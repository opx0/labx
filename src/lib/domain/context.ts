// A field we could not read must never look like a field that is empty.
// A narrowed DataHub token returns less rather than erroring, which would
// silently turn "production AND PII -> REVIEW" into ALLOW.

export type Scalar = string | number | boolean;

export type ContextValue =
  | { readonly status: "observed"; readonly value: Scalar }
  | { readonly status: "observed-set"; readonly value: readonly Scalar[] }
  | { readonly status: "absent" }
  | { readonly status: "unreadable"; readonly reason: string };

export type Context = Readonly<Record<string, ContextValue>>;

export const observed = (value: Scalar): ContextValue => ({ status: "observed", value });
export const observedSet = (value: readonly Scalar[]): ContextValue => ({
  status: "observed-set",
  value,
});
export const absent = (): ContextValue => ({ status: "absent" });
export const unreadable = (reason: string): ContextValue => ({ status: "unreadable", reason });

export function unreadableFields(context: Context, fields: readonly string[]): string[] {
  return fields.filter((f) => {
    const v = context[f];
    return v === undefined || v.status === "unreadable";
  });
}
