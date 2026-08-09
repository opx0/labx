import { google } from "@ai-sdk/google";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { DataHubClient } from "@/lib/datahub/client";
import { CANDIDATES, TARGETS } from "@/lib/demo/targets";
import { ACTION_REGISTRY, ACTION_TYPES, validateAction } from "@/lib/domain/actions";
import { contextDependenciesFor, DEFAULT_POLICY_SET, evaluatePolicy } from "@/lib/domain/policy";
import { connectDataHubMcp } from "./mcp";

// Discovery runs on DataHub's official MCP server. The governance read does not:
// MCP search and lineage resolve against Elasticsearch, which lags, so the
// Passport is built from aspect reads instead. Staleness costs the agent a
// suggestion; it must never cost a security decision.
//
// The agent has no tool that mutates DataHub. MCP mutation tools stay disabled,
// and propose_action submits a proposal rather than executing one.

export type Proposal = {
  targetKey: keyof typeof TARGETS;
  actionType: (typeof ACTION_TYPES)[number];
  params: Record<string, string>;
  rationale: string;
};

const client = () =>
  new DataHubClient({
    gmsUrl: process.env.DATAHUB_GMS_URL ?? "",
    token: process.env.DATAHUB_TOKEN ?? "",
  });

// One MCP process per server, not per request: uvx spawn costs seconds.
let mcp: ReturnType<typeof connectDataHubMcp> | null = null;
const datahubMcp = () => {
  mcp ??= connectDataHubMcp();
  return mcp;
};

export function governanceTools(onPropose: (p: Proposal) => void) {
  return {
    inspect_governance_context: tool({
      description:
        "Read a dataset's governance context by URN — environment, tags, lifecycle, critical dependency count — and what policy would decide for a given action. Use this before proposing anything.",
      inputSchema: z.object({
        target: z.enum(Object.keys(TARGETS) as [string, ...string[]]),
        actionType: z.enum(ACTION_TYPES),
      }),
      execute: async ({ target, actionType }) => {
        const key = target as keyof typeof TARGETS;
        const def = ACTION_REGISTRY[actionType];
        const fields = contextDependenciesFor(DEFAULT_POLICY_SET, actionType, def.requiresContext);
        const ctx = await client().readContext(TARGETS[key], fields, CANDIDATES);
        const decision = evaluatePolicy(DEFAULT_POLICY_SET, actionType, ctx, def.requiresContext);
        return { context: ctx, decision: decision.decision, reasons: decision.reasons };
      },
    }),

    propose_action: tool({
      description:
        "Propose one governed action. This does NOT execute it — it enters policy evaluation and may require human approval.",
      // Explicit optional fields, not a free-form record: models fill a named
      // schema reliably and guess at an open object.
      inputSchema: z.object({
        target: z.enum(Object.keys(TARGETS) as [string, ...string[]]),
        actionType: z.enum(ACTION_TYPES),
        lifecycle: z.enum(["ACTIVE", "DEPRECATED"]).optional(),
        tag: z.string().optional(),
        description: z.string().optional(),
        rationale: z.string(),
      }),
      execute: async ({ target, actionType, rationale, ...rest }) => {
        const key = target as keyof typeof TARGETS;
        const params = Object.fromEntries(
          Object.entries(rest).filter(([, v]) => v !== undefined),
        ) as Record<string, string>;
        const parsed = validateAction(actionType, TARGETS[key], params);
        if (!parsed.ok) return { accepted: false, errors: parsed.errors };
        onPropose({ targetKey: key, actionType, params: parsed.action.params, rationale });
        return { accepted: true, note: "Proposal submitted for policy evaluation." };
      },
    }),
  };
}

const SYSTEM = `You govern data changes in DataHub. You cannot mutate anything directly.

Datasets you may act on: ${Object.keys(TARGETS).join(", ")}.
Use the DataHub MCP tools to explore. Always call inspect_governance_context before
proposing, because only it reports what policy will decide.

Propose exactly one action via propose_action, then stop.
If policy would BLOCK, say so plainly and propose nothing.`;

export async function runAgent(intent: string) {
  let proposal: Proposal | null = null;
  const { tools: mcpTools, names } = await datahubMcp();

  const { text } = await generateText({
    model: google("gemini-2.5-flash"),
    system: SYSTEM,
    prompt: intent,
    tools: { ...mcpTools, ...governanceTools((p) => (proposal = p)) },
    stopWhen: stepCountIs(8),
  });

  return { proposal: proposal as Proposal | null, explanation: text, mcpTools: names };
}
