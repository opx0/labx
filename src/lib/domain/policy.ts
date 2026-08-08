import type { ActionType, Risk } from "./actions";
import type { Context, ContextValue } from "./context";

// Deterministic: no clock, no randomness, no I/O, no LLM. Each rule declares
// the context fields it reads; the Passport is derived from those declarations.

export type Decision = "ALLOW" | "REVIEW" | "BLOCK";

export type Rule = {
  readonly id: string;
  readonly description: string;
  readonly dependsOn: readonly string[];
  readonly appliesTo: readonly ActionType[];
  readonly decision: Decision;
  readonly risk: Risk;
  readonly matches: (ctx: Context) => boolean;
  readonly reason: string;
};

export type PolicySet = {
  readonly id: string;
  readonly version: number;
  readonly rules: readonly Rule[];
};

export type PolicyDecision = {
  readonly decision: Decision;
  readonly risk: Risk;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly reasons: readonly string[];
  readonly matchedRules: readonly string[];
  readonly contextDependencies: readonly string[];
};

const str = (v: ContextValue | undefined) =>
  v?.status === "observed" && typeof v.value === "string" ? v.value : null;
const num = (v: ContextValue | undefined) =>
  v?.status === "observed" && typeof v.value === "number" ? v.value : null;
const set = (v: ContextValue | undefined): readonly string[] =>
  v?.status === "observed-set" ? v.value.map(String) : [];

export const DEFAULT_POLICY_SET: PolicySet = {
  id: "datahubx-default",
  version: 1,
  rules: [
    {
      id: "protected-asset",
      description: "Protected assets may never be mutated by an agent",
      dependsOn: ["tags"],
      appliesTo: ["UPDATE_DESCRIPTION", "ADD_TAG", "REMOVE_TAG", "CHANGE_LIFECYCLE"],
      decision: "BLOCK",
      risk: "CRITICAL",
      matches: (ctx) => set(ctx.tags).includes("Protected"),
      reason: "Target is a protected asset",
    },
    {
      id: "production-pii-lifecycle",
      description: "Lifecycle change on production PII requires a human",
      dependsOn: ["environment", "tags", "critical_dependency_count"],
      appliesTo: ["CHANGE_LIFECYCLE"],
      decision: "REVIEW",
      risk: "CRITICAL",
      matches: (ctx) => str(ctx.environment) === "PROD" && set(ctx.tags).includes("PII"),
      reason: "Target is production and contains PII; lifecycle mutation requires human approval",
    },
    {
      id: "production-critical-dependents",
      description: "Deprecating something with critical dependents requires a human",
      dependsOn: ["environment", "critical_dependency_count"],
      appliesTo: ["CHANGE_LIFECYCLE"],
      decision: "REVIEW",
      risk: "HIGH",
      matches: (ctx) =>
        str(ctx.environment) === "PROD" && (num(ctx.critical_dependency_count) ?? 0) > 0,
      reason: "Target has critical downstream dependencies",
    },
    {
      id: "production-tag-change",
      description: "Tag changes in production are reviewed",
      dependsOn: ["environment"],
      appliesTo: ["ADD_TAG", "REMOVE_TAG"],
      decision: "REVIEW",
      risk: "MEDIUM",
      matches: (ctx) => str(ctx.environment) === "PROD",
      reason: "Tag mutation in production requires human approval",
    },
  ],
};

const SEVERITY: Record<Decision, number> = { ALLOW: 0, REVIEW: 1, BLOCK: 2 };
const RISK: Record<Risk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

// Computed before context is read, so the reader knows what to fetch and the
// fingerprint covers exactly the decision-relevant fields.
export function contextDependenciesFor(
  policySet: PolicySet,
  actionType: ActionType,
  actionRequires: readonly string[],
): string[] {
  const deps = new Set(actionRequires);
  for (const rule of policySet.rules) {
    if (rule.appliesTo.includes(actionType)) for (const d of rule.dependsOn) deps.add(d);
  }
  return [...deps].sort();
}

export function evaluatePolicy(
  policySet: PolicySet,
  actionType: ActionType,
  context: Context,
  actionRequires: readonly string[],
): PolicyDecision {
  const matched = policySet.rules.filter(
    (r) => r.appliesTo.includes(actionType) && r.matches(context),
  );

  let decision: Decision = "ALLOW";
  let risk: Risk = "LOW";
  for (const r of matched) {
    if (SEVERITY[r.decision] > SEVERITY[decision]) decision = r.decision;
    if (RISK[r.risk] > RISK[risk]) risk = r.risk;
  }

  return {
    decision,
    risk,
    policyId: policySet.id,
    policyVersion: policySet.version,
    reasons: matched.map((r) => r.reason),
    matchedRules: matched.map((r) => r.id),
    contextDependencies: contextDependenciesFor(policySet, actionType, actionRequires),
  };
}
