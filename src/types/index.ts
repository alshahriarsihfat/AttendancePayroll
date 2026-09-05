// ============================================================================
// Khan Pharmacy — Domain Types
// Custom shifts (9AM–11PM window), 9 counters, KP98 staff IDs,
// role-per-employee (Supervisor is also a clocking employee), overtime log.
// ============================================================================

/** Session roles. Supervisor & Staff are both real employees (they clock in). */
export type Role = "ADMIN" | "SUPERVISOR" | "STAFF";
export type EmpRole = "STAFF" | "SUPERVISOR";

export type SalaryType = "Daily" | "Weekly" | "Monthly" | "Hourly";
export type EmployeeStatus = "Active" | "On-leave" | "Terminated";
export type LeaveType =
  | "Annual" | "Sick" | "Casual" | "Maternity" | "Paternity" | "Unpaid";
export type LeaveStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";
export type PaymentStatus = "Paid" | "Pending" | "UNPAID";

/** Live Floor statuses — primary states (+ idle). */
export type ClockStatus =
  | "off"            // not clocked in today
  | "working"        // ON_DUTY
  | "on-meal"        // ON_BREAK (meal)
  | "on-rest"        // ON_BREAK (rest)
  | "on-unpaid"      // ON_UNPAID_BREAK (immediate deduction, bypasses pools)
  | "on-goout"       // ON_PAID_GO_OUT (field work, no deduction)
  | "completed"      // clocked out
  | "on-leave";      // ON_LEAVE today

export type BreakType = "meal" | "rest" | "unpaid" | "goout";

export interface Employee {
  recordId: string;
  employeeId: string;     // KP98XX internal record id (e.g. KP9820).
  username: string;       // login username (admin-assigned).
  password: string;       // login password (admin-assigned).
  fullName: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;       // Designation
  section: string;        // Section
  counter: number | null; // 1–9 (Pharmacy Counter dept only)
  joinDate: string;
  endDate?: string | null;
  role: EmpRole;          // SUPERVISOR or STAFF
  salaryType: SalaryType; // tracked internally; hidden from staff role
  baseSalary: number;     // monthly BDT
  dailyRate: number;      // BDT/day
  hourlyRate: number;     // BDT/hour
  // Custom shift (per employee)
  shiftStart: string;     // "09:00 AM"
  shiftEnd: string;       // "08:00 PM"
  mealBreakMin: number;   // paid meal allowance
  restMin: number;        // paid rest allowance
  shiftId: string;        // template id (quick pick)
  photoUrl: string;       // Google Drive link or URL
  status: EmployeeStatus;
  isActive: boolean;
  /** Accumulated unpaid daily-wage arrears (BDT) payable in future cycles. */
  arrears: number;
  /** Outstanding advance (অগ্রিম) already paid out — auto-deducted from the next payout. */
  advance: number;
}

export interface Department {
  id: string;
  name: string;
  costCenter: string;
}

/** Quick-pick shift templates that fill an employee's custom shift. */
export interface Shift {
  id: string;
  name: string;
  startTime: string;   // "09:00 AM"
  endTime: string;     // "11:00 PM"
  mealBreakMin: number;
  restMin: number;
  color: string;
}

export interface BreakEvent {
  id: string;
  type: BreakType;
  start: string;
  end: string | null;
}

/** Paid Go-Out event (field work / customer service — no deduction). */
export interface GoOutEvent {
  id: string;
  start: string;
  end: string | null;
  reason: string;       // customer name / work description
  estimatedMin: number; // estimated time out
}

export interface TimeSession {
  id: string;
  staffId: string;
  date: string;
  timeIn: string;
  timeOut: string | null;
  breaks: BreakEvent[];
  /** Manual "Extra Time" toggle segments — routed to the overtime queue. */
  extraTime: BreakEvent[];
  /** Paid Go-Out events (field work — no deduction). */
  goOuts: GoOutEvent[];
  completed: boolean;
  /** True if the system auto-clocked-out this session. */
  autoClockedOut?: boolean;
}

export interface OvertimeLog {
  id: string;
  staffId: string;
  date: string;
  shiftEnd: string;     // scheduled shift end (ISO)
  clockOut: string;     // actual clock-out (ISO)
  overtimeMin: number;
  hourlyRate: number;   // prorated basic hourly rate
  amount: number;
}

export interface Payment {
  id: string;
  staffId: string;
  sessionId: string;
  date: string;
  /** Exact ISO datetime the cash flow occurred (never backdated). */
  paidAt: string;
  periodLabel: string;
  dutyHours: number;
  workedMin: number;
  breakMin: number;
  overBreakMin: number;
  overtimeMin: number;
  overtimePay: number;
  hourlyRate: number;
  grossPay: number;
  overBreakDeduction: number;
  netPay: number;
  status: PaymentStatus;
  paidBy: string;
}

export interface LeaveRequest {
  recordId: string;
  staffId: string;
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  comment?: string;
}

export interface LeaveBalance {
  staffId: string;
  leaveType: LeaveType;
  entitledDays: number;
  usedDays: number;
  year: number;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  type: string;
}

export interface AuditEntry {
  logId: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string;
  actorRole: Role;
  summary: string;
}

export interface ConfigEntry {
  key: string;
  value: string;
  description: string;
  category: string;
}

export interface TaxSlab {
  from: number;
  to: number | null;
  rate: number;
}

/** Manager approval types for exceptions (late, early exit, break overrun). */
export type ApprovalType = "late" | "early_exit" | "break_overrun";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  staffId: string;
  sessionId: string;
  type: ApprovalType;
  deltaMin: number;        // minutes late / early / over-break
  date: string;
  status: ApprovalStatus;
  managerNote?: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
}

export interface Dataset {
  staff: Employee[];
  departments: Department[];
  shifts: Shift[];
  sessions: TimeSession[];
  payments: Payment[];
  overtimeLogs: OvertimeLog[];
  leaveRequests: LeaveRequest[];
  leaveBalances: LeaveBalance[];
  holidays: Holiday[];
  approvalRequests: ApprovalRequest[];
  auditLog: AuditEntry[];
  config: ConfigEntry[];
}

export interface Session {
  role: Role;
  staffId?: string | null;
  name: string;
  loginAt: string;
}
