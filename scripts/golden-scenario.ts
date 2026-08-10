/**
 * The golden scenario (spec §23, §26) run against a REAL DataHub.
 *
 *   propose -> passport P1 -> policy REVIEW -> approve -> authorize
 *   -> reality changes (2 -> 3 critical dependencies)
 *   -> gateway re-reads, detects drift, REFUSES, mutation not executed
 *   -> replan -> fresh passport P2 -> fresh approval -> fresh authorization
 *   -> execute -> verify
 *
 * Every assertion here is checked against DataHub itself, not against our own
 * bookkeeping. The critical one is that the *provider state* is unchanged
 * after the drift refusal — otherwise "we blocked it" would be a claim, not a
 * fact.
 */

import { randomUUID } from "node:crypto";
import { DataHubClient } from "../src/lib/datahub/client";
import { M_UPDATE_LINEAGE } from "../src/lib/datahub/mutations";
import { PrismaAuthorizationStore } from "../src/lib/db/authorization-store";
import { prisma } from "../src/lib/db/client";
import { recordAuthorizedChain, recordExecution } from "../src/lib/db/repository";
import { ACTION_REGISTRY, validateAction } from "../src/lib/domain/actions";
import { generateSigningKeypair, issueAuthorization } from "../src/lib/domain/authorization";
import { fingerprint, hashRecord } from "../src/lib/domain/canonical";
import {
  contextDependenciesFor,
  DEFAULT_POLICY_SET,
  evaluatePolicy,
} from "../src/lib/domain/policy";
import { executeAuthorizedAction } from "../src/lib/gateway/gateway";

const GMS = process.env.DATAHUB_GMS_URL ?? "http://localhost:18080";
const TOKEN = process.env.DATAHUB_TOKEN ?? "";
const P = "urn:li:dataset:(urn:li:dataPlatform:demo,{},PROD)";
const TARGET = P.replace("{}", "customer_prod");
const DRIFT = P.replace("{}", "fraud_alerts");
const CANDIDATES = ["revenue_daily", "exec_dashboard_feed", "fraud_alerts"].map((n) =>
  P.replace("{}", n),
);

const c = {
  ok: (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`),
  no: (s: string) => console.log(`  \x1b[31m✗\x1b[0m ${s}`),
  hd: (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`),
  kv: (k: string, v: unknown) => console.log(`    ${k.padEnd(26)} ${String(v)}`),
};

let failures = 0;
const expect = (cond: boolean, msg: string) => {
  if (cond) c.ok(msg);
  else {
    c.no(msg);
    failures++;
  }
};

async function main() {
  if (!TOKEN) throw new Error("DATAHUB_TOKEN is required");

  const client = new DataHubClient({ gmsUrl: GMS, token: TOKEN });
  const store = new PrismaAuthorizationStore();
  const { privateKeyPem, publicKeyPem } = generateSigningKeypair();
  const deps = {
    client,
    store,
    publicKeyPem,
    now: () => Date.now(),
    candidatesFor: () => CANDIDATES,
  };

  const PRINCIPAL = "urn:li:corpuser:agent-1";
  const parsed = validateAction("CHANGE_LIFECYCLE", TARGET, { lifecycle: "DEPRECATED" });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  const action = parsed.action;
  const actionHash = await hashRecord({
    type: action.type,
    target: action.target,
    ...action.params,
  });
  const deps_fields = contextDependenciesFor(
    DEFAULT_POLICY_SET,
    action.type,
    ACTION_REGISTRY[action.type].requiresContext,
  );

  // -- reset drift edge so the run is repeatable -----------------------------
  await client.graphql(
    `mutation($d:String!,$u:String!){ updateLineage(input:{edgesToAdd:[],edgesToRemove:[{downstreamUrn:$d,upstreamUrn:$u}]}) }`,
    { d: DRIFT, u: TARGET },
  );

  c.hd("1. AGENT PROPOSES · PASSPORT P1 · POLICY");
  const ctx1 = await client.readContext(TARGET, deps_fields, CANDIDATES);
  const fp1 = await fingerprint(ctx1, deps_fields);
  const decision = evaluatePolicy(
    DEFAULT_POLICY_SET,
    action.type,
    ctx1,
    ACTION_REGISTRY[action.type].requiresContext,
  );
  c.kv("action", `${action.type} ${action.params.lifecycle}`);
  c.kv("target", "customer_prod");
  c.kv("critical dependencies", (ctx1.critical_dependency_count as { value?: number }).value);
  c.kv("decision", `${decision.decision} (${decision.risk})`);
  c.kv("passport P1", `${fp1.slice(0, 16)}…`);
  for (const r of decision.reasons) c.kv("reason", r);
  expect(decision.decision === "REVIEW", "policy requires human review");
  expect(
    (ctx1.critical_dependency_count as { value?: number }).value === 2,
    "2 critical dependencies observed",
  );

  c.hd("2. HUMAN APPROVES · AUTHORIZATION AUTH-001");
  const approvalId = randomUUID();
  const auth1 = issueAuthorization(
    {
      id: randomUUID(),
      principal: PRINCIPAL,
      actionType: action.type,
      target: action.target,
      actionHash,
      passportFingerprint: fp1,
      policyId: decision.policyId,
      policyVersion: decision.policyVersion,
      approvalId,
      ttlSeconds: 900,
      now: Date.now(),
    },
    privateKeyPem,
  );
  const chain1 = await recordAuthorizedChain({
    principal: PRINCIPAL,
    approver: "urn:li:corpuser:human-1",
    actionType: action.type,
    target: action.target,
    params: action.params,
    actionHash,
    context: ctx1,
    declaredFields: deps_fields,
    fingerprint: fp1,
    decision,
    authorization: auth1,
  });
  c.kv("approved against", `${fp1.slice(0, 16)}…`);
  c.kv("authorization", `AUTH-001 (${auth1.claims.id.slice(0, 8)}…)`);
  c.kv("persisted", `action ${chain1.actionId.slice(0, 8)}… → passport → approval → authorization`);

  c.hd("3. REALITY CHANGES · a third critical dependency appears");
  const before = await client.readVerificationState(TARGET);
  await client.graphql(M_UPDATE_LINEAGE, { downstreamUrn: DRIFT, upstreamUrn: TARGET });
  let count = 0;
  for (let i = 0; i < 100; i++) {
    ({ count } = await client.countCriticalDownstreams(TARGET, CANDIDATES));
    if (count === 3) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  c.kv("critical dependencies", `2 → ${count}`);
  expect(count === 3, "drift is observable");

  c.hd("4. STALE AUTHORIZATION IS PRESENTED TO THE GATEWAY");
  const r1 = await executeAuthorizedAction(deps, {
    authorization: auth1,
    principal: PRINCIPAL,
    actionType: action.type,
    target: action.target,
    params: action.params,
    actionHash,
    contextDependencies: deps_fields,
    approvedContext: ctx1,
  });
  c.kv("result", r1.ok ? "EXECUTED" : r1.code);
  if (!r1.ok && r1.drift) {
    c.kv("approved fingerprint", `${r1.drift.approvedFingerprint.slice(0, 16)}…`);
    c.kv("current  fingerprint", `${r1.drift.currentFingerprint.slice(0, 16)}…`);
  }
  expect(!r1.ok && r1.code === "CONTEXT_DRIFT", "gateway returns CONTEXT_DRIFT");
  expect(!r1.executed, "MUTATION NOT EXECUTED");

  const after = await client.readVerificationState(TARGET);
  expect(
    JSON.stringify(before) === JSON.stringify(after),
    "DataHub state is byte-identical — nothing was mutated",
  );
  c.kv("lifecycle in DataHub", after.lifecycle);

  c.hd("5. AGENT REPLANS · FRESH PASSPORT P2 · FRESH APPROVAL");
  const ctx2 = await client.readContext(TARGET, deps_fields, CANDIDATES);
  const fp2 = await fingerprint(ctx2, deps_fields);
  const decision2 = evaluatePolicy(
    DEFAULT_POLICY_SET,
    action.type,
    ctx2,
    ACTION_REGISTRY[action.type].requiresContext,
  );
  c.kv("passport P2", `${fp2.slice(0, 16)}…`);
  c.kv("decision", decision2.decision);
  expect(fp2 !== fp1, "P2 differs from P1");

  const auth2 = issueAuthorization(
    {
      id: randomUUID(),
      principal: PRINCIPAL,
      actionType: action.type,
      target: action.target,
      actionHash,
      passportFingerprint: fp2,
      policyId: decision2.policyId,
      policyVersion: decision2.policyVersion,
      approvalId: randomUUID(),
      ttlSeconds: 900,
      now: Date.now(),
    },
    privateKeyPem,
  );
  const chain2 = await recordAuthorizedChain({
    principal: PRINCIPAL,
    approver: "urn:li:corpuser:human-1",
    actionType: action.type,
    target: action.target,
    params: action.params,
    actionHash,
    context: ctx2,
    declaredFields: deps_fields,
    fingerprint: fp2,
    decision: decision2,
    authorization: auth2,
  });
  c.kv("authorization", `AUTH-002 (${auth2.claims.id.slice(0, 8)}…)`);

  c.hd("6. EXECUTE WITH FRESH AUTHORITY · VERIFY");
  const r2 = await executeAuthorizedAction(deps, {
    authorization: auth2,
    principal: PRINCIPAL,
    actionType: action.type,
    target: action.target,
    params: action.params,
    actionHash,
    contextDependencies: deps_fields,
    approvedContext: ctx2,
  });
  c.kv("result", r2.ok ? "EXECUTED" : r2.code);
  if (r2.ok) {
    c.kv("verification", r2.verification);
    c.kv("postcondition", r2.receipt.postcondition);
    c.kv("observed lifecycle", r2.receipt.observedAfter.lifecycle);
  }
  expect(r2.ok, "execution succeeded");
  expect(r2.ok && r2.verification === "VERIFIED_SUCCESS", "postcondition verified against DataHub");

  if (r2.ok) {
    await recordExecution({
      authorizationId: auth2.claims.id,
      actionId: chain2.actionId,
      idempotencyKey: `${auth2.claims.id}:${actionHash}`,
      outcome: r2.verification,
      receipt: {
        target: r2.receipt.target,
        actionType: r2.receipt.actionType,
        params: r2.receipt.params,
        fingerprintAtExecution: r2.receipt.fingerprintAtExecution,
        postcondition: r2.receipt.postcondition,
        verification: r2.receipt.verification,
        observedAfter: r2.receipt.observedAfter,
      },
    });
  }

  const persisted = await prisma.authorization.findUnique({ where: { id: auth2.claims.id } });
  expect(persisted?.state === "CONSUMED", "authorization is CONSUMED in Postgres");
  const stale = await prisma.authorization.findUnique({ where: { id: auth1.claims.id } });
  expect(stale?.state === "ACTIVE", "the drifted authorization was never consumed");

  c.hd("7. SECURITY PROPERTIES");
  const replay = await executeAuthorizedAction(deps, {
    authorization: auth2,
    principal: PRINCIPAL,
    actionType: action.type,
    target: action.target,
    params: action.params,
    actionHash,
    contextDependencies: deps_fields,
  });
  expect(!replay.ok && replay.code === "AUTHORIZATION_REPLAY", "replay of AUTH-002 is denied");

  const tampered = {
    ...auth2,
    claims: { ...auth2.claims, target: P.replace("{}", "regulated_core") },
  };
  const forged = await executeAuthorizedAction(deps, {
    authorization: tampered,
    principal: PRINCIPAL,
    actionType: action.type,
    target: tampered.claims.target,
    params: action.params,
    actionHash,
    contextDependencies: deps_fields,
  });
  expect(
    !forged.ok && forged.code === "AUTHORIZATION_INVALID",
    "tampered authorization is rejected",
  );

  // restore for the next run
  await client.graphql(
    `mutation($u:String!){ updateDeprecation(input:{urn:$u, deprecated:false}) }`,
    { u: TARGET },
  );

  c.hd(
    failures === 0
      ? "\x1b[32mGOLDEN SCENARIO PASSED\x1b[0m"
      : `\x1b[31m${failures} FAILURE(S)\x1b[0m`,
  );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n\x1b[31mFATAL\x1b[0m", e);
  process.exit(1);
});
