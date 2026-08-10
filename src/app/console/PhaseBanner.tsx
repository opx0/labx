import type { ScenarioState } from "@/lib/demo/engine";

export function PhaseBanner({ s }: { s: ScenarioState }) {
  if (s.phase === "DRIFT_DETECTED" && s.lastResult && !s.lastResult.ok) {
    return (
      <div className="banner bad">
        <h3>Authorization invalidated — context drift</h3>
        <p>
          The authorization was bound to the exact context the human approved. Reality changed
          between approval and execution, so the fingerprints no longer match — the gateway refused
          to execute against a world nobody approved.
        </p>
        <p className="seq">
          HUMAN APPROVED ✓ → REALITY CHANGED ⚠ → AUTHORIZATION INVALIDATED ✕ → MUTATION NOT EXECUTED
          ✓
        </p>
      </div>
    );
  }

  if (
    s.phase === "COMPLETED" &&
    s.lastResult?.ok &&
    s.lastResult.verification === "VERIFIED_SUCCESS"
  ) {
    return (
      <div className="banner good">
        <h3>Executed and verified</h3>
        <p>
          {s.lastResult.receipt.postcondition} → {s.lastResult.verification}
        </p>
      </div>
    );
  }

  if (s.phase === "EXECUTED_UNVERIFIED" && s.lastResult?.ok) {
    const failed = s.lastResult.verification === "POSTCONDITION_FAILED";
    return (
      <div className={failed ? "banner bad" : "banner warn"}>
        <h3>Attempted — not verified</h3>
        <p>
          {s.lastResult.receipt.postcondition} → {s.lastResult.verification}
          {s.lastResult.receipt.providerError
            ? ` — provider error: ${s.lastResult.receipt.providerError}`
            : null}
        </p>
      </div>
    );
  }

  if (s.phase === "BLOCKED") {
    return (
      <div className="banner bad">
        <h3>Blocked by policy — no authorization issued</h3>
        <p>The gateway never signed anything. There is nothing to execute.</p>
      </div>
    );
  }

  if (s.phase === "REJECTED") {
    return (
      <div className="banner warn">
        <h3>Rejected by the approver — no authorization exists</h3>
        <p>The human said no. No token was minted; execution is impossible.</p>
      </div>
    );
  }

  if (s.phase === "REVOKED") {
    return (
      <div className="banner warn">
        <h3>Authorization revoked — ACTIVE → REVOKED, refused forever</h3>
        <p>
          Revocation is one-way. Any attempt to execute with this token is refused, permanently.
        </p>
      </div>
    );
  }

  if (s.phase === "AWAITING_APPROVAL") {
    return (
      <div className="banner warn">
        <h3>Human approval required</h3>
        <p>
          You are approving this action + this target + this observed context — not standing
          permission.
        </p>
      </div>
    );
  }

  return null;
}
