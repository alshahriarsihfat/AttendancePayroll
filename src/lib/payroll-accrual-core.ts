import { payRound } from "./currency";
import { dateKeyInZone, APP_TIMEZONE } from "./dates";
import { computeCanonical, type SessionLike, type StaffLike } from "./payroll-session";

export type AccrualConfig = Parameters<typeof computeCanonical>[0]["config"];
export type AccrualSource = "CLOCK_OUT" | "OVERTIME_DECISION" | "RETRY" | "SYSTEM" | "MANUAL_CLOSE";

export type StaffRow = {
  employeeId: string; fullName?: string; salaryType: string;
  baseSalary?: number | null; dailyRate?: number | null; hourlyRate: number | null;
  dailyDutyHours: number | null; workingDaysPerWeek?: number | null;
  shiftStart?: string; shiftEnd?: string; mealBreakMin?: number; restMin?: number;
};
export type SessionRow = SessionLike & {
  id?: string; staffId?: string; date: Date; completed?: boolean; timeOut: Date | null;
  breaks?: unknown; goOuts?: unknown; extraTime?: unknown;
};

export type AccrualResult = {
  created: boolean;
  skipped?: "EXISTS" | "NOT_COMPLETED" | "NO_TIMEOUT" | "EARNING_LOCKED_SETTLED";
  recovered?: boolean;
  earningId?: string;
  status?: "CALCULATED" | "INCOMPLETE";
  reason?: string | null;
  error?: string;
};

const normType = (t: string) => String(t || "").toUpperCase();
const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function dhakaYMD(d: Date): { y: number; m: number; day: number; key: string } {
  const key = dateKeyInZone(d, APP_TIMEZONE);
  const [y, m, day] = key.split("-").map(Number);
  return { y, m, day, key };
}
export function daysInMonth(y: number, m1: number) { return new Date(Date.UTC(y, m1, 0)).getUTCDate(); }
export function dhakaMidnight(ymd: string) { return new Date(ymd + "T00:00:00+06:00"); }
function addDaysYMD(ymd: string, n: number) {
  const d = dhakaMidnight(ymd); d.setUTCDate(d.getUTCDate() + n); return dateKeyInZone(d, APP_TIMEZONE);
}
function weekdayDhaka(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function weekMonSun(ymd: string) {
  const wd = weekdayDhaka(ymd);
  const deltaToMon = wd === 0 ? -6 : 1 - wd;
  const start = addDaysYMD(ymd, deltaToMon);
  const end = addDaysYMD(start, 6);
  return { start, end, key: "WEEK:" + start };
}

/**
 * Period labels/keys for display/summary grouping only (not earning/payment-cycle engines).
 * Monthly calendar days remain useful metadata; weekly working-days are not a denominator in active earning calc.
 */
export function resolvePeriod(staff: StaffRow, workDate: Date) {
  const { y, m, key: workKey } = dhakaYMD(workDate);
  const type = normType(staff.salaryType);
  if (type === "DAILY") return { kind: "DAILY", key: "DAY:" + workKey, start: dhakaMidnight(workKey), end: new Date(dhakaMidnight(workKey).getTime() + 86400000 - 1), monthlyCalendarDays: null as number | null, weeklyWorkingDays: null as number | null };
  if (type === "WEEKLY") { const w = weekMonSun(workKey); return { kind: "WEEKLY", key: w.key, start: dhakaMidnight(w.start), end: new Date(dhakaMidnight(w.end).getTime() + 86400000 - 1), monthlyCalendarDays: null as number | null, weeklyWorkingDays: null as number | null }; }
  if (type === "MONTHLY") { const last = daysInMonth(y, m); const startKey = y + "-" + String(m).padStart(2, "0") + "-01"; const endKey = y + "-" + String(m).padStart(2, "0") + "-" + String(last).padStart(2, "0"); return { kind: "MONTHLY", key: "MONTH:" + y + "-" + String(m).padStart(2, "0"), start: dhakaMidnight(startKey), end: new Date(dhakaMidnight(endKey).getTime() + 86400000 - 1), monthlyCalendarDays: last, weeklyWorkingDays: null as number | null }; }
  if (type === "HOURLY") return { kind: "HOURLY", key: "DAY:" + workKey, start: dhakaMidnight(workKey), end: new Date(dhakaMidnight(workKey).getTime() + 86400000 - 1), monthlyCalendarDays: null as number | null, weeklyWorkingDays: null as number | null };
  return { kind: type || "UNKNOWN", key: "DAY:" + workKey, start: dhakaMidnight(workKey), end: new Date(dhakaMidnight(workKey).getTime() + 86400000 - 1), monthlyCalendarDays: null as number | null, weeklyWorkingDays: null as number | null };
}

/** Preserve configured amount for snapshot context only; never used to derive active earning. */
function applicableSalary(staff: StaffRow, type: string): number | null {
  if (pos(staff.hourlyRate)) return staff.hourlyRate;
  if (type === "DAILY" && pos(staff.dailyRate)) return staff.dailyRate as number;
  if ((type === "WEEKLY" || type === "MONTHLY") && pos(staff.baseSalary)) return staff.baseSalary as number;
  return null;
}

/**
 * 2C.6.2 approved policy: active earning uses configured hourly rate and daily duty hours only.
 * Earned Salary = Approved Payable Hours × Configured Hourly Rate.
 * No /30, /7, calendar-month, workingDaysPerWeek/baseSalary/dailyRate derivation.
 * Missing required config => explicit INCOMPLETE (no shift-duration/8h fallback).
 */
export function deriveHourlyRate(staff: StaffRow, session: SessionRow, _period: ReturnType<typeof resolvePeriod>): { hourlyRate: number | null; dutyHours: number | null; reason: string | null } {
  const duty = pos(session.dailyDutyHoursSnapshot) ? session.dailyDutyHoursSnapshot : (pos(staff.dailyDutyHours) ? staff.dailyDutyHours : null);
  if (!pos(staff.hourlyRate)) return { hourlyRate: null, dutyHours: duty, reason: "MISSING_HOURLY_RATE" };
  if (!pos(duty)) return { hourlyRate: null, dutyHours: null, reason: "MISSING_DAILY_DUTY_HOURS" };
  return { hourlyRate: staff.hourlyRate, dutyHours: duty, reason: null };
}

export function computeAccrual(staff: StaffRow, session: SessionRow, config: AccrualConfig) {
  const period = resolvePeriod(staff, session.date);
  const { hourlyRate: policyRate, dutyHours, reason } = deriveHourlyRate(staff, session, period);
  if (!pos(policyRate) || reason) {
    return { status: "INCOMPLETE" as const, reason: reason || "INCOMPLETE_CONFIGURATION", period, dutyHours, hourlyRate: policyRate, payout: null, applicableSalary: applicableSalary(staff, normType(staff.salaryType)), idempotencyKey: "accrual:session:" + (session.id ?? "unknown") };
  }
  // Pass configured hourly rate as authoritative; duty hours explicit (no 8h/shift fallback in active earning path).
  const canonicalSession: SessionLike = { ...(session as any), hourlyRateSnapshot: policyRate, dailyDutyHoursSnapshot: dutyHours };
  const canonicalStaff: StaffLike & { workingDaysPerWeek?: number | null } = { salaryType: staff.salaryType, hourlyRate: staff.hourlyRate ?? 0, dailyRate: 0, baseSalary: 0, dailyDutyHours: dutyHours ?? undefined, shiftStart: staff.shiftStart, shiftEnd: staff.shiftEnd, mealBreakMin: staff.mealBreakMin, restMin: staff.restMin };
  const nowMs = session.timeOut ? (session.timeOut instanceof Date ? session.timeOut.getTime() : new Date(session.timeOut as any).getTime()) : Date.now();
  const payout = computeCanonical({ session: canonicalSession, staff: canonicalStaff as any, config, now: nowMs });
  const snap = {
    payrollSalaryType: normType(staff.salaryType),
    payrollApplicableSalary: applicableSalary(staff, normType(staff.salaryType)),
    payrollPeriodKind: period.kind, payrollPeriodKey: period.key, payrollPeriodStart: period.start, payrollPeriodEnd: period.end,
    weeklyWorkingDaysSnapshot: period.weeklyWorkingDays, weeklyScheduledHoursSnapshot: null as number | null,
    monthlyCalendarDaysSnapshot: period.monthlyCalendarDays, monthlyScheduledHoursSnapshot: period.monthlyCalendarDays && pos(dutyHours) ? period.monthlyCalendarDays * dutyHours : null,
    scheduledDutyHoursSnapshot: dutyHours, payableHoursSnapshot: payRound(payout.basicMin / 60, 4), payableMinutesSnapshot: Math.round(payout.basicMin),
    grossEarningSnapshot: payout.grossPay, overtimeEarningSnapshot: payout.overtimePay, deductionSnapshot: payout.overBreakDeduction, netEarningSnapshot: payout.netPay,
    payrollCalculationStatus: "CALCULATED" as const, payrollIncompleteReason: null,
    dailyDutyHoursSnapshot: dutyHours,
    hourlyRateSnapshot: payout.hourlyRate,
  };
  return { status: "CALCULATED" as const, reason: null, period, dutyHours, hourlyRate: policyRate, payout, applicableSalary: applicableSalary(staff, normType(staff.salaryType)), idempotencyKey: "accrual:session:" + (session.id ?? "unknown"), sessionSnap: snap };
}
