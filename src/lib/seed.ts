import type {
  AuditEntry, BreakEvent, Dataset, Department, Employee, EmpRole, Holiday,
  LeaveBalance, LeaveRequest, OvertimeLog, Payment, Shift, TimeSession,
} from "../types";
import { DEFAULT_CONFIG } from "./config";
import { uid } from "./utils";
import { isoDate, workingDaysBetween } from "./dates";

// ============================================================================
// AttendancePayroll — SYNTHETIC demo data. Never real PII.
// Staff IDs use the KP98XX format; PIN = last 4 of the ID.
// ============================================================================

function shifts(): Shift[] {
  return [
    { id: "SH-FULL", name: "Full Day 9AM–8PM", startTime: "09:00 AM", endTime: "08:00 PM", mealBreakMin: 30, restMin: 15, color: "#6366f1" },
    { id: "SH-MORN", name: "Morning 9AM–4PM", startTime: "09:00 AM", endTime: "04:00 PM", mealBreakMin: 30, restMin: 15, color: "#10b981" },
    { id: "SH-EVEN", name: "Evening 2PM–11PM", startTime: "02:00 PM", endTime: "11:00 PM", mealBreakMin: 30, restMin: 15, color: "#f59e0b" },
    { id: "SH-NIGHT", name: "Night Shift", startTime: "08:00 PM", endTime: "11:00 PM", mealBreakMin: 30, restMin: 15, color: "#8b5cf6" },
  ];
}

function departments(): Department[] {
  return [
    { id: "DEP-PHAR", name: "Pharmacy Counter", costCenter: "CC-100" },
    { id: "DEP-CASH", name: "Cash Counter", costCenter: "CC-200" },
    { id: "DEP-INV", name: "Inventory / Stock", costCenter: "CC-300" },
    { id: "DEP-DEL", name: "Delivery", costCenter: "CC-400" },
    { id: "DEP-MGMT", name: "Management", costCenter: "CC-500" },
  ];
}

interface StaffSeed {
  id: string; name: string; phone: string; email?: string; dept: string; section: string;
  counter: number | null; title: string; join: string; role: EmpRole;
  salary: Employee["salaryType"]; monthly?: number; daily?: number; hourly?: number;
  shiftStart: string; shiftEnd: string; meal?: number; rest?: number; status: Employee["status"];
}

const STAFF_SEED: StaffSeed[] = [
  { id: "KP9820", name: "Rahim Uddin", phone: "+8801711000020", email: "rahim@khanpharma.bd", dept: "Pharmacy Counter", section: "Sales Floor", counter: 1, title: "Supervising Pharmacist", join: "1998-06-10", role: "SUPERVISOR", salary: "Monthly", monthly: 42000, shiftStart: "09:00 AM", shiftEnd: "08:00 PM", status: "Active" },
  { id: "KP9821", name: "Karim Hossain", phone: "+8801711000021", dept: "Pharmacy Counter", section: "Sales Floor", counter: 2, title: "Pharmacist", join: "2010-03-01", role: "STAFF", salary: "Monthly", monthly: 32000, shiftStart: "09:00 AM", shiftEnd: "08:00 PM", status: "On-leave" },
  { id: "KP9822", name: "Salma Begum", phone: "+8801711000022", dept: "Cash Counter", section: "Billing", counter: null, title: "Cashier", join: "2012-01-20", role: "STAFF", salary: "Daily", daily: 1100, shiftStart: "09:00 AM", shiftEnd: "04:00 PM", status: "Active" },
  { id: "KP9823", name: "Jamal Ahmed", phone: "+8801711000023", dept: "Pharmacy Counter", section: "Dispensary", counter: 3, title: "Pharmacy Assistant", join: "2014-11-05", role: "STAFF", salary: "Daily", daily: 950, shiftStart: "02:00 PM", shiftEnd: "11:00 PM", status: "Active" },
  { id: "KP9824", name: "Fatima Akter", phone: "+8801711000024", email: "fatima@khanpharma.bd", dept: "Pharmacy Counter", section: "Dispensary", counter: 4, title: "Pharmacy Assistant", join: "2017-04-18", role: "STAFF", salary: "Hourly", hourly: 95, shiftStart: "09:00 AM", shiftEnd: "04:00 PM", status: "Active" },
  { id: "KP9825", name: "Nahid Hasan", phone: "+8801711000025", dept: "Delivery", section: "Dispatch", counter: null, title: "Delivery Rider", join: "2019-09-01", role: "STAFF", salary: "Daily", daily: 700, shiftStart: "10:00 AM", shiftEnd: "06:00 PM", status: "Active" },
  { id: "KP9826", name: "Rumana Yesmin", phone: "+8801711000026", dept: "Cash Counter", section: "Billing", counter: null, title: "Cashier", join: "2020-06-15", role: "STAFF", salary: "Monthly", monthly: 22000, shiftStart: "02:00 PM", shiftEnd: "11:00 PM", status: "Active" },
  { id: "KP9827", name: "Selim Reza", phone: "+8801711000027", dept: "Pharmacy Counter", section: "Sales Floor", counter: 5, title: "Sales Staff", join: "2021-02-10", role: "STAFF", salary: "Hourly", hourly: 80, shiftStart: "02:00 PM", shiftEnd: "11:00 PM", status: "Active" },
  { id: "KP9828", name: "Anwar Hossain", phone: "+8801711000028", dept: "Inventory / Stock", section: "Store Room", counter: null, title: "Stock In-Charge", join: "2015-10-08", role: "STAFF", salary: "Monthly", monthly: 28000, shiftStart: "09:00 AM", shiftEnd: "06:00 PM", status: "Active" },
  { id: "KP9829", name: "Tasnim Jahan", phone: "+8801711000029", dept: "Pharmacy Counter", section: "Sales Floor", counter: 6, title: "Trainee", join: "2024-01-15", role: "STAFF", salary: "Daily", daily: 600, shiftStart: "09:00 AM", shiftEnd: "04:00 PM", status: "Active" },
];

function buildStaff(): Employee[] {
  return STAFF_SEED.map((s) => ({
    recordId: uid("REC"),
    employeeId: s.id,
    username: s.id.toLowerCase(),          // admin-assigned (e.g. kp9820)
    password: s.id.slice(-4),              // admin-assigned (e.g. 9820)
    fullName: s.name,
    email: s.email ?? "",
    phone: s.phone,
    department: s.dept,
    jobTitle: s.title,
    section: s.section,
    counter: s.counter,
    joinDate: s.join,
    endDate: null,
    role: s.role,
    salaryType: s.salary,
    baseSalary: s.monthly ?? 0,
    dailyRate: s.daily ?? 0,
    hourlyRate: s.hourly ?? 0,
    shiftStart: s.shiftStart,
    shiftEnd: s.shiftEnd,
    mealBreakMin: s.meal ?? 30,
    restMin: s.rest ?? 15,
    shiftId: "SH-FULL",
    photoUrl: "",
    status: s.status,
    isActive: true,
    arrears: 0,
    advance: 0,
  }));
}

function holidays(): Holiday[] {
  const y = new Date().getFullYear();
  return [
    { id: uid("HOL"), date: `${y}-02-21`, name: "Mother Language Day", type: "National" },
    { id: uid("HOL"), date: `${y}-03-26`, name: "Independence Day", type: "National" },
    { id: uid("HOL"), date: `${y}-05-01`, name: "May Day", type: "National" },
    { id: uid("HOL"), date: `${y}-12-16`, name: "Victory Day", type: "National" },
  ];
}

const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => iso(new Date(Date.now() - m * 60000));
const hoursAgo = (h: number) => iso(new Date(Date.now() - h * 3600000));
const inHours = (h: number) => iso(new Date(Date.now() + h * 3600000));

// Live sessions today in varied states.
function buildSessions(): TimeSession[] {
  const dateISO = isoDate(new Date());
  const mk = (staffId: string, timeInISO: string, breaks: BreakEvent[], timeOutISO: string | null, completed = false): TimeSession =>
    ({ id: uid("SES"), staffId, date: dateISO, timeIn: timeInISO, timeOut: timeOutISO, breaks, extraTime: [], goOuts: [], completed });

  /** A completed shift from N days ago with no payment → registers as UNPAID due. */
  const mkUnpaid = (staffId: string, daysAgo: number, hoursWorked: number): TimeSession => {
    const base = Date.now() - daysAgo * 86400000;
    const d = new Date(base); d.setHours(0, 0, 0, 0);
    const dayISO = isoDate(d);
    const timeIn = new Date(d.getTime() + 9 * 3600000);
    const timeOut = new Date(timeIn.getTime() + hoursWorked * 3600000);
    return {
      id: uid("SES"), staffId, date: dayISO,
      timeIn: timeIn.toISOString(), timeOut: timeOut.toISOString(),
      breaks: [], extraTime: [], goOuts: [], completed: true,
    };
  };

  return [
    // Supervisor on duty, no break yet
    mk("KP9820", hoursAgo(3), [], null),
    // Working, took a short paid meal
    mk("KP9822", hoursAgo(5), [{ id: uid("BK"), type: "meal", start: hoursAgo(3), end: minsAgo(152) }], null),
    // Currently ON MEAL (started 12m ago → 18m left)
    mk("KP9823", hoursAgo(6), [{ id: uid("BK"), type: "meal", start: minsAgo(12), end: null }], null),
    // Currently ON REST (6m ago → 9m left)
    mk("KP9824", hoursAgo(4), [{ id: uid("BK"), type: "rest", start: minsAgo(6), end: null }], null),
    // Took 40m meal → 10m over-break (deduction)
    mk("KP9825", hoursAgo(5), [{ id: uid("BK"), type: "meal", start: hoursAgo(3), end: minsAgo(140) }], null),
    // Working
    mk("KP9826", hoursAgo(4), [], null),
    // On meal but OVER (45m ago → 15m over)
    mk("KP9827", hoursAgo(7), [{ id: uid("BK"), type: "meal", start: minsAgo(45), end: null }], null),
    // Working
    mk("KP9828", hoursAgo(3), [], null),
    // KP9829 — active working session so the staff demo user can clock in/out live
    mk("KP9829", hoursAgo(2), [], null),
    // Yesterday's completed-but-UNPAID shifts (demo the dues ledger)
    mkUnpaid("KP9822", 1, 7),
    mkUnpaid("KP9825", 1, 8),
  ];
}

function buildLeave(staff: Employee[], hol: Holiday[]): { requests: LeaveRequest[]; balances: LeaveBalance[] } {
  void staff;
  const requests: LeaveRequest[] = [];
  const year = new Date().getFullYear();
  const m = new Date().getMonth();
  const at = (off: number, day: number) => isoDate(new Date(year, m + off, day));

  const add = (staffId: string, type: LeaveRequest["leaveType"], fromISO: string, span: number, status: LeaveRequest["status"], reason: string) => {
    const toISO = isoDate(new Date(new Date(fromISO).getTime() + (span - 1) * 86400000));
    const days = workingDaysBetween(fromISO, toISO, hol);
    requests.push({
      recordId: uid("LV"), staffId, leaveType: type, fromDate: fromISO, toDate: toISO, days, reason, status,
      approvedBy: status === "Approved" ? "Admin" : null,
      approvedAt: status !== "Pending" ? new Date(year, m, 5).toISOString() : null,
    });
  };

  add("KP9821", "Annual", at(0, 1), 3, "Approved", "Family wedding out of town.");
  add("KP9820", "Casual", at(0, 22), 1, "Pending", "Personal errand.");
  add("KP9826", "Sick", at(-1, 12), 2, "Approved", "Fever, doctor advised rest.");
  add("KP9825", "Casual", at(-1, 25), 1, "Rejected", "Insufficient notice.");

  const balances: LeaveBalance[] = [];
  for (const s of staff.filter((e) => e.isActive)) {
    const used = (type: LeaveRequest["leaveType"]) =>
      requests.filter((r) => r.staffId === s.employeeId && r.leaveType === type && r.status === "Approved" && new Date(r.fromDate).getFullYear() === year)
        .reduce((sum, r) => sum + r.days, 0);
    balances.push({ staffId: s.employeeId, leaveType: "Annual", entitledDays: 20, usedDays: used("Annual"), year });
    balances.push({ staffId: s.employeeId, leaveType: "Sick", entitledDays: 14, usedDays: used("Sick"), year });
    balances.push({ staffId: s.employeeId, leaveType: "Casual", entitledDays: 10, usedDays: used("Casual"), year });
  }
  return { requests, balances };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function buildPaymentsAndOvertime(staff: Employee[]): { payments: Payment[]; overtime: OvertimeLog[] } {
  const payments: Payment[] = [];
  const overtime: OvertimeLog[] = [];
  const y = isoDate(new Date(Date.now() - 86400000));
  const samples = [
    { sid: "KP9822", worked: 7, brk: 45, over: 0, ot: 0 },
    { sid: "KP9823", worked: 9, brk: 60, over: 15, ot: 60 },
    { sid: "KP9824", worked: 7, brk: 45, over: 0, ot: 0 },
    { sid: "KP9825", worked: 8, brk: 30, over: 0, ot: 30 },
  ];
  for (const x of samples) {
    const s = staff.find((e) => e.employeeId === x.sid)!;
    // crude rate proxy for historical samples
    const rate = s.salaryType === "Hourly" ? s.hourlyRate : s.salaryType === "Daily" ? s.dailyRate / 8 : s.baseSalary / 30 / 8;
    const grossMin = x.worked * 60;
    const gross = rate * (grossMin / 60);
    const ded = rate * (x.over / 60);
    const otPay = rate * 1.25 * (x.ot / 60);
    payments.push({
      id: uid("PAY"), staffId: s.employeeId, sessionId: uid("SES"), date: y,
      paidAt: new Date(y).toISOString(),
      periodLabel: `${new Date(y).getDate()} ${MONTHS[new Date(y).getMonth()]} · Day`,
      dutyHours: 8, workedMin: grossMin, breakMin: x.brk, overBreakMin: x.over,
      overtimeMin: x.ot, overtimePay: Math.round(otPay * 100) / 100, hourlyRate: rate,
      grossPay: Math.round(gross * 100) / 100, overBreakDeduction: Math.round(ded * 100) / 100,
      netPay: Math.round((gross - ded + otPay) * 100) / 100, status: "Paid", paidBy: "Supervisor",
    });
    if (x.ot > 0) {
      overtime.push({
        id: uid("OT"), staffId: s.employeeId, date: y,
        shiftEnd: iso(new Date(new Date(y).getTime())),
        clockOut: iso(new Date(new Date(y).getTime() + x.ot * 60000)),
        overtimeMin: x.ot, hourlyRate: Math.round(rate * 100) / 100,
        amount: Math.round(otPay * 100) / 100,
      });
    }
  }
  return { payments, overtime };
}

function buildAudit(): AuditEntry[] {
  const mk = (action: string, entity: string, id: string, name: string, role: AuditEntry["actorRole"], summary: string): AuditEntry =>
    ({ logId: uid("LOG"), timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(), action, entityType: entity, entityId: id, actorName: name, actorRole: role, summary });
  return [
    mk("PAYMENT", "Payment", "KP9822", "Supervisor", "SUPERVISOR", "Paid ৳1023.50 to Salma Begum."),
    mk("CLOCK_IN", "Session", "KP9820", "Rahim Uddin", "SUPERVISOR", "Clocked in for the day."),
    mk("CREATE", "Staff", "KP9829", "Admin", "ADMIN", "Added staff Tasnim Jahan (KP9829)."),
    mk("LEAVE_APPROVE", "Leave", "KP9821", "Admin", "ADMIN", "Approved Annual leave for Karim Hossain."),
  ];
}

export function createSeedData(): Dataset {
  const sh = shifts();
  const deps = departments();
  const staff = buildStaff();
  const hol = holidays();
  const sessions = buildSessions();
  const { requests, balances } = buildLeave(staff, hol);
  const { payments, overtime } = buildPaymentsAndOvertime(staff);
  const auditLog = buildAudit();

  return {
    staff, departments: deps, shifts: sh, sessions, payments, overtimeLogs: overtime,
    leaveRequests: requests, leaveBalances: balances, holidays: hol, auditLog,
    approvalRequests: [],
    config: DEFAULT_CONFIG.map((c) => ({ ...c })),
  };
}

// referenced to keep exports stable for sheets.ts typing
void inHours;
