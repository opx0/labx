import type { ScenarioState } from "@/lib/demo/engine";
import styles from "./AuditTimeline.module.css";

export function AuditTimeline({ events }: { events: ScenarioState["events"] }) {
  return (
    <section className="panel" id="audit">
      <h2>Audit timeline</h2>
      <p className="note">
        Every event is persisted to Postgres with links to the action, approval, authorization and
        execution it concerns — the trail survives restarts. The same trail feeds the public feed:{" "}
        <a href="/changelog">see the full public changelog →</a>
      </p>
      {events.length === 0 ? (
        <div className="empty">
          No events yet — run the safety test or propose an action to begin.
        </div>
      ) : (
        <ol className={styles.timeline}>
          {events.map((e) => (
            <li key={e.id} className={styles.row} data-severity={e.severity}>
              <span className={styles.dot} aria-hidden="true" />
              <time className={styles.time}>{new Date(e.at).toISOString().slice(11, 19)}</time>
              <div>
                <span className={styles.type}>{e.type}</span>
                <span className={styles.detail}>{e.detail}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
