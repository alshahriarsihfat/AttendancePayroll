import type {
  BreakType, ClockStatus, ConfigEntry, Employee, TimeSession,
} from "../types";
import { configNumber, configValue } from "./config";
import { minutesBetween } from "./dates";
import { payRound } from "./currency";

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
export function hourlyRateFor(staff: Pick<Employee, "salaryType" | "hourlyRate" | "dailyRate" | "baseSalary">, shift: EmpShift): number {
  const duty = shift.regularHours || 8;
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
  const dhakaDateStr = d.toLocaleDateString("en-US", { timeZone: "Asia/Dhaka" });
  const localDay = new Date(dhakaDateStr);
  
  const timeInMinutes = d.getHours() * 60 + d.getMinutes();
  const dayOffset = (boundaryMin < timeInMinutes && Math.abs(boundaryMin - timeInMinutes) > 12 * 60) ? 24 * 60 : 0;
  return localDay.getTime() + (boundaryMin + dayOffset) * 60000;
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
  const shift = empShift(staff);
  const mealAllow = staff.mealBreakMin || configNumber(config, "MEAL_BREAK_MINUTES", 30);
  const restAllow = staff.restMin || configNumber(config, "REST_BREAK_MINUTES", 15);
  const otMult = configNumber(config, "OVERTIME_MULTIPLIER", 1.25);
  const rate = hourlyRateFor(staff, shift);
  const overtimeRate = rate * otMult;

  if (!session) {
    return {
      clockStatus: "off", grossMin: 0, breakMin: 0, mealMin: 0, restMin: 0, unpaidMin: 0,
      paidMealAllow: mealAllow, paidRestAllow: restAllow, totalPaidAllow: mealAllow + restAllow,
      mealRemaining: mealAllow, restRemaining: restAllow, poolsExhausted: false,
      overBreakMin: 0, overtimeMin: 0,
      hourlyRate: rate, overtimeRate, grossPay: 0, overBreakDeduction: 0, overtimePay: 0, netPay: 0,
      breakRemainingSec: 0, isOngoing: false, lateMin: 0, isLate: false,
      extraTimeMin: 0, extraTimeActive: false,
      goOutMin: 0, activeGoOutReason: null, activeElapsedSec: 0,
    };
  }

  const endMs = session.timeOut ? new Date(session.timeOut).getTime() : now;
  const grossMin = Math.max(0, minutesBetween(session.timeIn, new Date(endMs).toISOString()));
  const bt = breakTotals(session, now);

  // ---- Dual-pool break engine ---------------------------------------------
  const totalPaidAllow = mealAllow + restAllow;
  const totalPaidBreaks = bt.mealMin + bt.restMin;       
  const poolOverrun = Math.max(0, totalPaidBreaks - totalPaidAllow); 
  const overBreakMin = poolOverrun + bt.unpaidMin;        
  const poolsExhausted = totalPaidBreaks >= totalPaidAllow;

  const mealOver = Math.max(0, bt.mealMin - mealAllow);
  const mealRemaining = Math.max(0, mealAllow - bt.mealMin);
  const restRemaining = Math.max(0, restAllow - bt.restMin - mealOver);

  // Overtime calculation with safe guard against pre-shift overtime
  const schedEnd = scheduledBoundary(session.timeIn, shift.endMin);
  const schedStart = scheduledBoundary(session.timeIn, shift.startMin);
  const timeInMs = new Date(session.timeIn).getTime();
  
  const autoOvertimeMin = endMs > schedEnd && endMs > timeInMs ? Math.round((endMs - schedEnd) / 60000) : 0;

  // Manual "Extra Time" segments
  let extraTimeMin = 0, extraTimeActive = false;
  for (const et of session.extraTime ?? []) {
    const endISO = et.end ?? new Date(now).toISOString();
    extraTimeMin += minutesBetween(et.start, endISO);
    if (!et.end) extraTimeActive = true;
  }
  const overtimeMin = autoOvertimeMin + extraTimeMin;

  // Late detection vs shift start
  const lateMin = timeInMs > schedStart && Math.abs(timeInMs - schedStart) < 12 * 60 * 60000
    ? Math.round((timeInMs - schedStart) / 60000) : 0;

  // Pay calculation
  const basicMin = Math.max(0, grossMin - overtimeMin);
  const grossPay = rate * (basicMin / 60);
  const overBreakDeduction = rate * (overBreakMin / 60);
  const overtimePay = overtimeRate * (overtimeMin / 60);
  const netPay = grossPay - overBreakDeduction + overtimePay;

  // ---- Paid Go-Out (field work) -------------------------------------------
  let goOutMin = 0, activeGoOutReason: string | null = null, activeGoOutStart: number | null = null;
  for (const g of session.goOuts ?? []) {
    const endISO = g.end ?? new Date(now).toISOString();
    goOutMin += minutesBetween(g.start, endISO);
    if (!g.end) { activeGoOutReason = g.reason; activeGoOutStart = new Date(g.start).getTime(); }
  }

  // Active break countdown
  let breakRemainingSec = 0;
  let activeElapsedSec = 0;
  if (bt.activeBreak) {
    activeElapsedSec = Math.max(0, (now - new Date(bt.activeBreak.start).getTime()) / 1000);
    if (bt.activeBreak.type === "unpaid") {
      breakRemainingSec = -activeElapsedSec; 
    } else {
      breakRemainingSec = (totalPaidAllow - totalPaidBreaks) * 60;
    }
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
    grossMin,
    breakMin: bt.breakMin,
    mealMin: bt.mealMin,
    restMin: bt.restMin,
    unpaidMin: bt.unpaidMin,
    paidMealAllow: mealAllow,
    paidRestAllow: restAllow,
    totalPaidAllow,
    mealRemaining,
    restRemaining,
    poolsExhausted,
    overBreakMin,
    overtimeMin,
    hourlyRate: rate,
    overtimeRate,
    grossPay: payRound(grossPay),
    overBreakDeduction: payRound(overBreakDeduction),
    overtimePay: payRound(overtimePay),
    netPay: payRound(Math.max(0, netPay)),
    breakRemainingSec,
    isOngoing: !session.timeOut,
    lateMin,
    isLate: lateMin >= configNumber(config, "LATE_GRACE_MINUTES", 10),
    extraTimeMin,
    extraTimeActive,
    goOutMin,
    activeGoOutReason,
    activeElapsedSec,
  };
}

/** Next scheduled shift start (ms) — today if not yet started, else tomorrow. */
export function nextShiftAt(startMin: number, fromMs: number = Date.now()): number {
  const day = new Date(fromMs);
  day.setHours(0, 0, 0, 0);
  const todayStart = day.getTime() + startMin * 60000;
  return todayStart > fromMs ? todayStart : todayStart + 24 * 3600_000;
}

/** Safe timezone-aware lookup matching Dhaka local business dates */
export function sessionFor(sessions: TimeSession[], staffId: string, dateISO?: string): TimeSession | undefined {
  if (dateISO) {
    return sessions.find((s) => s.staffId === staffId && s.date === dateISO);
  }
  const dhakaStr = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Dhaka" });
  const d = new Date(dhakaStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const targetDate = `${yyyy}-${mm}-${dd}`;
  
  return sessions.find((s) => s.staffId === staffId && (s.date === targetDate || !s.completed));
}
