import { describe, expect, it } from "vitest";
import { computeAccrual, resolvePeriod, daysInMonth } from "./payroll-accrual-core";
import { payRound } from "./currency";

const cfg = { MEAL_BREAK_MINUTES: "30", REST_BREAK_MINUTES: "15", OVERTIME_MULTIPLIER: "1.0", LATE_GRACE_MINUTES: "10" };

const baseStaff = (o: any = {}) => ({
  employeeId: "T1", fullName: "Test", salaryType: "DAILY",
  baseSalary: 0, dailyRate: 0, hourlyRate: 100,
  dailyDutyHours: 8, workingDaysPerWeek: null,
  shiftStart: "09:00 AM", shiftEnd: "05:00 PM", mealBreakMin: 30, restMin: 15,
  ...o,
});

const baseSession = (o: any = {}) => ({
  id: "S1", staffId: "T1", date: new Date("2024-01-15T00:00:00+06:00"),
  timeIn: "2024-01-15T03:00:00.000Z", timeOut: "2024-01-15T11:00:00.000Z", // 8h Dhaka 09:00-17:00
  completed: true, breaks: [], extraTime: [], goOuts: [],
  shiftStartMin: 540, shiftEndMin: 1020, shiftStartTime: "09:00 AM", shiftEndTime: "05:00 PM",
  dailyDutyHoursSnapshot: 8, dailySalarySnapshot: null, hourlyRateSnapshot: null,
  overtimeStatus: "NotRequired", overtimeMinutes: 0,
  ...o,
});

describe("payroll-accrual-core 2C.6.2 single-hourly policy", () => {
  it("1. daily label accrues as approved payable hours × configured hourly rate", () => {
    const r = computeAccrual(baseStaff({ salaryType: "DAILY", hourlyRate: 100, dailyDutyHours: 8 }), baseSession(), cfg);
    expect(r.status).toBe("CALCULATED");
    expect(r.hourlyRate).toBe(100);
    expect(r.payout?.grossPay).toBe(800);
    expect(r.period.kind).toBe("DAILY");
  });

  it("2. weekly label accrues by hours×rate (no /7, workingDaysPerWeek not required/used)", () => {
    const r = computeAccrual(baseStaff({ salaryType: "WEEKLY", hourlyRate: 100, dailyDutyHours: 8, workingDaysPerWeek: null, baseSalary: 9999 }), baseSession(), cfg);
    expect(r.status).toBe("CALCULATED");
    expect(r.hourlyRate).toBe(100);
    expect(r.payout?.netPay).toBe(800);
    expect(r.period.key).toBe("WEEK:2024-01-15");
  });

  it("3. monthly label accrues by hours×rate (no /30, no calendar-days denominator in earning)", () => {
    const m31 = computeAccrual(baseStaff({ salaryType: "MONTHLY", hourlyRate: 100, dailyDutyHours: 8, baseSalary: 9999 }), baseSession({ date: new Date("2024-01-15T00:00:00+06:00") }), cfg);
    expect(m31.status).toBe("CALCULATED");
    expect(m31.period.monthlyCalendarDays).toBe(31);
    expect(m31.hourlyRate).toBe(100);
    expect(m31.payout?.netPay).toBe(800);

    const m29 = computeAccrual(baseStaff({ salaryType: "MONTHLY", hourlyRate: 100, dailyDutyHours: 8 }), baseSession({ date: new Date("2024-02-15T00:00:00+06:00") }), cfg);
    expect(m29.period.monthlyCalendarDays).toBe(29);
    expect(m29.hourlyRate).toBe(100);
    expect(m29.payout?.netPay).toBe(800);
  });

  it("4. hourly salary accrual uses configured hourly rate directly", () => {
    const r = computeAccrual(baseStaff({ salaryType: "HOURLY", hourlyRate: 125 }), baseSession(), cfg);
    expect(r.status).toBe("CALCULATED");
    expect(r.hourlyRate).toBe(125);
    expect(r.payout?.netPay).toBe(1000);
  });

  it("5. missing dailyDutyHours => explicit INCOMPLETE (no 8h/shift fallback)", () => {
    const r = computeAccrual(baseStaff({ dailyDutyHours: null }), baseSession({ dailyDutyHoursSnapshot: null }), cfg);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.reason).toBe("MISSING_DAILY_DUTY_HOURS");
    expect(r.payout).toBeNull();
  });

  it("6. missing hourly rate => explicit INCOMPLETE (salary type/base/daily do not derive)", () => {
    const r = computeAccrual(baseStaff({ hourlyRate: 0, baseSalary: 4800, dailyRate: 800, salaryType: "WEEKLY" }), baseSession(), cfg);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.reason).toBe("MISSING_HOURLY_RATE");
    expect(r.payout).toBeNull();
  });

  it("8. supervisor-authorized activated OT payable (no approval gate); no payable OT without activation", () => {
    const otSession = (o: any = {}) => baseSession({ ...o });
    const activated = computeAccrual(baseStaff({ salaryType: "HOURLY", hourlyRate: 100 }), otSession({
      timeOut: "2024-01-15T12:00:00.000Z", // 18:00 Dhaka, 1h after duty end 17:00
      overtimeActivatedAt: "2024-01-15T11:00:00.000Z", // 17:00 Dhaka activation
      overtimeMinutes: 60,
      overtimeStatus: "Approved",
    }), cfg);
    expect(activated.status).toBe("CALCULATED");
    expect(activated.payout?.payableOvertimeMin).toBe(60);
    expect(activated.payout?.overtimePay).toBe(100);

    const notActivated = computeAccrual(baseStaff({ salaryType: "HOURLY", hourlyRate: 100 }), otSession({
      timeOut: "2024-01-15T12:00:00.000Z",
      overtimeActivatedAt: undefined,
      overtimeMinutes: 60,
      overtimeStatus: "Pending",
    }), cfg);
    expect(notActivated.payout?.payableOvertimeMin).toBe(0);
    expect(notActivated.payout?.overtimePay).toBe(0);
  });

  it("13. Asia/Dhaka weekly period boundaries (Mon-Sun) and monthly actual days metadata", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    const tueDhaka = resolvePeriod(baseStaff({ salaryType: "WEEKLY", workingDaysPerWeek: null }), new Date("2024-01-15T18:30:00Z"));
    expect(tueDhaka.kind).toBe("WEEKLY");
    expect(tueDhaka.key).toBe("WEEK:2024-01-15");
    const sun = resolvePeriod(baseStaff({ salaryType: "WEEKLY" }), new Date("2024-01-14T03:00:00Z"));
    expect(sun.key).toBe("WEEK:2024-01-08");
    const mon = resolvePeriod(baseStaff({ salaryType: "WEEKLY" }), new Date("2024-01-14T18:00:00Z"));
    expect(mon.key).toBe("WEEK:2024-01-15");
  });

  it("14. preserves payRound/break rules via canonical engine", () => {
    const withBreak = baseSession({ breaks: [{ type: "meal", start: "2024-01-15T06:00:00Z", end: "2024-01-15T06:50:00Z" }] });
    const r = computeAccrual(baseStaff({ salaryType: "HOURLY", hourlyRate: 90.9090909 }), withBreak, cfg);
    expect(r.status).toBe("CALCULATED");
    expect(r.payout?.overBreakMin).toBe(5);
    expect(r.payout?.overBreakDeduction).toBe(payRound(90.9090909 * (5 / 60)));
    expect(r.payout?.netPay).toBe(719.7);
  });
});
