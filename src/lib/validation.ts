import type { Employee } from "../types";

// ============================================================================
// Validation — guards before any write. Bad input is rejected with a clear
// field-level message.
// ============================================================================

export const isEmployeeId = (s: string): boolean => /^KP98\d{2}$/.test(s.trim());
export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
export const isPhone = (s: string): boolean => /^[\d+\-\s()]{6,}$/.test(s.trim());
export const isNonEmpty = (s: string): boolean => s.trim().length > 0;
export const isPositive = (n: number): boolean => Number.isFinite(n) && n >= 0;
export const isISODate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export interface FieldError { field: string; message: string; }

export function validateStaff(
  s: Partial<Employee>,
  opts: { existingIds?: string[]; existingUsernames?: string[]; selfUsername?: string } = {}
): FieldError[] {
  const errors: FieldError[] = [];
  if (!s.fullName || !isNonEmpty(s.fullName)) errors.push({ field: "fullName", message: "Full name is required." });
  if (!s.employeeId || !isEmployeeId(s.employeeId || "")) errors.push({ field: "employeeId", message: "ID must be KP98 + 2 digits (e.g. KP9820)." });
  // Manual credentials
  if (!s.username || !isNonEmpty(s.username)) errors.push({ field: "username", message: "Username is required." });
  if (!s.password || !isNonEmpty(s.password)) errors.push({ field: "password", message: "Password is required." });
  if (s.email && !isEmail(s.email)) errors.push({ field: "email", message: "Enter a valid email or leave blank." });
  if (!s.phone || !isPhone(s.phone || "")) errors.push({ field: "phone", message: "A valid phone is required." });
  if (!s.department) errors.push({ field: "department", message: "Department is required." });
  if (!s.jobTitle || !isNonEmpty(s.jobTitle || "")) errors.push({ field: "jobTitle", message: "Designation is required." });
  if (!s.joinDate || !isISODate(s.joinDate || "")) errors.push({ field: "joinDate", message: "Join date is required (YYYY-MM-DD)." });
  if (!s.salaryType) errors.push({ field: "salaryType", message: "Select a salary type." });
  if (s.salaryType === "Monthly" && !isPositive(Number(s.baseSalary))) errors.push({ field: "baseSalary", message: "Monthly salary is required." });
  if (s.salaryType === "Weekly" && !isPositive(Number(s.baseSalary))) errors.push({ field: "baseSalary", message: "Weekly salary is required." });
  if (s.salaryType === "Daily" && !isPositive(Number(s.dailyRate))) errors.push({ field: "dailyRate", message: "Daily rate is required." });
  if (s.salaryType === "Hourly" && !isPositive(Number(s.hourlyRate))) errors.push({ field: "hourlyRate", message: "Hourly rate is required." });
  if (!s.shiftStart) errors.push({ field: "shiftStart", message: "Shift start time is required." });
  if (!s.shiftEnd) errors.push({ field: "shiftEnd", message: "Shift end time is required." });

  if (s.employeeId && opts.existingIds?.includes(s.employeeId))
    errors.push({ field: "employeeId", message: "This Staff ID already exists." });
  // Username uniqueness (case-insensitive), excluding the record being edited.
  if (s.username && opts.existingUsernames?.includes(s.username.toLowerCase()) && s.username.toLowerCase() !== opts.selfUsername)
    errors.push({ field: "username", message: "This username is already taken." });
  return errors;
}

export function validateLeave(req: {
  leaveType: string; fromDate: string; toDate: string; reason: string;
}): FieldError[] {
  const errors: FieldError[] = [];
  if (!req.leaveType) errors.push({ field: "leaveType", message: "Select a leave type." });
  if (!isISODate(req.fromDate)) errors.push({ field: "fromDate", message: "Start date is required." });
  if (!isISODate(req.toDate)) errors.push({ field: "toDate", message: "End date is required." });
  if (isISODate(req.fromDate) && isISODate(req.toDate) && req.toDate < req.fromDate)
    errors.push({ field: "toDate", message: "End date cannot be before start date." });
  if (req.leaveType === "Sick" && !isNonEmpty(req.reason))
    errors.push({ field: "reason", message: "A reason is required for Sick leave." });
  return errors;
}
