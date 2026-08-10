"""Showcase enrichment for the judge-facing catalog.

Adds everything a real estate has — schemas, docs, owners, domains, glossary,
upstream lineage, home announcements, context documents — WITHOUT touching the
four fingerprinted fields the demo depends on (datasetKey origin, globalTags,
deprecation, critical-downstream lineage of the candidate set).

Idempotent: aspect upserts throughout; posts/documents guarded.
Run on the VM: python3 seed_showcase.py
"""

import os
import time
import warnings

warnings.filterwarnings("ignore")

from datahub.emitter.mcp import MetadataChangeProposalWrapper
from datahub.ingestion.graph.client import DatahubClientConfig, DataHubGraph
from datahub.metadata.schema_classes import (
    AuditStampClass,
    CorpUserInfoClass,
    DomainPropertiesClass,
    DomainsClass,
    EditableDatasetPropertiesClass,
    GlossaryTermAssociationClass,
    GlossaryTermInfoClass,
    GlossaryTermsClass,
    InstitutionalMemoryClass,
    InstitutionalMemoryMetadataClass,
    OwnerClass,
    OwnershipClass,
    OwnershipTypeClass,
)
from datahub.sdk import DataHubClient, Dataset
from datahub.metadata.urns import TagUrn

TOKEN = open(os.path.expanduser("~/.datahub/governance-token")).read().strip()
SERVER = "http://localhost:8080"

client = DataHubClient(server=SERVER, token=TOKEN)
graph = DataHubGraph(DatahubClientConfig(server=SERVER, token=TOKEN))

NOW = AuditStampClass(time=int(time.time() * 1000), actor="urn:li:corpuser:datahub")

DEMO = "urn:li:dataset:(urn:li:dataPlatform:demo,{},PROD)"
CUSTOMER = DEMO.format("customer_prod")

def emit(urn, aspect):
    graph.emit_mcp(MetadataChangeProposalWrapper(entityUrn=urn, aspect=aspect))

# ---------------------------------------------------------------- people ----
print("== people ==")
PEOPLE = {
    "agent-1": ("DataHubX Agent", "Governed AI agent — proposes, never mutates directly"),
    "human-1": ("Dana Okafor", "Data Governance Lead — approves context-bound authorizations"),
    "priya": ("Priya Sharma", "Data Platform Engineer"),
}
for user, (name, title) in PEOPLE.items():
    emit(
        f"urn:li:corpuser:{user}",
        CorpUserInfoClass(active=True, displayName=name, title=title, email=f"{user}@opxz.dev"),
    )
    print(f"  {user}: {name}")

# ------------------------------------------------------- datasets/schemas ----
# Tags MUST stay exactly as the policy demo expects: they are fingerprinted.
print("== datasets: schemas + descriptions (tags unchanged) ==")
def ds(platform, name, env, tags, desc, schema):
    d = Dataset(
        platform=platform, name=name, env=env, description=desc,
        tags=[TagUrn(t) for t in tags], schema=schema,
    )
    client.entities.upsert(d)
    print(f"  {platform}/{name} ({len(schema)} cols)")
    return str(d.urn)

ds("demo", "customer_prod", "PROD", ["PII", "Finance"],
   "Master customer table for production billing and support. Contains PII.",
   [("customer_id", "bigint", "Primary key"),
    ("full_name", "string", "PII — legal name"),
    ("email", "string", "PII — contact email"),
    ("phone", "string", "PII — contact phone"),
    ("ssn_hash", "string", "PII — salted hash of national id"),
    ("account_balance", "decimal(18,2)", "Current balance in account currency"),
    ("risk_score", "double", "Model risk score, refreshed nightly"),
    ("segment", "string", "Marketing segment"),
    ("created_at", "timestamp", "Row created"),
    ("updated_at", "timestamp", "Last mutation")])

ds("demo", "revenue_daily", "PROD", ["Critical"],
   "Daily revenue rollup consumed by finance close. Depends on customer_prod.",
   [("date", "date", "Business date"),
    ("revenue_gross", "decimal(18,2)", "Gross revenue"),
    ("revenue_net", "decimal(18,2)", "Net of refunds"),
    ("txn_count", "bigint", "Settled transactions"),
    ("avg_ticket", "decimal(18,2)", "Average ticket size")])

ds("demo", "exec_dashboard_feed", "PROD", ["Critical"],
   "Curated KPI feed behind the executive dashboard. Depends on customer_prod.",
   [("metric_date", "date", "Reporting date"),
    ("kpi_name", "string", "KPI identifier"),
    ("kpi_value", "double", "Value"),
    ("wow_delta", "double", "Week-over-week delta"),
    ("source_table", "string", "Upstream table the KPI derives from")])

ds("demo", "fraud_alerts", "PROD", ["Critical"],
   "Real-time fraud alerts raised by the risk models. Joins to customer_prod.",
   [("alert_id", "string", "Alert id"),
    ("customer_id", "bigint", "FK to customer_prod"),
    ("alert_type", "string", "Rule or model family"),
    ("severity", "string", "LOW / MEDIUM / HIGH"),
    ("model_version", "string", "Model that raised it"),
    ("raised_at", "timestamp", "Raised")])

ds("demo", "analytics_test", "DEV", [],
   "Scratch analytics table used by the analytics team for experiments.",
   [("session_id", "string", "Session"),
    ("event_name", "string", "Event"),
    ("ts", "timestamp", "Event time")])

ds("demo", "regulated_core", "PROD", ["Protected"],
   "Regulated records under retention obligations. Protected asset — agents may never mutate it.",
   [("record_id", "string", "Record id"),
    ("jurisdiction", "string", "Governing jurisdiction"),
    ("retention_class", "string", "Retention schedule class"),
    ("payload_ref", "string", "Pointer to encrypted payload")])

# Upstream sources: new platforms, no Critical tags, edges INTO customer_prod —
# invisible to the critical-downstream count by construction.
print("== upstream sources ==")
RAW = ds("kafka", "raw_customer_events", "PROD", [],
   "Customer change events streamed from the product. Source for customer_prod.",
   [("event_id", "string", "Event id"),
    ("customer_id", "bigint", "Customer key"),
    ("event_type", "string", "created / updated / deleted"),
    ("payload", "string", "JSON payload"),
    ("kafka_ts", "timestamp", "Broker timestamp")])
CRM = ds("postgres", "crm_export", "PROD", [],
   "Nightly CRM export. Source for customer_prod contact fields.",
   [("customer_id", "bigint", "Customer key"),
    ("name", "string", "Contact name"),
    ("email", "string", "Contact email"),
    ("phone", "string", "Contact phone"),
    ("exported_at", "timestamp", "Export run")])
for up in (RAW, CRM):
    client.lineage.add_lineage(upstream=up, downstream=CUSTOMER)
    print(f"  {up.split(',')[1]} -> customer_prod")

# ----------------------------------------------------------------- owners ----
print("== ownership ==")
OWNED = ["customer_prod", "revenue_daily", "exec_dashboard_feed", "fraud_alerts", "regulated_core"]
owners = OwnershipClass(owners=[
    OwnerClass(owner="urn:li:corpuser:human-1", type=OwnershipTypeClass.BUSINESS_OWNER),
    OwnerClass(owner="urn:li:corpuser:priya", type=OwnershipTypeClass.TECHNICAL_OWNER),
])
for name in OWNED:
    emit(DEMO.format(name), owners)
print(f"  human-1 + priya on {len(OWNED)} datasets")

# ---------------------------------------------------------------- domains ----
print("== domains ==")
DOMAINS = {
    "customer-360": ("Customer 360",
        "Everything describing a customer: master data and its sources.",
        [CUSTOMER, RAW, CRM]),
    "finance-analytics": ("Finance Analytics",
        "Revenue and executive reporting derived from customer data.",
        [DEMO.format("revenue_daily"), DEMO.format("exec_dashboard_feed")]),
    "risk-compliance": ("Risk & Compliance",
        "Fraud detection and regulated records.",
        [DEMO.format("fraud_alerts"), DEMO.format("regulated_core")]),
}
for did, (name, desc, members) in DOMAINS.items():
    durn = f"urn:li:domain:{did}"
    emit(durn, DomainPropertiesClass(name=name, description=desc))
    for m in members:
        emit(m, DomainsClass(domains=[durn]))
    print(f"  {name}: {len(members)} assets")

# --------------------------------------------------------------- glossary ----
print("== glossary ==")
TERMS = {
    "PII": "Personally Identifiable Information. Datasets carrying PII require human "
           "approval for lifecycle changes in production.",
    "CustomerRecord": "The governed master representation of a customer.",
    "CriticalDependency": "A downstream asset whose breakage has business impact. The count "
                          "of critical dependencies is part of the governance context DataHubX "
                          "fingerprints before authorizing a mutation.",
    "RegulatedData": "Data under legal retention or jurisdiction constraints. Protected from "
                     "agent mutation entirely.",
}
for tid, definition in TERMS.items():
    emit(f"urn:li:glossaryTerm:{tid}",
         GlossaryTermInfoClass(definition=definition, termSource="INTERNAL", name=tid))
ATTACH = {
    "customer_prod": ["PII", "CustomerRecord"],
    "revenue_daily": ["CriticalDependency"],
    "exec_dashboard_feed": ["CriticalDependency"],
    "fraud_alerts": ["CriticalDependency"],
    "regulated_core": ["RegulatedData"],
}
for name, terms in ATTACH.items():
    emit(DEMO.format(name), GlossaryTermsClass(
        terms=[GlossaryTermAssociationClass(urn=f"urn:li:glossaryTerm:{t}") for t in terms],
        auditStamp=NOW))
print(f"  {len(TERMS)} terms, attached to {len(ATTACH)} datasets")

# ------------------------------------------------- docs on customer_prod ----
print("== documentation ==")
emit(CUSTOMER, EditableDatasetPropertiesClass(description=(
    "## customer_prod\n\n"
    "Master customer table for production billing and support. **Contains PII.**\n\n"
    "| | |\n|---|---|\n"
    "| Refresh | streaming (raw_customer_events) + nightly CRM merge |\n"
    "| SLA | 99.9%, business-hours paging |\n"
    "| Critical consumers | revenue_daily, exec_dashboard_feed |\n\n"
    "### Governance\n"
    "Lifecycle changes to this dataset are **governed by DataHubX**: an agent may "
    "propose a change, policy requires human review (production + PII), and the "
    "resulting authorization is bound to the context fingerprint observed at approval "
    "time. If the world changes before execution — for example a new critical "
    "downstream appears — the authorization is permanently invalidated and the "
    "mutation never reaches this table.\n\n"
    "Try it: [governance console](https://app.opxz.dev)."
)))
emit(CUSTOMER, InstitutionalMemoryClass(elements=[
    InstitutionalMemoryMetadataClass(
        url="https://app.opxz.dev",
        description="DataHubX governance console — propose, approve, drift, execute",
        createStamp=NOW),
    InstitutionalMemoryMetadataClass(
        url="https://catalog.opxz.dev/demo-login",
        description="One-click reviewer sign-in for this catalog",
        createStamp=NOW),
]))
print("  markdown docs + links on customer_prod")

# -------------------------------------------------- junk dataset cleanup ----
print("== cleanup ==")
for junk_query in ("probe_downstream_1", "smoke_test"):
    res = graph.execute_graphql(
        """query($q:String!){ search(input:{type:DATASET, query:$q, start:0, count:5})
             { searchResults { entity { urn } } } }""",
        variables={"q": junk_query})
    for r in res["search"]["searchResults"]:
        urn = r["entity"]["urn"]
        if junk_query in urn:
            graph.delete_entity(urn, hard=True)
            print(f"  deleted {urn}")

# ------------------------------------------------------- reset demo state ----
print("== baseline reset ==")
graph.execute_graphql(
    """mutation($d:String!,$u:String!){ updateLineage(input:{edgesToAdd:[],
         edgesToRemove:[{downstreamUrn:$d,upstreamUrn:$u}]}) }""",
    variables={"d": DEMO.format("fraud_alerts"), "u": CUSTOMER})
graph.execute_graphql(
    """mutation($u:String!){ updateDeprecation(input:{urn:$u, deprecated:false}) }""",
    variables={"u": CUSTOMER})
print("  drift edge absent, customer_prod ACTIVE")

# ------------------------------------------------------ home announcements ----
print("== home announcements ==")
existing = graph.execute_graphql(
    """{ listPosts(input:{start:0, count:20}) { posts { urn content { title } } } }""")
have = {p["content"]["title"] for p in existing["listPosts"]["posts"]}
POSTS = [
    ("Welcome, reviewers 👋",
     "This catalog is the live provider behind DataHubX — context-bound authorization "
     "for AI agents. Drive the governance console, then watch the changes land here.",
     "https://app.opxz.dev"),
    ("customer_prod is under governed mutation",
     "Lifecycle changes require a human approval bound to the exact observed context. "
     "Check its deprecation note after an executed run — it carries the approval id, "
     "policy version and passport fingerprint.",
     "https://catalog.opxz.dev/dataset/" + CUSTOMER.replace(",", "%2C").replace(":", "%3A").replace("(", "%28").replace(")", "%29"),
     ),
]
for title, desc, link in POSTS:
    if title in have:
        print(f"  post exists: {title}")
        continue
    graph.execute_graphql(
        """mutation($input: CreatePostInput!){ createPost(input:$input) }""",
        variables={"input": {"postType": "HOME_PAGE_ANNOUNCEMENT",
                             "content": {"contentType": "TEXT", "title": title,
                                         "description": desc, "link": link}}})
    print(f"  posted: {title}")

# ------------------------------------------------------ context documents ----
print("== context documents ==")
DOCS = [
    ("datahubx-governance", "How this estate is governed (DataHubX)",
     "# How this estate is governed\n\n"
     "AI agents can read everything in this catalog, but **no agent holds a mutation "
     "capability**. Changes flow through DataHubX:\n\n"
     "1. The agent proposes a structured action (e.g. deprecate `customer_prod`).\n"
     "2. Policy evaluates the observed context — environment, tags, lifecycle, and the "
     "count of critical downstream dependencies — and returns ALLOW / REVIEW / BLOCK.\n"
     "3. A human approves against a canonical fingerprint of that exact context.\n"
     "4. The Gateway re-reads this catalog immediately before mutating. If the world no "
     "longer matches the approved fingerprint, the authorization is permanently "
     "invalidated and nothing is mutated.\n"
     "5. After a mutation, the Gateway reads the catalog back and only a confirmed "
     "postcondition counts as success.\n\n"
     "Console: https://app.opxz.dev"),
    ("datahubx-drift-runbook", "Runbook: the 2 → 3 drift scenario",
     "# Runbook: the 2 → 3 drift scenario\n\n"
     "`customer_prod` has **2** critical downstreams (`revenue_daily`, "
     "`exec_dashboard_feed`). The demo injects a third (`fraud_alerts`) *after* a human "
     "approved the deprecation but *before* the agent executes it.\n\n"
     "Expected result: the Gateway detects the fingerprint mismatch, refuses with "
     "`CONTEXT_DRIFT`, permanently invalidates the authorization, and this catalog is "
     "left byte-identical. The agent then replans against the 3-dependency world and "
     "obtains fresh authority.\n\n"
     "Steps: https://app.opxz.dev — Propose → Approve → Change the world → Execute → "
     "Replan."),
]
for doc_id, title, text in DOCS:
    try:
        graph.execute_graphql(
            """mutation($input: CreateDocumentInput!){ createDocument(input:$input) }""",
            variables={"input": {"id": doc_id, "title": title, "state": "PUBLISHED",
                                 "contents": {"text": text}}})
        print(f"  document: {title}")
    except Exception as e:  # id exists on re-run, or state enum differs
        msg = str(e)
        if "already exists" in msg or "duplicate" in msg.lower():
            print(f"  document exists: {title}")
        else:
            try:
                graph.execute_graphql(
                    """mutation($input: CreateDocumentInput!){ createDocument(input:$input) }""",
                    variables={"input": {"id": doc_id, "title": title,
                                         "contents": {"text": text}}})
                print(f"  document (default state): {title}")
            except Exception as e2:
                print(f"  document FAILED: {title}: {e2}")

print("\nSHOWCASE SEEDED")
