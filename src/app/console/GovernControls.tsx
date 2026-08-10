import type { ScenarioState } from "@/lib/demo/engine";
import { TARGETS } from "@/lib/demo/engine";
import {
  approveAction,
  executeAction,
  injectDriftAction,
  refreshAction,
  rejectAction,
  replanAction,
  resetAction,
  revokeAction,
} from "../actions";
import { SubmitButton } from "../submit-button";
import styles from "./GovernControls.module.css";

export function GovernControls({ s }: { s: ScenarioState }) {
  const awaiting = s.phase === "AWAITING_APPROVAL";
  const hasAuth = s.phase === "AUTHORIZED";
  const canDrift = hasAuth && s.targetUrn === TARGETS.customer_prod;
  const canReplan = ["DRIFT_DETECTED", "REJECTED", "REVOKED"].includes(s.phase);

  return (
    <section className="panel">
      <h2>Govern</h2>
      <div className={styles.grid}>
        <form action={approveAction}>
          <SubmitButton
            className="btn"
            disabled={!awaiting}
            pendingLabel="Issuing signed authorization…"
          >
            Approve<small>Binds authority to this fingerprint</small>
          </SubmitButton>
        </form>
        <form action={rejectAction}>
          <SubmitButton className="btn" disabled={!awaiting} pendingLabel="Persisting rejection…">
            Reject<small>Persists a REJECTED approval — no authority</small>
          </SubmitButton>
        </form>
        <form action={injectDriftAction}>
          <SubmitButton
            className="btn warn"
            disabled={!canDrift}
            pendingLabel="Mutating DataHub lineage…"
          >
            Change the world<small>Adds a 3rd critical dependency to customer_prod</small>
          </SubmitButton>
        </form>
        <form action={executeAction}>
          <SubmitButton
            className="btn primary"
            disabled={!hasAuth}
            pendingLabel="Gateway re-reading context…"
          >
            Execute via Gateway<small>Re-reads context, then decides</small>
          </SubmitButton>
        </form>
        <form action={revokeAction}>
          <SubmitButton className="btn" disabled={!hasAuth} pendingLabel="Revoking in Postgres…">
            Revoke authorization<small>Human withdraws authority before execution</small>
          </SubmitButton>
        </form>
        <form action={replanAction}>
          <SubmitButton
            className="btn"
            disabled={!canReplan}
            pendingLabel="Fresh Passport against new world…"
          >
            Replan<small>Fresh Passport against the new world</small>
          </SubmitButton>
        </form>
      </div>
      <div className={styles.utilities}>
        <form action={refreshAction}>
          <SubmitButton className="btn ghost" pendingLabel="Re-reading context…">
            Refresh current context
          </SubmitButton>
        </form>
        <form action={resetAction}>
          <SubmitButton className="btn ghost" pendingLabel="Resetting DataHub baseline…">
            Reset demo
          </SubmitButton>
        </form>
      </div>
      <p className="note">
        Every action uses the live demo DataHub. The drift step deliberately simulates an outside
        actor changing that real data.
      </p>
    </section>
  );
}
