import { describe, expect, it } from "vitest";
import {
  canonicalize,
  fingerprint,
  hashRecord,
  UnreadableContextError,
} from "@/lib/domain/canonical";
import { absent, observed, observedSet, unreadable } from "@/lib/domain/context";

const FIELDS = ["environment", "tags", "critical_dependency_count"];

const ctx = (over: Record<string, ReturnType<typeof observed>> = {}) => ({
  environment: observed("PROD"),
  tags: observedSet(["PII", "Finance"]),
  critical_dependency_count: observed(2),
  ...over,
});

describe("canonicalize", () => {
  it("is stable across runs", async () => {
    const a = await fingerprint(ctx(), FIELDS);
    const b = await fingerprint(ctx(), FIELDS);
    expect(a).toBe(b);
  });

  it("ignores set ordering — equivalent contexts hash equally", async () => {
    const a = await fingerprint(ctx(), FIELDS);
    const b = await fingerprint(ctx({ tags: observedSet(["Finance", "PII"]) }), FIELDS);
    expect(a).toBe(b);
  });

  it("ignores key insertion order", async () => {
    const reordered = {
      critical_dependency_count: observed(2),
      environment: observed("PROD"),
      tags: observedSet(["PII", "Finance"]),
    };
    expect(await fingerprint(reordered, FIELDS)).toBe(await fingerprint(ctx(), FIELDS));
  });

  it("detects the drift the whole product exists for: 2 -> 3 dependencies", async () => {
    const approved = await fingerprint(ctx(), FIELDS);
    const current = await fingerprint(ctx({ critical_dependency_count: observed(3) }), FIELDS);
    expect(current).not.toBe(approved);
  });

  it("only covers declared fields — unrelated metadata does not invalidate authority", async () => {
    const withExtra = { ...ctx(), description: observed("edited by someone else") };
    expect(await fingerprint(withExtra, FIELDS)).toBe(await fingerprint(ctx(), FIELDS));
  });

  it("distinguishes absent from empty-set from empty-string", async () => {
    const f = ["tags"];
    const a = await fingerprint({ tags: absent() }, f);
    const b = await fingerprint({ tags: observedSet([]) }, f);
    const c = await fingerprint({ tags: observed("") }, f);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("distinguishes numeric 2 from string '2'", async () => {
    const f = ["critical_dependency_count"];
    const a = await fingerprint({ critical_dependency_count: observed(2) }, f);
    const b = await fingerprint({ critical_dependency_count: observed("2") }, f);
    expect(a).not.toBe(b);
  });

  it("normalises unicode so visually identical strings agree", async () => {
    const f = ["environment"];
    const composed = await fingerprint({ environment: observed("café") }, f);
    const decomposed = await fingerprint({ environment: observed("café") }, f);
    expect(composed).toBe(decomposed);
  });

  it("hashes the schema version in", () => {
    expect(canonicalize(ctx(), FIELDS)).toMatch(/^v1\{/);
  });
});

describe("fail closed on unreadable context", () => {
  it("refuses to fingerprint when a declared field could not be read", async () => {
    const poisoned = ctx({ tags: unreadable("token lacks privilege") });
    await expect(fingerprint(poisoned, FIELDS)).rejects.toBeInstanceOf(UnreadableContextError);
  });

  it("refuses when a declared field is missing entirely", async () => {
    const { tags: _dropped, ...partial } = ctx();
    await expect(fingerprint(partial, FIELDS)).rejects.toBeInstanceOf(UnreadableContextError);
  });

  it("does not care about unreadable fields nobody declared", async () => {
    const withNoise = { ...ctx(), owner: unreadable("not permitted") };
    await expect(fingerprint(withNoise, FIELDS)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the offending fields so the failure is diagnosable", async () => {
    const poisoned = ctx({ tags: unreadable("nope") });
    await expect(fingerprint(poisoned, FIELDS)).rejects.toThrow(/tags/);
  });
});

describe("hashRecord (action hash)", () => {
  it("is order independent", async () => {
    const a = await hashRecord({ type: "CHANGE_LIFECYCLE", target: "x", lifecycle: "DEPRECATED" });
    const b = await hashRecord({ lifecycle: "DEPRECATED", target: "x", type: "CHANGE_LIFECYCLE" });
    expect(a).toBe(b);
  });

  it("changes when any parameter changes", async () => {
    const a = await hashRecord({ type: "CHANGE_LIFECYCLE", target: "x", lifecycle: "DEPRECATED" });
    const b = await hashRecord({ type: "CHANGE_LIFECYCLE", target: "y", lifecycle: "DEPRECATED" });
    expect(a).not.toBe(b);
  });
});
