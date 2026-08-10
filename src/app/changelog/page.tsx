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

function Entry({ a }: { a: Actions[number] }) {
  const pd = a.policyDecisions[0];
  const approval = a.approvals.find((ap) => ap.status !== "PENDING");
  const auth = a.authorizations[a.authorizations.length - 1];
  const exec = a.authorizations
    .flatMap((z) => z.executions)
    .sort((x, y) => y.startedAt.getTime() - x.startedAt.getTime())[0];
  const receipt = exec?.receipt;
  const fpMismatch =
    auth && receipt ? auth.passportFingerprint !== receipt.fingerprintAtExecution : false;

  return (
    <details className="cl-card">
      <summary className="cl-head">
        <span className="cl-time">
          {a.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="cl-type">{a.type}</span>
        <span className="cl-target">on {shortTarget(a.target)}</span>
        <span className="cl-right">
          {pd && <span className={`pill ${pd.decision}`}>{pd.decision}</span>}
          {exec && <span className={`cl-chip ${execTone(exec.outcome)}`}>{exec.outcome}</span>}
          <span className="cl-caret" aria-hidden>
            ▾
          </span>
        </span>
      </summary>

      <div className="cl-body">
        <div className="cl-params">{JSON.stringify(a.params)}</div>

        {pd && (
          <div className="cl-row">
            <span className="cl-label">policy</span>
            <span>
              {pd.policyId} v{pd.policyVersion} · risk {pd.risk}
            </span>
          </div>
        )}
        {pd && pd.reasons.length > 0 && (
          <ul className="cl-reasons">
            {pd.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}

        <div className="cl-row">
          <span className="cl-label">approval</span>
          {approval ? (
            <span>
              {approval.status === "APPROVED" ? "approved" : "rejected"} by{" "}
              <span className="cl-who">{approval.approver}</span>
              {approval.decidedAt && ` · ${approval.decidedAt.toLocaleString()}`}
            </span>
          ) : pd?.decision === "BLOCK" ? (
            <span>blocked by policy — never reached a human</span>
          ) : (
            <span>awaiting approval</span>
          )}
        </div>

        {auth && (
          <div className="cl-row">
            <span className="cl-label">authorization</span>
            <span>
              <span className="cl-who">{auth.id.slice(0, 8)}</span>{" "}
              <span className={`cl-chip ${AUTH_TONE[auth.state] ?? ""}`}>{auth.state}</span> ·
              expires {auth.expiresAt.toLocaleString()}
            </span>
          </div>
        )}

        {auth && receipt && (
          <div className="cl-fps">
            <div>
              <div className="cl-fp-label">approved world</div>
              <div className="cl-fp">{auth.passportFingerprint.slice(0, 16)}</div>
            </div>
            <div>
              <div className="cl-fp-label">world at execution</div>
              <div className={`cl-fp${fpMismatch ? " bad" : ""}`}>
                {receipt.fingerprintAtExecution.slice(0, 16)}
              </div>
            </div>
          </div>
        )}

        {receipt && (
          <div className="cl-row">
            <span className="cl-label">postcondition</span>
            <span>{receipt.postcondition}</span>
          </div>
        )}
        {exec?.errorCode && (
          <div className="cl-row">
            <span className="cl-label">error</span>
            <span className="cl-error">{exec.errorCode}</span>
          </div>
        )}

        <a
          className="cl-link"
          href={`https://catalog.opxz.dev/dataset/${encodeURIComponent(a.target)}`}
          target="_blank"
          rel="noreferrer"
        >
          View in catalog →
        </a>
      </div>
    </details>
  );
}

export default async function ChangelogPage() {
  let actions: Actions | null = null;
  try {
    actions = await loadActions();
  } catch {
    actions = null;
  }

  const execs = actions?.flatMap((a) => a.authorizations.flatMap((z) => z.executions)) ?? [];
  const auths = actions?.flatMap((a) => a.authorizations) ?? [];
  const stats = [
    { label: "Governed actions", value: actions?.length ?? 0, tone: "" },
    {
      label: "Verified successes",
      value: execs.filter((e) => e.outcome === "VERIFIED_SUCCESS").length,
      tone: "good",
    },
    {
      label: "Refusals",
      value: execs.filter((e) => e.outcome === "REFUSED").length,
      tone: "bad",
    },
    {
      label: "Authority invalidated",
      value: auths.filter((z) => z.state === "INVALIDATED" || z.state === "REVOKED").length,
      tone: "bad",
    },
  ];

  const groups: { day: string; items: Actions }[] = [];
  for (const a of actions ?? []) {
    const day = a.createdAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(a);
    else groups.push({ day, items: [a] });
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

        {actions !== null && actions.length > 0 && (
          <div className="cl-stats">
            {stats.map((s) => (
              <div className="cl-stat" key={s.label}>
                <div className={`cl-stat-num ${s.tone}`}>{s.value}</div>
                <div className="cl-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        )}

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
            {groups.map((g) => (
              <section key={g.day}>
                <h2 className="cl-day">{g.day}</h2>
                {g.items.map((a) => (
                  <Entry a={a} key={a.id} />
                ))}
              </section>
            ))}
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
