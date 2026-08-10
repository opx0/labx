# DataHubX

**Context-bound authorization for AI agents performing real DataHub mutations.**

DataHubX demonstrates a specific failure mode in agent approval workflows:

```text
human approves an action → relevant DataHub context changes → agent tries to execute
```

Before executing, the Gateway reads current DataHub context again and compares its canonical fingerprint with the one approved by a human. A mismatch blocks that attempt; the agent re-evaluates and obtains fresh approval.

> The agent proposes. Policy evaluates. A human approves. The Gateway executes.

## Judge quick start

The fastest way to evaluate the project is the hosted demo. No setup or API key is required.

| What | URL | Credentials |
|---|---|---|
| Governance console | https://app.opxz.dev | None |
| DataHub catalog | https://catalog.opxz.dev/demo-login | None — auto-signs you in as the read-only `judge` account |

(`https://catalog.opxz.dev` with `judge` / `judge` also works if you prefer the login form.)

### What to do

1. In the governance console choose **customer_prod** and **CHANGE_LIFECYCLE**, then select **Propose**. Policy should return **REVIEW** because it is production PII.
2. Select **Approve**. An authorization is created against the displayed context fingerprint.
3. Select **Change the world**. A third critical downstream, `fraud_alerts`, is added.
4. Select **Execute**. Expected result: **CONTEXT_DRIFT** and **MUTATION NOT EXECUTED**.
5. Select **Replan**, approve the new proposal, then execute it.
6. In the catalog, search for `customer_prod` and confirm it is deprecated. Its deprecation note contains authorization provenance.

The meaningful check is step 4: immediately before and after the rejected attempt, DataHub's lifecycle remains `ACTIVE`. The blocked result is checked against DataHub, not inferred from the UI.

### What the catalog shows

This is a live, populated DataHub estate, not an empty fixture:

- **Home** — reviewer announcements pointing back to the console.
- **`customer_prod`** — full schema (10 PII-annotated columns), markdown documentation, owners
  (`Dana Okafor`, governance lead; `Priya Sharma`, platform engineer), the `Customer 360` domain,
  `PII` glossary terms, upstream sources (`kafka/raw_customer_events`, `postgres/crm_export`) and
  the two critical downstreams the demo counts.
- **Context → Documents** — "How this estate is governed" and the drift-scenario runbook.
- **Govern → Glossary / Domains** — `PII`, `CriticalDependency`, `RegulatedData` terms;
  `Customer 360`, `Finance Analytics`, `Risk & Compliance` domains.
- After an executed run, `customer_prod`'s deprecation note carries the approval id, policy
  version and passport fingerprint that authorized it — provenance readable by the next human
  or agent.

## The core demonstration

The golden scenario runs against a real DataHub and Postgres instance:

```text
customer_prod has 2 critical downstreams
  → policy returns REVIEW
  → approval and authorization are created
  → a third critical downstream is added
  → Gateway returns CONTEXT_DRIFT
  → the authorization becomes INVALIDATED in Postgres, permanently
  → DataHub state is unchanged
  → a fresh proposal is approved and executed
  → DataHub is read back to verify the requested lifecycle
```

It also asserts the security properties directly, each against the live system:

- A drifted authorization is `INVALIDATED` in Postgres, and retrying it is refused.
- Replaying a consumed authorization is refused.
- An authorization with tampered claims fails signature verification.
- Presenting valid authority with **different parameters** is refused — the Gateway recomputes
  the action hash from the parameters it would execute; it never trusts a caller-supplied hash.
- A rejected substitution does not consume the authorization.
- The signed `approvalId` resolves to the persisted approval row.

Run it locally:

```bash
bun run scripts/golden-scenario.ts
```

Typical output:

```text
4. STALE AUTHORIZATION IS PRESENTED TO THE GATEWAY
    result                     CONTEXT_DRIFT
  ✓ gateway returns CONTEXT_DRIFT
  ✓ MUTATION NOT EXECUTED
  ✓ DataHub state is byte-identical — nothing was mutated
```

## Run it locally

### Fastest path — everything in Docker

Three commands give you the whole thing: DataHub, the governance database, and the console.

```bash
# 1. DataHub itself (official quickstart), then enable auth + mint a token — see below
pip install acryl-datahub && datahub docker quickstart

# 2. The DataHubX stack: Postgres + the console, migrations applied automatically
DATAHUB_TOKEN=<your-pat> docker compose --profile full up --build -d

# 3. Seed the demo estate
python scripts/seed_demo.py && python scripts/seed_showcase.py
```

Console: http://localhost:3000. The container reaches DataHub on the host via
`host.docker.internal` (override with `DATAHUB_GMS_URL` if yours lives elsewhere).
Prefer running the app on the host? Follow the manual path below.

### Prerequisites

- Bun 1.x
- Docker and Docker Compose
- Python 3 and `pip`
- A running DataHub instance reachable from this machine
- A DataHub personal access token able to create demo datasets, change lineage, and update deprecation
- Optional: `uv` and a Google Gemini key, only for the natural-language agent panel

The default commands assume DataHub GMS is at `http://localhost:8080`. Use an existing DataHub instance or DataHub Quickstart.

```bash
git clone <repository-url> datahubx
cd datahubx
bun install
docker compose up -d
```

Create `.env.local` (start from `.env.example`). It is ignored by Git; never commit it.

```dotenv
DATAHUB_GMS_URL=http://localhost:8080
DATAHUB_TOKEN=<your-datahub-personal-access-token>
DATABASE_URL=postgresql://datahubx:datahubx_dev@localhost:5435/datahubx

# Optional: required only for the natural-language agent panel.
GOOGLE_GENERATIVE_AI_API_KEY=<your-gemini-key>
```

Migrate and verify the application:

```bash
bun run db:migrate
bun run typecheck
bun run build
```

### Seed the exact demo corpus

`scripts/seed_demo.py` currently reads its DataHub token from `~/.datahub/governance-token` and targets `http://localhost:8080`. Create that local token file with the same PAT:

```bash
mkdir -p ~/.datahub
chmod 700 ~/.datahub
printf '%s' '<your-datahub-personal-access-token>' > ~/.datahub/governance-token
chmod 600 ~/.datahub/governance-token

python -m pip install acryl-datahub
python scripts/seed_demo.py          # the minimal governed corpus
python scripts/seed_showcase.py      # schemas, docs, owners, domains, glossary, announcements
```

The seed creates:

| Dataset | Expected context | Purpose |
|---|---|---|
| `customer_prod` | PROD, PII, Finance, two Critical downstreams | REVIEW and drift scenario |
| `fraud_alerts` | PROD, Critical; no initial lineage edge | deterministic drift trigger |
| `analytics_test` | DEV | ALLOW fixture |
| `regulated_core` | PROD, Protected | BLOCK fixture |
| `revenue_daily`, `exec_dashboard_feed` | PROD, Critical | initial downstreams |

Now run the end-to-end scenario:

```bash
bun run scripts/golden-scenario.ts
```

It exits non-zero if the expected 2 → 3 dependency drift, blocked attempt, fresh execution, or read-back verification does not occur. It changes demo data, so use only a disposable DataHub environment.

Start the console separately:

```bash
bun run dev
# Open http://localhost:3000
```

## Test commands

```bash
bun run typecheck          # TypeScript validation
bun run check              # Biome formatting/lint checks
bun run test:run           # 60 fast unit tests, no infrastructure needed
bun run test:integration   # Postgres atomic-consumption tests; requires DATABASE_URL
bun run build              # production Next.js build
```

`bun run test:run` covers canonical fingerprinting, context readability, policy determinism, action validation, the exposed agent-tool list, and — in `tests/unit/gateway-security.test.ts` — the Gateway's security boundary itself: parameter substitution, claim tampering, replay, drift invalidation permanence, expiry, and verification honesty, all provable with a fake provider and an in-memory store. `bun run test:integration` uses real Postgres to show that, under concurrent attempts, exactly one `ACTIVE → CONSUMED` transition wins.

The golden scenario is the DataHub end-to-end check; it deliberately mutates the local/demo DataHub instance.

## Architecture

```text
intent → passport + policy (ALLOW / REVIEW / BLOCK) → human approval
       → signed single-use authorization → Gateway (15 checks, re-reads DataHub)
       → verified mutation — or permanent invalidation on drift
```

**The full interactive architecture — deployment topology, all 15 Gateway checks in execution
order, the authorization state machine, and the evidence chain — lives at
[app.opxz.dev/architecture](https://app.opxz.dev/architecture).**

| Responsibility | Location |
|---|---|
| Action types, validation, postconditions | `src/lib/domain/actions.ts` |
| Typed readable/unreadable context and canonical SHA-256 fingerprints | `src/lib/domain/context.ts`, `src/lib/domain/canonical.ts` |
| Deterministic policies and declared context dependencies | `src/lib/domain/policy.ts` |
| Ed25519 authorization signing and state model | `src/lib/domain/authorization.ts` |
| Pre-execution revalidation and verification | `src/lib/gateway/gateway.ts` |
| DataHub aspect reads and mutation adapter | `src/lib/datahub/` |
| Atomic Postgres authorization consumption | `src/lib/db/authorization-store.ts` |
| Hosted demo workflow | `src/lib/demo/engine.ts` |

## Built on DataHub's official agent stack

- The agent's discovery runs on [`mcp-server-datahub`](https://github.com/acryldata/mcp-server-datahub),
  DataHub's official MCP server — version-pinned, mutation tools disabled, and only its six read
  tools wired to the model (enforced by test).
- The catalog works with DataHub's official Claude skills:
  `claude plugins install datahub-skills --from github:datahub-project/datahub-skills` and point
  it at this instance — DataHubX supplies the governed write path those read-oriented skills
  deliberately stop short of.

## DataHub read strategy

The agent uses DataHub's MCP server for discovery with mutation tools disabled. Governance context does not depend on search results: it is read from primary DataHub aspects by URN. This avoids letting a stale discovery result become a security decision.

## Security boundary, as implemented

- **Parameter binding.** The Gateway validates the request's parameters against the action
  registry and recomputes the action hash from them before comparing with the signed
  authorization. There is no way to present approved authority with different parameters —
  `ExecuteRequest` does not even have an `actionHash` field a caller could supply.
- **Drift kills authority permanently.** On `CONTEXT_DRIFT` the Gateway transitions the
  authorization `ACTIVE → INVALIDATED` in Postgres before returning. It stays dead even if the
  world drifts back to the approved state.
- **The write path is structurally isolated.** `DataHubClient` — the client the agent and the
  app hold — is read-only by construction: it has no GraphQL method and no non-GET request.
  Mutations live in `src/lib/datahub/mutations.ts`. The demo's "change the world" button uses
  `src/lib/demo/out-of-band.ts`, an explicitly separate simulator of a third party changing
  DataHub outside the governed system. A test walks every source file under `src/` and asserts
  the exact importer set of both write modules (Gateway only; demo engine only) — any spelling
  of the import, in any new file, fails the suite.
- **The agent's MCP surface is pinned and allowlisted.** The DataHub MCP server version is
  pinned, mutation tools are disabled by configuration, and only the six known read tools are
  wired to the model — a tool the allowlist does not name never reaches the agent's registry,
  whatever an upstream release ships.
- **Success means verified.** The console shows success only when the provider acknowledged the
  mutation *and* the post-mutation read-back confirms the postcondition (`VERIFIED_SUCCESS`).
  A failed provider call with an unchanged world is a `PROVIDER_ERROR` refusal; a failed call
  against a world that already matched is `EXECUTION_UNKNOWN`, never success. The provider's
  error is preserved on the receipt, and refused executions are persisted with their error code.
- **Approval references resolve.** The `approvalId` inside the signed authorization is the
  primary key of the persisted approval row.
- **Policy binding.** The signed authorization names the policy set and version it was approved
  under. If the policy in force changes before execution, the Gateway refuses and permanently
  invalidates the authorization — a rule change retroactively kills authority granted under the
  old rules.
- **Rejection and revocation are real states.** An approver can reject a proposal (persisted as
  a `REJECTED` approval with its full evidence chain, and no authorization row exists at all) or
  revoke an issued authorization (`ACTIVE → REVOKED`, atomic, refused by the Gateway forever).
- **The audit trail is durable.** Every timeline event is persisted to Postgres with links to
  the action, approval, authorization and execution it concerns; the console rebuilds its
  timeline from the database after a restart. Refused executions are persisted with their error
  codes, and the signing key survives restarts so outstanding authorizations are not orphaned.

## Limitations and trust assumptions

Stated explicitly — the guarantee is only as strong as these:

- **Trusted computing base:** the Gateway runtime, the Ed25519 signing key, the Postgres
  database, and DataHub's own identity boundary.
- **Single-process demo:** the agent runtime and the Gateway run in one process, so both sides
  see the same DataHub token. The *capability* is separated (the agent's client cannot express
  a write; the MCP server is pinned and read-allowlisted — both test-enforced), but the
  *credential* is not. A production deployment would run the Gateway separately with its own
  scoped write token.
- **Approver identity is configured, not authenticated:** approval/rejection/revocation act as
  the `APPROVER_URN` principal (default `human-1`); there is no login in front of the button.
- **Candidate-set dependency counting:** critical downstreams are counted over a declared
  candidate set read by URN (deliberately, because lineage *search* measurably lags); an entity
  nobody has declared is invisible until discovery catches up.
- **Policy under-declaration narrows the guarantee silently** — a rule that reads a field it
  does not declare would not be fingerprinted. A test asserts every rule declares every field
  it reads.

## Future work

`CHANGE_OWNER` and further action types; authenticated approver identity; split deployment with
scoped credentials per component; step-level authorization for multi-step agent workflows; a
policy management UI; provider connectors beyond DataHub.

## Why DataHubX

AI agents need enough access to understand a data estate, but privileged writes must remain specific, temporary, and grounded in current reality. DataHubX binds authorization to:

- the principal
- the exact action, target, and parameters
- the policy decision and version
- the context observed at approval time
- a short authorization lifetime

The result is a governance layer that lets agents help operate metadata without turning an old approval into standing authority.

## License

Apache-2.0. See [LICENSE](LICENSE).
