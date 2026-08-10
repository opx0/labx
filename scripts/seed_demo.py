import os, warnings
warnings.filterwarnings("ignore")
from datahub.sdk import DataHubClient, Dataset
from datahub.metadata.urns import DatasetUrn, TagUrn

TOKEN = open(os.path.expanduser("~/.datahub/governance-token")).read().strip()
client = DataHubClient(server="http://localhost:8080", token=TOKEN)
P = "demo"

def ds(name, env, tags, desc):
    d = Dataset(platform=P, name=name, env=env, description=desc,
                tags=[TagUrn(t) for t in tags],
                schema=[("id","int","primary key"),("amount","double","value")])
    client.entities.upsert(d)
    print(f"  seeded {name:24} env={env:4} tags={tags}")
    return d.urn

print("== target ==")
target = ds("customer_prod","PROD",["PII","Finance"],"Customer records. Production. Contains PII.")

print("== critical downstreams (linked now) ==")
d1 = ds("revenue_daily","PROD",["Critical"],"Daily revenue rollup.")
d2 = ds("exec_dashboard_feed","PROD",["Critical"],"Executive dashboard feed.")

print("== critical downstream held back for drift ==")
d3 = ds("fraud_alerts","PROD",["Critical"],"Fraud detection alerts.")

print("== policy fixtures ==")
ds("analytics_test","DEV",[],"Scratch analytics table.")
ds("regulated_core","PROD",["Protected"],"Regulated core. Protected asset.")

print("== lineage: 2 critical downstreams ==")
for d in (d1, d2):
    client.lineage.add_lineage(upstream=target, downstream=d)
    print(f"  {target.name} -> {d.name}")

print("\nTARGET_URN=" + str(target))
print("DRIFT_URN=" + str(d3))
