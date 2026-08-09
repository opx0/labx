import type { AuthorizationStore } from "@/lib/gateway/gateway";
import { prisma } from "./client";

// Consumption is a conditional UPDATE, never a read-then-write: Postgres row-locks
// for the statement, so exactly one of N concurrent callers sees count === 1.

export class PrismaAuthorizationStore implements AuthorizationStore {
  async getState(id: string): Promise<string | null> {
    const row = await prisma.authorization.findUnique({
      where: { id },
      select: { state: true, expiresAt: true },
    });
    if (!row) return null;
    // Expiry is a fact about the clock, true whether or not a sweeper has run.
    return row.state === "ACTIVE" && row.expiresAt.getTime() <= Date.now() ? "EXPIRED" : row.state;
  }

  async consume(id: string): Promise<boolean> {
    const { count } = await prisma.authorization.updateMany({
      where: { id, state: "ACTIVE", expiresAt: { gt: new Date() } },
      data: { state: "CONSUMED", consumedAt: new Date() },
    });
    return count === 1;
  }

  async revoke(id: string): Promise<boolean> {
    const { count } = await prisma.authorization.updateMany({
      where: { id, state: "ACTIVE" },
      data: { state: "REVOKED" },
    });
    return count === 1;
  }

  async invalidate(id: string): Promise<boolean> {
    const { count } = await prisma.authorization.updateMany({
      where: { id, state: "ACTIVE" },
      data: { state: "INVALIDATED" },
    });
    return count === 1;
  }
}
