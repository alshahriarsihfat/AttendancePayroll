import { describe, it, expect, beforeEach } from "vitest";
import {
  computeSession,
  empShift,
  scheduledShiftBounds,
  shiftForSession,
  hourlyRateFor,
  parseTime12,
} from "@/lib/timeclock";
import type { Employee, TimeSession, ConfigEntry, BreakEvent, GoOutEvent } from "@/types";

const mockConfig: ConfigEntry[] = [
  { key: "MEAL_BREAK_MINUTES", value: "30", description: "", category: "Breaks" },
  { key: "REST_BREAK_MINUTES", value: "15", description: "", category: "Breaks" },
  { key: "LATE_GRACE_MINUTES", value: "10", description: "", category: "Attendance" },
  { key: "OVERTIME_MULTIPLIER", value: "1.25", description: "", category: "Payroll" },
  { key: "EARLY_CHECKIN_MINUTES", value: "5", description: "", category: "Attendance" },
];

const baseStaff: Employee = {
  recordId: "REC1",
  employeeId: "KP9820",
  username: "kp9820",
  password: "9820",
  fullName: "Test Staff",
  email: "",
  phone: "",
  department: "Pharmacy Counter",
  jobTitle: "Pharmacist",
  section: "Sales Floor",
  counter: 1,
  joinDate: "2024-01-01",
  endDate: null,
  role: "STAFF",
  salaryType: "Monthly",
  baseSalary: 30000,
  dailyRate: 0,
  hourlyRate: 0,
  shiftStart: "09:00 AM",
  shiftEnd: "08:00 PM",
  mealBreakMin: 30,
  restMin: 15,
  photoUrl: "",
  status: "Active",
  isActive: true,
  arrears: 0,
  advance: 0,
};

const createSession = (overrides: Partial<TimeSession> = {}): TimeSession => ({
  id: "SES1",
  staffId: "KP9820",
  date: "2024-01-15",
  timeIn: "2024-01-15T03:00:00.000Z", // 9:00 AM Dhaka
  timeOut: null,
  breaks: [],
  extraTime: [],
  goOuts: [],
  completed: false,
  shiftStartMin: 540, // 9:00 AM
  shiftEndMin: 1200, // 8:00 PM
  shiftStartTime: "09:00 AM",
  shiftEndTime: "08:00 PM",
  ...overrides,
});

const dhakaNoon = new Date("2024-01-15T06:00:00.000Z").getTime(); // 12:00 PM Dhaka
const dhaka6pm = new Date("2024-01-15T12:00:00.000Z").getTime(); // 6:00 PM Dhaka
const dhaka8pm = new Date("2024-01-15T14:00:00.000Z").getTime(); // 8:00 PM Dhaka
const dhaka10pm = new Date("2024-01-15T16:00:00.000Z").getTime(); // 10:00 PM Dhaka

describe("computeSession - Core Payroll Logic", () => {
  describe("Normal shift (9AM-8PM, 11h duty)", () => {
    it("calculates correct gross minutes for full shift", () => {
      const session = createSession({ timeOut: "2024-01-15T14:00:00.000Z" }); // 8PM Dhaka
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.grossMin).toBe(660); // 11 hours = 660 min
    });

    it("calculates correct net pay for monthly salary", () => {
      const session = createSession({ timeOut: "2024-01-15T14:00:00.000Z" });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      // Monthly 30000 / 30 days / 11h = 90.91/hr
      // 11h * 90.91 = 1000 (rounded)
      expect(result.netPay).toBeGreaterThan(950);
      expect(result.netPay).toBeLessThan(1050);
    });

    it("shows completed status when clocked out", () => {
      const session = createSession({ timeOut: "2024-01-15T14:00:00.000Z", completed: true });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.clockStatus).toBe("completed");
    });
  });

  describe("Late arrival detection", () => {
    it("detects late arrival > grace period (10 min)", () => {
      const session = createSession({
        timeIn: "2024-01-15T03:11:00.000Z", // 9:11 AM Dhaka (11 min late)
        timeOut: "2024-01-15T14:00:00.000Z",
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.lateMin).toBe(11);
      expect(result.isLate).toBe(true);
    });

    it("ignores late arrival within grace period (10 min)", () => {
      const session = createSession({
        timeIn: "2024-01-15T03:08:00.000Z", // 9:08 AM Dhaka (8 min late)
        timeOut: "2024-01-15T14:00:00.000Z",
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.lateMin).toBe(8);
      expect(result.isLate).toBe(false);
    });

    it("on-time arrival shows 0 late", () => {
      const session = createSession({
        timeIn: "2024-01-15T03:00:00.000Z", // 9:00 AM sharp
        timeOut: "2024-01-15T14:00:00.000Z",
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.lateMin).toBe(0);
      expect(result.isLate).toBe(false);
    });
  });

  describe("Overtime calculation", () => {
    it("calculates overtime only when supervisor activated Extra Time (activation timestamp -> actual clock-out)", () => {
      const session = createSession({
        timeOut: "2024-01-15T16:00:00.000Z", // 10:00 PM Dhaka
        overtimeActivatedAt: "2024-01-15T14:00:00.000Z", // activated at duty end 8:00 PM Dhaka
        overtimeMinutes: 120,
        overtimeStatus: "Approved",
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka10pm);
      expect(result.overtimeMin).toBe(120); // 2 hours
      expect(result.overtimePay).toBeGreaterThan(0);
    });

    it("no payable overtime for post-duty presence without supervisor activation", () => {
      const session = createSession({
        timeOut: "2024-01-15T16:00:00.000Z", // 10:00 PM Dhaka (stayed late, not activated)
        overtimeStatus: "NotRequired",
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka10pm);
      expect(result.overtimeMin).toBe(0);
      expect(result.overtimePay).toBe(0);
    });

    it("no overtime when clocked out at shift end", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z", // 8:00 PM sharp
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.overtimeMin).toBe(0);
      expect(result.overtimePay).toBe(0);
    });

    it("overtime paid at 1.25x rate when supervisor-activated", () => {
      const session = createSession({
        timeOut: "2024-01-15T16:00:00.000Z",
        overtimeActivatedAt: "2024-01-15T14:00:00.000Z",
        overtimeMinutes: 120,
        overtimeStatus: "Approved",
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka10pm);
      expect(result.overtimeRate).toBeCloseTo(result.hourlyRate * 1.25, 2);
    });
  });

  describe("Break handling (dual-pool: 30m meal + 15m rest = 45m paid)", () => {
    it("paid meal break within allowance (30m)", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z",
        breaks: [
          { id: "BK1", type: "meal", start: "2024-01-15T06:00:00.000Z", end: "2024-01-15T06:30:00.000Z" },
        ],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.mealMin).toBe(30);
      expect(result.overBreakMin).toBe(0);
      expect(result.paidMealAllow).toBe(30);
    });

    it("paid rest break within allowance (15m)", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z",
        breaks: [
          { id: "BK1", type: "rest", start: "2024-01-15T06:00:00.000Z", end: "2024-01-15T06:15:00.000Z" },
        ],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.restMin).toBe(15);
      expect(result.overBreakMin).toBe(0);
      expect(result.paidRestAllow).toBe(15);
    });

    it("meal overrun beyond 30m uses combined pool (45m total)", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z",
        breaks: [
          { id: "BK1", type: "meal", start: "2024-01-15T06:00:00.000Z", end: "2024-01-15T06:45:00.000Z" }, // 45m meal
        ],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.mealMin).toBe(45);
      expect(result.overBreakMin).toBe(0); // 45 meal uses full 45m pool, 0 over
      expect(result.poolsExhausted).toBe(true);
    });

    it("rest overrun beyond 15m uses combined pool", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z",
        breaks: [
          { id: "BK1", type: "rest", start: "2024-01-15T06:00:00.000Z", end: "2024-01-15T06:25:00.000Z" }, // 25m rest
        ],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.restMin).toBe(25);
      expect(result.overBreakMin).toBe(0); // 25 rest < 45 pool, 0 over
    });

    it("unpaid break always deducted immediately", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z",
        breaks: [
          { id: "BK1", type: "unpaid", start: "2024-01-15T06:00:00.000Z", end: "2024-01-15T06:20:00.000Z" }, // 20m unpaid
        ],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.unpaidMin).toBe(20);
      expect(result.overBreakMin).toBe(20); // unpaid always counts as over-break
      expect(result.overBreakDeduction).toBeGreaterThan(0);
    });

    it("meal + rest combined over 45m paid ceiling = over-break", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z",
        breaks: [
          { id: "BK1", type: "meal", start: "2024-01-15T06:00:00.000Z", end: "2024-01-15T06:30:00.000Z" }, // 30m
          { id: "BK2", type: "rest", start: "2024-01-15T08:00:00.000Z", end: "2024-01-15T08:20:00.000Z" }, // 20m rest
        ],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.mealMin).toBe(30);
      expect(result.restMin).toBe(20);
      expect(result.overBreakMin).toBe(5); // 50 total paid breaks - 45 ceiling = 5 over
    });

    it("active break shows correct clockStatus", () => {
      const session = createSession({
        breaks: [{ id: "BK1", type: "meal", start: "2024-01-15T06:00:00.000Z", end: null }],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhakaNoon);
      expect(result.clockStatus).toBe("on-meal");
    });
  });

  describe("Extra Time (manual overtime toggle)", () => {
    it("extra time tracked but NOT added to payable overtime (canonical policy)", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z",
        overtimeStatus: "Approved",
        overtimeMinutes: 0, // stored authoritative
        extraTime: [
          { id: "ET1", type: "rest", start: "2024-01-15T13:00:00.000Z", end: "2024-01-15T14:00:00.000Z" }, // 1h extra
        ],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.extraTimeMin).toBe(60);
      expect(result.overtimeMin).toBe(0); // stored authoritative
      expect(result.payableOvertimeMin).toBe(0);
      expect(result.overtimePay).toBe(0);
    });

    it("active extra time shows extraTimeActive = true", () => {
      const session = createSession({
        extraTime: [{ id: "ET1", type: "rest", start: "2024-01-15T13:00:00.000Z", end: null }],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka6pm);
      expect(result.extraTimeActive).toBe(true);
    });
  });

  describe("Paid Go-Out (field work - no deduction)", () => {
    it("go-out time tracked but not deducted", () => {
      const session = createSession({
        timeOut: "2024-01-15T14:00:00.000Z",
        goOuts: [
          { id: "GO1", start: "2024-01-15T06:00:00.000Z", end: "2024-01-15T07:00:00.000Z", reason: "Delivery", estimatedMin: 60 },
        ],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka8pm);
      expect(result.goOutMin).toBe(60);
      expect(result.overBreakMin).toBe(0); // NOT deducted
      expect(result.overBreakDeduction).toBe(0);
    });

    it("active go-out shows on-goout status", () => {
      const session = createSession({
        goOuts: [{ id: "GO1", start: "2024-01-15T06:00:00.000Z", end: null, reason: "Delivery", estimatedMin: 60 }],
      });
      const result = computeSession(session, baseStaff, mockConfig, dhakaNoon);
      expect(result.clockStatus).toBe("on-goout");
      expect(result.activeGoOutReason).toBe("Delivery");
    });
  });

  describe("Salary type variations", () => {
    it("hourly staff uses hourlyRate directly", () => {
      const hourlyStaff = { ...baseStaff, salaryType: "Hourly" as const, hourlyRate: 100 };
      const session = createSession({ timeOut: "2024-01-15T14:00:00.000Z" });
      const result = computeSession(session, hourlyStaff, mockConfig, dhaka8pm);
      expect(result.hourlyRate).toBe(100);
    });

    it("daily staff: dailyRate / dutyHours", () => {
      const dailyStaff = { ...baseStaff, salaryType: "Daily" as const, dailyRate: 1100 };
      const session = createSession({ timeOut: "2024-01-15T14:00:00.000Z" });
      const result = computeSession(session, dailyStaff, mockConfig, dhaka8pm);
      expect(result.hourlyRate).toBeCloseTo(1100 / 11, 2); // 100
    });

    it("weekly staff: baseSalary / 7 / dutyHours", () => {
      const weeklyStaff = { ...baseStaff, salaryType: "Weekly" as const, baseSalary: 7000 };
      const session = createSession({ timeOut: "2024-01-15T14:00:00.000Z" });
      const result = computeSession(session, weeklyStaff, mockConfig, dhaka8pm);
      expect(result.hourlyRate).toBeCloseTo(7000 / 7 / 11, 2);
    });
  });

  describe("Overnight shift handling (shiftEnd < shiftStart)", () => {
    const nightStaff: Employee = {
      ...baseStaff,
      employeeId: "KP9830",
      shiftStart: "10:00 PM",
      shiftEnd: "06:00 AM",
      mealBreakMin: 30,
      restMin: 15,
    };

    const nightSession = (timeIn: string, timeOut: string | null): TimeSession => ({
      id: "SES-NIGHT",
      staffId: "KP9830",
      date: "2024-01-15",
      timeIn,
      timeOut,
      breaks: [],
      extraTime: [],
      goOuts: [],
      completed: !!timeOut,
      shiftStartMin: 1320, // 10 PM
      shiftEndMin: 360, // 6 AM
      shiftStartTime: "10:00 PM",
      shiftEndTime: "06:00 AM",
    });

    it("scheduledShiftBounds handles overnight correctly", () => {
      const bounds = scheduledShiftBounds("2024-01-15T16:00:00.000Z", { startMin: 1320, endMin: 360 });
      // Clock in at 10 PM Dhaka (16:00 UTC) -> shift starts same day 10 PM
      expect(bounds.start).toBeLessThan(bounds.end);
    });

    it("late detection works for overnight shift", () => {
      // Clock in at 10:15 PM (15 min late)
      const session = nightSession("2024-01-15T16:15:00.000Z", "2024-01-16T00:00:00.000Z");
      const result = computeSession(session, nightStaff, mockConfig, new Date("2024-01-16T00:00:00.000Z").getTime());
      expect(result.lateMin).toBe(15);
      expect(result.isLate).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("no session returns off status with zeros", () => {
      const result = computeSession(undefined, baseStaff, mockConfig, dhakaNoon);
      expect(result.clockStatus).toBe("off");
      expect(result.grossMin).toBe(0);
      expect(result.netPay).toBe(0);
    });

    it("clocked in but no timeOut shows working status", () => {
      const session = createSession({ timeOut: null });
      const result = computeSession(session, baseStaff, mockConfig, dhakaNoon);
      expect(result.clockStatus).toBe("working");
      expect(result.isOngoing).toBe(true);
    });

    it("early departure before shift end", () => {
      const session = createSession({
        timeOut: "2024-01-15T12:00:00.000Z", // 6 PM (2h early)
      });
      const result = computeSession(session, baseStaff, mockConfig, dhaka6pm);
      // Early departure doesn't affect pay calc directly, but flagged for approval
      expect(result.grossMin).toBe(540); // 9 hours
    });

    it("break remaining seconds calculated correctly", () => {
      const session = createSession({
        breaks: [{ id: "BK1", type: "meal", start: "2024-01-15T06:00:00.000Z", end: null }], // started 3h ago (at noon)
      });
      const result = computeSession(session, baseStaff, mockConfig, dhakaNoon);
      // At noon, break just started, 45m pool remaining = 2700 sec
      expect(result.breakRemainingSec).toBe(2700);
    });
  });
});

describe("Utility functions", () => {
  describe("parseTime12", () => {
    it("parses 09:00 AM correctly", () => {
      expect(parseTime12("09:00 AM")).toBe(540);
    });
    it("parses 08:00 PM correctly", () => {
      expect(parseTime12("08:00 PM")).toBe(1200);
    });
    it("parses 12:00 AM (midnight)", () => {
      expect(parseTime12("12:00 AM")).toBe(0);
    });
    it("parses 12:00 PM (noon)", () => {
      expect(parseTime12("12:00 PM")).toBe(720);
    });
  });

  describe("empShift", () => {
    it("calculates regularHours for normal shift", () => {
      const shift = empShift(baseStaff);
      expect(shift.regularHours).toBe(11); // 9AM-8PM = 11h
    });

    it("handles overnight shift", () => {
      const nightStaff = { ...baseStaff, shiftStart: "10:00 PM", shiftEnd: "06:00 AM" };
      const shift = empShift(nightStaff);
      expect(shift.regularHours).toBe(8); // 10PM-6AM = 8h
    });
  });

  describe("hourlyRateFor", () => {
    it("monthly: baseSalary / 30 / dutyHours", () => {
      const rate = hourlyRateFor(baseStaff, empShift(baseStaff));
      expect(rate).toBeCloseTo(30000 / 30 / 11, 2);
    });

    it("daily: dailyRate / dutyHours", () => {
      const dailyStaff = { ...baseStaff, salaryType: "Daily" as const, dailyRate: 1100 };
      const rate = hourlyRateFor(dailyStaff, empShift(dailyStaff));
      expect(rate).toBeCloseTo(1100 / 11, 2);
    });
  });

  describe("shiftForSession", () => {
    it("uses session snapshot when available", () => {
      const session = createSession({ shiftStartMin: 600, shiftEndMin: 1140 }); // 10AM-7PM snapshot
      const shift = shiftForSession(baseStaff, session);
      expect(shift.startMin).toBe(600);
      expect(shift.endMin).toBe(1140);
    });

    it("falls back to live staff shift when no snapshot", () => {
      const session = createSession({ shiftStartMin: undefined, shiftEndMin: undefined });
      const shift = shiftForSession(baseStaff, session);
      expect(shift.startMin).toBe(540);
      expect(shift.endMin).toBe(1200);
    });
  });
});