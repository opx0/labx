import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { jsonSchema, tool } from "ai";

// DataHub's official MCP server, spawned over stdio. It ships with
// TOOLS_IS_MUTATION_ENABLED=false and we leave it false: the agent reads
// through DataHub's own tooling and writes only through our Gateway.

const MUTATION_ENABLED = "false";

export async function connectDataHubMcp() {
  const client = new Client({ name: "datahubx", version: "1.0.0" });

  await client.connect(
    new StdioClientTransport({
      command: "uvx",
      args: ["mcp-server-datahub@latest"],
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

  const wrapped = Object.fromEntries(
    tools.map((t) => [
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

  return { tools: wrapped, names: tools.map((t) => t.name), close: () => client.close() };
}
