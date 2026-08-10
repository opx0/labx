import { engine } from "@/lib/demo/engine";
import type { Context, ContextValue } from "@/lib/domain/context";
import {
  approveAction,
  askAgentAction,
  executeAction,
  injectDriftAction,
  proposeAction,
  refreshAction,
  replanAction,
  resetAction,
} from "./actions";

export const dynamic = "force-dynamic";

function render(v: ContextValue | undefined): string {
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

function ContextTable({
  title,
  context,
  fingerprint,
  compareWith,
}: {
  title: string;
  context: Context | null;
  fingerprint: string | null;
  compareWith?: Context | null;
}) {
  const keys = context ? Object.keys(context).sort() : [];
  return (
    <div className="ctx">
      <div className="hd">{title}</div>
      {context ? (
        <table>
          <tbody>
            {keys.map((k) => {
              const mine = render(context[k]);
              const theirs = compareWith ? render(compareWith[k]) : mine;
              return (
                <tr key={k} className={compareWith && mine !== theirs ? "changed" : undefined}>
                  <td className="k">{k}</td>
                  <td className="v">{mine}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="empty">not captured yet</div>
      )}
      <div className="fp">
        fingerprint <b>{fingerprint ? `${fingerprint.slice(0, 24)}…` : "—"}</b>
      </div>
    </div>
  );
}

export default async function Page() {
  const s = engine.state;
  const drifted = s.phase === "DRIFT_DETECTED";
  const hasAuth = s.authorizationLabel !== null && s.phase !== "COMPLETED";

  return (
    <div className="wrap">
      <header className="top">
        <h1>DataHubX — context-bound authorization for AI agents</h1>
        <p>
          The agent proposes. The policy decides. The human authorizes. The Gateway enforces — by
          re-reading DataHub itself immediately before the mutation and refusing if the world no
          longer matches what was approved.
        </p>
      </header>

      {drifted && s.lastResult && !s.lastResult.ok && (
        <div className="banner bad">
          <h3>Authorization invalidated — context drift</h3>
          <p>
            A human approved this action against a world with 2 critical dependencies. The Gateway
            re-read DataHub and found a different world, so the authorization it was granted under
            is no longer valid.
          </p>
          <div className="seq">
            HUMAN APPROVED ✓ → REALITY CHANGED ⚠ → AUTHORIZATION INVALIDATED ✕ → MUTATION NOT
            EXECUTED ✓
          </div>
        </div>
      )}

      {s.phase === "COMPLETED" && s.lastResult?.ok && (
        <div className="banner good">
          <h3>Executed and verified</h3>
          <p>
            Fresh authority, granted against the world as it actually is. The Gateway mutated
            DataHub and then read the state back to confirm it: {s.lastResult.receipt.postcondition}{" "}
            → {s.lastResult.verification}.
          </p>
        </div>
      )}

      {s.phase === "BLOCKED" && (
        <div className="banner bad">
          <h3>Blocked by policy — no authorization issued</h3>
          <p>
            A protected asset cannot be mutated by an agent. No human is asked, because no approval
            could make this legitimate.
          </p>
        </div>
      )}

      {s.phase === "AWAITING_APPROVAL" && (
        <div className="banner warn">
          <h3>Human approval required</h3>
          <p>
            You are approving <b>this action</b> + <b>this target</b> + <b>this observed context</b>{" "}
            — not granting the agent standing permission.
          </p>
        </div>
      )}

      <div className="grid">
        <div>
          <div className="panel">
            <h2>Agent</h2>
            <form action={askAgentAction}>
              <label htmlFor="intent">Tell the agent what you want</label>
              <input
                id="intent"
                name="intent"
                defaultValue="Retire customer_prod, it is being decommissioned."
              />
              <button className="btn primary" type="submit">
                Ask agent
                <small>Reads DataHub, proposes one governed action</small>
              </button>
            </form>
            <p className="note">
              The agent has three tools: list, inspect, propose. It has no tool that mutates
              DataHub.
            </p>
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>Or propose directly</h2>
            <form action={proposeAction}>
              <label htmlFor="target">Target</label>
              <select id="target" name="target" defaultValue={s.targetKey}>
                <option value="customer_prod">customer_prod — PROD, PII, Finance</option>
                <option value="analytics_test">analytics_test — DEV, no tags</option>
                <option value="regulated_core">regulated_core — Protected</option>
              </select>
              <label htmlFor="actionType">Action</label>
              <select id="actionType" name="actionType" defaultValue={s.actionType}>
                <option value="CHANGE_LIFECYCLE">CHANGE_LIFECYCLE → DEPRECATED</option>
                <option value="ADD_TAG">ADD_TAG → Deprecated</option>
                <option value="UPDATE_DESCRIPTION">UPDATE_DESCRIPTION</option>
              </select>
              <button className="btn primary" type="submit">
                Propose action
                <small>Builds a Passport and evaluates policy</small>
              </button>
            </form>
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>Govern</h2>
            <form action={approveAction}>
              <button className="btn" type="submit" disabled={s.phase !== "AWAITING_APPROVAL"}>
                Approve
                <small>Binds authority to this fingerprint</small>
              </button>
            </form>
            <form action={injectDriftAction}>
              <button className="btn warn" type="submit" disabled={!hasAuth}>
                Change the world
                <small>Adds a 3rd critical dependency in DataHub</small>
              </button>
            </form>
            <form action={executeAction}>
              <button className="btn primary" type="submit" disabled={!hasAuth}>
                Execute via Gateway
                <small>Re-reads context, then decides</small>
              </button>
            </form>
            <form action={replanAction}>
              <button className="btn" type="submit" disabled={!drifted}>
                Replan
                <small>Fresh Passport against the new world</small>
              </button>
            </form>
            <form action={refreshAction}>
              <button className="btn ghost" type="submit">
                Refresh current context
              </button>
            </form>
            <form action={resetAction}>
              <button className="btn ghost" type="submit">
                Reset demo
              </button>
            </form>
            <p className="note">
              Every button drives the real domain against a real DataHub instance. Nothing here is
              simulated.
            </p>
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>Action detail</h2>
            <div className="meta">
              <span>
                action <b>{s.actionType}</b>
              </span>
              <span>
                target <b>{s.targetKey}</b>
              </span>
              <span>
                phase <b>{s.phase}</b>
              </span>
              {s.authorizationLabel && (
                <span>
                  authorization <b>{s.authorizationLabel}</b>
                </span>
              )}
            </div>

            {s.decision && (
              <>
                <div className="decision">
                  <span className={`pill ${s.decision.decision}`}>{s.decision.decision}</span>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>
                    risk {s.decision.risk} · policy {s.decision.policyId} v
                    {s.decision.policyVersion}
                  </span>
                </div>
                {s.decision.reasons.length > 0 && (
                  <ul className="reasons">
                    {s.decision.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <div className="cmp" style={{ marginTop: 16 }}>
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
              />
            </div>

            {s.decision && (
              <p className="note">
                Only these fields are fingerprinted — they are exactly what the matched policy rules
                declare they depend on. An unrelated metadata edit does not invalidate authority.
              </p>
            )}
          </div>

          <div className="panel timeline" style={{ marginTop: 14 }}>
            <h2>Audit timeline</h2>
            {s.events.length === 0 ? (
              <div className="empty">No events yet — propose an action to begin.</div>
            ) : (
              <ol>
                {s.events.map((e) => (
                  <li key={e.id} className={e.severity}>
                    <span className="t">{new Date(e.at).toISOString().slice(11, 19)}</span>
                    <span className="e">{e.type}</span>
                    <span className="d">{e.detail}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
