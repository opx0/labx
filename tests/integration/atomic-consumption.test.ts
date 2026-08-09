/**
 * Proves the invariant the whole replay-protection story rests on (§17, §60):
 * an authorization can be consumed exactly once, even under concurrency.
 *
 * This talks to a real Postgres. An in-memory fake cannot prove it, because
 * the bug being excluded is a race between two database sessions.
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaAuthorizationStore } from "@/lib/db/authorization-store";

const prisma = new PrismaClient();
const store = new PrismaAuthorizationStore();

/** Minimal object graph — the FK chain requires each parent to exist. */
async function seedAuthorization(
  opts: { expiresInMs?: number; state?: "ACTIVE" | "REVOKED" } = {},
) {
  const action = await prisma.action.create({
    data: {
      principal: "urn:li:corpuser:agent-1",
      type: "CHANGE_LIFECYCLE",
      target: "urn:li:dataset:(urn:li:dataPlatform:demo,customer_prod,PROD)",
      params: { lifecycle: "DEPRECATED" },
      hash: `hash-${crypto.randomUUID()}`,
    },
  });
  const passport = await prisma.passport.create({
    data: {
      actionId: action.id,
      target: action.target,
      context: { environment: { status: "observed", value: "PROD" } },
      declaredFields: ["environment"],
      fingerprint: `fp-${crypto.randomUUID()}`,
      schemaVersion: "1",
    },
  });
  const decision = await prisma.policyDecision.create({
    data: {
      actionId: action.id,
      decision: "REVIEW",
      risk: "CRITICAL",
      policyId: "datahubx-default",
      policyVersion: 1,
      reasons: ["test"],
      matchedRules: ["production-pii-lifecycle"],
      contextDependencies: ["environment"],
    },
  });
  const approval = await prisma.approval.create({
    data: {
      actionId: action.id,
      policyDecisionId: decision.id,
      actionHash: action.hash,
      passportFingerprint: passport.fingerprint,
      principal: action.principal,
      approver: "urn:li:corpuser:human-1",
      status: "APPROVED",
      decidedAt: new Date(),
    },
  });
  return prisma.authorization.create({
    data: {
      actionId: action.id,
      passportId: passport.id,
      approvalId: approval.id,
      principal: action.principal,
      actionType: action.type,
      target: action.target,
      actionHash: action.hash,
      passportFingerprint: passport.fingerprint,
      policyId: "datahubx-default",
      policyVersion: 1,
      nonce: crypto.randomUUID(),
      signature: "test-signature",
      state: opts.state ?? "ACTIVE",
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 900_000)),
    },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.action.deleteMany(); // cascades through the graph
  await prisma.$disconnect();
});

describe("atomic authorization consumption", () => {
  it("a single consume succeeds", async () => {
    const auth = await seedAuthorization();
    expect(await store.consume(auth.id)).toBe(true);
    expect(await store.getState(auth.id)).toBe("CONSUMED");
  });

  it("a second consume is denied — replay", async () => {
    const auth = await seedAuthorization();
    expect(await store.consume(auth.id)).toBe(true);
    expect(await store.consume(auth.id)).toBe(false);
  });

  it("EXACTLY ONE of 20 concurrent consumers wins", async () => {
    const auth = await seedAuthorization();

    // Fired together, resolved together: this is the double-spend window.
    const results = await Promise.all(Array.from({ length: 20 }, () => store.consume(auth.id)));

    const winners = results.filter(Boolean).length;
    expect(winners).toBe(1);
    expect(results.filter((r) => !r).length).toBe(19);
    expect(await store.getState(auth.id)).toBe("CONSUMED");
  });

  it("holds across many independent authorizations run concurrently", async () => {
    const auths = await Promise.all(Array.from({ length: 10 }, () => seedAuthorization()));

    // 10 authorizations x 5 racers each, all interleaved.
    const outcomes = await Promise.all(
      auths.flatMap((a) =>
        Array.from({ length: 5 }, () => store.consume(a.id).then((ok) => [a.id, ok] as const)),
      ),
    );

    for (const a of auths) {
      const wins = outcomes.filter(([id, ok]) => id === a.id && ok).length;
      expect(wins, `authorization ${a.id}`).toBe(1);
    }
  });

  it("an expired authorization cannot be consumed", async () => {
    const auth = await seedAuthorization({ expiresInMs: -1000 });
    expect(await store.consume(auth.id)).toBe(false);
    expect(await store.getState(auth.id)).toBe("EXPIRED");
  });

  it("a revoked authorization cannot be consumed", async () => {
    const auth = await seedAuthorization({ state: "REVOKED" });
    expect(await store.consume(auth.id)).toBe(false);
  });

  it("revocation races consumption — never both", async () => {
    const auth = await seedAuthorization();
    const [consumed, revoked] = await Promise.all([store.consume(auth.id), store.revoke(auth.id)]);
    expect(consumed && revoked).toBe(false);
    expect(consumed || revoked).toBe(true);
  });

  it("an unknown authorization has no state", async () => {
    expect(await store.getState(crypto.randomUUID())).toBeNull();
  });
});

describe("database-enforced invariants", () => {
  it("rejects a duplicate nonce (§17)", async () => {
    const first = await seedAuthorization();
    const action = await prisma.action.findUniqueOrThrow({ where: { id: first.actionId } });

    await expect(
      prisma.authorization.create({
        data: {
          actionId: first.actionId,
          passportId: first.passportId,
          approvalId: first.approvalId,
          principal: action.principal,
          actionType: action.type,
          target: action.target,
          actionHash: action.hash,
          passportFingerprint: first.passportFingerprint,
          policyId: "datahubx-default",
          policyVersion: 1,
          nonce: first.nonce, // <- the duplicate
          signature: "x",
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate idempotency key (§59)", async () => {
    const auth = await seedAuthorization();
    const key = `idem-${crypto.randomUUID()}`;
    const mk = () =>
      prisma.execution.create({
        data: {
          authorizationId: auth.id,
          actionId: auth.actionId,
          idempotencyKey: key,
          outcome: "VERIFIED_SUCCESS",
        },
      });
    await mk();
    await expect(mk()).rejects.toThrow();
  });
});
