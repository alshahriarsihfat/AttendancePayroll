import type {
  BreakType, ClockStatus, ConfigEntry, Employee, TimeSession,
} from "../types";
import { configNumber, configValue } from "./config";
import { minutesBetween } from "./dates";
import { payRound } from "./currency";
import { computeCanonical } from "./payroll-session";

// ============================================================================
// Time-clock calculation engine — DETERMINISTIC & auditable.
// Uses each employee's CUSTOM shift (shiftStart/shiftEnd + paid breaks).
//
// Pay model (any salary type reduces to an hourly rate):
//   • Hourly staff  → staff.hourlyRate
//   • Daily staff   → dailyRate ÷ dutyHours
//   • Monthly staff → baseSalary ÷ 30 ÷ dutyHours
//
// Breaks: first MEAL + REST allowances are PAID; beyond = over-break (deducted).
// Overtime: time worked past shiftEnd is paid at basic rate × OVERTIME_MULTIPLIER.
// ============================================================================

/** Parse "09:00 AM" → minutes from midnight. */
export function parseTime12(time: string): number {
  const m = time.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

/** The live floor accepts clock actions throughout the operating window (Dhaka context). */
export function isWithinOperatingWindow(date: Date = new Date(), config: ConfigEntry[] = []): boolean {
  const dhakaStr = date.toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour12: false });
  const [h, m] = dhakaStr.split(":").map(Number);
  const minutes = h * 60 + m;

  const open = parseTime12(configValue(config, "FLOOR_OPEN_TIME", "09:00 AM"));
  const close = parseTime12(configValue(config, "FLOOR_CLOSE_TIME", "11:00 PM"));
  
  return open <= close
    ? minutes >= open && minutes <= close
    : minutes >= open || minutes <= close;
}

/** Get current time in Asia/Dhaka as minutes from midnight (0-1440). */
export function getDhakaMinutes(date: Date = new Date()): number {
  const dhakaStr = date.toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour12: false });
  const [h, m] = dhakaStr.split(":").map(Number);
  return h * 60 + m;
}

/** Check if current time is within an individual's shift window (with early check-in grace). */
export function isWithinIndividualShiftWindow(
  date: Date = new Date(),
  shift: EmpShift,
  config: ConfigEntry[] = []
): boolean {
  const minutes = getDhakaMinutes(date);
  const earlyCheckinMin = configNumber(config, "EARLY_CHECKIN_MINUTES", 5);
  // Early clock-in allowed up to exactly configured grace before scheduled Duty Start.
  // Pre-duty minutes are not payable (canonical payroll calc enforces payable start at scheduled Duty Start).
  const shiftStartWithGrace = shift.startMin - earlyCheckinMin;

  // Overnight shift: endMin < startMin (e.g., 22:00 to 06:00 means 1320 to 360)
  if (shiftStartWithGrace <= shift.endMin) {
    return minutes >= shiftStartWithGrace && minutes <= shift.endMin;
  }
  return minutes >= shiftStartWithGrace || minutes <= shift.endMin;
}

/** An employee's resolved shift params. */
export interface EmpShift {
  startMin: number;       // minutes from midnight
  endMin: number;
  regularHours: number;   // (end − start), handles overnight wrap
  mealBreakMin: number;
  restMin: number;
  startTime: string;
  endTime: string;
}

export function empShift(emp: Pick<Employee, "shiftStart" | "shiftEnd" | "mealBreakMin" | "restMin">): EmpShift {
  const startMin = parseTime12(emp.shiftStart || "09:00 AM");
  const endMin = parseTime12(emp.shiftEnd || "08:00 PM");
  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60; // overnight shift wrap
  return {
    startMin, endMin, regularHours: payRound(diff / 60, 2),
    mealBreakMin: emp.mealBreakMin ?? 30, restMin: emp.restMin ?? 15,
    startTime: emp.shiftStart || "09:00 AM", endTime: emp.shiftEnd || "08:00 PM",
  };
}

/** Resolve a staff member's effective basic hourly BDT rate. */
export function hourlyRateFor(staff: Pick<Employee, "salaryType" | "hourlyRate" | "dailyRate" | "baseSalary" | "dailyDutyHours">, shift: EmpShift): number {
  const duty = staff.dailyDutyHours && staff.dailyDutyHours > 0 ? staff.dailyDutyHours : (shift.regularHours || 8);
  switch (staff.salaryType) {
    case "Hourly": return staff.hourlyRate || 0;
    case "Daily": return (staff.dailyRate || 0) / duty;
    case "Weekly": return (staff.baseSalary || 0) / 7 / duty;
    case "Monthly": return (staff.baseSalary || 0) / 30 / duty;
    default: return 0;
  }
}

/** Datetime (ms) of the scheduled shift start/end on a given clock-in day. */
export function scheduledBoundary(timeInISO: string, boundaryMin: number): number {
  const d = new Date(timeInISO);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const localDay = new Date(`${value.year}-${value.month}-${value.day}T00:00:00+06:00`);
  const timeInMinutes = Number(value.hour) * 60 + Number(value.minute);
  const dayOffset = (boundaryMin < timeInMinutes && Math.abs(boundaryMin - timeInMinutes) > 12 * 60) ? 24 * 60 : 0;
  return localDay.getTime() + (boundaryMin + dayOffset) * 60000;
}

/** True when a session carries its own shift snapshot captured at clock-in. */
export function hasShiftSnapshot(session: TimeSession | undefined): boolean {
  return !!session && Number.isInteger(session.shiftStartMin) && Number.isInteger(session.shiftEndMin);
}

/** The shift PARAMETERS to judge a specific session by. Prefers the snapshotted
 *  shift recorded when the session was created (historical fidelity — a past
 *  session stays judged against the shift that was active then, even after the
 *  employee's shift is later edited). Falls back to the LIVE assignment only
 *  for brand-new/in-progress sessions that have no snapshot yet. */
export function shiftForSession(
  staff: Pick<Employee, "shiftStart" | "shiftEnd" | "mealBreakMin" | "restMin">,
  session: TimeSession | undefined
): EmpShift {
  const live = empShift(staff);
  if (!hasShiftSnapshot(session)) return live;
  const startMin = session!.shiftStartMin as number;
  const endMin = session!.shiftEndMin as number;
  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60; // overnight wrap
  return {
    startMin, endMin, regularHours: payRound(diff / 60, 2),
    mealBreakMin: live.mealBreakMin, restMin: live.restMin,
    startTime: session!.shiftStartTime || live.startTime,
    endTime: session!.shiftEndTime || live.endTime,
  };
}

/** Shift-aware scheduled start/end (ms) for a clock-in instant.
 *  For an overnight shift (endMin < startMin) the shift START belongs to the
 *  PREVIOUS evening — a 3:22 AM clock-in on an 3PM–4AM shift must be judged
 *  against yesterday's 3:00 PM start, never the same-day (future) 3 PM.
 *  Replaces the single-boundary `scheduledBoundary()` guesses everywhere
 *  sessions are evaluated (the old helper is kept for legacy server callers). */
export function scheduledShiftBounds(
  timeInISO: string,
  shift: Pick<EmpShift, "startMin" | "endMin">
): { start: number; end: number } {
  const d = new Date(timeInISO);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const value = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const dhakaMidnight = (dayOffset: number) =>
    new Date(`${value.year}-${value.month}-${value.day}T00:00:00+06:00`).getTime() + dayOffset * 24 * 60 * 60000;
  const timeInMinutes = Number(value.hour) * 60 + Number(value.minute);
  const { startMin, endMin } = shift;
  const overnight = endMin < startMin;
  if (!overnight) return { start: dhakaMidnight(0) + startMin * 60000, end: dhakaMidnight(0) + endMin * 60000 };
  if (timeInMinutes <= endMin) return { start: dhakaMidnight(-1) + startMin * 60000, end: dhakaMidnight(0) + endMin * 60000 };
  return { start: dhakaMidnight(0) + startMin * 60000, end: dhakaMidnight(1) + endMin * 60000 };
}

export interface BreakTotals {
  mealMin: number;
  restMin: number;
  unpaidMin: number;        // unpaid break time (immediate deduction)
  breakMin: number;         // meal + rest + unpaid
  activeBreak?: { type: BreakType; start: string } | null;
}

export function breakTotals(session: TimeSession, now: number): BreakTotals {
  let mealMin = 0, restMin = 0, unpaidMin = 0;
  let activeBreak: BreakTotals["activeBreak"] = null;
  for (const b of session.breaks) {
    const endISO = b.end ?? new Date(now).toISOString();
    const m = minutesBetween(b.start, endISO);
    if (b.type === "meal") mealMin += m;
    else if (b.type === "rest") restMin += m;
    else unpaidMin += m;
    if (!b.end) activeBreak = { type: b.type, start: b.start };
  }
  return { mealMin, restMin, unpaidMin, breakMin: mealMin + restMin + unpaidMin, activeBreak };
}

export interface SessionComputation {
  clockStatus: ClockStatus;
  grossMin: number;        // clocked minutes (timeIn → timeOut|now)
  breakMin: number;        // total break minutes (meal + rest + unpaid)
  mealMin: number;
  restMin: number;
  unpaidMin: number;       // unpaid break minutes (immediate deduction)
  paidMealAllow: number;   // meal pool (30)
  paidRestAllow: number;   // rest pool (15)
  totalPaidAllow: number;  // combined paid ceiling (45)
  mealRemaining: number;   // remaining in meal pool
  restRemaining: number;   // remaining in rest pool (after meal spillover)
  poolsExhausted: boolean; // true when meal+rest hit the 45m ceiling
  overBreakMin: number;    // paid-break overage beyond 45m + unpaid minutes (deducted)
  overtimeMin: number;     // time past shiftEnd (extra pay)
  payableOvertimeMin: number;
  hourlyRate: number;      // basic prorated rate
  overtimeRate: number;    // basic × multiplier
  grossPay: number;        // basic pay (clocked, minus over-break)
  overBreakDeduction: number;
  overtimePay: number;     // extra pay for overtime minutes
  netPay: number;          // grossPay − overBreakDeduction + overtimePay
  breakRemainingSec: number;
  isOngoing: boolean;
  lateMin: number;
  isLate: boolean;
  extraTimeMin: number;
  extraTimeActive: boolean;
  goOutMin: number;
  activeGoOutReason: string | null;
  activeElapsedSec: number;
}

export function computeSession(
  session: TimeSession | undefined,
  staff: Employee,
  config: ConfigEntry[],
  now: number
): SessionComputation {
  const c = computeCanonical({ session, staff, config, now });
  if (!session) {
    return {
      clockStatus: "off", grossMin: 0, breakMin: 0, mealMin: 0, restMin: 0, unpaidMin: 0,
      paidMealAllow: c.paidMealAllow, paidRestAllow: c.paidRestAllow, totalPaidAllow: c.totalPaidAllow,
      mealRemaining: c.mealRemaining, restRemaining: c.restRemaining, poolsExhausted: false,
      overBreakMin: 0, overtimeMin: 0, payableOvertimeMin: 0,
      hourlyRate: c.hourlyRate, overtimeRate: c.overtimeRate, grossPay: 0, overBreakDeduction: 0, overtimePay: 0, netPay: 0,
      breakRemainingSec: 0, isOngoing: false, lateMin: 0, isLate: false,
      extraTimeMin: 0, extraTimeActive: false,
      goOutMin: 0, activeGoOutReason: null, activeElapsedSec: 0,
    };
  }
  const bt = breakTotals(session, now);
  // Go-out
  let goOutMin = 0, activeGoOutReason: string | null = null, activeGoOutStart: number | null = null;
  for (const g of session.goOuts ?? []) {
    const endISO = g.end ?? new Date(now).toISOString();
    goOutMin += minutesBetween(g.start, endISO);
    if (!g.end) { activeGoOutReason = g.reason; activeGoOutStart = new Date(g.start).getTime(); }
  }
  // Active break countdown
  let breakRemainingSec = 0, activeElapsedSec = 0;
  if (bt.activeBreak) {
    activeElapsedSec = Math.max(0, (now - new Date(bt.activeBreak.start).getTime()) / 1000);
    breakRemainingSec = bt.activeBreak.type === "unpaid" ? -activeElapsedSec : (c.totalPaidAllow - (bt.mealMin + bt.restMin)) * 60;
  } else if (activeGoOutStart !== null) {
    activeElapsedSec = Math.max(0, (now - activeGoOutStart) / 1000);
    breakRemainingSec = -activeElapsedSec;
  }
  let clockStatus: ClockStatus;
  if (session.timeOut || session.completed) clockStatus = "completed";
  else if (bt.activeBreak?.type === "meal") clockStatus = "on-meal";
  else if (bt.activeBreak?.type === "rest") clockStatus = "on-rest";
  else if (bt.activeBreak?.type === "unpaid") clockStatus = "on-unpaid";
  else if (activeGoOutStart !== null) clockStatus = "on-goout";
  else clockStatus = "working";
  return {
    clockStatus,
    grossMin: c.grossMin,
    breakMin: bt.breakMin,
    mealMin: bt.mealMin, restMin: bt.restMin, unpaidMin: bt.unpaidMin,
    paidMealAllow: c.paidMealAllow, paidRestAllow: c.paidRestAllow, totalPaidAllow: c.totalPaidAllow,
    mealRemaining: c.mealRemaining, restRemaining: c.restRemaining, poolsExhausted: c.poolsExhausted,
    overBreakMin: c.overBreakMin,
    overtimeMin: c.overtimeMin, payableOvertimeMin: c.payableOvertimeMin,
    hourlyRate: c.hourlyRate, overtimeRate: c.overtimeRate,
    grossPay: c.grossPay, overBreakDeduction: c.overBreakDeduction, overtimePay: c.overtimePay, netPay: c.netPay,
    breakRemainingSec,
    isOngoing: !session.timeOut,
    lateMin: c.lateMin, isLate: c.isLate,
    extraTimeMin: c.extraTimeMin,
    extraTimeActive: (session.extraTime ?? []).some((et) => !et.end),
    goOutMin, activeGoOutReason, activeElapsedSec,
  };
}

/** Next scheduled shift start (ms) — today if not yet started, else tomorrow.
 *  Derives "today" as a Dhaka calendar date (fixed UTC+6, no DST) rather than
 *  the runtime's own local midnight, so this returns the same instant
 *  whether it runs in a Dhaka-timezone browser or on a UTC Vercel server. */
export function nextShiftAt(startMin: number, fromMs: number = Date.now()): number {
  const dhakaDateStr = new Date(fromMs).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }); // "YYYY-MM-DD"
  const dhakaMidnightMs = new Date(`${dhakaDateStr}T00:00:00+06:00`).getTime();
  const todayStart = dhakaMidnightMs + startMin * 60000;
  return todayStart > fromMs ? todayStart : todayStart + 24 * 3600_000;
}

/** Safe timezone-aware lookup matching Dhaka local business dates */
export function dhakaTodayKey(): string {
  // en-CA formats as YYYY-MM-DD directly — no need to re-parse through the
  // local Date constructor (which technically only reliably parses
  // "M/D/YYYY" in V8, not per spec across all JS engines).
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
}

export function sessionFor(sessions: TimeSession[], staffId: string, dateISO?: string): TimeSession | undefined {
  const todayDhaka = dhakaTodayKey();
  if (dateISO) {
    const session = sessions.find((s) => s.staffId === staffId && s.date === dateISO);
    if (session && session.date === todayDhaka) {
      return session;
    }
  }
  return sessions.find((s) => s.staffId === staffId && s.date === todayDhaka);
}