import { describe, expect, it } from "vitest";
import { ACTION_REGISTRY, validateAction } from "@/lib/domain/actions";
import { observed, observedSet } from "@/lib/domain/context";
import { contextDependenciesFor, DEFAULT_POLICY_SET, evaluatePolicy } from "@/lib/domain/policy";

const evaluate = (
  type: Parameters<typeof evaluatePolicy>[1],
  ctx: Parameters<typeof evaluatePolicy>[2],
) => evaluatePolicy(DEFAULT_POLICY_SET, type, ctx, ACTION_REGISTRY[type].requiresContext);

const customerProd = {
  environment: observed("PROD"),
  tags: observedSet(["PII", "Finance"]),
  lifecycle: observed("ACTIVE"),
  critical_dependency_count: observed(2),
};

const analyticsTest = {
  environment: observed("DEV"),
  tags: observedSet([]),
  lifecycle: observed("ACTIVE"),
  critical_dependency_count: observed(0),
};

const regulatedCore = {
  environment: observed("PROD"),
  tags: observedSet(["Protected"]),
  lifecycle: observed("ACTIVE"),
  critical_dependency_count: observed(0),
};

describe("the three demo fixtures produce the three decisions (spec §22)", () => {
  it("customer_prod -> REVIEW", () => {
    const d = evaluate("CHANGE_LIFECYCLE", customerProd);
    expect(d.decision).toBe("REVIEW");
    expect(d.risk).toBe("CRITICAL");
    expect(d.matchedRules).toContain("production-pii-lifecycle");
  });

  it("analytics_test -> ALLOW", () => {
    expect(evaluate("CHANGE_LIFECYCLE", analyticsTest).decision).toBe("ALLOW");
  });

  it("regulated_core -> BLOCK", () => {
    const d = evaluate("CHANGE_LIFECYCLE", regulatedCore);
    expect(d.decision).toBe("BLOCK");
    expect(d.matchedRules).toContain("protected-asset");
  });
});

describe("determinism", () => {
  it("same input, same output", () => {
    const a = evaluate("CHANGE_LIFECYCLE", customerProd);
    const b = evaluate("CHANGE_LIFECYCLE", customerProd);
    expect(a).toEqual(b);
  });

  it("BLOCK absorbs REVIEW — severity wins regardless of rule order", () => {
    const both = {
      environment: observed("PROD"),
      tags: observedSet(["PII", "Protected"]),
      lifecycle: observed("ACTIVE"),
      critical_dependency_count: observed(2),
    };
    expect(evaluate("CHANGE_LIFECYCLE", both).decision).toBe("BLOCK");
  });

  it("records the policy version so authority is tied to it (§63)", () => {
    const d = evaluate("CHANGE_LIFECYCLE", customerProd);
    expect(d.policyId).toBe("datahubx-default");
    expect(d.policyVersion).toBe(1);
  });

  it("gives human-readable reasons, not just a verdict", () => {
    expect(evaluate("CHANGE_LIFECYCLE", customerProd).reasons.length).toBeGreaterThan(0);
  });
});

describe("declared context dependencies drive the Passport (§62)", () => {
  it("includes every field the applicable rules read", () => {
    const deps = contextDependenciesFor(
      DEFAULT_POLICY_SET,
      "CHANGE_LIFECYCLE",
      ACTION_REGISTRY.CHANGE_LIFECYCLE.requiresContext,
    );
    expect(deps).toEqual(["critical_dependency_count", "environment", "lifecycle", "tags"]);
  });

  it("does not drag in fields only other action types need", () => {
    const deps = contextDependenciesFor(
      DEFAULT_POLICY_SET,
      "UPDATE_DESCRIPTION",
      ACTION_REGISTRY.UPDATE_DESCRIPTION.requiresContext,
    );
    expect(deps).not.toContain("critical_dependency_count");
  });

  it("every rule that reads a field has declared it", () => {
    // Guards against a rule quietly depending on something unfingerprinted.
    for (const rule of DEFAULT_POLICY_SET.rules) {
      const body = rule.matches.toString();
      for (const field of ["environment", "tags", "critical_dependency_count", "lifecycle"]) {
        if (body.includes(`ctx.${field}`)) {
          expect(rule.dependsOn, `rule ${rule.id} reads ${field}`).toContain(field);
        }
      }
    }
  });
});

describe("action registry", () => {
  it("rejects an action type that does not exist", () => {
    const r = validateAction("DROP_TABLE", "urn:x", {});
    expect(r.ok).toBe(false);
  });

  it("rejects bad parameters", () => {
    const r = validateAction("CHANGE_LIFECYCLE", "urn:x", { lifecycle: "BANANA" });
    expect(r.ok).toBe(false);
  });

  it("accepts a valid action", () => {
    const r = validateAction("CHANGE_LIFECYCLE", "urn:x", { lifecycle: "DEPRECATED" });
    expect(r.ok).toBe(true);
  });

  it("UPDATE_DESCRIPTION verifies the editable aspect, not the ingestion one", () => {
    const pc = ACTION_REGISTRY.UPDATE_DESCRIPTION.postcondition;
    const params = { description: "hello" };
    expect(pc.holds(params, { editableDescription: "hello", description: "stale" })).toBe(true);
    expect(pc.holds(params, { editableDescription: "stale", description: "hello" })).toBe(false);
  });

  it("CHANGE_LIFECYCLE postcondition holds only on the requested value", () => {
    const pc = ACTION_REGISTRY.CHANGE_LIFECYCLE.postcondition;
    expect(pc.holds({ lifecycle: "DEPRECATED" }, { lifecycle: "DEPRECATED" })).toBe(true);
    expect(pc.holds({ lifecycle: "DEPRECATED" }, { lifecycle: "ACTIVE" })).toBe(false);
  });
});
