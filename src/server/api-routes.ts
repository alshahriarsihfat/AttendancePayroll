// ============================================================================
// API Route Handlers — copy these into src/app/api/*/route.ts in Next.js.
// Every handler uses: Zod validation, Prisma singleton, safe async-await,
// and atomic transactions for multi-table writes.
//
//   npm install zod
// ============================================================================

import { z } from "zod";
import { prisma, payRound } from "./db";

// ---------------------------------------------------------------------------
// POST /api/clock — Handles ALL clock actions atomically.
// Body: { employeeId, action: "in"|"out"|"break_start"|"break_end"|"goout_start"|"goout_end", ... }
// ---------------------------------------------------------------------------
const ClockSchema = z.object({
  employeeId: z.string().min(1),
  action: z.enum(["in", "out", "break_start", "break_end", "goout_start", "goout_end"]),
  breakType: z.enum(["meal", "rest", "unpaid"]).optional(),
  goOutReason: z.string().optional(),
  goOutEstimatedMin: z.number().int().positive().optional(),
  managedBy: z.string().optional(),   // supervisor acting on staff's behalf
});

export async function POST_clock(req: Request) {
  const body = ClockSchema.safeParse(await req.json());
  if (!body.success) {
    return Response.json({ error: "Invalid payload", details: body.error.flatten() }, { status: 400 });
  }
  const { employeeId, action, managedBy } = body.data;
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);

  try {
    const staff = await prisma.staff.findUnique({ where: { employeeId } });
    if (!staff || !staff.isActive) {
      return Response.json({ error: "Staff not found or inactive" }, { status: 404 });
    }

    // ---- CLOCK IN ----
    if (action === "in") {
      const existing = await prisma.timeSession.findUnique({
        where: { staffId_date: { staffId: employeeId, date: today } },
      });
      if (existing) {
        return Response.json({ error: "Already clocked in today" }, { status: 409 });
      }
      // Late detection vs scheduled shift start
      const [hh, mm] = parseShiftTime(staff.shiftStart);
      const shiftStart = new Date(today); shiftStart.setHours(hh, mm, 0, 0);
      const lateMin = now > shiftStart ? Math.round((now.getTime() - shiftStart.getTime()) / 60000) : 0;

      const session = await prisma.timeSession.create({
        data: { staffId: employeeId, date: today, timeIn: now },
      });

      await prisma.auditLog.create({
        data: {
          action: "CLOCK_IN", entityType: "TimeSession", entityId: session.id,
          actorName: staff.fullName, actorRole: staff.role.toString(),
          summary: `${staff.fullName} clocked in${lateMin > 0 ? ` (${lateMin}m late)` : " on time"}`,
          managedBy,
        },
      });

      // Flag for manager approval if late >= 10 min
      if (lateMin >= 10) {
        await prisma.approvalRequest.create({
          data: { staffId: employeeId, sessionId: session.id, type: "late", deltaMin: lateMin, date: today },
        });
      }
      return Response.json({ session, lateMin });
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
      await saveSession(session.id, { breaks }, managedBy, `started ${type} break`);
      return Response.json({ ok: true });
    }

    // ---- BREAK END ----
    if (action === "break_end") {
      const updated = breaks.map((b) => (b.end ? b : { ...b, end: now.toISOString() }));
      await saveSession(session.id, { breaks: updated }, managedBy, "returned from break");
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
      await saveSession(session.id, { goOuts }, managedBy, `went out: ${body.data.goOutReason}`);
      return Response.json({ ok: true });
    }

    // ---- GO-OUT END ----
    if (action === "goout_end") {
      const updated = goOuts.map((g) => (g.end ? g : { ...g, end: now.toISOString() }));
      await saveSession(session.id, { goOuts: updated }, managedBy, "returned from go-out");
      return Response.json({ ok: true });
    }

    // ---- CLOCK OUT (closes ALL open segments) ----
    if (action === "out") {
      const outISO = now.toISOString();
      // Early-departure detection
      const [eh, em] = parseShiftTime(staff.shiftEnd);
      const shiftEnd = new Date(today); shiftEnd.setHours(eh, em, 0, 0);
      const earlyMin = now < shiftEnd ? Math.round((shiftEnd.getTime() - now.getTime()) / 60000) : 0;

      const closed = {
        breaks: breaks.map((b) => (b.end ? b : { ...b, end: outISO })),
        goOuts: goOuts.map((g) => (g.end ? g : { ...g, end: outISO })),
        extraTime: extraTime.map((b) => (b.end ? b : { ...b, end: outISO })),
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
          actorName: staff.fullName, actorRole: staff.role.toString(),
          summary: `${staff.fullName} clocked out${earlyMin ? ` (${earlyMin}m early)` : ""}`,
          managedBy,
        },
      });

      return Response.json({ ok: true, earlyDepartureMin: earlyMin });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[api/clock]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
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

export async function POST_payment(req: Request) {
  const body = PaySchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  try {
    const session = await prisma.timeSession.findUnique({
      where: { id: body.data.sessionId },
      include: { staff: true },
    });
    if (!session?.timeOut) return Response.json({ error: "Staff must clock out first" }, { status: 409 });

    const existing = await prisma.payment.findFirst({ where: { sessionId: session.id } });
    if (existing) return Response.json({ error: "Already paid" }, { status: 409 });

    // ---- Wage calculation (mirrors frontend computeSession) ----
    const staff = session.staff;
    const shiftHours = parseShiftHours(staff.shiftStart, staff.shiftEnd);
    const hourlyRate = getHourlyRate(staff, shiftHours);

    const workedMin = (session.timeOut.getTime() - session.timeIn.getTime()) / 60000;
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
    const paidAllow = staff.mealBreakMin + staff.restMin;   // 45
    const paidTaken = mealMin + restMin;
    const overBreakMin = Math.max(0, paidTaken - paidAllow) + unpaidMin;

    // Overtime: minutes past scheduled shift end
    const [eh, em] = parseShiftTime(staff.shiftEnd);
    const shiftEnd = new Date(session.date); shiftEnd.setHours(eh, em, 0, 0);
    const overtimeMin = session.timeOut > shiftEnd
      ? Math.round((session.timeOut.getTime() - shiftEnd.getTime()) / 60000) : 0;

    // ---- Money (single rounding point) ----
    const basicMin = Math.max(0, workedMin - overtimeMin);
    const grossPay = payRound(hourlyRate * (basicMin / 60));
    const overBreakDeduction = payRound(hourlyRate * (overBreakMin / 60));
    const overtimePay = payRound(hourlyRate * 1.25 * (overtimeMin / 60));
    const netEarned = payRound(grossPay + overtimePay - overBreakDeduction);

    // ---- AUTO ADVANCE ADJUSTMENT ----
    const advanceAdjusted = payRound(Math.min(staff.advance, netEarned));
    const netPay = payRound(netEarned - advanceAdjusted);

    // ---- ATOMIC TRANSACTION ----
    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          staffId: staff.employeeId, sessionId: session.id,
          date: session.date, paidAt: new Date(),          // exact cash-flow time
          periodLabel: `${session.date.toISOString().slice(0, 10)} · Day`,
          dutyHours: payRound(shiftHours), workedMin: Math.round(workedMin),
          breakMin: Math.round(mealMin + restMin), overBreakMin: Math.round(overBreakMin),
          overtimeMin, hourlyRate: payRound(hourlyRate), grossPay,
          overtimePay, overBreakDeduction,
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
    console.error("[api/payments]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
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
    console.error("[api/advance]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
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

async function saveSession(id: string, data: object, managedBy: string | undefined, summary: string) {
  await prisma.timeSession.update({ where: { id }, data: { ...data } as never });
  await prisma.auditLog.create({
    data: {
      action: "SESSION_UPDATE", entityType: "TimeSession", entityId: id,
      actorName: managedBy ?? "staff", actorRole: "STAFF", summary, managedBy,
    },
  });
}
