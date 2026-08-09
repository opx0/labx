import type { DataHubClient } from "@/lib/datahub/client";
import { executeMutation } from "@/lib/datahub/mutations";
import { ACTION_REGISTRY, type ActionType, isActionType } from "@/lib/domain/actions";
import { type SignedAuthorization, verifySignature } from "@/lib/domain/authorization";
import { fingerprint, UnreadableContextError } from "@/lib/domain/canonical";
import type { Context } from "@/lib/domain/context";

// The only privileged mutation path. Never trusts a caller-supplied Passport —
// it re-reads the world and recomputes the fingerprint itself.

export type GatewayErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHORIZATION_INVALID"
  | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_REPLAY"
  | "CONTEXT_DRIFT"
  | "CONTEXT_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "EXECUTION_UNKNOWN"
  | "POSTCONDITION_FAILED";

export type VerificationOutcome =
  | "VERIFIED_SUCCESS"
  | "POSTCONDITION_FAILED"
  | "VERIFICATION_PENDING"
  | "EXECUTION_UNKNOWN";

export type DriftDetail = {
  readonly approvedFingerprint: string;
  readonly currentFingerprint: string;
  readonly approvedContext: Context | null;
  readonly currentContext: Context;
};

export type Receipt = {
  readonly authorizationId: string;
  readonly target: string;
  readonly actionType: ActionType;
  readonly params: Record<string, string>;
  readonly fingerprintAtExecution: string;
  readonly postcondition: string;
  readonly verification: VerificationOutcome;
  readonly observedAfter: Record<string, unknown>;
  readonly executedAt: number;
};

export type GatewayResult =
  | {
      readonly ok: true;
      readonly executed: true;
      readonly verification: VerificationOutcome;
      readonly receipt: Receipt;
    }
  | {
      readonly ok: false;
      readonly executed: false;
      readonly code: GatewayErrorCode;
      readonly message: string;
      readonly drift?: DriftDetail;
    };

export interface AuthorizationStore {
  /** Atomic ACTIVE -> CONSUMED. Exactly one concurrent caller may see true. */
  consume(authorizationId: string): Promise<boolean>;
  getState(authorizationId: string): Promise<string | null>;
}

export type GatewayDeps = {
  readonly client: DataHubClient;
  readonly store: AuthorizationStore;
  readonly publicKeyPem: string;
  readonly now: () => number;
  readonly candidatesFor: (target: string) => readonly string[];
};

export type ExecuteRequest = {
  readonly authorization: SignedAuthorization;
  readonly principal: string;
  readonly actionType: string;
  readonly target: string;
  readonly params: Record<string, string>;
  readonly actionHash: string;
  readonly contextDependencies: readonly string[];
  /** Display only on drift; never trusted for the decision. */
  readonly approvedContext?: Context;
};

const fail = (code: GatewayErrorCode, message: string, drift?: DriftDetail): GatewayResult => ({
  ok: false,
  executed: false,
  code,
  message,
  drift,
});

export async function executeAuthorizedAction(
  deps: GatewayDeps,
  req: ExecuteRequest,
): Promise<GatewayResult> {
  const c = req.authorization.claims;

  if (!verifySignature(req.authorization, deps.publicKeyPem)) {
    return fail("AUTHORIZATION_INVALID", "signature verification failed");
  }

  const state = await deps.store.getState(c.id);
  if (state === null) return fail("AUTHORIZATION_INVALID", "unknown authorization");
  if (state === "CONSUMED") return fail("AUTHORIZATION_REPLAY", "authorization already consumed");
  if (state !== "ACTIVE") return fail("AUTHORIZATION_INVALID", `authorization is ${state}`);
  if (deps.now() >= c.expiresAt) return fail("AUTHORIZATION_EXPIRED", "authorization has expired");

  if (c.principal !== req.principal) return fail("AUTHORIZATION_INVALID", "principal mismatch");
  if (c.actionType !== req.actionType) return fail("AUTHORIZATION_INVALID", "action mismatch");
  if (c.target !== req.target) return fail("AUTHORIZATION_INVALID", "target mismatch");
  if (c.actionHash !== req.actionHash) return fail("AUTHORIZATION_INVALID", "parameter mismatch");
  if (!isActionType(req.actionType)) return fail("VALIDATION_ERROR", "unsupported action type");

  const def = ACTION_REGISTRY[req.actionType];

  let currentContext: Context;
  let currentFingerprint: string;
  try {
    currentContext = await deps.client.readContext(
      req.target,
      req.contextDependencies,
      deps.candidatesFor(req.target),
    );
    currentFingerprint = await fingerprint(currentContext, req.contextDependencies);
  } catch (e) {
    // Unreadable context is a security condition, not an outage.
    const message = e instanceof Error ? e.message : String(e);
    return fail(
      "CONTEXT_UNAVAILABLE",
      e instanceof UnreadableContextError
        ? `cannot establish current context: ${message}`
        : message,
    );
  }

  if (currentFingerprint !== c.passportFingerprint) {
    return fail("CONTEXT_DRIFT", "approved context no longer matches current context", {
      approvedFingerprint: c.passportFingerprint,
      currentFingerprint,
      approvedContext: req.approvedContext ?? null,
      currentContext,
    });
  }

  // Consume before mutating: the loser of a race never reaches the provider.
  if (!(await deps.store.consume(c.id))) {
    return fail("AUTHORIZATION_REPLAY", "authorization was consumed concurrently");
  }

  let acknowledged = false;
  let providerError: string | null = null;
  try {
    // Write the decision back so the next reader inherits the context.
    const provenance =
      `Governed by DataHubX. approval=${c.approvalId} principal=${c.principal} ` +
      `policy=${c.policyId} v${c.policyVersion} passport=${c.passportFingerprint.slice(0, 16)}`;
    ({ acknowledged } = await executeMutation(
      deps.client,
      req.actionType,
      req.target,
      req.params,
      provenance,
    ));
  } catch (e) {
    providerError = e instanceof Error ? e.message : String(e);
  }

  // A provider acknowledgement is not proof, and a provider failure is not
  // proof of non-execution. Read the world back either way.
  let observedAfter: Record<string, unknown> = {};
  let verification: VerificationOutcome;
  try {
    observedAfter = await deps.client.readVerificationState(req.target);
    verification = def.postcondition.holds(req.params, observedAfter)
      ? "VERIFIED_SUCCESS"
      : providerError !== null
        ? "EXECUTION_UNKNOWN"
        : "POSTCONDITION_FAILED";
  } catch {
    verification = "VERIFICATION_PENDING";
  }

  if (verification === "POSTCONDITION_FAILED" && !acknowledged && providerError !== null) {
    return fail("PROVIDER_ERROR", providerError);
  }

  return {
    ok: true,
    executed: true,
    verification,
    receipt: {
      authorizationId: c.id,
      target: req.target,
      actionType: req.actionType,
      params: req.params,
      fingerprintAtExecution: currentFingerprint,
      postcondition: def.postcondition.describe(req.params),
      verification,
      observedAfter,
      executedAt: deps.now(),
    },
  };
}
