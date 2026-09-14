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
import { scheduledBoundary } from "@/lib/timeclock";
import { sessionFromRequest, type AuthSession } from "@/lib/auth-session";

// ---------------------------------------------------------------------------
// POST /api/clock — Handles ALL clock actions atomically.
// Body: { employeeId, action: "in"|"out"|"break_start"|"break_end"|"goout_start"|"goout_end", ... }
// ---------------------------------------------------------------------------
const ClockSchema = z.object({
  employeeId: z.string().min(1).optional(),
  staffId: z.string().min(1).optional(),
  action: z.enum(["in", "out", "break_start", "break_end", "goout_start", "goout_end"]),
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
  const employeeId = body.data.employeeId ?? body.data.staffId ?? "";
  const { action } = body.data;
  const now = new Date();
  const todayKey = dhakaDateKey(now);
  const today = dhakaStart(todayKey);
  const config = await loadConfig();
  try {
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

        // Close forgotten prior-day sessions at the scheduled shift end before
        // creating today's unique staff/date row.
        const openSessions = await tx.timeSession.findMany({
          where: { staffId: employeeId, timeOut: null, date: { lt: today } },
        });
        for (const open of openSessions) {
          const [endHour, endMinute] = parseShiftTime(staff.shiftEnd);
          const autoOut = dhakaAt(dhakaDateKey(open.date), endHour * 60 + endMinute);
          await tx.timeSession.update({
            where: { id: open.id },
            data: { timeOut: autoOut, completed: true, autoClockedOut: true },
          });
        }

        const [hh, mm] = parseShiftTime(staff.shiftStart);
        const shiftStart = dhakaAt(todayKey, hh * 60 + mm);
        const lateMin = now > shiftStart ? Math.round((now.getTime() - shiftStart.getTime()) / 60000) : 0;
        const session = await tx.timeSession.create({ data: { staffId: employeeId, date: today, timeIn: now } });
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
        return { session, lateMin };
      });
      if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
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
      // Early-departure detection
      const [eh, em] = parseShiftTime(staff.shiftEnd);
      const shiftEnd = new Date(scheduledBoundary(session.timeIn.toISOString(), eh * 60 + em));
      const earlyMin = now < shiftEnd ? Math.round((shiftEnd.getTime() - now.getTime()) / 60000) : 0;

      const closed = {
        breaks: breaks.map((b) => (b.end ? b : { ...b, end: outISO })) as unknown as Prisma.InputJsonValue,
        goOuts: goOuts.map((g) => (g.end ? g : { ...g, end: outISO })) as unknown as Prisma.InputJsonValue,
        extraTime: extraTime.map((b) => (b.end ? b : { ...b, end: outISO })) as unknown as Prisma.InputJsonValue,
      };

      await prisma.timeSession.update({
        where: { id: session.id },
        data: { timeOut: now, completed: true, ...closed },
      });

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

      return Response.json({ ok: true, earlyDepartureMin: earlyMin });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/payments — Process a payout with automatic advance adjustment.
// Runs in a TRANSACTION: Payment + AdvanceLog + Staff.advance all update
// together or not at all.
// ---------------------------------------------------------------------------
const PaySchema = z.object({
  sessionId: z.string().min(1),
  paidBy: z.string().min(1),
});

/** Thrown when a payment for this session already exists (checked inside the
 *  transaction so concurrent requests can't both create a duplicate). */
class PaymentAlreadyPaidError extends Error {}

export async function POST_payment(req: Request) {
  const body = PaySchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  try {
    const session = await prisma.timeSession.findUnique({
      where: { id: body.data.sessionId },
      include: { staff: true },
    });
    if (!session?.timeOut) return Response.json({ error: "Staff must clock out first" }, { status: 409 });

    // ---- Wage calculation (mirrors frontend computeSession) ----
    const staff = session.staff;
    const config = await loadConfig();
    const shiftHours = payRound(parseShiftHours(staff.shiftStart, staff.shiftEnd));
    const hourlyRate = payRound(getHourlyRate(staff, shiftHours));

    const workedMin = payRound(Math.max(0, (session.timeOut.getTime() - session.timeIn.getTime()) / 60000), 4);
    const breaks: Segment[] = JSON.parse(JSON.stringify(session.breaks ?? "[]"));
    const goOuts: GoOut[] = JSON.parse(JSON.stringify(session.goOuts ?? "[]"));

    // Dual-pool break engine: 30m meal + 15m rest = 45m paid ceiling
    let mealMin = 0, restMin = 0, unpaidMin = 0;
    for (const b of breaks) {
      const end = b.end ? new Date(b.end).getTime() : session.timeOut!.getTime();
      const mins = (end - new Date(b.start).getTime()) / 60000;
      if (b.type === "meal") mealMin += mins;
      else if (b.type === "rest") restMin += mins;
      else unpaidMin += mins;
    }
    const paidAllow = configNumber(config, "MEAL_BREAK_MINUTES", staff.mealBreakMin) + configNumber(config, "REST_BREAK_MINUTES", staff.restMin);
    const paidTaken = mealMin + restMin;
    const overBreakMin = payRound(Math.max(0, paidTaken - paidAllow) + unpaidMin, 4);

    // Overtime: minutes past scheduled shift end
    const shiftEndMs = scheduledBoundary(session.timeIn.toISOString(), parseShiftTime(staff.shiftEnd)[0] * 60 + parseShiftTime(staff.shiftEnd)[1]);
    const overtimeMin = session.timeOut.getTime() > shiftEndMs
      ? Math.round((session.timeOut.getTime() - shiftEndMs) / 60000) : 0;
    const extraTimeMin = ((session.extraTime ?? []) as Array<{ start: string; end: string | null }>).reduce((sum: number, et) => {
      const endISO = et.end ?? session.timeOut!.toISOString();
      return sum + minutesBetween(et.start, endISO);
    }, 0);

    // ---- Money (single rounding point) ----
    const totalOvertimeMin = overtimeMin + extraTimeMin;
    const basicMin = Math.max(0, workedMin - totalOvertimeMin);
    const grossPay = payRound(hourlyRate * (basicMin / 60));
    const overBreakDeduction = payRound(hourlyRate * (overBreakMin / 60));
    const overtimePay = payRound(hourlyRate * configNumber(config, "OVERTIME_MULTIPLIER", 1.25) * (totalOvertimeMin / 60));
    const netEarned = payRound(Math.max(0, grossPay + overtimePay - overBreakDeduction));

    // ---- AUTO ADVANCE ADJUSTMENT ----
    const advanceAdjusted = payRound(Math.min(Math.max(0, staff.advance), netEarned));
    const netPay = payRound(Math.max(0, netEarned - advanceAdjusted));

    // ---- ATOMIC TRANSACTION ----
    // Duplicate-payment guard runs INSIDE the transaction. Paired with the
    // `@unique` constraint on Payment.sessionId, this closes the race where two
    // concurrent requests could both pass a check made outside the transaction
    // and create two payments for the same shift.
    const payment = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const alreadyPaid = await tx.payment.findFirst({ where: { sessionId: session.id } });
      if (alreadyPaid) throw new PaymentAlreadyPaidError();

      const p = await tx.payment.create({
        data: {
          staffId: staff.employeeId, sessionId: session.id,
          date: session.date, paidAt: new Date(),          // exact cash-flow time
          // Resolve the SHIFT's calendar date in Dhaka time — session.date is
          // stored as Dhaka midnight, and toISOString().slice(0,10) returns the
          // UTC date which lands on the previous day between 18:00–24:00 UTC.
          periodLabel: `${dateKeyInZone(session.date)} · Day`,
          dutyHours: payRound(shiftHours), workedMin: Math.round(workedMin),
          breakMin: Math.round(mealMin + restMin), overBreakMin: Math.round(overBreakMin),
          overtimeMin: Math.max(0, totalOvertimeMin), hourlyRate: payRound(hourlyRate), grossPay: payRound(grossPay),
          overtimePay: payRound(overtimePay), overBreakDeduction: payRound(overBreakDeduction),
          advanceAdjusted, netPay,
          status: "PAID", paidBy: body.data.paidBy,
        },
      });

      if (advanceAdjusted > 0) {
        await tx.advanceLog.create({
          data: {
            staffId: staff.employeeId, type: "ADJUSTED", amount: advanceAdjusted,
            balanceAfter: payRound(staff.advance - advanceAdjusted),
            paymentId: p.id, note: "Auto-adjusted from payout",
            createdBy: body.data.paidBy,
          },
        });
        await tx.staff.update({
          where: { employeeId: staff.employeeId },
          data: { advance: payRound(staff.advance - advanceAdjusted) },
        });
      }

      await tx.auditLog.create({
        data: {
          action: "PAYMENT", entityType: "Payment", entityId: p.id,
          actorName: body.data.paidBy, actorRole: "SUPERVISOR",
          summary: `Paid ৳${netPay.toFixed(2)} to ${staff.fullName}` +
                   (advanceAdjusted > 0 ? ` (advance adjusted ৳${advanceAdjusted.toFixed(2)})` : ""),
        },
      });

      return p;
    });

    return Response.json(payment);
  } catch (err) {
    if (err instanceof PaymentAlreadyPaidError) {
      return Response.json({ error: "Already paid" }, { status: 409 });
    }
    // Belt-and-braces: the DB unique constraint on Payment.sessionId is the
    // final authority — surface a duplicate insert as a clean 409 too.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return Response.json({ error: "Already paid" }, { status: 409 });
    }
    return dbErrorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/advance — Give an advance (অগ্রিম) to a staff member.
// ---------------------------------------------------------------------------
const AdvanceSchema = z.object({
  staffId: z.string().min(1),
  amount: z.number().positive(),
  createdBy: z.string().min(1),
  note: z.string().optional(),
});

export async function POST_advance(req: Request) {
  const body = AdvanceSchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  try {
    const staff = await prisma.staff.findUnique({ where: { employeeId: body.data.staffId } });
    if (!staff) return Response.json({ error: "Staff not found" }, { status: 404 });

    const newBalance = payRound(staff.advance + body.data.amount);

    await prisma.$transaction([
      prisma.staff.update({
        where: { employeeId: body.data.staffId },
        data: { advance: newBalance },
      }),
      prisma.advanceLog.create({
        data: {
          staffId: body.data.staffId, type: "GIVEN", amount: payRound(body.data.amount),
          balanceAfter: newBalance, note: body.data.note, createdBy: body.data.createdBy,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "ADVANCE_GIVEN", entityType: "Staff", entityId: body.data.staffId,
          actorName: body.data.createdBy, actorRole: "SUPERVISOR",
          summary: `Advance ৳${body.data.amount.toFixed(2)} given to ${staff.fullName}`,
        },
      }),
    ]);

    return Response.json({ ok: true, balance: newBalance });
  } catch (err) {
    return dbErrorResponse(err);
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
