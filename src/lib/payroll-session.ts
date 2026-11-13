import type { ConfigEntry, Employee, TimeSession } from "../types";
import { configNumber } from "./config";
import { payRound } from "./currency";
import { minutesBetween } from "./dates";
import { parseTime12, scheduledShiftBounds, type EmpShift } from "./timeclock";

/** Config as Record (server) or ConfigEntry[] (client). */
type Cfg = Record<string, string> | ConfigEntry[];

function cfgNum(cfg: Cfg, key: string, fb: number): number {
  if (Array.isArray(cfg)) return configNumber(cfg, key, fb);
  const v = Number((cfg as Record<string, string>)[key]);
  return Number.isFinite(v) ? v : fb;
}

function shiftDurationMin(startMin: number, endMin: number): number {
  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

function resolveShift(
  staff: Pick<Employee, "shiftStart" | "shiftEnd" | "mealBreakMin" | "restMin">,
  session?: Pick<TimeSession, "shiftStartMin" | "shiftEndMin" | "shiftStartTime" | "shiftEndTime"> | null
): EmpShift {
  const liveStart = parseTime12(staff.shiftStart || "09:00 AM");
  const liveEnd = parseTime12(staff.shiftEnd || "08:00 PM");
  const meal = staff.mealBreakMin ?? 30;
  const rest = staff.restMin ?? 15;
  const hasSnap = session && Number.isInteger(session.shiftStartMin) && Number.isInteger(session.shiftEndMin);
  const startMin = hasSnap ? (session!.shiftStartMin as number) : liveStart;
  const endMin = hasSnap ? (session!.shiftEndMin as number) : liveEnd;
  return {
    startMin, endMin, regularHours: payRound(shiftDurationMin(startMin, endMin) / 60, 2),
    mealBreakMin: meal, restMin: rest,
    startTime: hasSnap ? (session!.shiftStartTime || staff.shiftStart || "09:00 AM") : (staff.shiftStart || "09:00 AM"),
    endTime: hasSnap ? (session!.shiftEndTime || staff.shiftEnd || "08:00 PM") : (staff.shiftEnd || "08:00 PM"),
  };
}

/**
 * Duty hours: explicit session/staff config > shift duration.
 * No silent 8-hour fallback in active earning context (accrual requires explicit config).
 */
export function resolveDutyHours(
  staff: Pick<Employee, "dailyDutyHours" | "shiftStart" | "shiftEnd">,
  session?: Pick<TimeSession, "dailyDutyHoursSnapshot" | "shiftStartMin" | "shiftEndMin"> | null
): number {
  const snap = session?.dailyDutyHoursSnapshot;
  if (typeof snap === "number" && snap > 0) return snap;
  const staffDuty = staff.dailyDutyHours;
  if (typeof staffDuty === "number" && staffDuty > 0) return staffDuty;
  const shift = resolveShift(staff as any, session);
  if (shift.regularHours > 0) return shift.regularHours;
  return 0;
}

function toMs(v: string | Date | undefined | null): number {
  if (!v) return NaN;
  return typeof v === "string" ? new Date(v).getTime() : v.getTime();
}
function toISO(v: string | Date | undefined | null): string {
  if (!v) return "";
  return typeof v === "string" ? v : v.toISOString();
}

export interface CanonicalPayout {
  dutyHours: number;
  hourlyRate: number;
  overtimeRate: number;
  grossMin: number;
  basicMin: number;
  breakMin: number;
  overBreakMin: number;
  overtimeMin: number; // stored authoritative
  payableOvertimeMin: number;
  extraTimeMin: number; // tracked, NOT payable
  grossPay: number;
  overBreakDeduction: number;
  overtimePay: number;
  netPay: number;
  mealMin: number;
  restMin: number;
  unpaidMin: number;
  paidMealAllow: number;
  paidRestAllow: number;
  totalPaidAllow: number;
  mealRemaining: number;
  restRemaining: number;
  poolsExhausted: boolean;
  lateMin: number;
  isLate: boolean;
  shift: EmpShift;
}

export interface SessionLike {
  timeIn: string | Date;
  timeOut?: string | Date | null;
  breaks?: Array<{ type?: string; start: string | Date; end?: string | Date | null }> | any;
  extraTime?: Array<{ start: string | Date; end?: string | Date | null }> | any;
  goOuts?: any;
  completed?: boolean;
  overtimeStatus?: string | null;
  overtimeMinutes?: number | null;
  dailySalarySnapshot?: number | null;
  dailyDutyHoursSnapshot?: number | null;
  hourlyRateSnapshot?: number | null;
  shiftStartMin?: number | null;
  shiftEndMin?: number | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
}
export interface StaffLike {
  salaryType: string;
  hourlyRate?: number; dailyRate?: number; baseSalary?: number;
  dailySalary?: number; dailyDutyHours?: number;
  shiftStart?: string; shiftEnd?: string;
  mealBreakMin?: number; restMin?: number;
}
export interface ComputeInput {
  session?: SessionLike | null;
  staff: StaffLike;
  config: Cfg;
  now: number;
}

/** Canonical shared payroll calculation. Pure, browser+server safe. */
export function computeCanonical(input: ComputeInput): CanonicalPayout {
  const { session, staff, config, now } = input;
  const shift = resolveShift(staff as any, session as any);
  const mealAllow = staff.mealBreakMin ?? cfgNum(config, "MEAL_BREAK_MINUTES", 30);
  const restAllow = staff.restMin ?? cfgNum(config, "REST_BREAK_MINUTES", 15);
  const otMult = cfgNum(config, "OVERTIME_MULTIPLIER", 1.0);
  const dutyHours = resolveDutyHours(staff as any, session as any);

  // Hourly rate: authoritative snapshot first, then configured hourlyRate (2C.6.2), then legacy derivation fallback.
  let hourlyRate: number;
  if (session?.hourlyRateSnapshot && session.hourlyRateSnapshot > 0) {
    hourlyRate = session.hourlyRateSnapshot;
  } else if ((staff.hourlyRate || 0) > 0) {
    hourlyRate = staff.hourlyRate || 0;
  } else {
    const dailySalary = (session?.dailySalarySnapshot && session.dailySalarySnapshot > 0)
      ? session.dailySalarySnapshot
      : (staff.salaryType === "Daily" || staff.salaryType === "DAILY" ? (staff.dailyRate || 0)
        : staff.salaryType === "Monthly" || staff.salaryType === "MONTHLY" ? ((staff.baseSalary || staff.dailySalary || 0)) / 30
        : staff.salaryType === "Weekly" || staff.salaryType === "WEEKLY" ? (staff.baseSalary || 0) / 7
        : (staff.dailySalary || staff.dailyRate || 0));
    hourlyRate = dutyHours > 0 ? dailySalary / dutyHours : 0;
  }
  const overtimeRate = hourlyRate * otMult;

  const zero: CanonicalPayout = {
    dutyHours, hourlyRate, overtimeRate,
    grossMin: 0, basicMin: 0, breakMin: 0, overBreakMin: 0, overtimeMin: 0, payableOvertimeMin: 0, extraTimeMin: 0,
    grossPay: 0, overBreakDeduction: 0, overtimePay: 0, netPay: 0,
    mealMin: 0, restMin: 0, unpaidMin: 0,
    paidMealAllow: mealAllow, paidRestAllow: restAllow, totalPaidAllow: mealAllow + restAllow,
    mealRemaining: mealAllow, restRemaining: restAllow, poolsExhausted: false,
    lateMin: 0, isLate: false, shift,
  };
  if (!session) return zero;

  const timeInISO = toISO(session.timeIn);
  const timeOutMs = session.timeOut ? toMs(session.timeOut) : now;
  const timeInMs = toMs(session.timeIn);
  const grossMin = Math.max(0, (timeOutMs - timeInMs) / 60000);
  const { start: schedStart, end: schedEnd } = scheduledShiftBounds(timeInISO, shift);

  // Breaks (preserve fractional for overrun calc accuracy, consistent with minutesBetween)
  let mealMin = 0, restMin = 0, unpaidMin = 0;
  const breaks = Array.isArray(session.breaks) ? session.breaks : (typeof session.breaks === "string" ? JSON.parse(session.breaks || "[]") : (session.breaks ?? []));
  for (const b of breaks) {
    const bEnd = b.end ? toMs(b.end) : timeOutMs;
    const m = Math.max(0, (bEnd - toMs(b.start)) / 60000);
    if (b.type === "meal") mealMin += m;
    else if (b.type === "rest") restMin += m;
    else unpaidMin += m;
  }
  const breakMin = mealMin + restMin + unpaidMin;
  const totalPaidAllow = mealAllow + restAllow;
  const poolOverrun = Math.max(0, (mealMin + restMin) - totalPaidAllow);
  const overBreakMin = poolOverrun + unpaidMin;
  const poolsExhausted = (mealMin + restMin) >= totalPaidAllow;
  const mealOver = Math.max(0, mealMin - mealAllow);
  const mealRemaining = Math.max(0, mealAllow - mealMin);
  const restRemaining = Math.max(0, restAllow - restMin - mealOver);

  // Extra time segments are tracked, NOT payable (legacy field; supervisor-authorized OT uses overtimeActivatedAt).
  let extraTimeMin = 0;
  const extraTime = Array.isArray(session.extraTime) ? session.extraTime : (session.extraTime ?? []);
  for (const et of extraTime) {
    const eEnd = et.end ? toMs(et.end) : timeOutMs;
    extraTimeMin += Math.max(0, (eEnd - toMs(et.start)) / 60000);
  }

  // Supervisor-authorized Extra Time / OT:
  // - no OT merely by presence/time after duty end
  // - OT starts at explicit activation timestamp and ends at actual clock-out (or now if open)
  // - no approval gate/workflow; authorized activated OT is payable under configured multiplier
  // - time before activation and pre-duty early clock-in minutes are not payable
  const activatedAtRaw = (session as any).overtimeActivatedAt;
  const activatedAtMs = activatedAtRaw ? toMs(activatedAtRaw) : NaN;
  const hasActivatedOT = Number.isFinite(activatedAtMs) && activatedAtMs >= schedEnd && timeOutMs > activatedAtMs;
  const storedOT = typeof session.overtimeMinutes === "number" ? Math.max(0, session.overtimeMinutes) : null;
  let overtimeMin: number;
  let payableOvertimeMin: number;
  if (hasActivatedOT) {
    // Duration from activation timestamp to actual manual clock-out (authoritative OT interval).
    const otStart = Math.max(activatedAtMs, schedEnd);
    let ot = Math.max(0, (timeOutMs - otStart) / 60000);
    // Apply existing break deductions within OT interval for unpaid breaks (server stores final overtimeMinutes on close; keep client/live calc consistent).
    for (const b of breaks) {
      if (b.type !== "unpaid" || !b.start) continue;
      const bStart = toMs(b.start);
      const bEnd = b.end ? toMs(b.end) : timeOutMs;
      const overlap = Math.max(0, Math.min(bEnd, timeOutMs) - Math.max(bStart, otStart));
      ot -= overlap / 60000;
    }
    overtimeMin = Math.max(0, storedOT ?? ot);
    payableOvertimeMin = overtimeMin;
  } else if (Number.isFinite(activatedAtMs) && activatedAtMs >= schedEnd && !session.timeOut) {
    // Running (open) authorized OT: elapsed for visibility only when reliably computable from server-provided activation timestamp.
    const runningOt = Math.max(0, (now - Math.max(activatedAtMs, schedEnd)) / 60000);
    overtimeMin = Math.max(0, storedOT ?? runningOt);
    payableOvertimeMin = 0; // not payable until actual clock-out finalizes duration
  } else {
    // Closed session without supervisor-activated OT: no payable OT (no presence-based OT, no approval workflow).
    // Preserve any stored minutes for display/audit only; payable remains 0.
    overtimeMin = Math.max(0, storedOT ?? 0);
    payableOvertimeMin = 0;
  }

  // Late (from scheduled start)
  const lateMin = timeInMs > schedStart && Math.abs(timeInMs - schedStart) < 12 * 60 * 60000
    ? Math.round((timeInMs - schedStart) / 60000) : 0;

  // Basic payable begins at scheduled duty start (early pre-duty minutes not payable) and ends at scheduled duty end.
  // Time after duty end before activation is not basic and not OT.
  const basicStart = Math.max(timeInMs, schedStart);
  const basicEnd = Math.min(timeOutMs, schedEnd);
  const basicWindowMin = Math.max(0, (basicEnd - basicStart) / 60000);
  const basicMin = basicWindowMin;
  const grossPay = hourlyRate * (basicMin / 60);
  const overBreakDeduction = hourlyRate * (overBreakMin / 60);
  const overtimePay = overtimeRate * (payableOvertimeMin / 60);
  const netPay = grossPay - overBreakDeduction + overtimePay;

  return {
    dutyHours, hourlyRate, overtimeRate,
    grossMin, basicMin, breakMin, overBreakMin, overtimeMin, payableOvertimeMin, extraTimeMin,
    grossPay: payRound(grossPay),
    overBreakDeduction: payRound(overBreakDeduction),
    overtimePay: payRound(overtimePay),
    netPay: payRound(Math.max(0, netPay)),
    mealMin, restMin, unpaidMin,
    paidMealAllow: mealAllow, paidRestAllow: restAllow, totalPaidAllow,
    mealRemaining, restRemaining, poolsExhausted,
    lateMin, isLate: lateMin >= cfgNum(config, "LATE_GRACE_MINUTES", 10),
    shift,
  };
}
