import type { ScenarioState } from "@/lib/demo/engine";
import styles from "./FlowStepper.module.css";

const STAGES = ["Propose", "Policy", "Approve", "Gateway", "Verify"] as const;

const PHASE_MAP: Record<ScenarioState["phase"], { active: number; tone?: "bad" | "good" }> = {
  IDLE: { active: -1 },
  EVALUATED: { active: 1 },
  BLOCKED: { active: 1 },
  AWAITING_APPROVAL: { active: 2 },
  AUTHORIZED: { active: 3 },
  DRIFT_DETECTED: { active: 3, tone: "bad" },
  REJECTED: { active: 3, tone: "bad" },
  REVOKED: { active: 3, tone: "bad" },
  EXECUTED_UNVERIFIED: { active: 4 },
  COMPLETED: { active: 4, tone: "good" },
};

export function FlowStepper({ phase }: { phase: ScenarioState["phase"] }) {
  const { active, tone } = PHASE_MAP[phase];
  return (
    <section className={`panel ${styles.stepper}`}>
      <ol className={styles.track} aria-label="Run pipeline">
        {STAGES.map((label, i) => {
          const state = i < active ? "done" : i === active ? (tone ?? "current") : "upcoming";
          return (
            <li
              key={label}
              className={`${styles.stage} ${styles[state]}`}
              aria-current={i === active ? "step" : undefined}
            >
              <span className={styles.node}>
                {state === "done" || state === "good" ? "✓" : state === "bad" ? "✕" : i + 1}
              </span>
              <span className={styles.label}>{label}</span>
            </li>
          );
        })}
      </ol>
      <p className={styles.caption}>
        Phase <span className={styles.phase}>{phase.replaceAll("_", " ")}</span>
      </p>
    </section>
  );
}
