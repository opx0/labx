import type { EstateEntry } from "@/lib/demo/engine";
import { askAgentAction, proposeAction } from "../actions";
import { SubmitButton } from "../submit-button";

export function ProposeForms({
  estate,
  targetUrn,
  actionType,
  agentExplanation,
}: {
  estate: EstateEntry[];
  targetUrn: string;
  actionType: string;
  agentExplanation: string | null;
}) {
  return (
    <>
      <section className="panel">
        <h2>Ask the agent</h2>
        <form action={askAgentAction}>
          <label htmlFor="intent">Tell the agent what you want to change</label>
          <input
            id="intent"
            name="intent"
            defaultValue="Retire customer_prod, it is being decommissioned."
          />
          <SubmitButton className="btn primary" pendingLabel="Agent reading DataHub, planning…">
            Ask the agent
            <small>It can read DataHub and propose, but cannot change it</small>
          </SubmitButton>
        </form>
        {agentExplanation !== null && (
          <details open className="agent-reasoning">
            <summary>Agent reasoning</summary>
            <p>{agentExplanation}</p>
          </details>
        )}
        <p className="note">
          The agent can inspect DataHub and propose an action; it has no tool that mutates DataHub.
        </p>
      </section>

      <section className="panel">
        <h2>Choose an action yourself</h2>
        <form action={proposeAction}>
          <label htmlFor="target">
            Target — {estate.length} datasets discovered live from DataHub
          </label>
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
      </section>
    </>
  );
}
