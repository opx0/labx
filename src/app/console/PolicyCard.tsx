import { DEFAULT_POLICY_SET } from "@/lib/domain/policy";
import styles from "./PolicyCard.module.css";

export function PolicyCard() {
  return (
    <section className="panel" id="policy">
      <h2>
        Policy in force — {DEFAULT_POLICY_SET.id} v{DEFAULT_POLICY_SET.version}
      </h2>
      <table className="policy">
        <tbody>
          {DEFAULT_POLICY_SET.rules.map((r) => (
            <tr key={r.id}>
              <td className="k">{r.id}</td>
              <td>
                <span className={`pill ${r.decision}`}>{r.decision}</span>
              </td>
              <td>
                {r.description}
                <div className={styles.sub}>
                  depends on: {r.dependsOn.join(", ")} · risk {r.risk}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        These rules are deterministic — the LLM cannot override them. Each rule declares the context
        fields it depends on; exactly those fields are fingerprinted into the Passport. If the
        policy set itself changes, every signed authorization dies with it.
      </p>
    </section>
  );
}
