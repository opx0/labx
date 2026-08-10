"use client";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap">
      <div className="panel nf-panel">
        <div className="nf-code">Error</div>
        <p className="nf-line">Something failed — nothing was mutated without authority.</p>
        <button type="button" className="btn primary nf-btn" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
