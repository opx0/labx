// Drives the real domain against a real DataHub. Nothing here is simulated —
// the UI only renders what the policy engine and Gateway actually return.

import { randomUUID } from "node:crypto";
import { DataHubClient, type DataHubConfig } from "@/lib/datahub/client";
import { PrismaAuthorizationStore } from "@/lib/db/authorization-store";
import {
  type AuditRefs,
  loadAuditTimeline,
  recordAuditEvent,
  recordAuthorizedChain,
  recordExecution,
  recordRejectedChain,
} from "@/lib/db/repository";
import { loadOrCreateSigningKeypair } from "@/lib/db/signing-key";
import { ACTION_REGISTRY, type ActionType, validateAction } from "@/lib/domain/actions";
import { issueAuthorization, type SignedAuthorization } from "@/lib/domain/authorization";
import { fingerprint, hashRecord } from "@/lib/domain/canonical";
import type { Context } from "@/lib/domain/context";
import {
  contextDependenciesFor,
  DEFAULT_POLICY_SET,
  evaluatePolicy,
  type PolicyDecision,
} from "@/lib/domain/policy";
import { executeAuthorizedAction, type GatewayResult } from "@/lib/gateway/gateway";
import { addLineageEdge, removeLineageEdge, setDeprecation } from "./out-of-band";
import { CANDIDATES, DRIFT_URN, TARGETS } from "./targets";

export { CANDIDATES, DRIFT_URN, TARGETS } from "./targets";

export type AuditEvent = {
  readonly id: string;
  readonly at: number;
  readonly type: string;
  readonly detail: string;
  readonly severity: "info" | "good" | "warn" | "bad";
};

export type ScenarioState = {
  phase:
    | "IDLE"
    | "EVALUATED"
    | "AWAITING_APPROVAL"
    | "AUTHORIZED"
    | "DRIFT_DETECTED"
    | "COMPLETED"
    | "EXECUTED_UNVERIFIED"
    | "REJECTED"
    | "REVOKED"
    | "BLOCKED";
  targetKey: keyof typeof TARGETS;
  actionType: ActionType;
  params: Record<string, string>;
  decision: PolicyDecision | null;
  approvedContext: Context | null;
  approvedFingerprint: string | null;
  currentContext: Context | null;
  currentFingerprint: string | null;
  authorizationLabel: string | null;
  authorizationExpiresAt: number | null;
  lastResult: GatewayResult | null;
  events: AuditEvent[];
  authCounter: number;
};

function freshState(): ScenarioState {
  return {
    phase: "IDLE",
    targetKey: "customer_prod",
    actionType: "CHANGE_LIFECYCLE",
    params: { lifecycle: "DEPRECATED" },
    decision: null,
    approvedContext: null,
    approvedFingerprint: null,
    currentContext: null,
    currentFingerprint: null,
    authorizationLabel: null,
    authorizationExpiresAt: null,
    lastResult: null,
    events: [],
    authCounter: 0,
  };
}

const APPROVER = process.env.APPROVER_URN ?? "urn:li:corpuser:human-1";
const PRINCIPAL = "urn:li:corpuser:agent-1";

class Engine {
  state = freshState();
  private store = new PrismaAuthorizationStore();
  private keys = loadOrCreateSigningKeypair();
  private auth: SignedAuthorization | null = null;
  private actionHash = "";
  private deps_fields: string[] = [];
  private chain: { actionId: string; authorizationId: string; approvalId: string } | null = null;
  private hydrated = false;

  /** Rebuild the visible timeline from the durable audit trail on first render. */
  async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const rows = await loadAuditTimeline();
      if (this.state.events.length === 0) {
        this.state.events = rows.map((r) => ({
          id: r.id,
          at: r.at.getTime(),
          type: r.type,
          detail: r.detail,
          severity: (["info", "good", "warn", "bad"].includes(r.severity)
            ? r.severity
            : "info") as AuditEvent["severity"],
        }));
      }
    } catch {
      // Database down: the in-memory timeline still works for this process.
    }
  }

  private config(): DataHubConfig {
    const gmsUrl = process.env.DATAHUB_GMS_URL;
    const token = process.env.DATAHUB_TOKEN;
    if (!gmsUrl || !token) {
      throw new Error("DATAHUB_GMS_URL and DATAHUB_TOKEN must be set (see .env.local)");
    }
    return { gmsUrl, token };
  }

  private client() {
    return new DataHubClient(this.config());
  }

  private log(
    type: string,
    detail: string,
    severity: AuditEvent["severity"] = "info",
    refs?: AuditRefs,
  ) {
    this.state.events.push({ id: randomUUID(), at: Date.now(), type, detail, severity });
    // The durable trail must not depend on the request completing.
    recordAuditEvent({ type, severity, detail, refs }).catch(() => undefined);
  }

  private gatewayDeps() {
    const config = this.config();
    return {
      client: new DataHubClient(config),
      datahub: config,
      store: this.store,
      publicKeyPem: this.keys.publicKeyPem,
      policy: { policyId: DEFAULT_POLICY_SET.id, policyVersion: DEFAULT_POLICY_SET.version },
      now: () => Date.now(),
      candidatesFor: () => CANDIDATES,
    };
  }

  async reset() {
    const config = this.config();
    // Remove the drift edge and reinstate the dataset so a run is repeatable.
    await removeLineageEdge(config, DRIFT_URN, TARGETS.customer_prod).catch(() => undefined);
    await setDeprecation(config, TARGETS.customer_prod, false).catch(() => undefined);
    this.state = freshState();
    this.auth = null;
    this.chain = null;
    this.log("DEMO_RESET", "Drift edge removed, target reinstated to ACTIVE", "info");
    return this.state;
  }

  async propose(
    targetKey: keyof typeof TARGETS,
    actionType: ActionType,
    params: Record<string, string>,
  ) {
    const target = TARGETS[targetKey];
    const parsed = validateAction(actionType, target, params);
    if (!parsed.ok) {
      this.log("VALIDATION_ERROR", parsed.errors.join("; "), "bad");
      return this.state;
    }
    // Hash and execute the validated params, so the approve-time hash always
    // matches what the Gateway recomputes.
    params = parsed.action.params;

    this.state = { ...freshState(), events: this.state.events, targetKey, actionType, params };
    this.log("ACTION_PROPOSED", `${actionType} on ${targetKey}`, "info");

    const def = ACTION_REGISTRY[actionType];
    this.deps_fields = contextDependenciesFor(DEFAULT_POLICY_SET, actionType, def.requiresContext);
    this.actionHash = await hashRecord({ type: actionType, target, ...params });

    const client = this.client();
    const ctx = await client.readContext(target, this.deps_fields, CANDIDATES);
    const fp = await fingerprint(ctx, this.deps_fields);
    this.log(
      "PASSPORT_CREATED",
      `Fingerprint ${fp.slice(0, 12)}… over ${this.deps_fields.join(", ")}`,
      "info",
    );

    const decision = evaluatePolicy(DEFAULT_POLICY_SET, actionType, ctx, def.requiresContext);
    this.state.decision = decision;
    this.state.approvedContext = ctx;
    this.state.approvedFingerprint = fp;
    this.state.currentContext = ctx;
    this.state.currentFingerprint = fp;

    this.log(
      "POLICY_EVALUATED",
      `${decision.decision} (${decision.risk}) — ${decision.reasons.join("; ") || "no rule matched"}`,
      decision.decision === "BLOCK" ? "bad" : decision.decision === "REVIEW" ? "warn" : "good",
    );

    if (decision.decision === "BLOCK") {
      this.state.phase = "BLOCKED";
      this.log("AUTHORIZATION_WITHHELD", "Policy BLOCK — no authorization is issued", "bad");
    } else if (decision.decision === "REVIEW") {
      this.state.phase = "AWAITING_APPROVAL";
      this.log("APPROVAL_REQUESTED", "Human approval required for this exact context", "warn");
    } else {
      this.state.phase = "EVALUATED";
    }
    return this.state;
  }

  async approve() {
    const s = this.state;
    if (!s.decision || !s.approvedFingerprint) return s;
    if (s.decision.decision === "BLOCK") return s;

    s.authCounter += 1;
    const label = `AUTH-${String(s.authCounter).padStart(3, "0")}`;
    const auth = issueAuthorization(
      {
        id: randomUUID(),
        principal: PRINCIPAL,
        actionType: s.actionType,
        target: TARGETS[s.targetKey],
        actionHash: this.actionHash,
        passportFingerprint: s.approvedFingerprint,
        policyId: s.decision.policyId,
        policyVersion: s.decision.policyVersion,
        approvalId: randomUUID(),
        ttlSeconds: 900,
        now: Date.now(),
      },
      this.keys.privateKeyPem,
    );
    this.auth = auth;
    this.chain = await recordAuthorizedChain({
      principal: PRINCIPAL,
      approver: APPROVER,
      actionType: s.actionType,
      target: TARGETS[s.targetKey],
      params: s.params,
      actionHash: this.actionHash,
      context: s.approvedContext ?? {},
      declaredFields: this.deps_fields,
      fingerprint: s.approvedFingerprint,
      decision: s.decision,
      authorization: auth,
    });
    s.authorizationLabel = label;
    s.authorizationExpiresAt = auth.claims.expiresAt;
    s.phase = "AUTHORIZED";
    this.log(
      "APPROVAL_GRANTED",
      `${APPROVER} approved against ${s.approvedFingerprint.slice(0, 12)}…`,
      "good",
      { actionId: this.chain.actionId, approvalId: this.chain.approvalId },
    );
    this.log(
      "AUTHORIZATION_ISSUED",
      `${label}, expires in 15 min, bound to that fingerprint`,
      "good",
      {
        actionId: this.chain.actionId,
        authorizationId: this.chain.authorizationId,
      },
    );
    return s;
  }

  async reject() {
    const s = this.state;
    if (s.phase !== "AWAITING_APPROVAL" || !s.decision || !s.approvedFingerprint) return s;

    const rejected = await recordRejectedChain({
      principal: PRINCIPAL,
      approver: APPROVER,
      approvalId: randomUUID(),
      actionType: s.actionType,
      target: TARGETS[s.targetKey],
      params: s.params,
      actionHash: this.actionHash,
      context: s.approvedContext ?? {},
      declaredFields: this.deps_fields,
      fingerprint: s.approvedFingerprint,
      decision: s.decision,
    }).catch(() => null);

    s.phase = "REJECTED";
    this.auth = null;
    this.chain = null;
    this.log(
      "APPROVAL_REJECTED",
      `${APPROVER} rejected the proposal — no authorization exists`,
      "warn",
      rejected ? { actionId: rejected.actionId, approvalId: rejected.approvalId } : undefined,
    );
    return s;
  }

  async revoke() {
    const s = this.state;
    if (!this.auth) return s;
    const id = this.auth.claims.id;
    const revoked = await this.store.revoke(id);
    if (revoked) {
      s.phase = "REVOKED";
      s.lastResult = null;
      this.log(
        "AUTHORIZATION_REVOKED",
        `${s.authorizationLabel ?? id.slice(0, 8)} revoked by ${APPROVER} — ACTIVE → REVOKED, unusable forever`,
        "warn",
        { authorizationId: id },
      );
      this.auth = null;
    } else {
      this.log("REVOKE_FAILED", `authorization is no longer ACTIVE`, "warn", {
        authorizationId: id,
      });
    }
    return s;
  }

  async injectDrift() {
    const client = this.client();
    await addLineageEdge(this.config(), DRIFT_URN, TARGETS.customer_prod);
    this.log(
      "ENVIRONMENT_CHANGED",
      "fraud_alerts became a critical downstream of customer_prod",
      "warn",
    );

    // Aspect reads are immediately consistent, but poll briefly so the UI
    // never renders a half-applied world.
    for (let i = 0; i < 40; i++) {
      const { count } = await client.countCriticalDownstreams(TARGETS.customer_prod, CANDIDATES);
      if (count === 3) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await this.refreshCurrent();
    return this.state;
  }

  async refreshCurrent() {
    const s = this.state;
    if (this.deps_fields.length === 0) return s;
    const client = this.client();
    const ctx = await client.readContext(TARGETS[s.targetKey], this.deps_fields, CANDIDATES);
    s.currentContext = ctx;
    try {
      s.currentFingerprint = await fingerprint(ctx, this.deps_fields);
    } catch {
      s.currentFingerprint = null;
    }
    return s;
  }

  async execute() {
    const s = this.state;
    if (!this.auth) return s;
    const authorizationId = this.auth.claims.id;
    const result = await executeAuthorizedAction(this.gatewayDeps(), {
      authorization: this.auth,
      principal: PRINCIPAL,
      actionType: s.actionType,
      target: TARGETS[s.targetKey],
      params: s.params,
      contextDependencies: this.deps_fields,
      approvedContext: s.approvedContext ?? undefined,
    });
    s.lastResult = result;

    if (result.ok) {
      // Success is claimed only when the postcondition verified against
      // DataHub itself. Anything else is an executed-but-unproven state.
      const refs = { authorizationId, actionId: this.chain?.actionId };
      if (result.verification === "VERIFIED_SUCCESS") {
        s.phase = "COMPLETED";
        this.log("EXECUTION_SUCCEEDED", "Mutation applied to DataHub", "good", refs);
        this.log(
          "VERIFICATION_SUCCEEDED",
          `${result.verification} — ${result.receipt.postcondition}`,
          "good",
          refs,
        );
      } else {
        s.phase = "EXECUTED_UNVERIFIED";
        this.log(
          "EXECUTION_UNVERIFIED",
          `${result.verification} — ${result.receipt.postcondition}`,
          result.verification === "POSTCONDITION_FAILED" ? "bad" : "warn",
          refs,
        );
      }
      if (this.chain) {
        await recordExecution({
          authorizationId: this.chain.authorizationId,
          actionId: this.chain.actionId,
          idempotencyKey: `${this.chain.authorizationId}:${this.actionHash}`,
          outcome: result.verification,
          errorCode: result.receipt.providerError ?? undefined,
          receipt: {
            target: result.receipt.target,
            actionType: result.receipt.actionType,
            params: result.receipt.params,
            fingerprintAtExecution: result.receipt.fingerprintAtExecution,
            postcondition: result.receipt.postcondition,
            verification: result.receipt.verification,
            observedAfter: result.receipt.observedAfter,
          },
        }).catch(() =>
          this.log(
            "RECEIPT_PERSIST_FAILED",
            "Execution happened but its receipt was not persisted",
            "warn",
          ),
        );
      }
    } else {
      const refs = { authorizationId, actionId: this.chain?.actionId };
      if (result.code === "CONTEXT_DRIFT") {
        s.phase = "DRIFT_DETECTED";
        s.currentFingerprint = result.drift?.currentFingerprint ?? s.currentFingerprint;
        s.currentContext = result.drift?.currentContext ?? s.currentContext;
        this.log(
          "AUTHORIZATION_INVALIDATED",
          "Authorization permanently INVALIDATED in Postgres — stale authority cannot be reused",
          "bad",
          refs,
        );
        this.log("MUTATION_NOT_EXECUTED", "DataHub was not modified", "good", refs);
      } else {
        this.log(result.code, result.message, "bad", refs);
      }
      // Refusals are part of the durable audit trail, not just the in-memory
      // timeline — a drift refusal is the product's headline event.
      if (this.chain) {
        await recordExecution({
          authorizationId: this.chain.authorizationId,
          actionId: this.chain.actionId,
          idempotencyKey: `${this.chain.authorizationId}:refused:${randomUUID()}`,
          outcome: "REFUSED",
          errorCode: result.code,
        }).catch(() =>
          this.log("RECEIPT_PERSIST_FAILED", "Refusal was not persisted to Postgres", "warn"),
        );
      }
    }
    await this.refreshCurrent();
    return s;
  }

  async replan() {
    const s = this.state;
    this.log("ACTION_REPLANNED", "Agent re-evaluates against the changed world", "info");
    this.auth = null;
    s.lastResult = null;
    return this.propose(s.targetKey, s.actionType, s.params);
  }
}

const globalRef = globalThis as unknown as { __dhxEngine?: Engine };
if (!globalRef.__dhxEngine) globalRef.__dhxEngine = new Engine();
export const engine: Engine = globalRef.__dhxEngine;
