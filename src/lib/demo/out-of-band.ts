import type { DataHubConfig } from "@/lib/datahub/client";

// Simulates a THIRD PARTY changing the world out of band — the dbt job that
// wires up a new downstream, the platform team that un-deprecates a table.
// It is deliberately not part of the governed system: the agent and the app
// hold only the read-only client, and the Gateway is the only governed write
// path. This module exists so the demo can make reality change underneath an
// approved authorization.

async function graphql(
  config: DataHubConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${config.gmsUrl}/api/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`out-of-band graphql failed: HTTP ${res.status}`);
  const body = (await res.json()) as { errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
}

const ADD_EDGE = `
  mutation($downstreamUrn: String!, $upstreamUrn: String!) {
    updateLineage(input: {
      edgesToAdd: [{ downstreamUrn: $downstreamUrn, upstreamUrn: $upstreamUrn }],
      edgesToRemove: []
    })
  }`;

const REMOVE_EDGE = `
  mutation($downstreamUrn: String!, $upstreamUrn: String!) {
    updateLineage(input: {
      edgesToAdd: [],
      edgesToRemove: [{ downstreamUrn: $downstreamUrn, upstreamUrn: $upstreamUrn }]
    })
  }`;

const SET_DEPRECATION = `
  mutation($urn: String!, $deprecated: Boolean!) {
    updateDeprecation(input: { urn: $urn, deprecated: $deprecated })
  }`;

export const addLineageEdge = (config: DataHubConfig, downstreamUrn: string, upstreamUrn: string) =>
  graphql(config, ADD_EDGE, { downstreamUrn, upstreamUrn });

export const removeLineageEdge = (
  config: DataHubConfig,
  downstreamUrn: string,
  upstreamUrn: string,
) => graphql(config, REMOVE_EDGE, { downstreamUrn, upstreamUrn });

export const setDeprecation = (config: DataHubConfig, urn: string, deprecated: boolean) =>
  graphql(config, SET_DEPRECATION, { urn, deprecated });
