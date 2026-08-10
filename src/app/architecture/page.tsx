import type { Metadata } from "next";
import { TopBar } from "../topbar";

export const metadata: Metadata = {
  title: "Architecture — DataHubX",
  description:
    "The complete DataHubX system: deployment topology, the authority path, all fifteen Gateway checks, the authorization state machine, and the evidence chain.",
};

// ---------------------------------------------------------------- content --

const CHECKS = [
  ["01", "Ed25519 signature verifies", "AUTHORIZATION_INVALID"],
  ["02", "Authorization exists in Postgres", "AUTHORIZATION_INVALID"],
  ["03", "Never consumed before", "AUTHORIZATION_REPLAY"],
  ["04", "State is ACTIVE", "AUTHORIZATION_INVALID"],
  ["05", "Inside its 15-minute lifetime", "AUTHORIZATION_EXPIRED"],
  ["06", "Principal matches the claims", "AUTHORIZATION_INVALID"],
  ["07", "Action type matches the claims", "AUTHORIZATION_INVALID"],
  ["08", "Target matches the claims", "AUTHORIZATION_INVALID"],
  ["09", "Action type is registered", "VALIDATION_ERROR"],
  ["10", "Policy set + version still current", "INVALID + INVALIDATED"],
  ["11", "Params pass the action schema", "VALIDATION_ERROR"],
  ["12", "Recomputed param hash = approved hash", "AUTHORIZATION_INVALID"],
  ["13", "Context readable from DataHub", "CONTEXT_UNAVAILABLE"],
  ["14", "Fingerprint = approved fingerprint", "DRIFT + INVALIDATED"],
  ["15", "Atomic single consumption wins", "AUTHORIZATION_REPLAY"],
] as const;

const STEPS = [
  {
    n: "01",
    t: "Propose",
    d: "An agent (or a human) names exactly one governed action — type, target, parameters. The params are schema-validated and hashed; free-form mutations do not exist.",
  },
  {
    n: "02",
    t: "Fingerprint",
    d: "The fields the policy declares it depends on are read from DataHub by URN — never through search, which measurably lags — canonicalized, and SHA-256 fingerprinted into a Passport.",
  },
  {
    n: "03",
    t: "Approve",
    d: "A human approves this action against this fingerprint. The result is an Ed25519-signed, single-use, 15-minute authorization — or a persisted rejection, and nothing exists to execute.",
  },
  {
    n: "04",
    t: "World changes",
    d: "Before execution, a third critical downstream appears in DataHub — a dbt job, another team, anyone. Nothing in our system did it, and nothing in our system needs to notice yet.",
  },
  {
    n: "05",
    t: "Refuse",
    d: "The Gateway re-reads DataHub, recomputes the hash and the fingerprint, and finds a different world. CONTEXT_DRIFT: the authorization is permanently INVALIDATED and the mutation-relevant verification state is unchanged.",
  },
  {
    n: "06",
    t: "Replan & verify",
    d: "The agent replans against reality. Fresh passport, fresh approval, execute — then the Gateway reads DataHub back, and only a confirmed postcondition is VERIFIED_SUCCESS on the receipt.",
  },
];

const CHAIN = [
  ["Action", "actions", "what was asked"],
  ["Passport", "passports", "the world as observed"],
  ["PolicyDecision", "policy_decisions", "why it needed a human"],
  ["Approval", "approvals", "who said yes — or no"],
  ["Authorization", "authorizations", "the signed, single-use authority"],
  ["Execution", "executions", "what happened, incl. refusals"],
  ["Receipt", "receipts", "verified outcome + provider error"],
] as const;

const PARTS = [
  [
    "canonical.ts",
    "Canonicalization + SHA-256 — absent, [] and “” are three different worlds",
    "src/lib/domain/canonical.ts",
  ],
  [
    "policy.ts",
    "Deterministic rules with declared context dependencies — the LLM cannot override",
    "src/lib/domain/policy.ts",
  ],
  [
    "authorization.ts",
    "Ed25519 claims, nonce, expiry, the state machine — verify never implies mint",
    "src/lib/domain/authorization.ts",
  ],
  [
    "gateway.ts",
    "The only mutation path: 15 checks, consume-before-mutate, read-back verification",
    "src/lib/gateway/gateway.ts",
  ],
  [
    "client.ts",
    "Read-only DataHub client — no GraphQL, no non-GET request, test-enforced",
    "src/lib/datahub/client.ts",
  ],
  [
    "mutations.ts",
    "Governed writes; imported only by the Gateway — a tree-walk test pins every importer",
    "src/lib/datahub/mutations.ts",
  ],
  [
    "authorization-store.ts",
    "Atomic ACTIVE → CONSUMED / INVALIDATED / REVOKED via conditional UPDATE",
    "src/lib/db/authorization-store.ts",
  ],
  [
    "agent/",
    "Official DataHub MCP server, version-pinned, six read tools allowlisted — no write tool",
    "src/lib/agent/mcp.ts",
  ],
] as const;

// ------------------------------------------------------------- svg pieces --

type Tone = "plain" | "bad" | "good" | "warn" | "accent" | "dim";
const FILL: Record<Tone, [string, string, string]> = {
  plain: ["var(--panel)", "var(--line-strong)", "var(--text)"],
  bad: ["var(--bad-soft)", "#fecaca", "var(--bad)"],
  good: ["var(--good-soft)", "#a7f3d0", "var(--good)"],
  warn: ["var(--warn-soft)", "#fde68a", "var(--warn)"],
  accent: ["var(--accent-soft)", "var(--accent)", "var(--accent)"],
  dim: ["var(--panel-2)", "var(--line-strong)", "var(--text)"],
};

function Node({
  x,
  y,
  w = 190,
  h = 56,
  title,
  sub,
  tone = "plain",
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  sub?: string;
  tone?: Tone;
}) {
  const [fill, stroke, color] = FILL[tone];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={Math.min(h / 2, 16)} fill={fill} stroke={stroke} />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 5 : y + h / 2 + 4.5}
        textAnchor="middle"
        fontSize="14"
        fontWeight="650"
        fill={color}
      >
        {title}
      </text>
      {sub && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 13}
          textAnchor="middle"
          fontSize="10"
          fill={tone === "plain" || tone === "dim" ? "var(--muted)" : color}
          opacity={tone === "plain" || tone === "dim" ? 1 : 0.8}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

function Hex({
  cx,
  cy,
  r,
  title,
  sub,
  accent = false,
}: {
  cx: number;
  cy: number;
  r: number;
  title: string;
  sub: string;
  accent?: boolean;
}) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
  return (
    <g>
      <polygon
        points={pts}
        fill={accent ? "var(--accent-soft)" : "var(--panel-2)"}
        stroke={accent ? "var(--accent)" : "var(--line-strong)"}
        strokeWidth={accent ? 1.6 : 1}
      />
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fill={accent ? "var(--accent)" : "var(--text)"}
      >
        {title}
      </text>
      {sub.split("|").map((line, i) => (
        <text
          key={line}
          x={cx}
          y={cy + 10 + i * 13}
          textAnchor="middle"
          fontSize="10"
          fill={accent ? "var(--accent)" : "var(--muted)"}
          opacity={accent ? 0.8 : 1}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Chip({ x, y, label }: { x: number; y: number; label: string }) {
  const w = label.length * 5.6 + 18;
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - 10}
        width={w}
        height={20}
        rx={10}
        fill="var(--panel)"
        stroke="var(--line)"
      />
      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fontSize="9.5"
        fontFamily="var(--mono)"
        fill="var(--muted)"
      >
        {label}
      </text>
    </g>
  );
}

function Badge({ x, y, n }: { x: number; y: number; n: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill="var(--accent-soft)" stroke="var(--accent)" />
      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="700"
        fontFamily="var(--mono)"
        fill="var(--accent)"
      >
        {n}
      </text>
    </g>
  );
}

function BoundaryLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} fontSize="9.5" letterSpacing="0.12em" fill="var(--muted)">
      {text}
    </text>
  );
}

const wire = "var(--wire)";
const W = { fill: "none", stroke: wire, strokeWidth: 2 } as const;

// ------------------------------------------------------------------ page --

export default function ArchitecturePage() {
  return (
    <div>
      <TopBar />
      <div className="wrap">
        <header className="arch-hero">
          <div className="eyebrow">The system</div>
          <h1>
            One authority.
            <br />
            Every check.
          </h1>
          <p>
            This page is the whole machine — every process, every credential, every check, every
            state, and where each one lives in the repo. Nothing on it is aspirational.
          </p>
        </header>

        {/* ------------------------------------------------ deployment ---- */}
        <h2 className="arch-h2">What is actually running</h2>
        <p className="arch-sub">
          Two domains, one VM, five kinds of process — one governed writer and one deliberately
          isolated fixture that simulates an outside change.
        </p>
        <div className="diagram-wrap">
          <svg viewBox="0 0 1160 620" role="img" aria-label="DataHubX deployment topology">
            {/* wires first */}
            <path d="M 200 108 C 230 108, 230 108, 252 108" {...W} />
            <path d="M 430 96 C 470 84, 480 92, 498 100" {...W} />
            <path d="M 430 120 C 560 140, 700 108, 856 120" {...W} />
            <path d="M 796 130 C 830 150, 830 180, 858 192" {...W} />
            <path d="M 650 228 L 650 258" {...W} />
            <path d="M 650 312 L 650 342" {...W} />
            <path d="M 796 286 C 830 270, 830 230, 856 208" {...W} />
            <path d="M 984 146 L 984 168" {...W} />
            <path d="M 920 224 L 900 250" {...W} />
            <path d="M 984 224 L 984 250" {...W} />
            <path d="M 1048 224 L 1068 250" {...W} />
            <path d="M 200 318 C 300 318, 380 200, 498 160" {...W} strokeDasharray="5 5" />
            <path d="M 200 528 C 400 528, 700 420, 866 224" {...W} strokeDasharray="5 5" />

            {/* edge + clients */}
            <Node x={20} y={80} w={180} title="Reviewer" sub="browser · one-click sign-in" />
            <Node x={252} y={80} w={178} title="Caddy edge" sub="TLS · app + catalog domains" />
            <Chip x={452} y={62} label="app.opxz.dev" />
            <Chip x={640} y={96} label="catalog.opxz.dev · /demo-login" />
            <Node
              x={20}
              y={290}
              w={180}
              title="Gemini 2.5 Flash"
              sub="planning only · no DataHub tool access"
              tone="dim"
            />
            <Chip x={330} y={252} label="prompts only" />
            <Node
              x={20}
              y={500}
              w={180}
              title="Dev laptop"
              sub="golden scenario · healthcheck"
              tone="dim"
            />
            <Chip x={480} y={496} label="ssh -L 18080 · PAT" />

            {/* VM boundary */}
            <rect
              x={470}
              y={24}
              width={676}
              height={572}
              rx={18}
              fill="none"
              stroke="var(--line-strong)"
              strokeDasharray="6 6"
            />
            <BoundaryLabel x={486} y={46} text="GCP VM · ALL SERVICES LOOPBACK-ONLY" />

            {/* console */}
            <rect
              x={498}
              y={60}
              width={300}
              height={168}
              rx={16}
              fill="var(--panel)"
              stroke="var(--line-strong)"
            />
            <text
              x={648}
              y={88}
              textAnchor="middle"
              fontSize="14.5"
              fontWeight="700"
              fill="var(--text)"
            >
              Governance console
            </text>
            <text x={648} y={106} textAnchor="middle" fontSize="10" fill="var(--muted)">
              Next.js · systemd labx.service
            </text>
            {(
              [
                ["policy engine", 514, 122],
                ["Gateway", 662, 122],
                ["agent runtime", 514, 158],
                ["Ed25519 key · file", 662, 158],
              ] as const
            ).map(([label, bx, by]) => (
              <g key={label}>
                <rect
                  x={bx}
                  y={by}
                  width={130}
                  height={26}
                  rx={13}
                  fill="var(--panel-2)"
                  stroke="var(--line)"
                />
                <text
                  x={bx + 65}
                  y={by + 17}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontFamily="var(--mono)"
                  fill="var(--muted)"
                >
                  {label}
                </text>
              </g>
            ))}
            <text x={648} y={212} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
              demo uses one PAT · agent receives read tools only
            </text>

            {/* mcp + postgres */}
            <Node
              x={498}
              y={258}
              w={300}
              h={54}
              title="mcp-server-datahub@0.6.0"
              sub="uvx subprocess · 6 read tools allowlisted"
            />
            <Node
              x={498}
              y={342}
              w={300}
              h={54}
              title="Postgres 18 · container"
              sub="authority states · evidence chain · audit"
            />
            <Chip x={826} y={246} label="read tools → GMS" />

            {/* datahub stack */}
            <rect
              x={840}
              y={60}
              width={290}
              height={330}
              rx={16}
              fill="none"
              stroke="var(--line-strong)"
              strokeDasharray="6 6"
            />
            <BoundaryLabel x={856} y={82} text="DATAHUB v1.7 · QUICKSTART CONTAINERS" />
            <Node
              x={856}
              y={96}
              w={258}
              h={50}
              title="datahub-frontend"
              sub="judge account is read-only"
            />
            <Node
              x={856}
              y={168}
              w={258}
              h={56}
              title="GMS"
              sub="OpenAPI v3 aspects · GraphQL · auth ON"
            />
            <Node x={856} y={250} w={80} h={44} title="MySQL" tone="dim" />
            <Node x={944} y={250} w={80} h={44} title="Kafka" tone="dim" />
            <Node x={1032} y={250} w={82} h={44} title="Search" tone="dim" />
            <Node x={856} y={310} w={258} h={44} title="datahub-actions" tone="dim" />
            <Chip x={828} y={168} label="PAT · reads + governed writes" />

            {/* out-of-band note */}
            <Node
              x={498}
              y={430}
              w={300}
              h={54}
              title="out-of-band.ts · demo simulator"
              sub="plays the third party — agent provably cannot import it"
              tone="warn"
            />
            <path d="M 798 457 C 860 457, 900 300, 940 226" {...W} strokeDasharray="5 5" />
          </svg>
        </div>

        {/* --------------------------------------------- authority path --- */}
        <h2 className="arch-h2">The authority path</h2>
        <p className="arch-sub">
          Three ways in, one gate, one governed write path — and the branch where stale authority
          dies.
        </p>
        <div className="diagram-wrap">
          <svg viewBox="0 0 1160 520" role="img" aria-label="DataHubX authority path diagram">
            <path d="M 210 118 C 280 118, 280 172, 326 186" {...W} />
            <path d="M 210 198 C 260 198, 270 198, 312 198" {...W} />
            <path d="M 210 278 C 280 278, 280 224, 326 210" {...W} />
            <path d="M 468 198 C 490 198, 490 198, 512 198" {...W} />
            <path d="M 682 198 C 706 198, 706 198, 726 198" {...W} />
            <path d="M 884 156 C 924 128, 928 118, 952 118" {...W} />
            <path d="M 900 198 C 924 198, 928 198, 952 198" {...W} />
            <path d="M 884 240 C 924 268, 928 278, 952 278" {...W} />
            <path className="wire-anim" d="M 562 441 C 700 441, 780 350, 808 286" {...W} />
            <path
              d="M 848 276 C 902 330, 960 368, 1036 406"
              fill="none"
              stroke="#fca5a5"
              strokeWidth="2"
            />

            <Node x={20} y={90} title="Ask the agent" sub="Gemini over DataHub MCP · read-only" />
            <Node
              x={20}
              y={170}
              title="Propose directly"
              sub="console form · any discovered dataset"
            />
            <Node x={20} y={250} title="Golden scenario" sub="CLI · asserted end to end" />

            <Hex
              cx={390}
              cy={198}
              r={82}
              title="Passport"
              sub="SHA-256 fingerprint|ALLOW · REVIEW · BLOCK"
            />
            <Chip x={266} y={240} label="aspect reads by URN" />

            <Node
              x={512}
              y={170}
              w={170}
              h={56}
              title="Human approval"
              sub="approve · reject · revoke"
            />
            <g>
              <rect
                x={512}
                y={252}
                width={170}
                height={62}
                rx={12}
                fill="none"
                stroke="var(--line-strong)"
                strokeDasharray="5 5"
              />
              {["AUTH-001", "AUTH-002", "AUTH-003"].map((a, i) => (
                <g key={a}>
                  <rect
                    x={524 + i * 50}
                    y={264}
                    width={46}
                    height={18}
                    rx={9}
                    fill="var(--panel-2)"
                    stroke="var(--line)"
                  />
                  <text
                    x={547 + i * 50}
                    y={276.5}
                    textAnchor="middle"
                    fontSize="8.5"
                    fontFamily="var(--mono)"
                    fill="var(--muted)"
                  >
                    {a}
                  </text>
                </g>
              ))}
              <text
                x={597}
                y={302}
                textAnchor="middle"
                fontSize="9"
                letterSpacing="0.08em"
                fill="var(--muted)"
              >
                SINGLE USE · 15 MIN · ED25519
              </text>
            </g>

            <Hex
              cx={815}
              cy={198}
              r={92}
              accent
              title="Gateway"
              sub="15 checks, in order|re-read · recompute|consume once · mutate"
            />

            <rect
              x={938}
              y={64}
              width={210}
              height={266}
              rx={14}
              fill="none"
              stroke="var(--line-strong)"
              strokeDasharray="5 5"
            />
            <text
              x={1043}
              y={52}
              textAnchor="middle"
              fontSize="9.5"
              letterSpacing="0.12em"
              fill="var(--muted)"
            >
              THE ONLY GOVERNED WRITE PATH
            </text>
            <Node x={952} y={90} w={182} title="DataHub" sub="governed mutation + read-back" />
            <Node x={952} y={170} w={182} title="Postgres" sub="ACTIVE → CONSUMED · atomic" />
            <Node x={952} y={250} w={182} title="Receipt" sub="verified outcome + provenance" />

            <Badge x={245} y={74} n="01" />
            <Badge x={390} y={100} n="02" />
            <Badge x={597} y={152} n="03" />
            <Badge x={392} y={395} n="04" />
            <Badge x={1000} y={376} n="05" />
            <Badge x={925} y={266} n="06" />

            <Node
              x={360}
              y={415}
              w={200}
              title="World changes"
              sub="out of band — dbt job, another team"
            />
            <Chip x={726} y={368} label="fingerprint mismatch" />
            <Node
              x={940}
              y={408}
              w={200}
              h={60}
              tone="bad"
              title="CONTEXT_DRIFT"
              sub="INVALIDATED forever · DataHub untouched"
            />
          </svg>
        </div>

        {/* ------------------------------------------------- the checks --- */}
        <h2 className="arch-h2">All fifteen checks, in execution order</h2>
        <p className="arch-sub">
          Straight from <code>src/lib/gateway/gateway.ts</code> — each with the refusal it produces.
          The first failure wins; nothing later runs.
        </p>
        <div className="checks-grid">
          {CHECKS.map(([n, name, code]) => (
            <div className="check" key={n}>
              <span className="check-n">{n}</span>
              <span className="check-name">{name}</span>
              <code className="check-code">{code}</code>
            </div>
          ))}
          <div className="check check-then">
            <span className="check-n">→</span>
            <span className="check-name">Only then: mutate, read DataHub back, verify</span>
            <code className="check-code">VERIFIED_SUCCESS or the honest alternative</code>
          </div>
        </div>

        {/* ------------------------------------------------ state machine - */}
        <h2 className="arch-h2">Authorization lifecycle</h2>
        <p className="arch-sub">
          Four ways for authority to die, one way for it to be spent — and no transition back.
        </p>
        <div className="diagram-wrap">
          <svg viewBox="0 0 1160 250" role="img" aria-label="Authorization state machine">
            <path d="M 210 124 C 240 124, 240 124, 262 124" {...W} />
            <path d="M 452 106 C 560 60, 640 44, 700 44" {...W} />
            <path d="M 452 118 C 560 104, 640 104, 700 104" {...W} />
            <path d="M 452 132 C 560 148, 640 164, 700 164" {...W} />
            <path d="M 452 142 C 560 192, 640 224, 700 224" {...W} />
            <Chip x={580} y={52} label="gateway consumes — exactly once" />
            <Chip x={580} y={96} label="clock passes 15 min · derived on check" />
            <Chip x={580} y={172} label="human revokes" />
            <Chip x={580} y={216} label="drift · policy change" />
            <Node
              x={20}
              y={98}
              w={190}
              h={52}
              title="ISSUED"
              sub="signed with its evidence chain"
              tone="dim"
            />
            <Node
              x={262}
              y={98}
              w={190}
              h={52}
              title="ACTIVE"
              sub="single-use authority"
              tone="accent"
            />
            <Node
              x={700}
              y={20}
              w={200}
              h={48}
              title="CONSUMED"
              sub="the execute that won"
              tone="good"
            />
            <Node x={700} y={80} w={200} h={48} title="EXPIRED" sub="time did its job" tone="dim" />
            <Node
              x={700}
              y={140}
              w={200}
              h={48}
              title="REVOKED"
              sub="authority withdrawn"
              tone="warn"
            />
            <Node
              x={700}
              y={200}
              w={200}
              h={48}
              title="INVALIDATED"
              sub="the world moved"
              tone="bad"
            />
            <text x={1000} y={124} fontSize="10.5" fill="var(--muted)">
              every terminal state is terminal —
            </text>
            <text x={1000} y={140} fontSize="10.5" fill="var(--muted)">
              nothing returns to ACTIVE
            </text>
          </svg>
        </div>

        {/* ---------------------------------------------- evidence chain -- */}
        <h2 className="arch-h2">The evidence chain</h2>
        <p className="arch-sub">
          Action, Passport, PolicyDecision, Approval, and Authorization are written in one
          Postgres transaction. Execution and Receipt follow in their own transaction; audit events
          link the hops. A judge can reconstruct who asked, what the world looked like, who
          approved, and what happened.
        </p>
        <div className="chain">
          {CHAIN.map(([name, table, why], i) => (
            <div className="chain-item" key={table}>
              <div className="chain-card">
                <b>{name}</b>
                <code>{table}</code>
                <span>{why}</span>
              </div>
              {i < CHAIN.length - 1 && <span className="chain-arrow">→</span>}
            </div>
          ))}
        </div>
        <p className="chain-note">
          <code>audit_events</code> runs alongside, stamped with links to every entity it mentions —
          the console timeline rebuilds from it after a restart.
        </p>

        <section className="trust-boundaries">
          <div>
            <span className="step-kicker">Honest scope</span>
            <h2>What this demo proves — and what it does not.</h2>
            <p>
              The point is a testable authorization boundary, not a claim that one demo deployment
              solves every production-control problem.
            </p>
          </div>
          <div className="trust-grid">
            <div className="trust-card prove">
              <h3>Proven here</h3>
              <ul>
                <li>The model cannot invoke a DataHub mutation tool.</li>
                <li>Authority is bound to exact parameters, policy, and observed context.</li>
                <li>Changed context invalidates authority before the governed write.</li>
                <li>The outcome is read back from DataHub and recorded.</li>
              </ul>
            </div>
            <div className="trust-card limit">
              <h3>Demo constraints</h3>
              <ul>
                <li>Agent runtime and Gateway share one DataHub token in this single-process demo.</li>
                <li>The approver identity is configured; the console has no approver login.</li>
                <li>Dependency counts cover the discovered candidate set, not every possible entity.</li>
                <li>The isolated drift fixture can mutate DataHub to simulate an external actor.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ steps --- */}
        <h2 className="arch-h2">The golden scenario, step by step</h2>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="step-pill">
                <span>{s.n}</span> {s.t}
              </div>
              <p>{s.d}</p>
            </div>
          ))}
        </div>

        <section className="arch-parts">
          <h2>Where each guarantee lives</h2>
          <div className="parts-grid">
            {PARTS.map(([name, desc, path]) => (
              <div className="part" key={path}>
                <h3>{name}</h3>
                <p>{desc}</p>
                <code>{path}</code>
              </div>
            ))}
          </div>
        </section>

        <section className="proof-strip">
          <b>Nothing here is a claim.</b> 60 unit tests including an adversarial gateway-security
          suite · 10 Postgres race tests · a golden scenario that asserts DataHub state
          byte-for-byte after the refusal · CI green.{" "}
          <a href="/#console">Drive it yourself in the console →</a>
        </section>
      </div>
    </div>
  );
}
