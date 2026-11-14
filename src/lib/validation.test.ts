import { describe, it, expect } from "vitest";
import { validateStaff, validateLeave, type FieldError } from "@/lib/validation";
import { can, type Permission } from "@/lib/auth";
import type { Role } from "@/types";

describe("Validation utilities", () => {
  describe("validateStaff", () => {
    const validStaff = {
      employeeId: "KP9899",
      username: "kp9899",
      password: "password123",
      fullName: "Test User",
      phone: "+8801711000099",
      email: "test@example.com",
      department: "Pharmacy Counter",
      jobTitle: "Pharmacist",
      joinDate: "2024-01-01",
      role: "STAFF" as const,
      salaryType: "Monthly" as const,
      baseSalary: 30000,
      dailyRate: 0,
      hourlyRate: 100,
      dailyDutyHours: 8,
      shiftStart: "09:00 AM",
      shiftEnd: "08:00 PM",
    };

    it("passes valid staff data with password", () => {
      const errors = validateStaff(validStaff, { existingIds: [], existingUsernames: [] });
      expect(errors).toHaveLength(0);
    });

    it("requires employeeId", () => {
      const errors = validateStaff({ ...validStaff, employeeId: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "employeeId")).toBe(true);
    });

    it("validates employeeId format (KP98 + 2 digits)", () => {
      const errors = validateStaff({ ...validStaff, employeeId: "INVALID" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "employeeId")).toBe(true);
    });

    it("requires unique employeeId", () => {
      const errors = validateStaff(validStaff, { existingIds: ["KP9899"], existingUsernames: [] });
      expect(errors.some((e) => e.field === "employeeId" && e.message.includes("exists"))).toBe(true);
    });

    it("requires username", () => {
      const errors = validateStaff({ ...validStaff, username: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "username")).toBe(true);
    });

    it("requires unique username (case-insensitive)", () => {
      const errors = validateStaff(validStaff, { existingIds: [], existingUsernames: ["kp9899"] });
      expect(errors.some((e) => e.field === "username" && e.message.includes("taken"))).toBe(true);
    });

    it("allows update with same username (case-insensitive)", () => {
      const errors = validateStaff(
        { ...validStaff, username: "kp9899" },
        { existingIds: [], existingUsernames: ["kp9899"], selfUsername: "kp9899", isUpdate: true }
      );
      expect(errors.filter((e) => e.field === "username")).toHaveLength(0);
    });

    it("requires password on create", () => {
      const errors = validateStaff({ ...validStaff, password: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "password")).toBe(true);
    });

    it("allows empty password on update", () => {
      const errors = validateStaff(
        { ...validStaff, password: "" },
        { existingIds: [], existingUsernames: [], isUpdate: true }
      );
      expect(errors.filter((e) => e.field === "password")).toHaveLength(0);
    });

    it("requires fullName", () => {
      const errors = validateStaff({ ...validStaff, fullName: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "fullName")).toBe(true);
    });

    it("requires phone", () => {
      const errors = validateStaff({ ...validStaff, phone: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "phone")).toBe(true);
    });

    it("validates email format", () => {
      const errors = validateStaff({ ...validStaff, email: "invalid" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "email")).toBe(true);
    });

    it("allows empty email", () => {
      const errors = validateStaff({ ...validStaff, email: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.filter((e) => e.field === "email")).toHaveLength(0);
    });

    it("allows a missing department (never blocks staff creation)", () => {
      const errors = validateStaff({ ...validStaff, department: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "department")).toBe(false);
    });

    it("allows a missing department field entirely", () => {
      const { department: _omitted, ...noDepartment } = validStaff;
      const errors = validateStaff(noDepartment, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "department")).toBe(false);
    });

    it("allows a blank joinDate (defaults to today server-side)", () => {
      const errors = validateStaff({ ...validStaff, joinDate: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "joinDate")).toBe(false);
    });

    it("requires jobTitle", () => {
      const errors = validateStaff({ ...validStaff, jobTitle: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "jobTitle")).toBe(true);
    });

    it("validates joinDate format", () => {
      const errors = validateStaff({ ...validStaff, joinDate: "invalid" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "joinDate")).toBe(true);
    });

    it("rejects a non-existent calendar date", () => {
      const errors = validateStaff({ ...validStaff, joinDate: "2024-02-30" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "joinDate")).toBe(true);
    });

    it("requires salaryType", () => {
      const errors = validateStaff({ ...validStaff, salaryType: undefined }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "salaryType")).toBe(true);
    });

    it("requires hourlyRate > 0 for active earning config (all types)", () => {
      const errors = validateStaff({ ...validStaff, hourlyRate: 0 }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "hourlyRate")).toBe(true);
      const missing = validateStaff({ ...validStaff, hourlyRate: undefined }, { existingIds: [], existingUsernames: [] });
      expect(missing.some((e) => e.field === "hourlyRate")).toBe(true);
    });

    it("requires dailyDutyHours (no fallback) for all salary types", () => {
      const monthly = { ...validStaff, dailyDutyHours: undefined };
      expect(validateStaff(monthly, { existingIds: [], existingUsernames: [] }).some((e) => e.field === "dailyDutyHours")).toBe(true);
      const hourly = { ...validStaff, salaryType: "Hourly" as const, dailyDutyHours: undefined };
      expect(validateStaff(hourly, { existingIds: [], existingUsernames: [] }).some((e) => e.field === "dailyDutyHours")).toBe(true);
    });

    it("does not require workingDaysPerWeek/baseSalary/dailyRate to derive active earnings", () => {
      const weeklyLabel = { ...validStaff, salaryType: "Weekly" as const, baseSalary: 0, workingDaysPerWeek: undefined };
      expect(validateStaff(weeklyLabel, { existingIds: [], existingUsernames: [] }).filter((e) => e.field === "workingDaysPerWeek" || e.field === "baseSalary")).toHaveLength(0);
      const dailyLabel = { ...validStaff, salaryType: "Daily" as const, dailyRate: 0 };
      expect(validateStaff(dailyLabel, { existingIds: [], existingUsernames: [] }).filter((e) => e.field === "dailyRate")).toHaveLength(0);
    });

    it("requires shiftStart", () => {
      const errors = validateStaff({ ...validStaff, shiftStart: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "shiftStart")).toBe(true);
    });

    it("requires shiftEnd", () => {
      const errors = validateStaff({ ...validStaff, shiftEnd: "" }, { existingIds: [], existingUsernames: [] });
      expect(errors.some((e) => e.field === "shiftEnd")).toBe(true);
    });
  });

  describe("validateLeave", () => {
    it("passes valid leave request", () => {
      const errors = validateLeave({
        leaveType: "Annual",
        fromDate: "2024-01-15",
        toDate: "2024-01-17",
        reason: "Vacation",
      });
      expect(errors).toHaveLength(0);
    });

    it("requires leaveType", () => {
      const errors = validateLeave({ leaveType: "", fromDate: "2024-01-15", toDate: "2024-01-17", reason: "X" });
      expect(errors.some((e) => e.field === "leaveType")).toBe(true);
    });

    it("requires fromDate", () => {
      const errors = validateLeave({ leaveType: "Annual", fromDate: "", toDate: "2024-01-17", reason: "X" });
      expect(errors.some((e) => e.field === "fromDate")).toBe(true);
    });

    it("requires toDate", () => {
      const errors = validateLeave({ leaveType: "Annual", fromDate: "2024-01-15", toDate: "", reason: "X" });
      expect(errors.some((e) => e.field === "toDate")).toBe(true);
    });

    it("validates fromDate format", () => {
      const errors = validateLeave({ leaveType: "Annual", fromDate: "invalid", toDate: "2024-01-17", reason: "X" });
      expect(errors.some((e) => e.field === "fromDate")).toBe(true);
    });

    it("validates toDate format", () => {
      const errors = validateLeave({ leaveType: "Annual", fromDate: "2024-01-15", toDate: "invalid", reason: "X" });
      expect(errors.some((e) => e.field === "toDate")).toBe(true);
    });

    it("rejects toDate before fromDate", () => {
      const errors = validateLeave({ leaveType: "Annual", fromDate: "2024-01-17", toDate: "2024-01-15", reason: "X" });
      expect(errors.some((e) => e.field === "toDate" && e.message.includes("before"))).toBe(true);
    });

    it("requires reason for Sick leave", () => {
      const errors = validateLeave({ leaveType: "Sick", fromDate: "2024-01-15", toDate: "2024-01-17", reason: "" });
      expect(errors.some((e) => e.field === "reason")).toBe(true);
    });

    it("allows empty reason for non-Sick leave", () => {
      const errors = validateLeave({ leaveType: "Annual", fromDate: "2024-01-15", toDate: "2024-01-17", reason: "" });
      expect(errors.filter((e) => e.field === "reason")).toHaveLength(0);
    });
  });
});

describe("Auth RBAC", () => {
  const permissions: Permission[] = [
    "manage.staff", "manage.config", "view.floor", "view.attendance",
    "manage.leave", "pay.staff", "clock.self", "download.slip", "view.financials",
  ];

  it("ADMIN has all permissions", () => {
    for (const p of permissions) {
      expect(can("ADMIN", p)).toBe(true);
    }
  });

  it("SUPERVISOR has floor, attendance, leave, pay, clock, slip, financials", () => {
    expect(can("SUPERVISOR", "view.floor")).toBe(true);
    expect(can("SUPERVISOR", "view.attendance")).toBe(true);
    expect(can("SUPERVISOR", "manage.leave")).toBe(true);
    expect(can("SUPERVISOR", "pay.staff")).toBe(true);
    expect(can("SUPERVISOR", "clock.self")).toBe(true);
    expect(can("SUPERVISOR", "download.slip")).toBe(true);
    expect(can("SUPERVISOR", "view.financials")).toBe(true);
  });

  it("SUPERVISOR cannot manage staff or config", () => {
    expect(can("SUPERVISOR", "manage.staff")).toBe(false);
    expect(can("SUPERVISOR", "manage.config")).toBe(false);
  });

  it("STAFF only has clock.self and download.slip", () => {
    expect(can("STAFF", "clock.self")).toBe(true);
    expect(can("STAFF", "download.slip")).toBe(true);
    expect(can("STAFF", "view.floor")).toBe(false);
    expect(can("STAFF", "pay.staff")).toBe(false);
    expect(can("STAFF", "manage.leave")).toBe(false);
  });

  it("unknown role returns false", () => {
    expect(can("UNKNOWN" as Role, "clock.self")).toBe(false);
  });
});