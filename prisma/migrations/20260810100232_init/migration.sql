-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('ALLOW', 'REVIEW', 'BLOCK');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuthorizationState" AS ENUM ('ISSUED', 'ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "ExecutionOutcome" AS ENUM ('VERIFIED_SUCCESS', 'POSTCONDITION_FAILED', 'VERIFICATION_PENDING', 'EXECUTION_UNKNOWN', 'REFUSED');

-- CreateTable
CREATE TABLE "actions" (
    "id" TEXT NOT NULL,
    "principal" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passports" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "declaredFields" TEXT[],
    "fingerprint" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_decisions" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "decision" "Decision" NOT NULL,
    "risk" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "reasons" TEXT[],
    "matchedRules" TEXT[],
    "contextDependencies" TEXT[],
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "policyDecisionId" TEXT NOT NULL,
    "actionHash" TEXT NOT NULL,
    "passportFingerprint" TEXT NOT NULL,
    "principal" TEXT NOT NULL,
    "approver" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorizations" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "principal" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "actionHash" TEXT NOT NULL,
    "passportFingerprint" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "nonce" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "state" "AuthorizationState" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" "ExecutionOutcome" NOT NULL,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "fingerprintAtExecution" TEXT NOT NULL,
    "postcondition" TEXT NOT NULL,
    "verification" TEXT NOT NULL,
    "observedAfter" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "actionId" TEXT,
    "passportId" TEXT,
    "approvalId" TEXT,
    "authorizationId" TEXT,
    "executionId" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "actions_target_idx" ON "actions"("target");

-- CreateIndex
CREATE INDEX "passports_fingerprint_idx" ON "passports"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "authorizations_nonce_key" ON "authorizations"("nonce");

-- CreateIndex
CREATE INDEX "authorizations_state_expiresAt_idx" ON "authorizations"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "executions_idempotencyKey_key" ON "executions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_executionId_key" ON "receipts"("executionId");

-- CreateIndex
CREATE INDEX "audit_events_at_idx" ON "audit_events"("at");

-- CreateIndex
CREATE INDEX "audit_events_actionId_idx" ON "audit_events"("actionId");

-- AddForeignKey
ALTER TABLE "passports" ADD CONSTRAINT "passports_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_policyDecisionId_fkey" FOREIGN KEY ("policyDecisionId") REFERENCES "policy_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "passports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "authorizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
