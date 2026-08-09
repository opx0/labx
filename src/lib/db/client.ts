import { PrismaClient } from "@prisma/client";

const globalRef = globalThis as unknown as { __dhxPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalRef.__dhxPrisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalRef.__dhxPrisma = prisma;
