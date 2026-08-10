"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { runAgent } from "@/lib/agent/agent";
import { engine, type TARGETS } from "@/lib/demo/engine";
import type { ActionType } from "@/lib/domain/actions";

async function run<T>(fn: () => Promise<T>) {
  try {
    await fn();
  } catch (e) {
    engine.state.events.push({
      id: randomUUID(),
      at: Date.now(),
      type: "INTERNAL_ERROR",
      detail: e instanceof Error ? e.message : String(e),
      severity: "bad",
    });
  }
  revalidatePath("/");
}

export async function proposeAction(formData: FormData) {
  const target = String(formData.get("target") ?? "customer_prod") as keyof typeof TARGETS;
  const actionType = String(formData.get("actionType") ?? "CHANGE_LIFECYCLE") as ActionType;
  const params: Record<string, string> =
    actionType === "CHANGE_LIFECYCLE"
      ? { lifecycle: "DEPRECATED" }
      : actionType === "UPDATE_DESCRIPTION"
        ? { description: "Retired by governed agent" }
        : { tag: "Deprecated" };
  await run(() => engine.propose(target, actionType, params));
}

export async function approveAction() {
  await run(() => engine.approve());
}

export async function rejectAction() {
  await run(() => engine.reject());
}

export async function revokeAction() {
  await run(() => engine.revoke());
}

export async function injectDriftAction() {
  await run(() => engine.injectDrift());
}

export async function executeAction() {
  await run(() => engine.execute());
}

export async function replanAction() {
  await run(() => engine.replan());
}

export async function resetAction() {
  await run(() => engine.reset());
}

export async function refreshAction() {
  await run(() => engine.refreshCurrent());
}

export async function askAgentAction(formData: FormData) {
  const intent = String(formData.get("intent") ?? "").trim();
  if (!intent) return;
  await run(async () => {
    engine.state.events.push({
      id: randomUUID(),
      at: Date.now(),
      type: "GOAL_CREATED",
      detail: intent,
      severity: "info",
    });
    const { proposal, explanation } = await runAgent(intent);
    engine.state.events.push({
      id: randomUUID(),
      at: Date.now(),
      type: proposal ? "AGENT_PROPOSED" : "AGENT_DECLINED",
      detail: explanation.replace(/\s+/g, " ").slice(0, 220),
      severity: proposal ? "info" : "warn",
    });
    if (proposal) await engine.propose(proposal.targetKey, proposal.actionType, proposal.params);
  });
}
