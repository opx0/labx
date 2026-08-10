import type { ActionType } from "@/lib/domain/actions";
import { type DataHubConfig, DataHubError } from "./client";

// The privileged path. Imported only by the Gateway. Takes raw credentials —
// not a DataHubClient — because the read client deliberately cannot write.

const UPDATE_DESCRIPTION = `
  mutation($urn: String!, $description: String!) {
    updateDescription(input: { resourceUrn: $urn, description: $description })
  }`;

const ADD_TAG = `
  mutation($tagUrn: String!, $urn: String!) {
    addTag(input: { tagUrn: $tagUrn, resourceUrn: $urn })
  }`;

const REMOVE_TAG = `
  mutation($tagUrn: String!, $urn: String!) {
    removeTag(input: { tagUrn: $tagUrn, resourceUrn: $urn })
  }`;

const UPDATE_DEPRECATION = `
  mutation($urn: String!, $deprecated: Boolean!, $note: String) {
    updateDeprecation(input: { urn: $urn, deprecated: $deprecated, note: $note })
  }`;

const tagUrn = (tag: string) => (tag.startsWith("urn:li:tag:") ? tag : `urn:li:tag:${tag}`);

async function graphql<T>(
  config: DataHubConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${config.gmsUrl}/api/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new DataHubError("graphql request failed", res.status);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new DataHubError(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new DataHubError("graphql returned no data");
  return body.data;
}

// Returns the provider's acknowledgement only — not proof the mutation landed.
// The Gateway reads actual state back separately.
export async function executeMutation(
  config: DataHubConfig,
  type: ActionType,
  target: string,
  params: Record<string, string>,
  provenance = "",
): Promise<{ acknowledged: boolean }> {
  switch (type) {
    case "UPDATE_DESCRIPTION": {
      const d = await graphql<{ updateDescription: boolean }>(config, UPDATE_DESCRIPTION, {
        urn: target,
        description: params.description ?? "",
      });
      return { acknowledged: d.updateDescription };
    }
    case "ADD_TAG": {
      const d = await graphql<{ addTag: boolean }>(config, ADD_TAG, {
        tagUrn: tagUrn(params.tag ?? ""),
        urn: target,
      });
      return { acknowledged: d.addTag };
    }
    case "REMOVE_TAG": {
      const d = await graphql<{ removeTag: boolean }>(config, REMOVE_TAG, {
        tagUrn: tagUrn(params.tag ?? ""),
        urn: target,
      });
      return { acknowledged: d.removeTag };
    }
    case "CHANGE_LIFECYCLE": {
      const d = await graphql<{ updateDeprecation: boolean }>(config, UPDATE_DEPRECATION, {
        urn: target,
        deprecated: params.lifecycle === "DEPRECATED",
        note: provenance,
      });
      return { acknowledged: d.updateDeprecation };
    }
  }
}
