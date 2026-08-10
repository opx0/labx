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
  runSafetyTestAction,
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

function DirectProposalForm({
  estate,
  targetUrn,
  actionType,
}: {
  estate: Awaited<ReturnType<typeof engine.estate>>;
  targetUrn: string;
  actionType: string;
}) {
  return (
    <form action={proposeAction}>
      <label htmlFor="target">Target — {estate.length} datasets discovered live from DataHub</label>
      <select id="target" name="target" defaultValue={targetUrn}>
        {estate.map((e) => (
          <option key={e.urn} value={e.urn}>
            {e.name} — {e.platform}/{e.env}
          </option>
        ))}
      </select>
      <label htmlFor="actionType">Action</label>
      <select id="actionType" name="actionType" defaultValue={actionType}>
        <option value="CHANGE_LIFECYCLE">Change lifecycle to deprecated</option>
        <option value="ADD_TAG">Add the Deprecated tag</option>
        <option value="UPDATE_DESCRIPTION">Update description</option>
      </select>
      <SubmitButton className="btn primary" pendingLabel="Checking policy and current data…">
        Check this action
        <small>Shows whether it is allowed, blocked, or needs approval</small>
      </SubmitButton>
    </form>
  );
}

function SafetyRunSummary({
  approvedContext,
  currentContext,
}: {
  approvedContext: Context | null;
  currentContext: Context | null;
}) {
  return (
    <section className="run-summary" aria-labelledby="safety-result-title">
      <div className="result-copy">
        <span className="result-kicker">Safety test passed</span>
        <h2 id="safety-result-title">Stale approval was blocked before the mutation.</h2>
        <p>
          The approval was valid when it was issued. Then the live DataHub context changed. The
          Gateway checked again, invalidated the old authority, and left the requested lifecycle
          change unexecuted.
        </p>
      </div>
      <ol className="result-steps">
        <li>
          <span className="result-number">01</span>
          <div>
            <b>Human approved</b>
            <span>Critical dependencies: {render(approvedContext?.critical_dependency_count)}</span>
          </div>
        </li>
        <li>
          <span className="result-number warn-number">02</span>
          <div>
            <b>The world changed</b>
            <span>Critical dependencies: {render(currentContext?.critical_dependency_count)}</span>
          </div>
        </li>
        <li>
          <span className="result-number bad-number">03</span>
          <div>
            <b>Gateway refused</b>
            <span>CONTEXT_DRIFT · authorization permanently invalidated</span>
          </div>
        </li>
      </ol>
      <div className="result-actions">
        <form action={runSafetyTestAction}>
          <SubmitButton className="btn primary" pendingLabel="Running the live safety test…">
            Run it again
            <small>Resets the demo baseline, then repeats the proof</small>
          </SubmitButton>
        </form>
        <a href="https://catalog.opxz.dev/demo-login" target="_blank" rel="noreferrer">
          Verify the live catalog ↗
        </a>
        <form action={replanAction}>
          <SubmitButton pendingLabel="Creating a fresh proposal…">
            See the recovery path
            <small>Replan against the new reality</small>
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

export default async function Page() {
  await engine.hydrate();
  const [s, estate] = [engine.state, await engine.estate()];
  const drifted = s.phase === "DRIFT_DETECTED";
  const hasAuth = s.phase === "AUTHORIZED";
  const canDrift = hasAuth && s.targetUrn === TARGETS.customer_prod;
  const canReplan = drifted || s.phase === "REJECTED" || s.phase === "REVOKED";
  const isFirstRun = s.phase === "IDLE";

  return (
    <div>
      <TopBar />

      <div className="wrap" id="top">
        <header className="top">
          <span className="eyebrow">A live, 20-second safety demo</span>
          <h1>Stop AI agents acting on stale approval.</h1>
          <p>
            DataHubX lets an agent propose a change, then checks the live data again just before it
            acts. If the world changed after a human said yes, the action is stopped. No setup or
            project knowledge needed.{" "}
            <a href="https://catalog.opxz.dev/demo-login" target="_blank" rel="noreferrer">
              View the live catalog
            </a>{" "}
            after a run if you want to verify it yourself.
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

        {isFirstRun && (
          <section className="start-screen" id="console" aria-label="Choose a demo path">
            <div className="start-main">
              <span className="step-kicker">Recommended path · about 20 seconds</span>
              <h2>See a stale approval get stopped</h2>
              <p>
                We will approve retiring a production customer dataset, change one relevant fact,
                then ask the Gateway to execute. It will refuse the stale approval before anything
                is changed.
              </p>
              <div className="proof-flow">
                <span>Approve</span>
                <b>→</b>
                <span>Data changes</span>
                <b>→</b>
                <span>Gateway blocks it</span>
              </div>
              <form action={runSafetyTestAction}>
                <SubmitButton
                  className="btn primary start-button"
                  pendingLabel="Running the live safety test…"
                >
                  Run the safety test
                  <small>Uses the live demo data; no account or configuration required</small>
                </SubmitButton>
              </form>
            </div>
            <div className="start-side">
              <h2>What this proves</h2>
              <ul className="proof-list">
                <li>The agent cannot write directly.</li>
                <li>Approval is tied to the exact data it was based on.</li>
                <li>A changed world makes that approval unusable.</li>
              </ul>
              <details className="custom-path">
                <summary>Or try your own action</summary>
                <p>Pick a dataset and action; the policy result tells you what happens next.</p>
                <DirectProposalForm
                  estate={estate}
                  targetUrn={s.targetUrn}
                  actionType={s.actionType}
                />
              </details>
            </div>
          </section>
        )}

        {!isFirstRun && (
          <section className="workbench" id="console">
            {drifted && (
              <SafetyRunSummary
                approvedContext={s.approvedContext}
                currentContext={s.currentContext}
              />
            )}
            <details className="workbench-details" open={!drifted}>
              <summary>
                {drifted
                  ? "Inspect the live evidence and explore manually"
                  : "Live action workbench"}
              </summary>
              {drifted && (
                <p className="workbench-intro">
                  The evidence below is the exact context and audit trail used by this run. You can
                  also try a different governed action.
                </p>
              )}
              <div className="grid">
                <div>
                  <div className="panel">
                    <h2>Try another action</h2>
                    <form action={askAgentAction}>
                      <label htmlFor="intent">Tell the agent what you want to change</label>
                      <input
                        id="intent"
                        name="intent"
                        defaultValue="Retire customer_prod, it is being decommissioned."
                      />
                      <SubmitButton
                        className="btn primary"
                        pendingLabel="Agent reading DataHub, planning…"
                      >
                        Ask the agent
                        <small>It can read DataHub and propose, but cannot change it</small>
                      </SubmitButton>
                    </form>
                    <p className="note">
                      The agent can inspect DataHub and propose an action. It has no tool that
                      mutates DataHub.
                    </p>
                  </div>

                  <div className="panel" style={{ marginTop: 28 }}>
                    <h2>Choose an action yourself</h2>
                    <DirectProposalForm
                      estate={estate}
                      targetUrn={s.targetUrn}
                      actionType={s.actionType}
                    />
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
                      <SubmitButton
                        className="btn ghost"
                        pendingLabel="Resetting DataHub baseline…"
                      >
                        Reset demo
                      </SubmitButton>
                    </form>
                    <p className="note">
                      Every action uses the live demo DataHub. The drift step deliberately simulates
                      an outside actor changing that real data.
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
                          <span className={`pill ${s.decision.decision}`}>
                            {s.decision.decision}
                          </span>
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
                        Only these fields are fingerprinted — they are exactly what the matched
                        policy rules declare they depend on. An unrelated metadata edit does not
                        invalidate authority.
                      </p>
                    )}
                  </div>

                  <div className="panel" style={{ marginTop: 28 }} id="policy">
                    <h2>
                      Policy in force — {DEFAULT_POLICY_SET.id} v{DEFAULT_POLICY_SET.version}
                    </h2>
                    <p className="note">
                      Deterministic rules; the LLM cannot override them. Each rule declares the
                      context fields it depends on — exactly those fields are fingerprinted into the
                      Passport, and a signed authorization dies if the policy set itself changes.
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
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
