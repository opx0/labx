/**
 * The Gateway's security boundary, provable without any infrastructure:
 * a fake context reader, an in-memory store, and a mocked provider write.
 *
 * Every test here is an attack a judge would try:
 *   - swap the params while keeping the approved authorization
 *   - tamper with the signed claims
 *   - replay a consumed authorization
 *   - retry an authorization after drift killed it
 *   - present authority after expiry
 *   - claim success the provider state does not confirm
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateSigningKeypair,
  issueAuthorization,
  type SignedAuthorization,
} from "@/lib/domain/authorization";
import { fingerprint, hashRecord } from "@/lib/domain/canonical";
import { type Context, observed, observedSet } from "@/lib/domain/context";
import {
  type AuthorizationStore,
  type ContextReader,
  executeAuthorizedAction,
  type GatewayDeps,
} from "@/lib/gateway/gateway";

vi.mock("@/lib/datahub/mutations", () => ({
  executeMutation: vi.fn(async () => ({ acknowledged: true })),
}));

import { executeMutation } from "@/lib/datahub/mutations";

const mutate = vi.mocked(executeMutation);

const TARGET = "urn:li:dataset:(urn:li:dataPlatform:demo,customer_prod,PROD)";
const PRINCIPAL = "urn:li:corpuser:agent-1";
const FIELDS = ["environment", "tags", "lifecycle", "critical_dependency_count"];

const world = (criticalDeps: number): Context => ({
  environment: observed("PROD"),
  tags: observedSet(["PII", "Finance"]),
  lifecycle: observed("ACTIVE"),
  critical_dependency_count: observed(criticalDeps),
});

class InMemoryStore implements AuthorizationStore {
  states = new Map<string, string>();
  async getState(id: string) {
    return this.states.get(id) ?? null;
  }
  async consume(id: string) {
    if (this.states.get(id) !== "ACTIVE") return false;
    this.states.set(id, "CONSUMED");
    return true;
  }
  async invalidate(id: string) {
    if (this.states.get(id) !== "ACTIVE") return false;
    this.states.set(id, "INVALIDATED");
    return true;
  }
}

class FakeReader implements ContextReader {
  constructor(
    public context: Context,
    public afterState: Record<string, unknown> = { lifecycle: "DEPRECATED", tags: [] },
    public verificationThrows = false,
  ) {}
  async readContext() {
    return this.context;
  }
  async readVerificationState() {
    if (this.verificationThrows) throw new Error("provider unreachable");
    return this.afterState;
  }
}

const keys = generateSigningKeypair();
const APPROVED_PARAMS = { lifecycle: "DEPRECATED" };

async function issue(
  store: InMemoryStore,
  passportContext: Context,
  overrides: { params?: Record<string, string>; ttlSeconds?: number } = {},
) {
  const params = overrides.params ?? APPROVED_PARAMS;
  const auth = issueAuthorization(
    {
      id: crypto.randomUUID(),
      principal: PRINCIPAL,
      actionType: "CHANGE_LIFECYCLE",
      target: TARGET,
      actionHash: await hashRecord({ type: "CHANGE_LIFECYCLE", target: TARGET, ...params }),
      passportFingerprint: await fingerprint(passportContext, FIELDS),
      policyId: "datahubx-default",
      policyVersion: 1,
      approvalId: crypto.randomUUID(),
      ttlSeconds: overrides.ttlSeconds ?? 900,
      now: Date.now(),
    },
    keys.privateKeyPem,
  );
  store.states.set(auth.claims.id, "ACTIVE");
  return auth;
}

function depsFor(reader: ContextReader, store: AuthorizationStore): GatewayDeps {
  return {
    client: reader,
    datahub: { gmsUrl: "http://fake", token: "fake" },
    store,
    publicKeyPem: keys.publicKeyPem,
    now: () => Date.now(),
    candidatesFor: () => [],
  };
}

function request(auth: SignedAuthorization, params: Record<string, string> = APPROVED_PARAMS) {
  return {
    authorization: auth,
    principal: PRINCIPAL,
    actionType: "CHANGE_LIFECYCLE",
    target: TARGET,
    params,
    contextDependencies: FIELDS,
  };
}

beforeEach(() => {
  mutate.mockClear();
});

describe("parameter binding", () => {
  it("refuses params that differ from the approved hash — and never mutates", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const r = await executeAuthorizedAction(depsFor(new FakeReader(world(2)), store), {
      ...request(auth, { lifecycle: "ACTIVE" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AUTHORIZATION_INVALID");
    expect(mutate).not.toHaveBeenCalled();
    // a rejected substitution is not consumption
    expect(await store.getState(auth.claims.id)).toBe("ACTIVE");
  });

  it("refuses a caller-supplied hash trick: the hash is recomputed, never trusted", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    // ExecuteRequest has no actionHash field at all — the only way to pass the
    // check is to present exactly the approved params.
    const r = await executeAuthorizedAction(
      depsFor(new FakeReader(world(2)), store),
      request(auth, { lifecycle: "ACTIVE", actionHash: auth.claims.actionHash }),
    );
    expect(r.ok).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("executes only the exact approved params", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const r = await executeAuthorizedAction(
      depsFor(new FakeReader(world(2)), store),
      request(auth),
    );
    expect(r.ok).toBe(true);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[3]).toEqual(APPROVED_PARAMS);
  });
});

describe("signature integrity", () => {
  it("rejects tampered claims even when every field-level check would pass", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const tampered = {
      ...auth,
      claims: { ...auth.claims, expiresAt: auth.claims.expiresAt + 3_600_000 },
    };
    const r = await executeAuthorizedAction(
      depsFor(new FakeReader(world(2)), store),
      request(tampered),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AUTHORIZATION_INVALID");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rejects an authorization signed by a different key", async () => {
    const store = new InMemoryStore();
    const otherKeys = generateSigningKeypair();
    const auth = issueAuthorization(
      {
        id: crypto.randomUUID(),
        principal: PRINCIPAL,
        actionType: "CHANGE_LIFECYCLE",
        target: TARGET,
        actionHash: await hashRecord({
          type: "CHANGE_LIFECYCLE",
          target: TARGET,
          ...APPROVED_PARAMS,
        }),
        passportFingerprint: await fingerprint(world(2), FIELDS),
        policyId: "datahubx-default",
        policyVersion: 1,
        approvalId: crypto.randomUUID(),
        ttlSeconds: 900,
        now: Date.now(),
      },
      otherKeys.privateKeyPem,
    );
    store.states.set(auth.claims.id, "ACTIVE");
    const r = await executeAuthorizedAction(
      depsFor(new FakeReader(world(2)), store),
      request(auth),
    );
    expect(r.ok).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("drift permanently kills authority", () => {
  it("CONTEXT_DRIFT transitions the authorization to INVALIDATED", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2)); // approved when 2 critical deps
    const r = await executeAuthorizedAction(
      depsFor(new FakeReader(world(3)), store), // world now has 3
      request(auth),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONTEXT_DRIFT");
    expect(await store.getState(auth.claims.id)).toBe("INVALIDATED");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("stays dead even if the world drifts back to the approved state", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const reader = new FakeReader(world(3));
    await executeAuthorizedAction(depsFor(reader, store), request(auth)); // drift

    reader.context = world(2); // world happens to match the approval again
    const r = await executeAuthorizedAction(depsFor(reader, store), request(auth));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("AUTHORIZATION_INVALID");
      expect(r.message).toContain("INVALIDATED");
    }
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("replay and expiry", () => {
  it("a consumed authorization cannot be replayed", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const deps = depsFor(new FakeReader(world(2)), store);
    expect((await executeAuthorizedAction(deps, request(auth))).ok).toBe(true);

    const replay = await executeAuthorizedAction(deps, request(auth));
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("AUTHORIZATION_REPLAY");
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("an expired authorization is refused before any provider contact", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2), { ttlSeconds: -1 });
    const r = await executeAuthorizedAction(
      depsFor(new FakeReader(world(2)), store),
      request(auth),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AUTHORIZATION_EXPIRED");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("an unknown authorization id is refused", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    store.states.delete(auth.claims.id);
    const r = await executeAuthorizedAction(
      depsFor(new FakeReader(world(2)), store),
      request(auth),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AUTHORIZATION_INVALID");
  });
});

describe("verification honesty", () => {
  it("reports POSTCONDITION_FAILED when the provider state does not confirm the write", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const reader = new FakeReader(world(2), { lifecycle: "ACTIVE", tags: [] }); // write did not land
    const r = await executeAuthorizedAction(depsFor(reader, store), request(auth));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verification).toBe("POSTCONDITION_FAILED");
      expect(r.verification).not.toBe("VERIFIED_SUCCESS");
    }
  });

  it("reports VERIFICATION_PENDING when the read-back fails — never success", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const reader = new FakeReader(world(2), {}, true);
    const r = await executeAuthorizedAction(depsFor(reader, store), request(auth));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verification).toBe("VERIFICATION_PENDING");
  });

  it("reports VERIFIED_SUCCESS only when the world confirms the postcondition", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const reader = new FakeReader(world(2), { lifecycle: "DEPRECATED", tags: [] });
    const r = await executeAuthorizedAction(depsFor(reader, store), request(auth));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verification).toBe("VERIFIED_SUCCESS");
  });

  it("never claims VERIFIED_SUCCESS when the provider call failed, even if the world already matches", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    mutate.mockRejectedValueOnce(new Error("401 unauthorized"));
    // the world was ALREADY deprecated — the postcondition holds without us
    const reader = new FakeReader(world(2), { lifecycle: "DEPRECATED", tags: [] });
    const r = await executeAuthorizedAction(depsFor(reader, store), request(auth));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verification).toBe("EXECUTION_UNKNOWN");
      expect(r.receipt.providerError).toContain("401");
    }
  });

  it("a definitive provider failure with an unchanged world returns PROVIDER_ERROR, not success", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    mutate.mockRejectedValueOnce(new Error("connection refused"));
    const reader = new FakeReader(world(2), { lifecycle: "ACTIVE", tags: [] });
    const r = await executeAuthorizedAction(depsFor(reader, store), request(auth));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("PROVIDER_ERROR");
      expect(r.message).toContain("connection refused");
    }
    // consume-before-mutate means the authorization is spent — fail-closed
    expect(await store.getState(auth.claims.id)).toBe("CONSUMED");
  });

  it("an unacknowledged mutation is never verified success", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    mutate.mockResolvedValueOnce({ acknowledged: false });
    const reader = new FakeReader(world(2), { lifecycle: "DEPRECATED", tags: [] });
    const r = await executeAuthorizedAction(depsFor(reader, store), request(auth));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verification).toBe("EXECUTION_UNKNOWN");
  });
});

describe("identity binding", () => {
  it("a different principal cannot use the authorization", async () => {
    const store = new InMemoryStore();
    const auth = await issue(store, world(2));
    const r = await executeAuthorizedAction(depsFor(new FakeReader(world(2)), store), {
      ...request(auth),
      principal: "urn:li:corpuser:agent-2",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AUTHORIZATION_INVALID");
    expect(mutate).not.toHaveBeenCalled();
  });
});
