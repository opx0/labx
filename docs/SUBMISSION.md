# Submission kit

Copy-paste material for the hackathon submission form, the live demo, and judge Q&A.

## Short description (≤ 3 sentences)

DataHubX is context-bound authorization for AI agents performing real DataHub mutations: a
human approves an action against a cryptographic fingerprint of the world as it was observed,
and an execution Gateway re-reads DataHub immediately before mutating — if reality changed, the
authorization is permanently invalidated and nothing executes. Agents get enough access to
reason (DataHub's official MCP server, read-only) but writes exist only behind the Gateway.
Stale authority dies; it does not linger.

## Why this matters (track response)

Every current agent-permission model — RBAC, OAuth scopes, human-in-the-loop approval queues —
shares one gap: the state of the world at *approval* time and at *execution* time are assumed
identical, and nothing checks. DataHubX closes exactly that gap for data-catalog mutations, with
the properties a security reviewer would demand: parameter binding by recomputed hash, atomic
single consumption, permanent invalidation on drift or policy change, rejection and revocation
as first-class persisted states, verified-only success, and a durable audit chain from intent to
receipt. Everything is enforced against a live DataHub and a real Postgres — the golden scenario
asserts DataHub's own state byte-for-byte, not the app's bookkeeping.

## 3-minute live demo script

Setup (before you present): `bun run health` — all three checks green; console + catalog tabs open.

1. **(20s)** Console (`app.opxz.dev`): "The agent proposes, policy decides, a human authorizes,
   the Gateway enforces." Ask the agent to retire `customer_prod` — it inspects governance
   context via DataHub's own MCP server and proposes `CHANGE_LIFECYCLE`.
2. **(25s)** Policy returns **REVIEW** (production + PII + 2 critical downstreams). Show the
   "Policy in force" panel — deterministic rules, each declaring the context fields it depends
   on; exactly those fields are fingerprinted.
3. **(20s)** **Approve.** Authorization AUTH-001 issued — bound to principal, action, params
   hash, policy version, and the context fingerprint. 15-minute TTL.
4. **(20s)** **Change the world.** A third critical downstream (`fraud_alerts`) appears in
   DataHub — show it in the catalog lineage tab if time allows.
5. **(30s)** **Execute.** The Gateway re-reads DataHub, fingerprints don't match →
   `CONTEXT_DRIFT`, authorization **permanently INVALIDATED in Postgres**, DataHub untouched.
   This is the thesis on screen: *human approved ✓, reality changed ⚠, authority died ✕,
   mutation not executed ✓*.
6. **(30s)** **Replan → Approve → Execute.** Fresh passport against the 3-dependency world;
   mutation lands; the Gateway reads DataHub back — `VERIFIED_SUCCESS`. Open the catalog:
   `customer_prod` is deprecated and its note carries approval id, policy version, and passport
   fingerprint.
7. **(15s)** Close: "Every claim you just saw is also a test: 60+ unit tests including an
   adversarial gateway-security suite, Postgres race tests, and an end-to-end golden scenario
   that asserts DataHub state byte-for-byte."

Fallbacks: if the agent panel is slow, use "Propose directly" (same governed path). If drift
polling lags a beat, refresh current context once.

## Judge Q&A

**Can I change the parameters after approval?** No — the Gateway recomputes the action hash
from the params it will execute and compares to the signed claims; the request doesn't even
have a hash field to forge. Rejected substitution doesn't consume the authorization.

**Can I replay an authorization?** No — consumption is one atomic conditional UPDATE; 20
concurrent racers are integration-tested and exactly one wins.

**What if the world drifts back?** Still dead. Drift transitions `ACTIVE → INVALIDATED`
permanently, before the caller even hears about the drift.

**Can the agent bypass the Gateway?** The agent's DataHub client has no write path (no GraphQL,
no non-GET request), the MCP server is version-pinned with only six read tools allowlisted, and
a test walks every source file asserting only the Gateway imports the mutation module. In this
single-process demo the *credential* is still shared — stated in Limitations; production would
split deployment.

**What if verification fails?** Only a read-back-confirmed postcondition is success. A provider
failure with an unchanged world is `PROVIDER_ERROR`; an already-matching world is
`EXECUTION_UNKNOWN` — never claimed as success, and the provider error is on the receipt.

**What if DataHub is unreadable at execution time?** Fail closed: `CONTEXT_UNAVAILABLE`, no
mutation. Unreadable is typed distinctly from empty precisely so a narrowed token can't turn
REVIEW into ALLOW.

**What if the policy changes after approval?** The authorization names its policy id + version;
the Gateway refuses and permanently invalidates on mismatch.

**What's simulated?** Nothing in the enforcement path. The only simulator is the demo's
"change the world" button, which plays the third party (a dbt job, another team) editing
DataHub out of band — via a module the agent provably cannot import.
