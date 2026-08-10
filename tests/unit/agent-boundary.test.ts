import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { governanceTools } from "@/lib/agent/agent";

/** Every TypeScript source under src/, so a NEW importer cannot hide. */
const SOURCES = readdirSync("src", { recursive: true })
  .map(String)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => `src/${f}`)
  .sort();

/** Files importing a module by any spelling — aliased, relative, or dynamic. */
const importersOf = (module: string, exclude: string) => {
  const pattern = new RegExp(`(from\\s*|import\\s*\\(\\s*)["'][^"']*${module}["']`);
  return SOURCES.filter((f) => f !== exclude && pattern.test(readFileSync(f, "utf8")));
};

const tools = governanceTools(() => {});
// Tool execute() expects runtime plumbing the SDK supplies; irrelevant here.
const OPTS = { toolCallId: "t", messages: [] } as never;
const names = Object.keys(tools);

describe("the agent has no way to mutate DataHub", () => {
  it("exposes exactly two governance tools", () => {
    expect(names.sort()).toEqual(["inspect_governance_context", "propose_action"]);
  });

  it("keeps DataHub MCP mutation tools disabled, pinned, and allowlisted", () => {
    const src = readFileSync("src/lib/agent/mcp.ts", "utf8");
    expect(src).toMatch(/TOOLS_IS_MUTATION_ENABLED/);
    expect(src).toMatch(/const MUTATION_ENABLED = "false"/);
    // The env flag alone trusts upstream. Pin the version and require the
    // runtime allowlist filter, so @latest can never grow the agent a write tool.
    expect(src).not.toMatch(/@latest/);
    expect(src).toMatch(/mcp-server-datahub@\$\{MCP_SERVER_VERSION\}/);
    expect(src).toMatch(/READ_TOOL_ALLOWLIST/);
    expect(src).toMatch(/tools\.filter\(\(t\) => READ_TOOL_ALLOWLIST\.has\(t\.name\)\)/);
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

  it("only the Gateway imports the mutation module — across the whole tree", () => {
    expect(importersOf("datahub/mutations", "src/lib/datahub/mutations.ts")).toEqual([
      "src/lib/gateway/gateway.ts",
    ]);
  });

  it("only the demo engine imports the out-of-band world-change simulator", () => {
    // out-of-band.ts is a deliberate second write path — it simulates a third
    // party changing DataHub outside the governed system. That role is only
    // honest while nothing but the demo engine (and scripts/) can reach it.
    expect(importersOf("out-of-band", "src/lib/demo/out-of-band.ts")).toEqual([
      "src/lib/demo/engine.ts",
    ]);
    const agent = readFileSync("src/lib/agent/agent.ts", "utf8");
    expect(agent).not.toMatch(/out-of-band|setDeprecation|addLineageEdge|removeLineageEdge/);
  });

  it("the shared DataHub client cannot write — no GraphQL, no non-GET request", () => {
    // The agent and the app hold DataHubClient. If this file ever grows a
    // mutation path — GraphQL or an OpenAPI POST — holding the client becomes
    // a write capability again. It must stay all-GET (fetch's default).
    const src = readFileSync("src/lib/datahub/client.ts", "utf8");
    expect(src).not.toContain("/api/graphql");
    expect(src).not.toMatch(/mutation\s*\(/i);
    expect(src).not.toMatch(/method\s*:/);
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
