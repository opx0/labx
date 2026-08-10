import { engine, TARGETS } from "@/lib/demo/engine";
import type { Context, ContextValue } from "@/lib/domain/context";
import { DEFAULT_POLICY_SET } from "@/lib/domain/policy";
import {
  approveAction,
  askAgentAction,
  executeAction,
  injectDriftAction,
  proposeAction,
  refreshAction,
  rejectAction,
  replanAction,
  resetAction,
  revokeAction,
} from "./actions";
import { SubmitButton } from "./submit-button";
import { TopBar } from "./topbar";

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
  await engine.hydrate();
  const [s, estate] = [engine.state, await engine.estate()];
  const drifted = s.phase === "DRIFT_DETECTED";
  const hasAuth = s.phase === "AUTHORIZED";
  const canDrift = hasAuth && s.targetUrn === TARGETS.customer_prod;
  const canReplan = drifted || s.phase === "REJECTED" || s.phase === "REVOKED";

  return (
    <div>
      <TopBar />

      <div className="wrap" id="top">
        <header className="top">
          <h1>DataHubX — context-bound authorization for AI agents</h1>
          <p>
            The agent proposes. The policy decides. The human authorizes. The Gateway enforces — by
            re-reading DataHub itself immediately before the mutation and refusing if the world no
            longer matches what was approved.{" "}
            <a href="https://catalog.opxz.dev/demo-login" target="_blank" rel="noreferrer">
              Open the DataHub catalog
            </a>{" "}
            (signs you in as the read-only judge account) to verify every mutation yourself.
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

        {s.phase === "COMPLETED" &&
          s.lastResult?.ok &&
          s.lastResult.verification === "VERIFIED_SUCCESS" && (
            <div className="banner good">
              <h3>Executed and verified</h3>
              <p>
                Fresh authority, granted against the world as it actually is. The Gateway mutated
                DataHub and then read the state back to confirm it:{" "}
                {s.lastResult.receipt.postcondition} → {s.lastResult.verification}.
              </p>
            </div>
          )}

        {s.phase === "EXECUTED_UNVERIFIED" && s.lastResult?.ok && (
          <div
            className={`banner ${s.lastResult.verification === "POSTCONDITION_FAILED" ? "bad" : "warn"}`}
          >
            <h3>Attempted — not verified</h3>
            <p>
              The Gateway attempted the mutation but could not verify it against DataHub:{" "}
              {s.lastResult.receipt.postcondition} → {s.lastResult.verification}
              {s.lastResult.receipt.providerError
                ? ` (provider: ${s.lastResult.receipt.providerError})`
                : ""}
              . This is not success — the recorded outcome is {s.lastResult.verification}.
            </p>
          </div>
        )}

        {s.phase === "BLOCKED" && (
          <div className="banner bad">
            <h3>Blocked by policy — no authorization issued</h3>
            <p>
              A protected asset cannot be mutated by an agent. No human is asked, because no
              approval could make this legitimate.
            </p>
          </div>
        )}

        {s.phase === "REJECTED" && (
          <div className="banner warn">
            <h3>Rejected by the approver — no authorization exists</h3>
            <p>
              The rejection is persisted with the full evidence chain (action, passport, policy
              decision, REJECTED approval). The agent may replan; nothing it holds can execute.
            </p>
          </div>
        )}

        {s.phase === "REVOKED" && (
          <div className="banner warn">
            <h3>Authorization revoked</h3>
            <p>
              A human withdrew the authority before execution: ACTIVE → REVOKED, atomically in
              Postgres. The Gateway will refuse it forever — revocation is not a soft delete.
            </p>
          </div>
        )}

        {s.phase === "AWAITING_APPROVAL" && (
          <div className="banner warn">
            <h3>Human approval required</h3>
            <p>
              You are approving <b>this action</b> + <b>this target</b> +{" "}
              <b>this observed context</b> — not granting the agent standing permission.
            </p>
          </div>
        )}

        <div className="grid" id="console">
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
                <SubmitButton
                  className="btn primary"
                  pendingLabel="Agent reading DataHub, planning…"
                >
                  Ask agent
                  <small>Reads DataHub, proposes one governed action</small>
                </SubmitButton>
              </form>
              <p className="note">
                The agent has three tools: list, inspect, propose. It has no tool that mutates
                DataHub.
              </p>
            </div>

            <div className="panel" style={{ marginTop: 28 }}>
              <h2>Or propose directly</h2>
              <form action={proposeAction}>
                <label htmlFor="target">
                  Target — {estate.length} datasets discovered live from DataHub
                </label>
                <select id="target" name="target" defaultValue={s.targetUrn}>
                  {estate.map((e) => (
                    <option key={e.urn} value={e.urn}>
                      {e.name} — {e.platform}/{e.env}
                    </option>
                  ))}
                </select>
                <label htmlFor="actionType">Action</label>
                <select id="actionType" name="actionType" defaultValue={s.actionType}>
                  <option value="CHANGE_LIFECYCLE">CHANGE_LIFECYCLE → DEPRECATED</option>
                  <option value="ADD_TAG">ADD_TAG → Deprecated</option>
                  <option value="UPDATE_DESCRIPTION">UPDATE_DESCRIPTION</option>
                </select>
                <SubmitButton
                  className="btn primary"
                  pendingLabel="Building Passport, evaluating policy…"
                >
                  Propose action
                  <small>Builds a Passport and evaluates policy</small>
                </SubmitButton>
              </form>
            </div>

            <div className="panel" style={{ marginTop: 28 }}>
              <h2>Govern</h2>
              <form action={approveAction}>
                <SubmitButton
                  disabled={s.phase !== "AWAITING_APPROVAL"}
                  pendingLabel="Issuing signed authorization…"
                >
                  Approve
                  <small>Binds authority to this fingerprint</small>
                </SubmitButton>
              </form>
              <form action={rejectAction}>
                <SubmitButton
                  disabled={s.phase !== "AWAITING_APPROVAL"}
                  pendingLabel="Persisting rejection…"
                >
                  Reject
                  <small>Persists a REJECTED approval — no authority</small>
                </SubmitButton>
              </form>
              <form action={injectDriftAction}>
                <SubmitButton
                  className="btn warn"
                  disabled={!canDrift}
                  pendingLabel="Mutating DataHub lineage…"
                >
                  Change the world
                  <small>Adds a 3rd critical dependency to customer_prod</small>
                </SubmitButton>
              </form>
              <form action={executeAction}>
                <SubmitButton
                  className="btn primary"
                  disabled={!hasAuth}
                  pendingLabel="Gateway re-reading context…"
                >
                  Execute via Gateway
                  <small>Re-reads context, then decides</small>
                </SubmitButton>
              </form>
              <form action={revokeAction}>
                <SubmitButton disabled={!hasAuth} pendingLabel="Revoking in Postgres…">
                  Revoke authorization
                  <small>Human withdraws authority before execution</small>
                </SubmitButton>
              </form>
              <form action={replanAction}>
                <SubmitButton
                  disabled={!canReplan}
                  pendingLabel="Fresh Passport against new world…"
                >
                  Replan
                  <small>Fresh Passport against the new world</small>
                </SubmitButton>
              </form>
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
                  target <b>{s.targetLabel}</b>
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
                    <span style={{ color: "var(--muted)", fontSize: 15 }}>
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

              <div className="cmp" style={{ marginTop: 20 }}>
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
                  Only these fields are fingerprinted — they are exactly what the matched policy
                  rules declare they depend on. An unrelated metadata edit does not invalidate
                  authority.
                </p>
              )}
            </div>

            <div className="panel" style={{ marginTop: 28 }} id="policy">
              <h2>
                Policy in force — {DEFAULT_POLICY_SET.id} v{DEFAULT_POLICY_SET.version}
              </h2>
              <p className="note">
                Deterministic rules; the LLM cannot override them. Each rule declares the context
                fields it depends on — exactly those fields are fingerprinted into the Passport, and
                a signed authorization dies if the policy set itself changes.
              </p>
              <table className="policy">
                <tbody>
                  {DEFAULT_POLICY_SET.rules.map((r) => (
                    <tr key={r.id}>
                      <td className="k">{r.id}</td>
                      <td>
                        <span className={`pill ${r.decision}`}>{r.decision}</span>
                      </td>
                      <td className="v">
                        {r.description}
                        <div style={{ color: "var(--muted)", fontSize: 13.5 }}>
                          depends on: {r.dependsOn.join(", ")} · risk {r.risk}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel timeline" style={{ marginTop: 28 }} id="audit">
              <h2>Audit timeline</h2>
              <p className="note">
                Every event is persisted to Postgres with links to the action, approval,
                authorization and execution it concerns — the trail survives restarts.
              </p>
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
    </div>
  );
}
