import {
  type Context,
  type ContextValue,
  observed,
  observedSet,
  unreadable,
} from "@/lib/domain/context";

// Passport reads use OpenAPI v3 aspect reads by URN, never searchAcrossLineage.
// Measured on a live instance, lineage search failed to reflect an added or
// removed edge within 30s and once returned the correct count over the wrong
// set. Aspect reads tracked the same changes in ~100-180ms. Search is fine for
// agent discovery; it must not feed a security decision.

export const CRITICAL_TAG = "urn:li:tag:Critical";

export type DataHubConfig = { readonly gmsUrl: string; readonly token: string };

export class DataHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DataHubError";
  }
}

type Aspects = Record<string, { value?: Record<string, unknown> } | undefined>;

const PASSPORT_ASPECTS = [
  // origin (fabric) lives on datasetKey; datasetProperties may not exist at all.
  "datasetKey",
  "datasetProperties",
  "globalTags",
  "deprecation",
  "editableDatasetProperties",
];

export class DataHubClient {
  constructor(private readonly config: DataHubConfig) {}

  private get headers() {
    return {
      Authorization: `Bearer ${this.config.token}`,
      "Content-Type": "application/json",
    };
  }

  async readAspects(urn: string, aspects: readonly string[]): Promise<Aspects | null> {
    const q = aspects.map((a) => `aspects=${encodeURIComponent(a)}`).join("&");
    const res = await fetch(
      `${this.config.gmsUrl}/openapi/v3/entity/dataset/${encodeURIComponent(urn)}?${q}`,
      { headers: this.headers },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new DataHubError(`aspect read failed for ${urn}`, res.status);
    return res.json() as Promise<Aspects>;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.config.gmsUrl}/api/graphql`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new DataHubError("graphql request failed", res.status);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new DataHubError(body.errors.map((e) => e.message).join("; "));
    if (!body.data) throw new DataHubError("graphql returned no data");
    return body.data;
  }

  private static tags(a: Aspects): string[] {
    return ((a.globalTags?.value?.tags ?? []) as { tag?: string }[])
      .map((t) => t.tag)
      .filter((t): t is string => typeof t === "string");
  }

  private static upstreams(a: Aspects): string[] {
    return ((a.upstreamLineage?.value?.upstreams ?? []) as { dataset?: string }[])
      .map((u) => u.dataset)
      .filter((u): u is string => typeof u === "string");
  }

  // Reverse lookup by asking each candidate what it points at. Only sees
  // candidates it was given — an entity nobody has observed is invisible.
  async countCriticalDownstreams(target: string, candidates: readonly string[]) {
    const results = await Promise.all(
      candidates.map(async (urn) => {
        try {
          return { urn, aspects: await this.readAspects(urn, ["upstreamLineage", "globalTags"]) };
        } catch {
          return { urn, failed: true as const };
        }
      }),
    );

    const members: string[] = [];
    const failures: string[] = [];
    for (const r of results) {
      if ("failed" in r) failures.push(r.urn);
      else if (
        r.aspects &&
        DataHubClient.upstreams(r.aspects).includes(target) &&
        DataHubClient.tags(r.aspects).includes(CRITICAL_TAG)
      ) {
        members.push(r.urn);
      }
    }
    return { count: members.length, members: members.sort(), failures };
  }

  async readContext(
    target: string,
    fields: readonly string[],
    candidates: readonly string[],
  ): Promise<Context> {
    let aspects: Aspects | null = null;
    let error: string | null = null;
    try {
      aspects = await this.readAspects(target, PASSPORT_ASPECTS);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const ctx: Record<string, ContextValue> = {};
    for (const field of fields) {
      if (error !== null) {
        ctx[field] = unreadable(error);
      } else if (aspects === null) {
        ctx[field] = unreadable(`target ${target} does not exist`);
      } else {
        ctx[field] = await this.readField(field, aspects, target, candidates);
      }
    }
    return ctx;
  }

  private async readField(
    field: string,
    aspects: Aspects,
    target: string,
    candidates: readonly string[],
  ): Promise<ContextValue> {
    switch (field) {
      case "environment": {
        const origin =
          aspects.datasetKey?.value?.origin ?? aspects.datasetProperties?.value?.origin;
        // Fabric is structural — its absence means we failed to read identity.
        return typeof origin === "string"
          ? observed(origin)
          : unreadable("no origin on datasetKey");
      }
      case "tags":
        return observedSet(DataHubClient.tags(aspects).map((t) => t.replace("urn:li:tag:", "")));
      case "lifecycle":
        return observed(aspects.deprecation?.value?.deprecated === true ? "DEPRECATED" : "ACTIVE");
      case "critical_dependency_count": {
        try {
          const { count, failures } = await this.countCriticalDownstreams(target, candidates);
          return failures.length > 0
            ? unreadable(`could not read ${failures.length} candidate(s)`)
            : observed(count);
        } catch (e) {
          return unreadable(e instanceof Error ? e.message : String(e));
        }
      }
      default:
        // A field with no reader is unknown, not empty. Fail closed.
        return unreadable(`no reader for field '${field}'`);
    }
  }

  async readVerificationState(target: string): Promise<Record<string, unknown>> {
    const a = await this.readAspects(target, [
      "globalTags",
      "deprecation",
      "editableDatasetProperties",
    ]);
    if (!a) return {};
    return {
      tags: DataHubClient.tags(a).map((t) => t.replace("urn:li:tag:", "")),
      lifecycle: a.deprecation?.value?.deprecated === true ? "DEPRECATED" : "ACTIVE",
      editableDescription: a.editableDatasetProperties?.value?.description ?? null,
    };
  }
}
