import type { Metadata } from "next";
import { prisma } from "@/lib/db/client";
import { TopBar } from "../topbar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Changelog — DataHubX",
  description:
    "Every governed change to the estate, public by design — each entry carries the policy decision, the approver, the authorization state, and the verified outcome.",
};

function loadActions() {
  return prisma.action.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      policyDecisions: true,
      approvals: true,
      authorizations: {
        include: {
          executions: { include: { receipt: true }, orderBy: { startedAt: "desc" } },
        },
      },
    },
  });
}

type Actions = Awaited<ReturnType<typeof loadActions>>;

/** urn:li:dataset:(urn:li:dataPlatform:x,db.schema.table,PROD) -> db.schema.table */
function shortTarget(target: string): string {
  return target.match(/,([^,()]+),PROD\)/)?.[1] ?? target;
}

const AUTH_TONE: Record<string, string> = {
  CONSUMED: "good",
  ACTIVE: "accent",
  INVALIDATED: "bad",
  REVOKED: "warn",
  EXPIRED: "",
  ISSUED: "",
};

function execTone(outcome: string): string {
  if (outcome === "VERIFIED_SUCCESS") return "good";
  if (outcome === "REFUSED") return "bad";
  return "warn";
}

export default async function ChangelogPage() {
  let actions: Actions | null = null;
  try {
    actions = await loadActions();
  } catch {
    actions = null;
  }

  return (
    <div>
      <TopBar />
      <div className="wrap">
        <header className="top">
          <h1>Changelog</h1>
          <p>
            Every governed change to the estate, public by design — each entry carries the policy
            decision, the approver, the authorization state, and the verified outcome. Nothing can
            appear here without passing the Gateway.
          </p>
        </header>

        {actions === null ? (
          <div className="panel">
            <div className="empty">Changelog unavailable — database unreachable.</div>
          </div>
        ) : actions.length === 0 ? (
          <div className="panel">
            <div className="empty">
              No governed changes yet — <a href="/#console">run the safety test in the console</a>.
            </div>
          </div>
        ) : (
          <div className="cl-feed">
            {actions.map((a) => {
              const pd = a.policyDecisions[0];
              const approval = a.approvals.find((ap) => ap.status !== "PENDING");
              const auth = a.authorizations[a.authorizations.length - 1];
              const exec = a.authorizations
                .flatMap((z) => z.executions)
                .sort((x, y) => y.startedAt.getTime() - x.startedAt.getTime())[0];
              return (
                <article className="cl-card" key={a.id}>
                  <div className="cl-head">
                    <span className="cl-time">{a.createdAt.toLocaleString()}</span>
                    <span className="cl-type">{a.type}</span>
                    <span className="cl-target">on {shortTarget(a.target)}</span>
                    {pd && (
                      <span className="cl-right">
                        <span className={`pill ${pd.decision}`}>{pd.decision}</span>
                        <span className="cl-risk">risk: {pd.risk}</span>
                      </span>
                    )}
                  </div>
                  <div className="cl-params">{JSON.stringify(a.params)}</div>
                  <div className="cl-evidence">
                    {approval ? (
                      <span>
                        {approval.status === "APPROVED" ? "approved" : "rejected"} by{" "}
                        <span className="cl-who">{approval.approver}</span>
                      </span>
                    ) : pd?.decision === "BLOCK" ? (
                      <span>blocked by policy — never reached a human</span>
                    ) : (
                      <span>awaiting approval</span>
                    )}
                    {auth && (
                      <span className={`cl-chip ${AUTH_TONE[auth.state] ?? ""}`}>{auth.state}</span>
                    )}
                    {exec && (
                      <>
                        <span className={`cl-chip ${execTone(exec.outcome)}`}>
                          {exec.outcome}
                          {exec.outcome === "REFUSED" && exec.errorCode
                            ? ` · ${exec.errorCode}`
                            : ""}
                        </span>
                        {exec.receipt && (
                          <>
                            <span className="cl-post">{exec.receipt.postcondition}</span>
                            <span className="cl-fp">
                              fp {exec.receipt.fingerprintAtExecution.slice(0, 16)}
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="note">
          Every entry is backed by rows in Postgres and metadata in the catalog —{" "}
          <a href="https://catalog.opxz.dev/demo-login">verify any entry against DataHub itself</a>,
          or read <a href="/architecture">how the authority path works</a>.
        </p>
      </div>
    </div>
  );
}
