# DataHubX

**Context-bound authorization for AI agents performing real DataHub mutations.**

An agent can be *approved* to act without being *permanently authorized* to act. DataHubX binds
execution authority to the exact action, target, parameters **and the observed state of the world**
that a human actually approved — then re-reads that state immediately before the mutation and
refuses if reality has moved.

> The agent proposes. The policy decides. The human authorizes. The Gateway enforces.

**Live:** [app.opxz.dev](https://app.opxz.dev) — the governance console, driving a real DataHub.
[catalog.opxz.dev](https://catalog.opxz.dev) — that DataHub's own UI (`datahub` / `datahub`), so
you can confirm the mutations are real and see the provenance written back.

---

## The problem

Give an agent a permission and it holds that permission forever. Add a human approval step and you
have improved things, but you have not closed the real gap:

```
APPROVAL  →  ...the environment changes...  →  EXECUTION
```

The conditions that justified the approval may no longer hold when the mutation finally runs.
Nothing in RBAC, OAuth, or a human approval queue notices that.

**DataHubX makes stale authority die.**

## The demonstration

A human approves deprecating `customer_prod` — a production dataset holding PII, with **2 critical
downstream dependencies**. Before the mutation executes, a third critical dependency appears.

```
HUMAN APPROVED ✓  →  REALITY CHANGED ⚠  →  AUTHORIZATION INVALIDATED ✕  →  MUTATION NOT EXECUTED ✓
```

The agent then re-reads the world, replans, obtains fresh authority against the world as it now is,
executes, and the system verifies the result by reading DataHub back.

Run it yourself against a real DataHub:

```bash
bun run scripts/golden-scenario.ts
```

```
4. STALE AUTHORIZATION IS PRESENTED TO THE GATEWAY
    result                     CONTEXT_DRIFT
    approved fingerprint       0d3f68e35b9750bb…
    current  fingerprint       59acaa9db6a2aee8…
  ✓ gateway returns CONTEXT_DRIFT
  ✓ MUTATION NOT EXECUTED
  ✓ DataHub state is byte-identical — nothing was mutated
```

That last assertion matters: *blocked* is verified against DataHub itself, not asserted from our own
bookkeeping.

---

## The agent

Natural language in, one governed action out:

```
"Retire customer_prod"        -> proposes CHANGE_LIFECYCLE, policy returns REVIEW
"Deprecate regulated_core"    -> agent declines: "Target is a protected asset"
"Clean up analytics_test"     -> proposes, policy returns ALLOW
```

### It reads through DataHub's own MCP Server

The agent spawns [`mcp-server-datahub`](https://github.com/acryldata/mcp-server-datahub) over
stdio and inherits its six read tools:

```
search  get_lineage  get_dataset_queries  get_entities
list_schema_fields   get_lineage_paths_between
```

That server ships with `TOOLS_IS_MUTATION_ENABLED=false`. **We leave it false.** DataHub
deliberately stops at read; DataHubX supplies the governed write path it stops short of.

### But the Passport does not read through MCP

MCP `search` and `get_lineage` resolve against Elasticsearch. We measured that path returning
stale lineage for over 30 seconds, and once returning the correct count over the wrong set. So
governance context is read from primary-store aspects instead, via `inspect_governance_context`.

**Discovery tolerates staleness — a security decision does not.** That split is the whole
design in one line.

### The boundary

Two governance tools on top of MCP's six: `inspect_governance_context` and `propose_action`.
None of the eight mutates DataHub. `propose_action` does not execute anything — it submits a
proposal into policy evaluation. The boundary is a missing capability, not an instruction the
model is asked to respect, so prompt injection has nothing to reach for.

`tests/unit/agent-boundary.test.ts` asserts the tool list, that MCP mutations stay disabled,
that no tool name implies a write, and that `agent.ts` never imports the privileged mutation
module.

## Results are written back

After a governed mutation the deprecation note carries its own provenance, so the next person
or agent reading DataHub inherits the reasoning rather than finding an unexplained change:

```
Governed by DataHubX. approval=db315f8b… principal=urn:li:corpuser:agent-1
policy=datahubx-default v1 passport=0d3f68e35b9750bb
```

## How it works

```
USER INTENT → AGENT → STRUCTURED ACTION → CONTEXT PASSPORT → POLICY ENGINE
                                                                  │
                                            ALLOW ── REVIEW ── BLOCK
                                                       │
                                                HUMAN APPROVAL
                                                       │
                                        CONTEXT-BOUND AUTHORIZATION
                                                       │
                                              EXECUTION GATEWAY
                                                       │
                                        re-read context, recompute fingerprint
                                                  ╱         ╲
                                             MATCH           MISMATCH
                                               │                │
                                          EXECUTE          INVALIDATE
                                               │                │
                                           VERIFY            REPLAN
```

### The Passport

Before any privileged action, the system captures the decision-relevant state of the target and
hashes it:

```
{ environment: PROD, tags: [PII, Finance], lifecycle: ACTIVE, critical_dependency_count: 2 }
                              ↓ canonicalise → SHA-256
                     0d3f68e35b9750bb...
```

**Only the fields the matched policy rules declare they depend on are fingerprinted.** An unrelated
description edit does not invalidate authority; a change to a field the decision rested on does.

### The Gateway

The single privileged mutation path. It never trusts a Passport handed to it — it re-reads DataHub
itself and recomputes the fingerprint (`src/lib/gateway/gateway.ts`, implementing the 15-step
validation sequence). Signature → state → expiry → principal → action → target → parameters →
**fresh context** → fingerprint comparison → mutate → verify → receipt.

### Verification

A provider returning `true` is not proof. After every mutation the Gateway reads actual state back
and evaluates the action's postcondition, yielding `VERIFIED_SUCCESS`, `POSTCONDITION_FAILED`,
`VERIFICATION_PENDING`, or `EXECUTION_UNKNOWN`.

---

## What we learned building this against real DataHub

Two findings changed the design, and both were found by measurement rather than reading docs.

### 1. Lineage search cannot be trusted for a security decision

The natural implementation counts downstream dependencies with `searchAcrossLineage` and filters on
`degree` and `tags`. Measured against a live instance, that path:

- did not reflect an added lineage edge within **30 seconds**
- kept returning an edge that had been **removed**
- at one point returned the **correct count over the wrong set** — simultaneously omitting a real
  downstream and retaining a deleted one, so the two errors cancelled numerically
- has a stale `degree` **filter** even while the `degree` **field** on the same response is correct

A fingerprint over that number **matches when reality has changed** — a false negative in the exact
control this product exists to provide, with a clean-looking audit trail.

Reading `upstreamLineage` and `globalTags` aspects **by URN** tracked the same add and remove in
**179 ms** and **109 ms**, correct in both directions. So the Passport is built from primary-store
aspect reads; search is used only for agent discovery, where staleness costs a suggestion rather
than a security decision.

### 2. Unreadable context must not look like empty context

A DataHub personal access token carries the *minting user's* privileges. If those are narrowed, the
read does not error — it returns **less**. Lose tag-read privilege and `production AND PII → REVIEW`
simply stops matching, silently downgrading to `ALLOW`.

So readability is part of the type (`src/lib/domain/context.ts`). A field is `observed`,
`observed-set`, `absent`, or `unreadable` — and fingerprinting **refuses** to run over unreadable
context rather than hashing a plausible-looking empty value.

This caught a real bug in our own code: `environment` lives on DataHub's `datasetKey` aspect, not
`datasetProperties` (which does not exist on SDK-created datasets). Reading the wrong aspect
returned `absent`, and the policy silently downgraded to `ALLOW`. It now fails closed.

---

## Security model

| Threat | Defense |
|---|---|
| Wrong target / parameters | Bound into the signed authorization and re-checked |
| Replay | Nonce + atomic single-consumption |
| Expiry | Authorization lifetime |
| Context changed since approval | Passport fingerprint + pre-execution revalidation |
| Agent bypass | Agent has no mutation tool; Gateway is the only module importing the mutation path |
| Authorization tampering | Ed25519 signature |
| Provider uncertainty | Postcondition verification against actual state |
| Missing / unreadable context | Fail closed |

Ed25519 rather than an HMAC so the component that *verifies* authority never holds the power to
*mint* it.

### Honest scope

- Trusts the Gateway runtime, the signing key, the database, and DataHub's own identity boundary.
- The guarantee is only as strong as the declared context model — a policy that under-declares its
  dependencies narrows the guarantee silently. Declarations are checked by a test.
- Counting dependencies from aspect reads requires a candidate set, so a never-before-observed
  entity can be missed until discovery catches up. This is a real limit, stated rather than hidden.
- The agent reads and proposes only. It cannot mutate DataHub under any prompt, because no such
  tool is in its registry.

### Replay protection is enforced by the database, not by discipline

An authorization is consumed with a conditional `UPDATE`, never a read-then-write:

```sql
UPDATE authorizations SET state = 'CONSUMED'
WHERE id = $1 AND state = 'ACTIVE'
```

Postgres row-locks for the statement, so of N concurrent callers exactly one sees `count = 1`. A
`SELECT` followed by an `UPDATE` leaves a window where both callers see `ACTIVE` and both proceed —
the classic double-spend. The Gateway consumes *before* touching the provider, so the loser never
reaches DataHub at all.

`tests/integration/atomic-consumption.test.ts` fires 20 concurrent consumers at one authorization
and asserts exactly one wins, then repeats it across 10 authorizations interleaved. It also asserts
the database rejects a duplicate nonce and a duplicate idempotency key.

---

## Running locally

**Prerequisites:** [Bun](https://bun.sh), Docker, [uv](https://docs.astral.sh/uv/) (the agent
spawns DataHub's MCP server with `uvx`), and a reachable DataHub instance.

```bash
git clone <this repo> && cd datahubx
bun install
```

### 1. A DataHub to talk to

```bash
pip install acryl-datahub
datahub docker quickstart
```

Then **enable authentication** — the quickstart ships with it off, which means tokens are ignored
and anonymous requests succeed:

```
METADATA_SERVICE_AUTH_ENABLED=true      # on BOTH datahub-gms and datahub-frontend
```

Verify by sending a request with **no** token and confirming a `401`. Checking that a valid token
works does not detect this failure.

Mint a personal access token in the DataHub UI (Settings → Access Tokens).

### 2. Postgres, and configure

```bash
docker compose up -d          # postgres 18 on 127.0.0.1:5435

cat > .env.local <<EOF
DATAHUB_GMS_URL=http://localhost:8080
DATAHUB_TOKEN=<your personal access token>
DATABASE_URL=postgresql://datahubx:datahubx_dev@localhost:5435/datahubx
GOOGLE_GENERATIVE_AI_API_KEY=<gemini key, for the agent>
EOF

bun run db:migrate
```

### 3. Seed the demo corpus

```bash
python scripts/seed_demo.py
```

Creates five datasets on the `demo` platform: `customer_prod` (PROD, PII, Finance) with two
`Critical` downstreams, `fraud_alerts` (held back as the drift trigger), plus `analytics_test` (DEV)
and `regulated_core` (Protected) to exercise ALLOW and BLOCK.

### 4. Run

```bash
bun run scripts/golden-scenario.ts   # the full scenario, asserted end to end
bun run dev                          # the governance console at localhost:3000
bun run test:run                     # unit tests
```

---

## Testing

```bash
bun run test:run          # 37 unit tests — canonicalisation, policy, registry, agent boundary
bun run test:integration  # 10 integration tests — atomic consumption against real Postgres
bun run typecheck
bun run check             # biome
```

The unit tests cover the properties the product depends on rather than incidental behaviour:
fingerprint stability, set-order independence, `absent` vs `[]` vs `""` being three distinct
fingerprints, declared-dependency scoping, fail-closed on unreadable context, BLOCK absorbing
REVIEW, and a test asserting that every policy rule has declared every field it reads.

`scripts/golden-scenario.ts` is the end-to-end proof against **real Postgres and real DataHub**. It
asserts DataHub's own state is byte-identical after the drift refusal, that the executed
authorization is `CONSUMED` in the database, and — the one that shows the ordering is right — that
the *drifted* authorization is still `ACTIVE`, because the Gateway refused before consuming it. It
also covers replay denial and tamper rejection.

---

## Architecture

```
src/lib/domain/        pure, no I/O, no framework, no provider
  context.ts           observed / absent / unreadable — readability is typed
  canonical.ts         canonicalisation + SHA-256 fingerprint, fail-closed
  actions.ts           the 4-action registry, params and postconditions
  policy.ts            deterministic rules with declared dependencies
  authorization.ts     Ed25519 signing, nonce, expiry, state machine
src/lib/datahub/
  client.ts            aspect reads (Passport) — the trusted path
  mutations.ts         GraphQL mutations — imported ONLY by the Gateway
src/lib/agent/
  mcp.ts               DataHub's official MCP server over stdio, mutations off
  agent.ts             governance tools on top of MCP; no write tool
src/lib/gateway/
  gateway.ts           the 15-step validation sequence
src/lib/db/
  authorization-store.ts  atomic single-consumption via conditional UPDATE
  repository.ts           persists action → passport → decision → approval → authorization
prisma/schema.prisma   the domain tables, with DB-enforced invariants
src/app/               the governance console
```

The domain layer does not know DataHub exists. The Gateway operates on
`execute(Action, Authorization)`, and only the adapter knows what that means for a given provider.

## Future work

More action types; a policy management UI; step-level authorization for multi-step workflows; provider connectors
beyond DataHub.

## License

Apache 2.0 — see [LICENSE](LICENSE).
