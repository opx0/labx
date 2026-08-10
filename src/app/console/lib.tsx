import type { ContextValue } from "@/lib/domain/context";

// Shared helpers for the console section components. Keep pure and tiny.

export function renderValue(v: ContextValue | undefined): string {
  if (!v) return "—";
  switch (v.status) {
    case "observed":
      return String(v.value);
    case "observed-set":
      return v.value.length ? `[${v.value.join(", ")}]` : "[]";
    case "absent":
      return "absent";
    case "unreadable":
      return `UNREADABLE (${v.reason})`;
  }
}

/** customer_prod from urn:li:dataset:(urn:li:dataPlatform:demo,customer_prod,PROD) */
export function shortName(urn: string): string {
  const m = urn.match(/,([^,]+),[^,)]+\)?$/);
  return m?.[1] ?? urn;
}
