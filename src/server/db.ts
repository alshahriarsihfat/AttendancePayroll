// ============================================================================
// Neon DB connection — copy to src/lib/db.ts in your Next.js project.
//
// CRITICAL for Vercel serverless:
//   1. Use the POOLED connection string (-pooler suffix) in DATABASE_URL
//   2. Cache the client on globalThis to prevent connection exhaustion
//   3. Use the Neon driver adapter for HTTP-based serverless queries
// ============================================================================

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Singleton Prisma client with the Neon serverless driver adapter.
 *
 * The `globalThis` cache is essential: without it, every serverless
 * invocation (and every hot-reload in dev) creates a new PrismaClient,
 * each holding its own connection pool. On Neon this exhausts the
 * connection limit almost immediately and crashes with
 * "Error: too many connections".
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ---------------------------------------------------------------------------
// Transaction helper — guarantees atomic multi-table writes.
// Essential for payment processing where you must update Payment,
// AdvanceLog, and Staff.advance together or not at all.
// ---------------------------------------------------------------------------
export async function withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => fn(tx));
}

// ---------------------------------------------------------------------------
// Safe money rounding — the single point where all currency math is rounded.
// Mirrors the frontend `payRound()` so both layers agree exactly.
// ---------------------------------------------------------------------------
export function payRound(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
