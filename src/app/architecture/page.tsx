import type { Metadata } from "next";
import { TopBar } from "../topbar";

export const metadata: Metadata = {
  title: "Architecture — DataHubX",
  description:
    "One authority path, every check enforced: how intent becomes a verified DataHub mutation, and how stale authority dies.",
};

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
    d: "The Gateway re-reads DataHub, recomputes the hash and the fingerprint, and finds a different world. CONTEXT_DRIFT: the authorization is permanently INVALIDATED and DataHub is byte-identical.",
  },
  {
    n: "06",
    t: "Replan & verify",
    d: "The agent replans against reality. Fresh passport, fresh approval, execute — then the Gateway reads DataHub back, and only a confirmed postcondition is VERIFIED_SUCCESS on the receipt.",
  },
];

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
  sub: string;
  tone?: "plain" | "bad";
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={h / 2}
        fill={tone === "bad" ? "var(--bad-soft)" : "var(--panel)"}
        stroke={tone === "bad" ? "#fecaca" : "var(--line-strong)"}
      />
      <text
        x={x + w / 2}
        y={y + h / 2 - 5}
        textAnchor="middle"
        fontSize="14.5"
        fontWeight="650"
        fill={tone === "bad" ? "var(--bad)" : "var(--text)"}
      >
        {title}
      </text>
      <text
        x={x + w / 2}
        y={y + h / 2 + 13}
        textAnchor="middle"
        fontSize="10.5"
        fill={tone === "bad" ? "var(--bad)" : "var(--muted)"}
      >
        {sub}
      </text>
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
        y={cy - 4}
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
          y={cy + 14 + i * 13}
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

const wire = "var(--wire)";

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
            From a sentence typed at an agent to a verified DataHub mutation — this is the actual
            path, and every box on it is something DataHubX enforces, not something it hopes.
          </p>
        </header>

        <div className="diagram-wrap">
          <svg viewBox="0 0 1160 520" role="img" aria-label="DataHubX authority path diagram">
            {/* entry -> passport curves */}
            <path
              d={`M 210 118 C 280 118, 280 172, 330 186`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            <path
              d={`M 210 198 C 260 198, 270 198, 318 198`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            <path
              d={`M 210 278 C 280 278, 280 224, 330 210`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            {/* passport -> approval */}
            <path
              d={`M 462 198 C 490 198, 490 198, 512 198`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            {/* approval -> gateway */}
            <path
              d={`M 682 198 C 715 198, 715 198, 742 198`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            {/* gateway -> right stack */}
            <path
              d={`M 878 160 C 920 130, 920 118, 952 118`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            <path
              d={`M 892 198 C 920 198, 920 198, 952 198`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            <path
              d={`M 878 236 C 920 266, 920 278, 952 278`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            {/* out-of-band -> gateway, gateway -> drift */}
            <path
              className="wire-anim"
              d={`M 560 443 C 690 443, 770 320, 804 276`}
              fill="none"
              stroke={wire}
              strokeWidth="2"
            />
            <path
              d={`M 843 274 C 888 340, 896 392, 936 430`}
              fill="none"
              stroke="#fca5a5"
              strokeWidth="2"
            />

            {/* entries */}
            <Node x={20} y={90} title="Ask the agent" sub="Gemini over DataHub MCP · read-only" />
            <Node
              x={20}
              y={170}
              title="Propose directly"
              sub="console form · any discovered dataset"
            />
            <Node x={20} y={250} title="Golden scenario" sub="CLI · asserted end to end" />

            {/* passport + policy */}
            <Hex
              cx={390}
              cy={198}
              r={82}
              title="Passport"
              sub="SHA-256 fingerprint|ALLOW · REVIEW · BLOCK"
            />
            <Chip x={266} y={240} label="aspect reads by URN" />

            {/* approval */}
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
            {/* gateway */}
            <Hex
              cx={815}
              cy={198}
              r={86}
              accent
              title="Gateway"
              sub="re-reads DataHub|recomputes hash + fingerprint|consume once, then mutate"
            />

            {/* the only write path */}
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
              THE ONLY WRITE PATH
            </text>
            <Node x={952} y={90} w={182} title="DataHub" sub="governed mutation + read-back" />
            <Node x={952} y={170} w={182} title="Postgres" sub="ACTIVE → CONSUMED · atomic" />
            <Node x={952} y={250} w={182} title="Receipt" sub="verified outcome + provenance" />

            {/* step badges — same numbers as the cards below */}
            <Badge x={245} y={74} n="01" />
            <Badge x={390} y={100} n="02" />
            <Badge x={597} y={152} n="03" />
            <Badge x={392} y={395} n="04" />
            <Badge x={914} y={396} n="05" />
            <Badge x={925} y={266} n="06" />

            {/* drift row */}
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
