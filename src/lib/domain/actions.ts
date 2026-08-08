import { z } from "zod";

// The only operations an agent can propose. Provider-agnostic: nothing here
// knows DataHub exists.

export const ACTION_TYPES = [
  "UPDATE_DESCRIPTION",
  "ADD_TAG",
  "REMOVE_TAG",
  "CHANGE_LIFECYCLE",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type Params = Record<string, string>;
type Observed = Readonly<Record<string, unknown>>;

export type ActionDefinition = {
  readonly type: ActionType;
  readonly summary: string;
  readonly params: z.ZodType<Params>;
  readonly requiresContext: readonly string[];
  readonly baseRisk: Risk;
  readonly postcondition: {
    readonly describe: (p: Params) => string;
    readonly holds: (p: Params, after: Observed) => boolean;
  };
};

const tags = (o: Observed): string[] => (Array.isArray(o.tags) ? o.tags.map(String) : []);

export const ACTION_REGISTRY: Readonly<Record<ActionType, ActionDefinition>> = {
  UPDATE_DESCRIPTION: {
    type: "UPDATE_DESCRIPTION",
    summary: "Replace the editable description of a dataset",
    params: z.object({ description: z.string().min(1).max(4000) }),
    requiresContext: ["environment"],
    baseRisk: "LOW",
    postcondition: {
      describe: (p) => `editable description equals ${JSON.stringify(p.description)}`,
      // updateDescription writes editableDatasetProperties, not datasetProperties.
      holds: (p, after) => after.editableDescription === p.description,
    },
  },

  ADD_TAG: {
    type: "ADD_TAG",
    summary: "Attach a tag to a dataset",
    params: z.object({ tag: z.string().min(1) }),
    requiresContext: ["environment", "tags"],
    baseRisk: "MEDIUM",
    postcondition: {
      describe: (p) => `tags contain ${p.tag}`,
      holds: (p, after) => tags(after).includes(p.tag ?? ""),
    },
  },

  REMOVE_TAG: {
    type: "REMOVE_TAG",
    summary: "Detach a tag from a dataset",
    params: z.object({ tag: z.string().min(1) }),
    requiresContext: ["environment", "tags"],
    baseRisk: "MEDIUM",
    postcondition: {
      describe: (p) => `tags do not contain ${p.tag}`,
      holds: (p, after) => !tags(after).includes(p.tag ?? ""),
    },
  },

  CHANGE_LIFECYCLE: {
    type: "CHANGE_LIFECYCLE",
    summary: "Deprecate or reinstate a dataset",
    params: z.object({ lifecycle: z.enum(["ACTIVE", "DEPRECATED"]) }),
    requiresContext: ["environment", "tags", "lifecycle", "critical_dependency_count"],
    baseRisk: "CRITICAL",
    postcondition: {
      describe: (p) => `lifecycle is ${p.lifecycle}`,
      holds: (p, after) => after.lifecycle === p.lifecycle,
    },
  },
};

export function isActionType(v: string): v is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(v);
}

export type ValidatedAction = {
  readonly type: ActionType;
  readonly target: string;
  readonly params: Params;
};

export type ValidationResult =
  | { readonly ok: true; readonly action: ValidatedAction }
  | { readonly ok: false; readonly errors: readonly string[] };

export function validateAction(type: string, target: string, params: unknown): ValidationResult {
  if (!isActionType(type)) return { ok: false, errors: [`unsupported action type: ${type}`] };
  if (!target) return { ok: false, errors: ["target is required"] };

  const parsed = ACTION_REGISTRY[type].params.safeParse(params);
  return parsed.success
    ? { ok: true, action: { type, target, params: parsed.data } }
    : { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
