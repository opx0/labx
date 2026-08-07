import { type Context, type Scalar, unreadableFields } from "./context";

// Canonical form: declared fields only, sorted; status tagged so `absent`,
// `[]` and `""` differ; sets sorted; strings NFC; version prefixed.
export const FINGERPRINT_SCHEMA_VERSION = "1";

export class UnreadableContextError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`cannot fingerprint: unreadable context fields: ${fields.join(", ")}`);
    this.name = "UnreadableContextError";
  }
}

function scalar(s: Scalar): string {
  if (typeof s === "string") return JSON.stringify(s.normalize("NFC"));
  if (typeof s === "boolean") return s ? "true" : "false";
  if (!Number.isFinite(s)) throw new Error(`non-finite number in context: ${s}`);
  return Number.isInteger(s) ? s.toFixed(0) : String(s);
}

export function canonicalize(context: Context, fields: readonly string[]): string {
  const bad = unreadableFields(context, fields);
  if (bad.length > 0) throw new UnreadableContextError(bad);

  const parts = [...fields].sort().map((field): string => {
    const v = context[field] as Exclude<ContextValue, { status: "unreadable" }>;
    const key = JSON.stringify(field.normalize("NFC"));
    if (v.status === "absent") return `${key}:absent`;
    if (v.status === "observed") return `${key}:value:${scalar(v.value)}`;
    return `${key}:set:[${v.value.map(scalar).sort().join(",")}]`;
  });

  return `v${FINGERPRINT_SCHEMA_VERSION}{${parts.join(";")}}`;
}

type ContextValue = Context[string];

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// async so unreadable context rejects rather than throwing synchronously —
// a caller using .catch() must not sail past a fail-closed condition.
export async function fingerprint(context: Context, fields: readonly string[]): Promise<string> {
  return sha256(canonicalize(context, fields));
}

export async function hashRecord(
  record: Record<string, Scalar | readonly Scalar[]>,
): Promise<string> {
  const parts = Object.keys(record)
    .sort()
    .map((k) => {
      const v = record[k];
      const rendered = Array.isArray(v)
        ? `[${v.map(scalar).sort().join(",")}]`
        : scalar(v as Scalar);
      return `${JSON.stringify(k.normalize("NFC"))}:${rendered}`;
    });
  return sha256(`v${FINGERPRINT_SCHEMA_VERSION}{${parts.join(";")}}`);
}
