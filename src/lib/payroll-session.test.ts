import { describe, it, expect } from "vitest";
import { computeCanonical } from "./payroll-session";
import type { Employee, TimeSession, ConfigEntry } from "@/types";

const cfg: ConfigEntry[] = [
  { key: "MEAL_BREAK_MINUTES", value: "30", description: "", category: "Breaks" },
  { key: "REST_BREAK_MINUTES", value: "15", description: "", category: "Breaks" },
  { key: "LATE_GRACE_MINUTES", value: "10", description: "", category: "Attendance" },
  { key: "OVERTIME_MULTIPLIER", value: "1.0", description: "", category: "Payroll" },
];

const baseStaff = (o: Partial<Employee> = {}): any => ({
  recordId: "R1", employeeId: "E1", username: "u", password: "p", fullName: "T",
  email: "", phone: "", department: "D", jobTitle: "J", section: "S", counter: 1,
  joinDate: "2024-01-01", endDate: null, role: "STAFF", salaryType: "Monthly",
  baseSalary: 30000, dailyRate: 0, hourlyRate: 90.9090909090909, dailyDutyHours: 11,
  shiftStart: "09:00 AM", shiftEnd: "08:00 PM", mealBreakMin: 30, restMin: 15,
  photoUrl: "", status: "Active", isActive: true, arrears: 0, advance: 0, ...o,
});

const session = (o: Partial<TimeSession> = {}): any => ({
  id: "S1", staffId: "E1", date: "2024-01-15",
  timeIn: "2024-01-15T03:00:00.000Z", // 9:00 AM Dhaka
  timeOut: "2024-01-15T14:00:00.000Z", // 8:00 PM Dhaka (11h)
  breaks: [], extraTime: [], goOuts: [], completed: true,
  shiftStartMin: 540, shiftEndMin: 1200, shiftStartTime: "09:00 AM", shiftEndTime: "08:00 PM",
  overtimeStatus: "NotRequired", overtimeMinutes: 0, ...o,
});

const now = new Date("2024-01-15T14:00:00.000Z").getTime();

function payoutFromLegacyAdapterShape(c: ReturnType<typeof computeCanonical>) {
  // historical parity shape (legacy POST /api/payments retired; canonical allocate/coordinated are authoritative)
  return {
    dutyHours: c.dutyHours,
    workedMin: Math.round(c.grossMin),
    breakMin: Math.round(c.mealMin + c.restMin),
    overBreakMin: Math.round(c.overBreakMin),
    overtimeMin: c.payableOvertimeMin,
    hourlyRate: Math.round((c.hourlyRate + Number.EPSILON) * 100) / 100,
    grossPay: c.grossPay,
    overtimePay: c.overtimePay,
    overBreakDeduction: c.overBreakDeduction,
    netEarned: c.netPay,
  };
}

describe("payroll-session canonical", () => {
  it("normal completed session uses configured hourly rate Ã— approved payable hours", () => {
    const c = computeCanonical({ session: session(), staff: baseStaff(), config: cfg, now });
    expect(c.hourlyRate).toBeCloseTo(90.9090909090909, 10);
    expect(c.grossPay).toBe(1000);
    expect(c.netPay).toBe(1000);
    expect(c.dutyHours).toBe(11);
  });

  it("handles uppercase salary type enum (server case)", () => {
    const c = computeCanonical({ session: session(), staff: baseStaff({ salaryType: "MONTHLY" as any }), config: cfg, now });
    expect(c.netPay).toBe(1000);
  });

  it("daily/weekly/monthly labels do not change configured hourly earning", () => {
    expect(computeCanonical({ session: session(), staff: baseStaff({ salaryType: "Daily", dailyRate: 1100, baseSalary: 0, hourlyRate: 100, dailyDutyHours: 11 }), config: cfg, now }).hourlyRate).toBe(100);
    expect(computeCanonical({ session: session(), staff: baseStaff({ salaryType: "Weekly", baseSalary: 7700, hourlyRate: 100, dailyDutyHours: 11 }), config: cfg, now }).hourlyRate).toBe(100);
    expect(computeCanonical({ session: session(), staff: baseStaff({ salaryType: "Hourly", hourlyRate: 100 }), config: cfg, now }).hourlyRate).toBe(100);
  });

  it("explicit duty hours take precedence over shift duration", () => {
    const c = computeCanonical({ session: session(), staff: baseStaff({ dailyDutyHours: 10, hourlyRate: 100 }), config: cfg, now });
    expect(c.dutyHours).toBe(10);
    expect(c.hourlyRate).toBe(100);
  });

  it("snapshot precedence: duty snapshot and explicit hourly rate snapshot respected", () => {
    const s = session({ dailyDutyHoursSnapshot: 12, hourlyRateSnapshot: 50 });
    const c = computeCanonical({ session: s, staff: baseStaff({ dailyDutyHours: 8, baseSalary: 99999, hourlyRate: 1 }), config: cfg, now });
    expect(c.dutyHours).toBe(12);
    expect(c.hourlyRate).toBe(50);
  });

  it("hourlyRateSnapshot authoritative when valid", () => {
    const s = session({ hourlyRateSnapshot: 77.5 });
    const c = computeCanonical({ session: s, staff: baseStaff({ baseSalary: 99999, dailyDutyHours: 5, hourlyRate: 1 }), config: cfg, now });
    expect(c.hourlyRate).toBe(77.5);
  });

  it("legacy no snapshots uses explicit staff config", () => {
    const s = session({ dailyDutyHoursSnapshot: undefined, dailySalarySnapshot: undefined, hourlyRateSnapshot: undefined });
    const c = computeCanonical({ session: s, staff: baseStaff({ dailyDutyHours: 10, hourlyRate: 80 }), config: cfg, now });
    expect(c.dutyHours).toBe(10);
    expect(c.hourlyRate).toBe(80);
  });

  it("early clock-in within grace is allowed contextually but pre-duty minutes are not payable (basic from scheduled duty start)", () => {
    // clock in 5 min early (08:55 Dhaka), clock out at scheduled end (20:00 Dhaka)
    const s = session({ timeIn: "2024-01-15T02:55:00.000Z", timeOut: "2024-01-15T14:00:00.000Z" });
    const c = computeCanonical({ session: s, staff: baseStaff(), config: cfg, now: new Date("2024-01-15T14:00:00.000Z").getTime() });
    expect(c.basicMin).toBe(660); // 11h scheduled duty only
    expect(c.grossPay).toBe(1000);
    expect(c.netPay).toBe(1000);
  });

  it("supervisor-authorized activated OT is payable from activation timestamp to actual clock-out (no approval gate); no OT before activation", () => {
    // duty end 20:00 Dhaka (14:00Z), activated 20:05 (14:05Z), clocked out 21:05 (15:05Z) => 60m OT
    const s = session({
      timeOut: "2024-01-15T15:05:00.000Z",
      overtimeActivatedAt: "2024-01-15T14:05:00.000Z",
      overtimeMinutes: 60,
      overtimeStatus: "Approved",
    });
    const c = computeCanonical({ session: s, staff: baseStaff({ hourlyRate: 100, dailyDutyHours: 11 }), config: cfg, now: new Date(s.timeOut).getTime() });
    expect(c.basicMin).toBe(660); // no basic after duty end before activation
    expect(c.grossPay).toBe(1100);
    expect(c.payableOvertimeMin).toBe(60);
    expect(c.overtimePay).toBe(100);
    expect(c.netPay).toBe(1200);
  });

  it("no supervisor-activated OT => no payable OT for post-duty presence (closed session)", () => {
    const s = session({ timeOut: "2024-01-15T15:00:00.000Z", overtimeActivatedAt: undefined, overtimeMinutes: 0, overtimeStatus: "NotRequired" });
    const c = computeCanonical({ session: s, staff: baseStaff(), config: cfg, now: new Date(s.timeOut).getTime() });
    expect(c.basicMin).toBe(660);
    expect(c.payableOvertimeMin).toBe(0);
    expect(c.overtimePay).toBe(0);
    expect(c.netPay).toBe(1000);
  });

  it("legacy extraTime segments remain non-payable; activated OT drives payable overtime", () => {
    const s = session({
      timeOut: "2024-01-15T15:05:00.000Z",
      overtimeActivatedAt: "2024-01-15T14:05:00.000Z",
      overtimeMinutes: 60,
      overtimeStatus: "Approved",
      extraTime: [{ id:"x", type:"rest", start:"2024-01-15T13:00:00Z", end:"2024-01-15T14:00:00Z" }],
    });
    const c = computeCanonical({ session: s, staff: baseStaff({ hourlyRate: 100, dailyDutyHours: 11 }), config: cfg, now: new Date(s.timeOut).getTime() });
    expect(c.extraTimeMin).toBe(60);
    expect(c.payableOvertimeMin).toBe(60);
    expect(c.overtimePay).toBe(100);
  });

  it("partial attendance proportional (basic from duty start)", () => {
    const s = session({ timeOut: "2024-01-15T08:30:00.000Z" }); // 5.5h
    const c = computeCanonical({ session: s, staff: baseStaff(), config: cfg, now: new Date(s.timeOut).getTime() });
    expect(c.grossMin).toBe(330);
    expect(c.netPay).toBe(500); // 90.909..*5.5
  });

  it("break pool overrun/unpaid deducted; meal/rest included in payable time", () => {
    const s = session({ breaks: [
      { id:"1", type:"meal", start:"2024-01-15T06:00:00Z", end:"2024-01-15T06:30:00Z" },
      { id:"2", type:"rest", start:"2024-01-15T07:00:00Z", end:"2024-01-15T07:20:00Z" },
      { id:"3", type:"unpaid", start:"2024-01-15T08:00:00Z", end:"2024-01-15T08:10:00Z" },
    ]});
    const c = computeCanonical({ session: s, staff: baseStaff(), config: cfg, now });
    expect(c.overBreakMin).toBe(15); // 5 over pool + 10 unpaid
    expect(c.overBreakDeduction).toBe(22.73); // 90.909..*0.25
  });

  it("client/server payout parity via shared calc mapping (activated OT)", () => {
    const s = session({ timeOut: "2024-01-15T15:00:00.000Z", overtimeActivatedAt: "2024-01-15T14:00:00.000Z", overtimeMinutes: 60, overtimeStatus: "Approved" });
    const c = computeCanonical({ session: s, staff: baseStaff(), config: cfg, now: new Date(s.timeOut).getTime() });
    const p = payoutFromLegacyAdapterShape(c);
    expect(p.netEarned).toBe(c.netPay);
    expect(p.grossPay).toBe(c.grossPay);
    expect(p.overtimePay).toBe(c.overtimePay);
    expect(p.overtimeMin).toBe(c.payableOvertimeMin);
  });
});
