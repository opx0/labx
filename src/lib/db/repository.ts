import type { SignedAuthorization } from "@/lib/domain/authorization";
import { FINGERPRINT_SCHEMA_VERSION } from "@/lib/domain/canonical";
import type { Context } from "@/lib/domain/context";
import type { PolicyDecision } from "@/lib/domain/policy";
import { prisma } from "./client";

export type RecordedChain = {
  actionId: string;
  passportId: string;
  approvalId: string;
  authorizationId: string;
};

// One transaction so the audit chain is never half-written.
export async function recordAuthorizedChain(input: {
  principal: string;
  approver: string;
  actionType: string;
  target: string;
  params: Record<string, string>;
  actionHash: string;
  context: Context;
  declaredFields: readonly string[];
  fingerprint: string;
  decision: PolicyDecision;
  authorization: SignedAuthorization;
}): Promise<RecordedChain> {
  const c = input.authorization.claims;

  return prisma.$transaction(async (tx) => {
    const action = await tx.action.create({
      data: {
        principal: input.principal,
        type: input.actionType,
        target: input.target,
        params: input.params,
        hash: input.actionHash,
        status: "AUTHORIZED",
      },
    });

    const passport = await tx.passport.create({
      data: {
        actionId: action.id,
        target: input.target,
        context: input.context as unknown as object,
        declaredFields: [...input.declaredFields],
        fingerprint: input.fingerprint,
        schemaVersion: FINGERPRINT_SCHEMA_VERSION,
      },
    });

    const policyDecision = await tx.policyDecision.create({
      data: {
        actionId: action.id,
        decision: input.decision.decision,
        risk: input.decision.risk,
        policyId: input.decision.policyId,
        policyVersion: input.decision.policyVersion,
        reasons: [...input.decision.reasons],
        matchedRules: [...input.decision.matchedRules],
        contextDependencies: [...input.decision.contextDependencies],
      },
    });

    // The approval row carries the SAME id the signed authorization names, so
    // claims.approvalId resolves to a persisted approval, not a phantom.
    const approval = await tx.approval.create({
      data: {
        id: c.approvalId,
        actionId: action.id,
        policyDecisionId: policyDecision.id,
        actionHash: input.actionHash,
        passportFingerprint: input.fingerprint,
        principal: input.principal,
        approver: input.approver,
        status: "APPROVED",
        decidedAt: new Date(),
      },
    });

    const authorization = await tx.authorization.create({
      data: {
        id: c.id,
        actionId: action.id,
        passportId: passport.id,
        approvalId: approval.id,
        principal: c.principal,
        actionType: c.actionType,
        target: c.target,
        actionHash: c.actionHash,
        passportFingerprint: c.passportFingerprint,
        policyId: c.policyId,
        policyVersion: c.policyVersion,
        nonce: c.nonce,
        signature: input.authorization.signature,
        state: "ACTIVE",
        issuedAt: new Date(c.issuedAt),
        expiresAt: new Date(c.expiresAt),
      },
    });

    return {
      actionId: action.id,
      passportId: passport.id,
      approvalId: approval.id,
      authorizationId: authorization.id,
    };
  });
}

export async function recordExecution(input: {
  authorizationId: string;
  actionId: string;
  idempotencyKey: string;
  outcome: string;
  errorCode?: string;
  receipt?: {
    target: string;
    actionType: string;
    params: Record<string, string>;
    fingerprintAtExecution: string;
    postcondition: string;
    verification: string;
    observedAfter: Record<string, unknown>;
  };
}) {
  const { receipt, outcome, ...rest } = input;
  return prisma.execution.create({
    data: {
      ...rest,
      outcome: outcome as never,
      finishedAt: new Date(),
      receipt: receipt
        ? { create: { ...receipt, observedAfter: receipt.observedAfter as object } }
        : undefined,
    },
    include: { receipt: true },
  });
}
