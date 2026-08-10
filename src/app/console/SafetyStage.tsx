import type { ScenarioState } from "@/lib/demo/engine";
import { replanAction, runSafetyTestAction } from "../actions";
import { SubmitButton } from "../submit-button";
import { renderValue } from "./lib";
import styles from "./SafetyStage.module.css";

export function SafetyStage({ s }: { s: ScenarioState }) {
  if (s.phase === "DRIFT_DETECTED") {
    return (
      <section className={`${styles.hero} ${styles.good}`}>
        <span className={`${styles.kicker} ${styles.kickerGood}`}>Safety test passed</span>
        <h2>Stale approval was blocked before the mutation.</h2>
        <p>
          The approval was valid when it was issued. Then the live context changed. The Gateway
          re-checked the world at execution time, invalidated the old authority, and left the change
          unexecuted.
        </p>
        <ol className={styles.steps}>
          <li>
            <span className={styles.num}>01</span>
            <span>
              <b>Human approved</b>
              <span>
                critical dependencies: {renderValue(s.approvedContext?.critical_dependency_count)}
              </span>
            </span>
          </li>
          <li>
            <span className={`${styles.num} ${styles.numWarn}`}>02</span>
            <span>
              <b>The world changed</b>
              <span>
                critical dependencies: {renderValue(s.currentContext?.critical_dependency_count)}
              </span>
            </span>
          </li>
          <li>
            <span className={`${styles.num} ${styles.numBad}`}>03</span>
            <span>
              <b>Gateway refused</b>
              <span>CONTEXT_DRIFT · permanently invalidated</span>
            </span>
          </li>
        </ol>
        <div className={styles.actions}>
          <form action={runSafetyTestAction}>
            <SubmitButton className="btn primary" pendingLabel="Running the live safety test…">
              Run it again
            </SubmitButton>
          </form>
          <a href="https://catalog.opxz.dev/demo-login" target="_blank" rel="noreferrer">
            Verify in the live catalog ↗
          </a>
          <form action={replanAction}>
            <SubmitButton className="btn" pendingLabel="Creating a fresh proposal…">
              See the recovery path
            </SubmitButton>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.hero} ${styles.blue}`}>
      <span className={styles.kicker}>One click · about 20 seconds</span>
      <h2>See a stale approval get stopped</h2>
      <p>
        We approve retiring a production customer dataset, change one relevant fact, then ask the
        Gateway to execute — it refuses the stale approval before anything changes.
      </p>
      <div className={styles.chips}>
        <span>Approve</span>
        <b>→</b>
        <span>Data changes</span>
        <b>→</b>
        <span>Gateway blocks it</span>
      </div>
      <form action={runSafetyTestAction} className={styles.launch}>
        <SubmitButton className="btn primary" pendingLabel="Running the live safety test…">
          Run the safety test
          <small>Uses the live demo data; no account or configuration required</small>
        </SubmitButton>
      </form>
      <div className={styles.proves}>
        <h3>What this proves</h3>
        <ul>
          <li>The agent cannot write directly — every mutation goes through the Gateway.</li>
          <li>An approval is tied to the exact data it was granted on.</li>
          <li>A changed world makes that approval unusable, automatically.</li>
        </ul>
      </div>
    </section>
  );
}
