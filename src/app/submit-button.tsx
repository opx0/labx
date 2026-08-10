"use client";

import { useFormStatus } from "react-dom";

// Every governed step talks to real DataHub and Postgres, which takes real
// time. A button that goes silent for seconds reads as broken — so while its
// form's server action runs, the button says what it is doing and refuses a
// second submit.
export function SubmitButton({
  className = "btn",
  disabled = false,
  pendingLabel,
  children,
}: {
  className?: string;
  disabled?: boolean;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? (
        <>
          {pendingLabel}
          <small>talking to live DataHub…</small>
        </>
      ) : (
        children
      )}
    </button>
  );
}
