import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { governanceTools } from "@/lib/agent/agent";

const tools = governanceTools(() => {});
// Tool execute() expects runtime plumbing the SDK supplies; irrelevant here.
const OPTS = { toolCallId: "t", messages: [] } as never;
const names = Object.keys(tools);

describe("the agent has no way to mutate DataHub", () => {
  it("exposes exactly two governance tools", () => {
    expect(names.sort()).toEqual(["inspect_governance_context", "propose_action"]);
  });

  it("keeps DataHub MCP mutation tools disabled", () => {
    const src = readFileSync("src/lib/agent/mcp.ts", "utf8");
    expect(src).toMatch(/TOOLS_IS_MUTATION_ENABLED/);
    expect(src).toMatch(/const MUTATION_ENABLED = "false"/);
  });

  it("has no tool whose name suggests a write", () => {
    for (const n of names) {
      expect(n).not.toMatch(/mutat|execute|update|delete|deprecate|write|add_tag|remove/i);
    }
  });

  it("never imports the privileged mutation module", () => {
    // The boundary is structural: only the Gateway may reach mutations.ts.
    const src = readFileSync("src/lib/agent/agent.ts", "utf8");
    expect(src).not.toMatch(/datahub\/mutations/);
    expect(src).not.toMatch(/executeMutation|executeAuthorizedAction/);
  });

  it("only the Gateway imports the mutation module", () => {
    const importers = [
      "src/lib/gateway/gateway.ts",
      "src/lib/demo/engine.ts",
      "src/lib/agent/agent.ts",
    ].filter((f) => /from "@\/lib\/datahub\/mutations"/.test(readFileSync(f, "utf8")));
    // engine imports only the lineage constant used to inject drift in the demo.
    expect(importers).not.toContain("src/lib/agent/agent.ts");
    expect(importers).toContain("src/lib/gateway/gateway.ts");
  });

  it("propose_action does not execute — it returns a proposal", async () => {
    let captured: unknown = null;
    const t = governanceTools((p) => {
      captured = p;
    });
    const result = await t.propose_action.execute?.(
      {
        target: "customer_prod",
        actionType: "CHANGE_LIFECYCLE",
        lifecycle: "DEPRECATED",
        rationale: "t",
      },
      OPTS,
    );
    expect(result).toEqual({ accepted: true, note: "Proposal submitted for policy evaluation." });
    expect(captured).toMatchObject({ targetKey: "customer_prod", actionType: "CHANGE_LIFECYCLE" });
  });

  it("rejects an action the registry does not define", async () => {
    const t = governanceTools(() => {});
    const result = await t.propose_action.execute?.(
      { target: "customer_prod", actionType: "CHANGE_LIFECYCLE", rationale: "no params" },
      OPTS,
    );
    expect(result).toMatchObject({ accepted: false });
  });
});
