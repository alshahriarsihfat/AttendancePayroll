import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db";
import { sessionFromRequest } from "@/lib/auth-session";
import { dbErrorResponse } from "@/lib/api-error";
import { processAutoClockouts } from "@/lib/auto-clockout-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  // External scheduler path: requires a configured CRON_SECRET matched
  // constant-time against the Bearer token. If CRON_SECRET is not configured
  // the cron path is fail-closed (never authorize via Bearer when unset).
  if (secret && bearer && safeEqual(bearer, secret)) return true;

  // Manual/operational trigger: authenticated Admin/Supervisor session (no secrets exposed to browser).
  const actor = sessionFromRequest(request);
  if (actor && (actor.role === "ADMIN" || actor.role === "SUPERVISOR")) return true;

  return false;
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processAutoClockouts(prisma, new Date());
    return NextResponse.json({
      ok: true,
      ranAt: result.ranAt,
      now: result.now,
      autoClockoutMinutes: result.autoClockoutMinutes,
      scannedOpen: result.scannedOpen,
      eligibleOverdue: result.eligibleOverdue,
      processed: result.processed,
      autoClosedAccrued: result.autoClosedAccrued,
      autoClosedAccrualIncomplete: result.autoClosedAccrualIncomplete,
      autoClosedAccrualFailed: result.autoClosedAccrualFailed,
      alreadyClosedOrClaimed: result.alreadyClosedOrClaimed,
      skippedNotEligible: result.skippedNotEligible,
      skippedOvertimeActivated: result.skippedOvertimeActivated,
      accrualRecoveryAttempted: result.accrualRecoveryAttempted,
      accrualRecovered: result.accrualRecovered,
      accrualRecoveryIncomplete: result.accrualRecoveryIncomplete,
      accrualRecoveryFailed: result.accrualRecoveryFailed,
      errorCount: result.errors.length,
      results: result.results.map((r) => ({
        sessionId: r.sessionId,
        outcome: r.outcome,
        dueAt: r.dueAt,
        closedAt: r.closedAt,
        accrualStatus: r.accrualStatus,
        accrualReason: r.accrualReason ?? null,
        ...(r.error ? { error: r.error } : {}),
      })),
    });
  } catch (error) {
    return dbErrorResponse(error);
  }
}

export async function POST(request: Request) { return handle(request); }
