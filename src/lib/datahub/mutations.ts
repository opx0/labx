import type { ActionType } from "@/lib/domain/actions";
import type { DataHubClient } from "./client";

// The privileged path. Imported only by the Gateway.

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

export const M_UPDATE_LINEAGE = `
  mutation($downstreamUrn: String!, $upstreamUrn: String!) {
    updateLineage(input: {
      edgesToAdd: [{ downstreamUrn: $downstreamUrn, upstreamUrn: $upstreamUrn }],
      edgesToRemove: []
    })
  }`;

const tagUrn = (tag: string) => (tag.startsWith("urn:li:tag:") ? tag : `urn:li:tag:${tag}`);

// Returns the provider's acknowledgement only — not proof the mutation landed.
// The Gateway reads actual state back separately.
export async function executeMutation(
  client: DataHubClient,
  type: ActionType,
  target: string,
  params: Record<string, string>,
  provenance = "",
): Promise<{ acknowledged: boolean }> {
  switch (type) {
    case "UPDATE_DESCRIPTION": {
      const d = await client.graphql<{ updateDescription: boolean }>(UPDATE_DESCRIPTION, {
        urn: target,
        description: params.description ?? "",
      });
      return { acknowledged: d.updateDescription };
    }
    case "ADD_TAG": {
      const d = await client.graphql<{ addTag: boolean }>(ADD_TAG, {
        tagUrn: tagUrn(params.tag ?? ""),
        urn: target,
      });
      return { acknowledged: d.addTag };
    }
    case "REMOVE_TAG": {
      const d = await client.graphql<{ removeTag: boolean }>(REMOVE_TAG, {
        tagUrn: tagUrn(params.tag ?? ""),
        urn: target,
      });
      return { acknowledged: d.removeTag };
    }
    case "CHANGE_LIFECYCLE": {
      const d = await client.graphql<{ updateDeprecation: boolean }>(UPDATE_DEPRECATION, {
        urn: target,
        deprecated: params.lifecycle === "DEPRECATED",
        note: provenance,
      });
      return { acknowledged: d.updateDeprecation };
    }
  }
}
