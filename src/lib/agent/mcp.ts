import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { jsonSchema, tool } from "ai";

// DataHub's official MCP server, spawned over stdio. It ships with
// TOOLS_IS_MUTATION_ENABLED=false and we leave it false: the agent reads
// through DataHub's own tooling and writes only through our Gateway.
//
// Two defenses stack here, because the subprocess holds a live token:
//  - the version is pinned, so an upstream release cannot silently change
//    what that flag means or what tools exist;
//  - only tools on the read allowlist are wired to the model, so even a
//    server that exposes more never reaches the agent's registry.

const MCP_SERVER_VERSION = "0.6.0";
const MUTATION_ENABLED = "false";

/** The six read tools the server is known to expose. Nothing else is wired. */
const READ_TOOL_ALLOWLIST = new Set([
  "search",
  "get_lineage",
  "get_dataset_queries",
  "get_entities",
  "list_schema_fields",
  "get_lineage_paths_between",
]);

export async function connectDataHubMcp() {
  const client = new Client({ name: "datahubx", version: "1.0.0" });

  await client.connect(
    new StdioClientTransport({
      command: "uvx",
      args: [`mcp-server-datahub@${MCP_SERVER_VERSION}`],
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        DATAHUB_GMS_URL: process.env.DATAHUB_GMS_URL ?? "",
        DATAHUB_GMS_TOKEN: process.env.DATAHUB_TOKEN ?? "",
        TOOLS_IS_MUTATION_ENABLED: MUTATION_ENABLED,
      },
    }),
  );

  const { tools } = await client.listTools();
  const allowed = tools.filter((t) => READ_TOOL_ALLOWLIST.has(t.name));

  const wrapped = Object.fromEntries(
    allowed.map((t) => [
      t.name,
      tool({
        description: t.description ?? t.name,
        inputSchema: jsonSchema(t.inputSchema as Record<string, unknown>),
        execute: async (args) => {
          const res = await client.callTool({
            name: t.name,
            arguments: args as Record<string, unknown>,
          });
          return res.content;
        },
      }),
    ]),
  );

  return { tools: wrapped, names: allowed.map((t) => t.name), close: () => client.close() };
}
