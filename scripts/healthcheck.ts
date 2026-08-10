/**
 * One command to prove the stack is up before a demo:
 *   bun run health
 * Checks Postgres, DataHub GMS liveness, and that the token actually reads.
 */
import { prisma } from "../src/lib/db/client";

const GMS = process.env.DATAHUB_GMS_URL ?? "http://localhost:8080";
const TARGET = encodeURIComponent("urn:li:dataset:(urn:li:dataPlatform:demo,customer_prod,PROD)");

const checks: [string, () => Promise<void>][] = [
  [
    "postgres",
    async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  ],
  [
    "datahub gms",
    async () => {
      const r = await fetch(`${GMS}/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
  ],
  [
    "datahub token reads customer_prod",
    async () => {
      const r = await fetch(`${GMS}/openapi/v3/entity/dataset/${TARGET}?aspects=datasetKey`, {
        headers: { Authorization: `Bearer ${process.env.DATAHUB_TOKEN ?? ""}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
  ],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
