import { Prisma } from "@prisma/client";
import { scheduledShiftBounds } from "./timeclock";
import { accrueCompletedSession } from "./payroll-accrual-service";
import { dateKeyInZone } from "./dates";

export type AutoClockoutTx = Prisma.TransactionClient;

type Segment = { type?: string; start: string; end: string | null; [k: string]: unknown };
type GoOut = { reason?: string; estimatedMin?: number; start: string; end: string | null; [k: string]: unknown };

function parseShiftTime(t: string): [number, number] {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return [9, 0];
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return [h, parseInt(m[2], 10)];
}

function sessionShiftProps(
  staff: { shiftStart: string; shiftEnd: string },
  session?: { shiftStartMin?: number | null; shiftEndMin?: number | null } | null
): { startMin: number; endMin: number } {
  if (session && Number.isInteger(session.shiftStartMin) && Number.isInteger(session.shiftEndMin)) {
    return { startMin: session.shiftStartMin as number, endMin: session.shiftEndMin as number };
  }
  const [sh, sm] = parseShiftTime(staff.shiftStart);
  const [eh, em] = parseShiftTime(staff.shiftEnd);
  return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
}

function configNumber(config: Record<string, string>, key: string, fallback: number): number {
  const value = Number(config[key]);
  return Number.isFinite(value) ? value : fallback;
}

export async function loadClockConfig(db: { config: { findMany: () => Promise<Array<{ key: string; value: string }>> } }): Promise<Record<string, string>> {
  const rows = await db.config.findMany();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function computeAutoClockoutDueMs(session: {
  timeIn: Date;
  date: Date;
  shiftStartMin?: number | null;
  shiftEndMin?: number | null;
  staff?: { shiftStart: string; shiftEnd: string } | null;
}, config: Record<string, string>): number | null {
  const minutesAfterEnd = Math.max(0, configNumber(config, "AUTO_CLOCKOUT_MINUTES", 15));
  const staff = session.staff;
  const shift = staff
    ? sessionShiftProps(staff, session)
    : (Number.isInteger(session.shiftStartMin) && Number.isInteger(session.shiftEndMin)
      ? { startMin: session.shiftStartMin as number, endMin: session.shiftEndMin as number }
      : null);
  if (!shift) return null;
  try {
    const { end } = scheduledShiftBounds(session.timeIn.toISOString(), shift);
    return end + minutesAfterEnd * 60000;
  } catch {
    return null;
  }
}

export type AutoCloseOutcome =
  | "auto_closed_accrued"
  | "auto_closed_accrual_incomplete"
  | "auto_closed_accrual_failed"
  | "already_closed"
  | "not_eligible"
  | "skipped_overtime_activated"
  | "skipped_claimed_by_other"
  | "error";

export interface AutoCloseResult {
  sessionId: string;
  staffId?: string;
  outcome: AutoCloseOutcome;
  dueAt?: string;
  closedAt?: string;
  earningId?: string;
  accrualStatus?: string;
  accrualReason?: string | null;
  error?: string;
}

function closeOpenSegmentsAt(session: { breaks: unknown; goOuts: unknown; extraTime: unknown }, closeIso: string) {
  const breaks: Segment[] = JSON.parse(JSON.stringify(session.breaks ?? []));
  const goOuts: GoOut[] = JSON.parse(JSON.stringify(session.goOuts ?? []));
  const extraTime: Segment[] = JSON.parse(JSON.stringify(session.extraTime ?? []));
  return {
    breaks: breaks.map((b) => (b.end ? b : { ...b, end: closeIso })) as unknown as Prisma.InputJsonValue,
    goOuts: goOuts.map((g) => (g.end ? g : { ...g, end: closeIso })) as unknown as Prisma.InputJsonValue,
    extraTime: extraTime.map((b) => (b.end ? b : { ...b, end: closeIso })) as unknown as Prisma.InputJsonValue,
  };
}

async function accrueAfterDurableClose(
  db: any,
  sessionId: string,
  staffName: string | undefined,
  config: Record<string, string>,
  sourceLabel: "AUTO_CLOCK_OUT" | "PRIOR_DAY_AUTO_CLOSE"
): Promise<{ ok: true; accrual: any } | { ok: false; accrualError: string; accrual?: any }> {
  try {
    const accrual = await db.$transaction((tx: any) =>
      accrueCompletedSession(tx, {
        sessionId,
        actor: { name: "System", role: "SYSTEM" },
        source: "SYSTEM",
        config,
      })
    );
    const incomplete = accrual?.status === "INCOMPLETE";
    try {
      await db.auditLog.create({
        data: {
          action: incomplete ? "AUTO_CLOCKOUT_ACCRUAL_INCOMPLETE" : "AUTO_CLOCKOUT_ACCRUAL_COMPLETED",
          entityType: "TimeSession",
          entityId: sessionId,
          actorName: "System",
          actorRole: "SYSTEM",
          summary: incomplete
            ? `Automatic clock-out accrual incomplete for ${staffName ?? sessionId}: ${accrual?.reason ?? "unknown"}`
            : `Automatic clock-out accrual processed for ${staffName ?? sessionId}`,
          after: { source: sourceLabel, ...(accrual ?? {}) },
          reason: accrual?.reason ?? (incomplete ? "INCOMPLETE" : null),
        },
      });
    } catch { /* audit best-effort; do not hide accrual result */ }
    return { ok: true, accrual };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ACCRUAL_FAILED";
    try {
      await db.auditLog.create({
        data: {
          action: "AUTO_CLOCKOUT_ACCRUAL_FAILED",
          entityType: "TimeSession",
          entityId: sessionId,
          actorName: "System",
          actorRole: "SYSTEM",
          summary: `Automatic clock-out accrual failed for ${staffName ?? sessionId}`,
          reason: msg,
          after: { source: sourceLabel, error: msg },
        },
      });
    } catch { /* best-effort */ }
    return { ok: false, accrualError: msg };
  }
}

/**
 * Attempt to auto-close a single eligible open session at its computed due time.
 * Idempotent: conditional update (timeOut null) prevents double close; accrual is idempotent.
 * Preserves session on accrual failure. Never invents payable hours (uses canonical engine via accrual).
 */
export async function autoCloseSessionIfEligible(
  db: any,
  session: any,
  config: Record<string, string>,
  now: Date,
  opts: { sourceLabel?: "AUTO_CLOCK_OUT" | "PRIOR_DAY_AUTO_CLOSE" } = {}
): Promise<AutoCloseResult> {
  const sourceLabel = opts.sourceLabel ?? "AUTO_CLOCK_OUT";
  const sessionId = session.id;
  const staffName = session.staff?.fullName as string | undefined;
  try {
    if (session.timeOut || session.completed) {
      return { sessionId, staffId: session.staffId, outcome: "already_closed" };
    }
    if (session.overtimeActivatedAt) {
      return { sessionId, staffId: session.staffId, outcome: "skipped_overtime_activated" };
    }
    const dueMs = computeAutoClockoutDueMs(session, config);
    if (dueMs == null) {
      return { sessionId, staffId: session.staffId, outcome: "not_eligible", error: "MISSING_SHIFT_SNAPSHOT" };
    }
    if (now.getTime() < dueMs) {
      return { sessionId, staffId: session.staffId, outcome: "not_eligible", dueAt: new Date(dueMs).toISOString() };
    }

    const due = new Date(dueMs);
    const closeIso = due.toISOString();
    const closed = closeOpenSegmentsAt(session, closeIso);

  // Claim/close atomically and conditionally to prevent concurrent double-close.
  // Supervisor-activated Extra Time (overtimeActivatedAt) suspends normal auto-close; activation path must also be conditional on open session.
  const updated = await db.$transaction(async (tx: any) => {
    const fresh = await tx.timeSession.findUnique({ where: { id: sessionId } });
    if (!fresh || fresh.timeOut || fresh.completed || fresh.overtimeActivatedAt) return null;
    const changed = await tx.timeSession.updateMany({
      where: { id: sessionId, timeOut: null, completed: false, overtimeActivatedAt: null },
      data: {
        timeOut: due,
        completed: true,
        autoClockedOut: true,
        ...closed,
        overtimeMinutes: 0,
        overtimeStatus: "NotRequired",
      },
    });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({
      data: {
        action: "AUTO_CLOCK_OUT",
        entityType: "TimeSession",
        entityId: sessionId,
        actorName: "System",
        actorRole: "SYSTEM",
        summary: `${staffName ?? session.staffId ?? sessionId} automatically clocked out (${sourceLabel === "PRIOR_DAY_AUTO_CLOSE" ? "prior-day overdue" : "scheduled"})`,
        after: {
          source: sourceLabel,
          autoClockedOut: true,
          dueAt: due.toISOString(),
          shiftEndMin: session.shiftEndMin ?? null,
          workDate: dateKeyInZone(session.date),
        },
      },
    });
    return await tx.timeSession.findUnique({ where: { id: sessionId } });
  });

    if (!updated) {
      return { sessionId, staffId: session.staffId, outcome: "skipped_claimed_by_other", dueAt: due.toISOString() };
    }

    const accrualRes = await accrueAfterDurableClose(db, sessionId, staffName, config, sourceLabel);
    if (!accrualRes.ok) {
      return { sessionId, staffId: session.staffId, outcome: "auto_closed_accrual_failed", dueAt: due.toISOString(), closedAt: due.toISOString(), error: accrualRes.accrualError };
    }
    const a = accrualRes.accrual;
    const incomplete = a?.status === "INCOMPLETE";
    return {
      sessionId, staffId: session.staffId,
      outcome: incomplete ? "auto_closed_accrual_incomplete" : "auto_closed_accrued",
      dueAt: due.toISOString(), closedAt: due.toISOString(),
      earningId: a?.earningId, accrualStatus: a?.status, accrualReason: a?.reason ?? null,
    };
  } catch (e) {
    return { sessionId, staffId: session.staffId, outcome: "error", error: e instanceof Error ? e.message : "AUTO_CLOSE_ERROR" };
  }
}

export interface ProcessSummary {
  ok: boolean;
  ranAt: string;
  now: string;
  autoClockoutMinutes: number;
  scannedOpen: number;
  eligibleOverdue: number;
  processed: number;
  autoClosedAccrued: number;
  autoClosedAccrualIncomplete: number;
  autoClosedAccrualFailed: number;
  alreadyClosedOrClaimed: number;
  skippedNotEligible: number;
  skippedOvertimeActivated: number;
  accrualRecoveryAttempted: number;
  accrualRecovered: number;
  accrualRecoveryIncomplete: number;
  accrualRecoveryFailed: number;
  errors: Array<{ sessionId?: string; error: string }>;
  results: AutoCloseResult[];
}

const BATCH_SIZE = 100;

/**
 * Process overdue open sessions and recover accrual for completed sessions missing/incomplete earnings.
 * Safe to run repeatedly and concurrently (per-session conditional claims + idempotent accrual).
 */
export async function processAutoClockouts(db: any, now: Date = new Date(), opts: { batchSize?: number } = {}): Promise<ProcessSummary> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? BATCH_SIZE, 500));
  const config = await loadClockConfig(db);
  const minutes = Math.max(0, configNumber(config, "AUTO_CLOCKOUT_MINUTES", 15));

  const summary: ProcessSummary = {
    ok: true, ranAt: new Date().toISOString(), now: now.toISOString(), autoClockoutMinutes: minutes,
    scannedOpen: 0, eligibleOverdue: 0, processed: 0,
    autoClosedAccrued: 0, autoClosedAccrualIncomplete: 0, autoClosedAccrualFailed: 0,
    alreadyClosedOrClaimed: 0, skippedNotEligible: 0, skippedOvertimeActivated: 0,
    accrualRecoveryAttempted: 0, accrualRecovered: 0, accrualRecoveryIncomplete: 0, accrualRecoveryFailed: 0,
    errors: [], results: [],
  };

  // 1) Close eligible overdue open sessions (missed-safe), in batches.
  let cursor: string | undefined;
  for (let pass = 0; pass < 20; pass++) {
    const open = await db.timeSession.findMany({
      where: { timeOut: null, completed: false, ...(cursor ? { id: { gt: cursor } } : {}) },
      include: { staff: { select: { employeeId: true, fullName: true, shiftStart: true, shiftEnd: true } } },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (open.length === 0) break;
    cursor = open[open.length - 1].id;
    summary.scannedOpen += open.length;

    for (const s of open) {
      const dueMs = computeAutoClockoutDueMs(s, config);
      if (s.overtimeActivatedAt) { summary.skippedOvertimeActivated++; continue; }
      if (dueMs == null || now.getTime() < dueMs) { summary.skippedNotEligible++; continue; }
      summary.eligibleOverdue++;
      summary.processed++;
      const res = await autoCloseSessionIfEligible(db, s, config, now, { sourceLabel: "AUTO_CLOCK_OUT" });
      summary.results.push(res);
      if (res.outcome === "auto_closed_accrued") summary.autoClosedAccrued++;
      else if (res.outcome === "auto_closed_accrual_incomplete") summary.autoClosedAccrualIncomplete++;
      else if (res.outcome === "auto_closed_accrual_failed") summary.autoClosedAccrualFailed++;
      else if (res.outcome === "already_closed" || res.outcome === "skipped_claimed_by_other") summary.alreadyClosedOrClaimed++;
      else if (res.outcome === "skipped_overtime_activated") summary.skippedOvertimeActivated++;
      else if (res.outcome === "not_eligible") summary.skippedNotEligible++;
      else if (res.outcome === "error") summary.errors.push({ sessionId: s.id, error: res.error || "error" });
    }
    if (open.length < batchSize) break;
  }

  // 2) Accrual recovery for auto-closed completed sessions missing/incomplete earning (idempotent, retry-safe).
  // Scoped to system auto-clocked-out sessions to avoid creating financial accrual records for unrelated historical
  // manually-completed sessions during ordinary auto-clockout processing (cron/endpoint). Sessions closed in this
  // pass are also autoClockedOut and covered here if their accrual failed after durable close.
  const recoveryCandidates = await db.timeSession.findMany({
    where: {
      completed: true,
      autoClockedOut: true,
      timeOut: { not: null },
      OR: [
        { payrollEarning: { is: null } },
        { payrollEarning: { is: { calculationStatus: "INCOMPLETE" } } },
      ],
    },
    include: { staff: { select: { fullName: true } }, payrollEarning: { select: { id: true, calculationStatus: true } } },
    orderBy: { date: "asc" },
    take: batchSize,
  });
  for (const s of recoveryCandidates) {
    summary.accrualRecoveryAttempted++;
    try {
      const accrual = await db.$transaction((tx: any) =>
        accrueCompletedSession(tx, {
          sessionId: s.id,
          actor: { name: "System", role: "SYSTEM" },
          source: "SYSTEM",
          config,
        })
      );
      if (accrual?.status === "INCOMPLETE") summary.accrualRecoveryIncomplete++;
      else if (accrual?.skipped === "EARNING_LOCKED_SETTLED" || accrual?.skipped === "EXISTS" || accrual?.created || accrual?.recovered) summary.accrualRecovered++;
      else summary.accrualRecovered++;
    } catch (e) {
      summary.accrualRecoveryFailed++;
      summary.errors.push({ sessionId: s.id, error: e instanceof Error ? e.message : "ACCRUAL_RECOVERY_FAILED" });
    }
  }

  return summary;
}

/**
 * Close a prior-day/overdue open session via canonical auto-close rules (same eligibility, idempotency, accrual).
 */
export async function autoClosePriorDaySession(
  db: any,
  session: any,
  config: Record<string, string>,
  now: Date
): Promise<AutoCloseResult> {
  return autoCloseSessionIfEligible(db, session, config, now, { sourceLabel: "PRIOR_DAY_AUTO_CLOSE" });
}
