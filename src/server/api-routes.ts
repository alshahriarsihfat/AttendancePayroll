// ============================================================================
// API Route Handlers — copy these into src/app/api/*/route.ts in Next.js.
// Every handler uses: Zod validation, Prisma singleton, safe async-await,
// and atomic transactions for multi-table writes.
//
//   npm install zod
// ============================================================================

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, payRound } from "./db";
import { dbErrorResponse } from "@/lib/api-error";
import { dateKeyInZone, minutesBetween } from "@/lib/dates";
import { accrueCompletedSession } from "@/lib/payroll-accrual-service";
import { scheduledShiftBounds } from "@/lib/timeclock";
import { sessionFromRequest, type AuthSession } from "@/lib/auth-session";
import { computeAutoClockoutDueMs } from "@/lib/auto-clockout-service";
import { createAdvanceAdjustment, getEligibleEarningsForStaff, getStaffAdvanceState, advErr } from "@/lib/advance-adjustment-service";

// ---------------------------------------------------------------------------
// POST /api/clock — Handles ALL clock actions atomically.
// Body: { employeeId, action: "in"|"out"|"break_start"|"break_end"|"goout_start"|"goout_end", ... }
// ---------------------------------------------------------------------------
const ClockSchema = z.object({
  employeeId: z.string().min(1).optional(),
  staffId: z.string().min(1).optional(),
  action: z.enum(["in", "out", "break_start", "break_end", "goout_start", "goout_end"]),
  // Client-side event timestamp. The server still uses its own authoritative
  // clock for the record — this field exists so both sides log the same action.
  timestamp: z.string().optional(),
  breakType: z.enum(["meal", "rest", "unpaid"]).optional(),
  goOutReason: z.string().optional(),
  goOutEstimatedMin: z.number().int().positive().optional(),
}).refine((value) => Boolean(value.employeeId || value.staffId), {
  message: "Target staff id is required.",
  path: ["employeeId"],
});

export async function POST_clock(req: Request) {
  const actor = sessionFromRequest(req);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const body = ClockSchema.safeParse(payload);
  if (!body.success) {
    return Response.json({ error: "Invalid payload", details: body.error.flatten() }, { status: 400 });
  }
  let employeeId = body.data.employeeId ?? body.data.staffId ?? "";
if (actor.role === "STAFF") {
  if (!actor.staffId) return Response.json({ error: "Staff identity missing" }, { status: 403 });
  employeeId = actor.staffId;
}
  const { action } = body.data;
  const now = new Date();
  const todayKey = dhakaDateKey(now);
  const today = dhakaStart(todayKey);
  try {
    // Loaded inside the try so a config/DB failure is caught by dbErrorResponse
    // below and returned as a descriptive message — never an unhandled 500.
    const config = await loadConfig();
    const staff = await prisma.staff.findUnique({ where: { employeeId } });
    if (!staff || !staff.isActive) {
      return Response.json({ error: "Staff not found or inactive" }, { status: 404 });
    }

    const managesOthers = (actor.role === "ADMIN" || actor.role === "SUPERVISOR") && actor.staffId !== employeeId;
    if (actor.role === "STAFF" && actor.staffId !== employeeId) {
      return Response.json({ error: "You can only manage your own clock." }, { status: 403 });
    }
    const managedBy = managesOthers ? actor.name : undefined;

    if (action === "in" && !isWithinShiftWindow(now, staff.shiftStart, staff.shiftEnd, config)) {
      return Response.json({ error: "Clock in is available only during the assigned shift window" }, { status: 422 });
    }

    const approvedLeave = await prisma.leaveRequest.findFirst({
      where: {
        staffId: employeeId,
        status: "Approved",
        fromDate: { lte: today },
        toDate: { gte: today },
      },
    });
    if (approvedLeave && (action === "in" || action === "out")) {
      return Response.json({ error: "Clocking is disabled during approved leave" }, { status: 409 });
    }

    // ---- CLOCK IN ----
    if (action === "in") {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.timeSession.findUnique({
          where: { staffId_date: { staffId: employeeId, date: today } },
        });
        if (existing) {
          if (!existing.timeOut && !existing.completed) {
            return { error: "Already clocked in today" as const };
          }

          const paidForSession = await tx.payment.findFirst({ where: { sessionId: existing.id } });
          if (paidForSession) {
            return { error: "This shift is already paid and cannot be re-opened" as const };
          }
          if (!managesOthers) {
            return { error: "This shift is complete and can only be re-opened by a supervisor" as const };
          }

          const [hh, mm] = parseShiftTime(staff.shiftStart);
          const shiftStart = dhakaAt(todayKey, hh * 60 + mm);
          const lateMin = now > shiftStart ? Math.round((now.getTime() - shiftStart.getTime()) / 60000) : 0;
          const reopened = await tx.timeSession.update({
            where: { id: existing.id },
            data: {
              timeIn: now,
              timeOut: null,
              completed: false,
              autoClockedOut: false,
              breaks: [],
              goOuts: [],
              extraTime: [],
              // Re-opened sessions re-capture the shift that is active NOW.
              ...staffShiftSnapshot(staff),
            },
          });
          await tx.auditLog.create({
            data: {
              action: "CLOCK_IN",
              entityType: "TimeSession",
              entityId: reopened.id,
              actorName: actor.name,
              actorRole: actor.role,
              summary: `${staff.fullName} clocked in${lateMin > 0 ? ` (${lateMin}m late)` : " on time"}${existing.timeOut ? " (re-opened)" : ""}`,
              managedBy,
            },
          });
          if (lateMin >= configNumber(config, "LATE_GRACE_MINUTES", 10)) {
            await tx.approvalRequest.create({
              data: { staffId: employeeId, sessionId: reopened.id, type: "late", deltaMin: lateMin, date: today },
            });
          }
          return { session: reopened, lateMin, reopened: true };
        }

        // Close forgotten prior-day/overdue sessions via canonical auto-clockout rules before
        // creating today's unique staff/date row. Eligible only at/after scheduled end + AUTO_CLOCKOUT_MINUTES.
        // Sessions with activated overtime are not auto-closed. Close is claimed conditionally/idempotently;
        // accrual runs after durable close via canonical service (outside this tx) so accrual failure never
        // reverts closure and retries are safe.
        const openSessions = await tx.timeSession.findMany({
          where: { staffId: employeeId, timeOut: null, date: { lt: today } },
        });
        const priorDayAutoClosedIds: string[] = [];
        for (const open of openSessions) {
          if (open.overtimeActivatedAt) continue;
          const dueMs = computeAutoClockoutDueMs({ ...open, staff: { shiftStart: staff.shiftStart, shiftEnd: staff.shiftEnd } }, config);
          if (dueMs == null || now.getTime() < dueMs) continue;
          const due = new Date(dueMs);
          const closeIso = due.toISOString();
          const breaksArr: Array<{ end?: string | null; [k: string]: unknown }> = JSON.parse(JSON.stringify(open.breaks ?? []));
          const goOutsArr: Array<{ end?: string | null; [k: string]: unknown }> = JSON.parse(JSON.stringify(open.goOuts ?? []));
          const extraArr: Array<{ end?: string | null; [k: string]: unknown }> = JSON.parse(JSON.stringify(open.extraTime ?? []));
          const changed = await tx.timeSession.updateMany({
            where: { id: open.id, timeOut: null, completed: false, overtimeActivatedAt: null },
            data: {
              timeOut: due, completed: true, autoClockedOut: true,
              breaks: breaksArr.map((b) => (b.end ? b : { ...b, end: closeIso })) as any,
              goOuts: goOutsArr.map((g) => (g.end ? g : { ...g, end: closeIso })) as any,
              extraTime: extraArr.map((b) => (b.end ? b : { ...b, end: closeIso })) as any,
              overtimeMinutes: 0, overtimeStatus: "NotRequired",
            },
          });
          if (changed.count === 1) {
            priorDayAutoClosedIds.push(open.id);
            await tx.auditLog.create({
              data: {
                action: "AUTO_CLOCK_OUT", entityType: "TimeSession", entityId: open.id,
                actorName: "System", actorRole: "SYSTEM",
                summary: `${staff.fullName} automatically clocked out (prior-day overdue)`,
                after: { source: "PRIOR_DAY_AUTO_CLOSE", autoClockedOut: true, dueAt: due.toISOString(), workDate: dateKeyInZone(open.date) },
              },
            });
          }
        }

        const [hh, mm] = parseShiftTime(staff.shiftStart);
        const shiftStart = dhakaAt(todayKey, hh * 60 + mm);
        const lateMin = now > shiftStart ? Math.round((now.getTime() - shiftStart.getTime()) / 60000) : 0;
        const session = await tx.timeSession.create({
          data: {
            staffId: employeeId, date: today, timeIn: now,
            // Capture the shift that was active at clock-in so future edits to
            // the staff row cannot rewrite how this session is evaluated.
            ...staffShiftSnapshot(staff),
          },
        });
        await tx.auditLog.create({
          data: {
            action: "CLOCK_IN", entityType: "TimeSession", entityId: session.id,
            actorName: actor.name, actorRole: actor.role,
            summary: `${staff.fullName} clocked in${lateMin > 0 ? ` (${lateMin}m late)` : " on time"}`,
            managedBy,
          },
        });
        if (lateMin >= configNumber(config, "LATE_GRACE_MINUTES", 10)) {
          await tx.approvalRequest.create({ data: { staffId: employeeId, sessionId: session.id, type: "late", deltaMin: lateMin, date: today } });
        }
        return { session, lateMin, ...(priorDayAutoClosedIds.length ? { priorDayAutoClosedIds } : {}) };
      });
      if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
      // Accrue durably auto-closed prior-day sessions after clock-in transaction commits (canonical, idempotent, retry-safe).
      if ("priorDayAutoClosedIds" in result && Array.isArray((result as any).priorDayAutoClosedIds)) {
        const ids = (result as any).priorDayAutoClosedIds as string[];
        const accruals: Array<{ sessionId: string; accrual?: any; error?: string }> = [];
        for (const sid of ids) {
          try {
            const accrual = await prisma.$transaction((tx) =>
              accrueCompletedSession(tx, { sessionId: sid, actor: { name: "System", role: "SYSTEM" }, source: "SYSTEM", config })
            );
            accruals.push({ sessionId: sid, accrual });
            try {
              await prisma.auditLog.create({
                data: {
                  action: accrual?.status === "INCOMPLETE" ? "AUTO_CLOCKOUT_ACCRUAL_INCOMPLETE" : "AUTO_CLOCKOUT_ACCRUAL_COMPLETED",
                  entityType: "TimeSession", entityId: sid, actorName: "System", actorRole: "SYSTEM",
                  summary: accrual?.status === "INCOMPLETE" ? `Prior-day auto-close accrual incomplete for session ${sid}` : `Prior-day auto-close accrual processed for session ${sid}`,
                  after: { source: "PRIOR_DAY_AUTO_CLOSE", ...(accrual ?? {}) },
                  reason: accrual?.reason ?? null,
                },
              });
            } catch {}
          } catch (e) {
            const msg = e instanceof Error ? e.message : "ACCRUAL_FAILED";
            accruals.push({ sessionId: sid, error: msg });
            try {
              await prisma.auditLog.create({
                data: { action: "AUTO_CLOCKOUT_ACCRUAL_FAILED", entityType: "TimeSession", entityId: sid, actorName: "System", actorRole: "SYSTEM", summary: `Prior-day auto-close accrual failed for session ${sid}`, reason: msg, after: { source: "PRIOR_DAY_AUTO_CLOSE", error: msg } },
              });
            } catch {}
          }
        }
        (result as any).priorDayAutoAccruals = accruals;
      }
      return Response.json(result);
    }

    // ---- All other actions require an active session ----
    const session = await prisma.timeSession.findUnique({
      where: { staffId_date: { staffId: employeeId, date: today } },
    });
    if (!session) return Response.json({ error: "Not clocked in" }, { status: 409 });
    if (session.timeOut) return Response.json({ error: "Already clocked out" }, { status: 409 });

    const breaks: Segment[] = JSON.parse(JSON.stringify(session.breaks ?? "[]"));
    const goOuts: GoOut[] = JSON.parse(JSON.stringify(session.goOuts ?? "[]"));
    const extraTime: Segment[] = JSON.parse(JSON.stringify(session.extraTime ?? "[]"));

    // ---- BREAK START (with double-tap protection) ----
    if (action === "break_start") {
      if (breaks.some((b) => !b.end)) {
        return Response.json({ error: "Finish the current break first" }, { status: 409 });
      }
      if (goOuts.some((g) => !g.end)) {
        return Response.json({ error: "Return from your go-out first" }, { status: 409 });
      }
      const type = body.data.breakType ?? "meal";
      breaks.push({ type, start: now.toISOString(), end: null });
      await saveSession(session.id, { breaks }, actor, managedBy, `started ${type} break`);
      return Response.json({ ok: true });
    }

    // ---- BREAK END ----
    if (action === "break_end") {
      const updated = breaks.map((b) => (b.end ? b : { ...b, end: now.toISOString() }));
      await saveSession(session.id, { breaks: updated }, actor, managedBy, "returned from break");
      return Response.json({ ok: true });
    }

    // ---- GO-OUT START (with double-tap protection) ----
    if (action === "goout_start") {
      if (goOuts.some((g) => !g.end)) {
        return Response.json({ error: "Already on a go-out" }, { status: 409 });
      }
      if (breaks.some((b) => !b.end)) {
        return Response.json({ error: "Finish the current break first" }, { status: 409 });
      }
      goOuts.push({
        reason: body.data.goOutReason ?? "Field work",
        estimatedMin: body.data.goOutEstimatedMin ?? 15,
        start: now.toISOString(), end: null,
      });
      await saveSession(session.id, { goOuts }, actor, managedBy, `went out: ${body.data.goOutReason}`);
      return Response.json({ ok: true });
    }

    // ---- GO-OUT END ----
    if (action === "goout_end") {
      const updated = goOuts.map((g) => (g.end ? g : { ...g, end: now.toISOString() }));
      await saveSession(session.id, { goOuts: updated }, actor, managedBy, "returned from go-out");
      return Response.json({ ok: true });
    }

    // ---- CLOCK OUT (closes ALL open segments) ----
    if (action === "out") {
      const outISO = now.toISOString();
      // Early-departure detection against the SESSION's snapshotted shift end.
      const shiftEnd = new Date(scheduledShiftBounds(session.timeIn.toISOString(), sessionShiftProps(staff, session)).end);
      const earlyMin = now < shiftEnd ? Math.round((shiftEnd.getTime() - now.getTime()) / 60000) : 0;

      const closed = {
        breaks: breaks.map((b) => (b.end ? b : { ...b, end: outISO })) as unknown as Prisma.InputJsonValue,
        goOuts: goOuts.map((g) => (g.end ? g : { ...g, end: outISO })) as unknown as Prisma.InputJsonValue,
        extraTime: extraTime.map((b) => (b.end ? b : { ...b, end: outISO })) as unknown as Prisma.InputJsonValue,
      };

      // Supervisor-authorized Extra Time (OT):
      // - OT only when explicitly activated by supervisor (overtimeActivatedAt)
      // - OT duration = activation timestamp -> actual manual clock-out
      // - time before activation is not OT; no approval workflow/gate
      // - existing break deductions applied within OT interval (unpaid overlap)
      let overtimeMinutes = 0;
      let overtimeStatus: "Pending" | "Approved" | "NotRequired" = "NotRequired";
      if (session.overtimeActivatedAt) {
        if (session.shiftEndMin == null) {
          return Response.json({ error: "Manual review required: missing shift snapshot" }, { status: 422 });
        }
        const shiftEndMs = session.date.getTime() + session.shiftEndMin * 60000;
        const activationMs = session.overtimeActivatedAt.getTime();
        if (!Number.isFinite(activationMs) || activationMs < shiftEndMs) {
          return Response.json({ error: "Manual review required: invalid overtime activation" }, { status: 422 });
        }
        if (now.getTime() <= activationMs) {
          return Response.json({ error: "Manual review required: invalid overtime interval" }, { status: 422 });
        }
        const otStartMs = Math.max(activationMs, shiftEndMs);
        const elapsed = Math.floor((now.getTime() - otStartMs) / 60000);
        let unpaidOverlap = 0;
        try {
          for (const b of breaks) {
            if (b.type !== "unpaid") continue;
            if (!b.start) continue;
            const bStart = new Date(b.start).getTime();
            const bEnd = b.end ? new Date(b.end).getTime() : now.getTime();
            if (!Number.isFinite(bStart) || !Number.isFinite(bEnd)) throw new Error("bad break");
            const overlapStart = Math.max(bStart, otStartMs);
            const overlapEnd = Math.min(bEnd, now.getTime());
            if (overlapEnd > overlapStart) unpaidOverlap += Math.floor((overlapEnd - overlapStart) / 60000);
          }
        } catch {
          return Response.json({ error: "Manual review required: invalid break data" }, { status: 422 });
        }
        overtimeMinutes = Math.max(0, elapsed - unpaidOverlap);
        // Enum-compatible marker for "authorized/ended payable OT" without approval workflow.
        overtimeStatus = "Approved";
      }

      const updatedCount = await prisma.timeSession.updateMany({
        where: { id: session.id, timeOut: null },
        data: { timeOut: now, completed: true, ...closed, overtimeMinutes, overtimeStatus },
      });
      if (updatedCount.count !== 1) {
        return Response.json({ error: "Already clocked out" }, { status: 409 });
      }

      if (earlyMin >= 10) {
        await prisma.approvalRequest.create({
          data: { staffId: employeeId, sessionId: session.id, type: "early_exit", deltaMin: earlyMin, date: today },
        });
      }

      await prisma.auditLog.create({
        data: {
          action: "CLOCK_OUT", entityType: "TimeSession", entityId: session.id,
          actorName: actor.name, actorRole: actor.role,
          summary: `${staff.fullName} clocked out${earlyMin ? ` (${earlyMin}m early)` : ""}`,
          managedBy,
        },
      });

      // Accrual after durable clock-out completion (preserve completed session on accrual failure). Idempotent + retry-safe.
      // When supervisor-authorized Extra Time was activated, reconcile unlocked CALCULATED earning to finalized OT minutes (no approval gate).
      let payrollAccrual: { created: boolean; skipped?: string; earningId?: string; status?: string; reason?: string | null; error?: string } | undefined;
      try {
        payrollAccrual = await prisma.$transaction((tx) =>
          accrueCompletedSession(tx, {
            sessionId: session.id,
            actor: { name: actor.name, role: actor.role },
            source: session.overtimeActivatedAt ? "MANUAL_CLOSE" : "CLOCK_OUT",
            config,
            allowCalculatedReconcile: !!session.overtimeActivatedAt,
          })
        );
      } catch (e) {
        payrollAccrual = { created: false, error: e instanceof Error ? e.message : "ACCRUAL_FAILED" };
      }

      return Response.json({
        ok: true,
        earlyDepartureMin: earlyMin,
        overtimeMinutes,
        ...(payrollAccrual?.error ? { payrollAccrualError: payrollAccrual.error } : { payrollAccrual }),
      });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

// Legacy POST /api/payments retired: src/app/api/payments/route.ts returns 410 LEGACY_PAYMENT_ENDPOINT_RETIRED.
// Canonical payment writes are handled only by /api/payments/allocate and /api/payments/coordinated.
// POST /api/advance — Give an advance (অগ্রিম) to a staff member. Idempotency-safe when idempotencyKey provided.
// ---------------------------------------------------------------------------
const AdvanceSchema = z.object({
  staffId: z.string().trim().min(1),
  amount: z.number().positive().finite(),
  createdBy: z.string().optional(),
  note: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

function advanceErrorResponse(err: unknown): Response {
  const e = err as any;
  const code = typeof e?.code === "string" ? e.code : undefined;
  switch (code) {
    case "STAFF_NOT_FOUND": return Response.json({ error: "Staff not found" }, { status: 404 });
    case "ADVANCE_LOG_NOT_FOUND": return Response.json({ error: "Advance not found" }, { status: 404 });
    case "EARNING_NOT_FOUND": return Response.json({ error: "Earning not found" }, { status: 404 });
    case "CROSS_STAFF_ADVANCE":
    case "CROSS_STAFF_EARNING": return Response.json({ error: "Staff mismatch: advance/earning must belong to the same staff member" }, { status: 403 });
    case "ADVANCE_ADJUSTMENT_IDEMPOTENCY_MISMATCH": return Response.json({ error: "Idempotency key reuse with a different request is not allowed" }, { status: 409 });
    case "ADVANCE_ADJUSTMENT_CONFLICT": return Response.json({ error: "A conflicting adjustment request is in progress; retry safely with the same idempotency key" }, { status: 409 });
    case "ADJUSTMENT_EXCEEDS_OUTSTANDING_ADVANCE": return Response.json({ error: "Adjustment exceeds outstanding advance" }, { status: 409 });
    case "ADJUSTMENT_EXCEEDS_ELIGIBLE_EARNING": return Response.json({ error: "Adjustment exceeds remaining eligible earned salary" }, { status: 409 });
    case "ADJUSTMENT_EXCEEDS_ADVANCE_LOG_OUTSTANDING": return Response.json({ error: "Adjustment exceeds selected advance outstanding" }, { status: 409 });
    case "EARNING_NOT_ELIGIBLE": return Response.json({ error: "Selected earning is not eligible for advance adjustment" }, { status: 409 });
    case "EARNING_FULLY_PAID_OR_ADJUSTED": return Response.json({ error: "Selected earning is already fully paid/adjusted" }, { status: 409 });
    case "EARNING_ALREADY_SETTLED": return Response.json({ error: "Legacy-settled earning cannot be adjusted" }, { status: 409 });
    case "NO_OUTSTANDING_ADVANCE": return Response.json({ error: "No outstanding advance available for adjustment" }, { status: 409 });
    case "ADVANCE_NOT_ADJUSTABLE": return Response.json({ error: "Selected advance record cannot be adjusted" }, { status: 409 });
    case "ADVANCE_LOCK_UNAVAILABLE": return Response.json({ error: "Advance adjustment service is temporarily unavailable" }, { status: 503 });
    case "INVALID_ADJUSTMENT_AMOUNT":
    case "INVALID_IDEMPOTENCY_KEY":
    case "STAFF_REQUIRED":
    case "ADVANCE_LOG_REQUIRED":
    case "EARNING_REQUIRED": return Response.json({ error: e?.message || "Invalid adjustment request" }, { status: 400 });
    default: return dbErrorResponse(err);
  }
}

export async function POST_advance(req: Request) {
  const actor = sessionFromRequest(req);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });
  let raw: unknown;
  try { raw = await req.json(); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  const body = AdvanceSchema.safeParse(raw);
  if (!body.success) return Response.json({ error: "Invalid payload", issues: body.error.flatten().fieldErrors }, { status: 400 });

  const staffId = body.data.staffId;
  const amount = payRound(body.data.amount);
  const note = (body.data.note ?? "").trim() || null;
  const idemKey = body.data.idempotencyKey ? body.data.idempotencyKey.trim() : null;

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const staff = await tx.staff.findUnique({ where: { employeeId: staffId } });
      if (!staff) throw advErr("STAFF_NOT_FOUND");

      if (idemKey) {
        const existing = await tx.advanceLog.findUnique({ where: { idempotencyKey: idemKey } as any });
        if (existing) {
          const same = existing.staffId === staffId && existing.type === "GIVEN" && Math.abs(payRound(Number(existing.amount) || 0) - amount) <= 0.000001 && ((existing.note ?? null) === note);
          if (!same) throw advErr("ADVANCE_ADJUSTMENT_IDEMPOTENCY_MISMATCH", "Idempotency key reuse with different payload");
          const st = await getStaffAdvanceState(tx as any, staffId);
          return { ok: true, advanceId: existing.id, staffId, amount: payRound(Number(existing.amount) || 0), balance: st.outstandingAdvance, outstandingAdvance: st.outstandingAdvance, skippedDuplicate: true, reason: "REPLAY" as const };
        }
      }

      const updatedStaff = await tx.staff.update({
        where: { employeeId: staffId },
        data: { advance: { increment: amount } },
        select: { advance: true, fullName: true },
      });

      let log: any;
      try {
        log = await tx.advanceLog.create({
          data: {
            staffId,
            type: "GIVEN",
            amount,
            balanceAfter: updatedStaff.advance,
            note,
            createdBy: actor.name,
            ...(idemKey ? { idempotencyKey: idemKey } : {}),
          } as any,
        });
      } catch (e: any) {
        if (idemKey && (e?.code === "P2002")) {
          const existing = await tx.advanceLog.findUnique({ where: { idempotencyKey: idemKey } as any });
          if (existing) {
            const same = existing.staffId === staffId && existing.type === "GIVEN" && Math.abs(payRound(Number(existing.amount) || 0) - amount) <= 0.000001 && ((existing.note ?? null) === note);
            if (!same) throw advErr("ADVANCE_ADJUSTMENT_IDEMPOTENCY_MISMATCH", "Idempotency key reuse with different payload");
            const st = await getStaffAdvanceState(tx as any, staffId);
            return { ok: true, advanceId: existing.id, staffId, amount: payRound(Number(existing.amount) || 0), balance: st.outstandingAdvance, outstandingAdvance: st.outstandingAdvance, skippedDuplicate: true, reason: "REPLAY" as const };
          }
        }
        throw e;
      }

      await tx.auditLog.create({
        data: {
          action: "ADVANCE_GIVEN",
          entityType: "AdvanceLog",
          entityId: log.id,
          actorName: actor.name,
          actorRole: actor.role,
          summary: `Advance ৳${amount.toFixed(2)} given to ${updatedStaff.fullName ?? staffId}`,
          after: { staffId, amount, advanceId: log.id, note, idempotencyKey: idemKey } as any,
        },
      });

      const st = await getStaffAdvanceState(tx as any, staffId);
      // keep Staff.advance cache consistent with derived outstanding (ledger source of truth)
      await tx.staff.update({ where: { employeeId: staffId }, data: { advance: st.outstandingAdvance } });
      return { ok: true, advanceId: log.id, staffId, amount, balance: st.outstandingAdvance, outstandingAdvance: st.outstandingAdvance, skippedDuplicate: false, reason: null as any };
    });

    return Response.json(result);
  } catch (err) {
    return advanceErrorResponse(err);
  }
}

const AdvanceAdjustSchema = z.object({
  staffId: z.string().trim().min(1),
  advanceLogId: z.string().trim().min(1),
  payrollEarningId: z.string().trim().min(1),
  amount: z.number().positive().finite(),
  idempotencyKey: z.string().trim().min(1).max(255),
  note: z.string().trim().max(1000).optional(),
});

export async function POST_adjust(req: Request) {
  const actor = sessionFromRequest(req);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });
  let raw: unknown;
  try { raw = await req.json(); } catch { return Response.json({ error: "Invalid payload" }, { status: 400 }); }
  const body = AdvanceAdjustSchema.safeParse(raw);
  if (!body.success) return Response.json({ error: "Invalid payload", issues: body.error.flatten().fieldErrors }, { status: 400 });
  try {
    const result = await prisma.$transaction((tx) => createAdvanceAdjustment(tx as any, {
      staffId: body.data.staffId,
      advanceLogId: body.data.advanceLogId,
      payrollEarningId: body.data.payrollEarningId,
      amount: body.data.amount,
      idempotencyKey: body.data.idempotencyKey,
      note: body.data.note ?? null,
      actor: { name: actor.name, role: actor.role },
    }));
    return Response.json(result);
  } catch (err) {
    return advanceErrorResponse(err);
  }
}

export async function GET_advance(req: Request) {
  const actor = sessionFromRequest(req);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") return Response.json({ error: "Admin or Supervisor access required" }, { status: 403 });
  const url = new URL(req.url);
  const staffId = (url.searchParams.get("staffId") || "").trim();
  try {
    const db = prisma as any;
    const whereLog = staffId ? { staffId } : {};
    const whereAdj = staffId ? { staffId } : {};
    const [state, logs, adjustments, eligible] = await Promise.all([
      staffId ? getStaffAdvanceState(db, staffId) : Promise.resolve(null),
      db.advanceLog.findMany({ where: whereLog, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, staffId: true, type: true, amount: true, balanceAfter: true, note: true, createdAt: true, createdBy: true, paymentId: true } }),
      db.advanceAdjustment.findMany({ where: whereAdj, orderBy: { adjustedAt: "desc" }, take: 200, select: { id: true, staffId: true, advanceLogId: true, payrollEarningId: true, amount: true, note: true, adjustedAt: true, adjustedBy: true, idempotencyKey: true, workDate: true } }),
      staffId ? getEligibleEarningsForStaff(db, staffId) : Promise.resolve([]),
    ]);
    const staffIds = Array.from(new Set([...logs.map((l: any) => String(l.staffId)), ...adjustments.map((a: any) => String(a.staffId)), ...(staffId ? [staffId] : [])]));
    const staffRows = staffIds.length ? await db.staff.findMany({ where: { employeeId: { in: staffIds } }, select: { employeeId: true, fullName: true } }) : [];
    const name = new Map<string, string>(staffRows.map((s: any) => [String(s.employeeId), String(s.fullName ?? s.employeeId)] as [string,string]));
    return Response.json({
      ok: true,
      staffId: staffId || null,
      state,
      eligibleEarnings: eligible,
      advanceLogs: logs.map((l: any) => ({ id: String(l.id), staffId: String(l.staffId), staffName: name.get(String(l.staffId)) ?? String(l.staffId), type: String(l.type), amount: payRound(Number(l.amount) || 0), balanceAfter: l.balanceAfter, note: l.note ?? null, createdAt: (l.createdAt instanceof Date ? l.createdAt : new Date(l.createdAt)).toISOString(), createdBy: l.createdBy ?? null, paymentId: l.paymentId ?? null })),
      adjustments: adjustments.map((a: any) => ({ id: String(a.id), staffId: String(a.staffId), staffName: name.get(String(a.staffId)) ?? String(a.staffId), advanceLogId: String(a.advanceLogId), payrollEarningId: String(a.payrollEarningId), amount: payRound(Number(a.amount) || 0), note: a.note ?? null, adjustedAt: (a.adjustedAt instanceof Date ? a.adjustedAt : new Date(a.adjustedAt)).toISOString(), adjustedBy: a.adjustedBy ?? null, idempotencyKey: String(a.idempotencyKey), workDate: a.workDate ?? null })),
    });
  } catch (err) {
    return advanceErrorResponse(err);
  }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
interface Segment { type: string; start: string; end: string | null }
interface GoOut { reason: string; estimatedMin: number; start: string; end: string | null }

function parseShiftTime(t: string): [number, number] {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return [9, 0];
  let h = parseInt(m[1]) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return [h, parseInt(m[2])];
}

/** Resolve the shift that a session must be judged against: its own
 *  clock-in snapshot when present (historical fidelity), else the staff's
 *  LIVE assignment (pre-snapshot legacy rows). */
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

/** The staff's current shift and pay snapshots at clock-in (historical fidelity). */
function staffShiftSnapshot(staff: {
  shiftStart: string; shiftEnd: string;
  salaryType?: string; dailyRate?: number | null; baseSalary?: number | null; hourlyRate?: number | null;
  dailyDutyHours?: number | null;
}) {
  const { startMin, endMin } = sessionShiftProps(staff, null);
  const duty = staff.dailyDutyHours && staff.dailyDutyHours > 0 ? staff.dailyDutyHours : 8;
  const st = staff.salaryType ?? "DAILY";
  const dailySalary = (st === "HOURLY" || st === "Hourly") ? 0
    : (st === "DAILY" || st === "Daily") ? (staff.dailyRate ?? 0)
    : (st === "WEEKLY" || st === "Weekly") ? (staff.baseSalary ?? 0) / 7
    : (st === "MONTHLY" || st === "Monthly") ? (staff.baseSalary ?? 0) / 30
    : (staff.dailyRate ?? 0);
  const hourlyRateSnapshot = (st === "HOURLY" || st === "Hourly") ? (staff.hourlyRate ?? 0) : (duty > 0 ? dailySalary / duty : 0);
  return {
    shiftStartMin: startMin, shiftEndMin: endMin, shiftStartTime: staff.shiftStart, shiftEndTime: staff.shiftEnd,
    dailySalarySnapshot: dailySalary,
    dailyDutyHoursSnapshot: duty,
    hourlyRateSnapshot,
  };
}

async function loadConfig(): Promise<Record<string, string>> {
  const rows = await prisma.config.findMany();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function configNumber(config: Record<string, string>, key: string, fallback: number): number {
  const value = Number(config[key]);
  return Number.isFinite(value) ? value : fallback;
}

function isOperatingWindow(now: Date, config: Record<string, string>): boolean {
  const minutes = dhakaMinutes(now);
  const open = parseShiftTime(config.FLOOR_OPEN_TIME ?? "09:00 AM");
  const close = parseShiftTime(config.FLOOR_CLOSE_TIME ?? "11:00 PM");
  const openMinute = open[0] * 60 + open[1];
  const closeMinute = close[0] * 60 + close[1];
  return openMinute <= closeMinute ? minutes >= openMinute && minutes <= closeMinute : minutes >= openMinute || minutes <= closeMinute;
}

function isWithinShiftWindow(now: Date, shiftStart: string, shiftEnd: string, config: Record<string, string>): boolean {
  const minutes = dhakaMinutes(now);
  const earlyCheckin = configNumber(config, "EARLY_CHECKIN_MINUTES", 5);
  const [sh, sm] = parseShiftTime(shiftStart);
  const [eh, em] = parseShiftTime(shiftEnd);
  // Early clock-in allowed up to exactly configured grace before scheduled Duty Start (default 5m).
  // Pre-duty minutes are not payable (enforced in canonical payroll calc), but clock-in is permitted in-window.
  let startMinute = (sh * 60 + sm) - earlyCheckin;
  if (startMinute < 0) startMinute += 24 * 60;
  const endMinute = eh * 60 + em;
  return startMinute <= endMinute
    ? minutes >= startMinute && minutes <= endMinute
    : minutes >= startMinute || minutes <= endMinute;
}

function dhakaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function dhakaDateKey(date: Date): string {
  const parts = dhakaParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dhakaMinutes(date: Date): number {
  const parts = dhakaParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function dhakaStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00+06:00`);
}

function dhakaAt(dateKey: string, minuteOfDay: number): Date {
  const dayOffset = minuteOfDay >= 24 * 60 ? 1 : 0;
  const normalized = minuteOfDay % (24 * 60);
  const base = dhakaStart(dateKey);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  base.setUTCMinutes(normalized);
  return base;
}

function parseShiftHours(start: string, end: string): number {
  const [sh, sm] = parseShiftTime(start);
  const [eh, em] = parseShiftTime(end);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

function getHourlyRate(staff: { salaryType: string; hourlyRate: number; dailyRate: number; baseSalary: number }, shiftHours: number): number {
  const duty = shiftHours || 8;
  switch (staff.salaryType) {
    case "HOURLY": return staff.hourlyRate;
    case "DAILY": return staff.dailyRate / duty;
    case "WEEKLY": return staff.baseSalary / 7 / duty;
    case "MONTHLY": return staff.baseSalary / 30 / duty;
    default: return 0;
  }
}

async function saveSession(id: string, data: object, actor: AuthSession, managedBy: string | undefined, summary: string) {
  await prisma.timeSession.update({ where: { id }, data: { ...data } as never });
  await prisma.auditLog.create({
    data: {
      action: "SESSION_UPDATE", entityType: "TimeSession", entityId: id,
      actorName: actor.name, actorRole: actor.role, summary, managedBy,
    },
  });
}

