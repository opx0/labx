import type { ScenarioState } from "@/lib/demo/engine";
import type { Context } from "@/lib/domain/context";
import styles from "./ContextDiff.module.css";
import { renderValue } from "./lib";

function ContextTable({
  title,
  context,
  fingerprint,
  compareWith,
  fingerprintChanged,
}: {
  title: string;
  context: Context | null;
  fingerprint: string | null;
  compareWith?: Context | null;
  fingerprintChanged?: boolean;
}) {
  return (
    <div className={styles.table}>
      <div className={styles.tableTitle}>{title}</div>
      {context ? (
        <table>
          <tbody>
            {Object.keys(context)
              .sort()
              .map((key) => {
                const value = renderValue(context[key]);
                const changed = compareWith != null && renderValue(compareWith[key]) !== value;
                return (
                  <tr key={key} className={changed ? styles.changed : undefined}>
                    <td className={styles.key}>{key}</td>
                    <td className={styles.value}>{value}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      ) : (
        <div className={styles.notCaptured}>not captured yet</div>
      )}
      <div className={`${styles.fingerprint} ${fingerprintChanged ? styles.fingerprintBad : ""}`}>
        <span className={styles.fpLabel}>fingerprint</span>
        <span className={styles.fpValue}>{fingerprint ? fingerprint.slice(0, 24) : "—"}</span>
      </div>
    </div>
  );
}

export function ContextDiff({ s }: { s: ScenarioState }) {
  const drifted =
    s.approvedFingerprint !== null &&
    s.currentFingerprint !== null &&
    s.approvedFingerprint !== s.currentFingerprint;

  return (
    <section className="panel">
      <h2>Action detail</h2>

      <div className={styles.meta}>
        <span className={styles.chip}>action {s.actionType}</span>
        <span className={styles.chip}>target {s.targetLabel}</span>
        <span className={styles.chip}>phase {s.phase}</span>
        {s.authorizationLabel && (
          <span className={styles.chip}>authorization {s.authorizationLabel}</span>
        )}
      </div>

      {s.decision && (
        <div className={styles.decision}>
          <div className={styles.decisionLine}>
            <span className={`pill ${s.decision.decision}`}>{s.decision.decision}</span>
            <span className={styles.decisionMeta}>
              risk {s.decision.risk} · policy {s.decision.policyId} v{s.decision.policyVersion}
            </span>
          </div>
          {s.decision.reasons.length > 0 && (
            <ul className={styles.reasons}>
              {s.decision.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={styles.diff}>
        <ContextTable
          title="Approved context"
          context={s.approvedContext}
          fingerprint={s.approvedFingerprint}
        />
        <ContextTable
          title="Current context"
          context={s.currentContext}
          fingerprint={s.currentFingerprint}
          compareWith={s.approvedContext}
          fingerprintChanged={drifted}
        />
      </div>

      {s.decision && (
        <p className="note">
          Only the policy-declared fields are fingerprinted, so an unrelated metadata edit does not
          invalidate authority.
        </p>
      )}
    </section>
  );
}
