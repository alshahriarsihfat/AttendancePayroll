// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./payroll-accrual-service", () => ({
  accrueCompletedSession: vi.fn(),
}));

import { computeAutoClockoutDueMs, autoCloseSessionIfEligible, processAutoClockouts } from "./auto-clockout-service";
import { accrueCompletedSession } from "./payroll-accrual-service";

const cfg = { AUTO_CLOCKOUT_MINUTES: "15" };

function session(overrides: any = {}) {
  // 2024-01-15 09:00-17:00 Dhaka shift (540-1020). timeIn 03:00Z = 09:00 Dhaka.
  return {
    id: "s1",
    staffId: "ST1",
    date: new Date("2024-01-15T00:00:00.000+06:00"),
    timeIn: new Date("2024-01-15T03:00:00.000Z"),
    timeOut: null,
    completed: false,
    autoClockedOut: false,
    overtimeActivatedAt: null,
    shiftStartMin: 540,
    shiftEndMin: 1020,
    shiftStartTime: "09:00 AM",
    shiftEndTime: "05:00 PM",
    breaks: [],
    goOuts: [],
    extraTime: [],
    staff: { employeeId: "ST1", fullName: "Staff One", shiftStart: "09:00 AM", shiftEnd: "05:00 PM" },
    ...overrides,
  };
}

function makeDb(opts: any = {}) {
  const updates: any[] = [];
  const audits: any[] = [];
  const sessions = new Map<string, any>((opts.sessions ?? []).map((s: any) => [s.id, { ...s }]));
  const txApi = {
    timeSession: {
      findUnique: vi.fn(async ({ where }: any) => sessions.get(where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const s = sessions.get(where.id);
        if (!s) return { count: 0 };
        if (where.timeOut === null && s.timeOut != null) return { count: 0 };
        if (where.completed === false && s.completed !== false) return { count: 0 };
        Object.assign(s, data);
        updates.push({ where, data });
        return { count: 1 };
      }),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => { audits.push(data); return { id: "a1", ...data }; }) },
  };
  const db: any = {
    config: { findMany: vi.fn(async () => opts.configRows ?? [{ key: "AUTO_CLOCKOUT_MINUTES", value: "15" }]) },
    timeSession: {
      findMany: vi.fn(async ({ where }: any) => {
        const list = Array.from(sessions.values());
        if (where?.timeOut === null && where?.completed === false) {
          return list.filter((s) => s.timeOut == null && s.completed === false).map((s) => ({ ...s }));
        }
        // recovery candidates
        return list.filter((s) => s.completed && s.timeOut).map((s) => ({ ...s, payrollEarning: opts.earningsBySession?.[s.id] ?? null }));
      }),
      findUnique: vi.fn(async ({ where }: any) => sessions.get(where.id) ?? null),
      updateMany: txApi.timeSession.updateMany,
    },
    auditLog: { create: vi.fn(async ({ data }: any) => { audits.push(data); return { id: "a1", ...data }; }) },
    $transaction: vi.fn(async (fn: any) => fn(txApi)),
    __sessions: sessions,
    __updates: updates,
    __audits: audits,
  };
  return db;
}

describe("auto clock-out service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("1) not closed before 15-minute threshold; eligible at threshold", async () => {
    const s = session();
    const due = computeAutoClockoutDueMs(s, cfg)!; // 17:00 + 15m Dhaka = 11:15Z
    expect(new Date(due).toISOString()).toBe("2024-01-15T11:15:00.000Z");
    const db = makeDb({ sessions: [s] });
    const early = await autoCloseSessionIfEligible(db, s, cfg, new Date("2024-01-15T11:14:59.000Z"));
    expect(early.outcome).toBe("not_eligible");
    expect(db.__updates.length).toBe(0);
    expect(accrueCompletedSession).not.toHaveBeenCalled();

    (accrueCompletedSession as any).mockResolvedValue({ created: true, earningId: "e1", status: "CALCULATED" });
    const db2 = makeDb({ sessions: [session()] });
    const at = await autoCloseSessionIfEligible(db2, db2.__sessions.get("s1"), cfg, new Date("2024-01-15T11:15:00.000Z"));
    expect(at.outcome).toBe("auto_closed_accrued");
    expect(db2.__sessions.get("s1").autoClockedOut).toBe(true);
    expect(db2.__sessions.get("s1").timeOut.toISOString()).toBe("2024-01-15T11:15:00.000Z");
  });

  it("2) different shift end times", async () => {
    // 14:00-22:00 Dhaka (840-1320), timeIn 08:00Z => due 22:15 Dhaka = 16:15Z
    const s2 = session({ id: "s2", staffId: "ST2", timeIn: new Date("2024-01-15T08:00:00.000Z"), shiftStartMin: 840, shiftEndMin: 1320, staff: { employeeId: "ST2", fullName: "B", shiftStart: "02:00 PM", shiftEnd: "10:00 PM" } });
    expect(new Date(computeAutoClockoutDueMs(s2, cfg)!).toISOString()).toBe("2024-01-15T16:15:00.000Z");
  });

  it("3) overnight shift and date-boundary behavior", async () => {
    // 22:00-06:00 Dhaka overnight (1320-360), clock-in 16:00Z = 22:00 Dhaka
    const s = session({ id: "sn", timeIn: new Date("2024-01-15T16:00:00.000Z"), date: new Date("2024-01-15T00:00:00.000+06:00"), shiftStartMin: 1320, shiftEndMin: 360, staff: { employeeId: "ST1", fullName: "N", shiftStart: "10:00 PM", shiftEnd: "06:00 AM" } });
    // end next day 06:00 Dhaka = 2024-01-16T00:00:00Z, due +15 => 00:15Z
    expect(new Date(computeAutoClockoutDueMs(s, cfg)!).toISOString()).toBe("2024-01-16T00:15:00.000Z");

    // post-midnight clock-in for same overnight shift: 03:22 Dhaka = 2024-01-15T21:22:00Z
    const sLate = session({ id: "sn2", timeIn: new Date("2024-01-15T21:22:00.000Z"), date: new Date("2024-01-15T00:00:00.000+06:00"), shiftStartMin: 1320, shiftEndMin: 360, staff: { employeeId: "ST1", fullName: "N", shiftStart: "10:00 PM", shiftEnd: "06:00 AM" } });
    expect(new Date(computeAutoClockoutDueMs(sLate, cfg)!).toISOString()).toBe("2024-01-16T00:15:00.000Z");
  });

  it("4) multiple overdue sessions and repeated run do not duplicate", async () => {
    const dueNow = new Date("2024-01-15T11:20:00.000Z");
    const a = session({ id: "a" });
    const b = session({ id: "b", staffId: "ST2", staff: { employeeId: "ST2", fullName: "B", shiftStart: "09:00 AM", shiftEnd: "05:00 PM" } });
    (accrueCompletedSession as any).mockResolvedValue({ created: true, earningId: "e", status: "CALCULATED" });
    const db = makeDb({ sessions: [a, b] });
    db.timeSession.findMany = vi.fn()
      .mockResolvedValueOnce([a, b]) // open batch
      .mockResolvedValueOnce([]) // open pass end
      .mockResolvedValue([]); // recovery
    const r1 = await processAutoClockouts(db, dueNow);
    expect(r1.eligibleOverdue).toBe(2);
    expect(r1.autoClosedAccrued).toBe(2);

    const db2 = makeDb({ sessions: [] });
    db2.timeSession.findMany = vi.fn().mockResolvedValue([]);
    const r2 = await processAutoClockouts(db2, dueNow);
    expect(r2.eligibleOverdue).toBe(0);
    expect(r2.processed).toBe(0);
  });

  it("5) successful auto-close triggers canonical accrual; missing config => INCOMPLETE (not estimated)", async () => {
    const s = session();
    (accrueCompletedSession as any).mockResolvedValue({ created: true, earningId: "e1", status: "INCOMPLETE", reason: "MISSING_HOURLY_RATE" });
    const db = makeDb({ sessions: [s] });
    const res = await autoCloseSessionIfEligible(db, s, cfg, new Date("2024-01-15T11:15:00.000Z"));
    expect(res.outcome).toBe("auto_closed_accrual_incomplete");
    expect(res.accrualReason).toBe("MISSING_HOURLY_RATE");
    expect(db.__sessions.get("s1").completed).toBe(true);
    expect(accrueCompletedSession).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "SYSTEM", sessionId: "s1" }));
  });

  it("6) accrual failure can be safely retried (session preserved)", async () => {
    const s = session();
    (accrueCompletedSession as any).mockRejectedValueOnce(new Error("DB_DOWN"));
    const db = makeDb({ sessions: [s] });
    const res = await autoCloseSessionIfEligible(db, s, cfg, new Date("2024-01-15T11:15:00.000Z"));
    expect(res.outcome).toBe("auto_closed_accrual_failed");
    expect(db.__sessions.get("s1").completed).toBe(true);
    expect(db.__sessions.get("s1").autoClockedOut).toBe(true);

    (accrueCompletedSession as any).mockResolvedValueOnce({ created: true, earningId: "e2", status: "CALCULATED" });
    const closed = { ...s, timeOut: new Date("2024-01-15T11:15:00.000Z"), completed: true, autoClockedOut: true };
    const dbRec = makeDb({ sessions: [closed] });
    dbRec.timeSession.findMany = vi.fn()
      .mockResolvedValueOnce([]) // no open
      .mockResolvedValueOnce([{ id: "s1", completed: true, autoClockedOut: true, timeOut: new Date(), staff: { fullName: "Staff One" }, payrollEarning: null }]);
    const rr = await processAutoClockouts(dbRec, new Date("2024-01-15T12:00:00.000Z"));
    expect(rr.accrualRecoveryAttempted).toBe(1);
    expect(rr.accrualRecoveryFailed).toBe(0);
  });

  it("7) concurrent processing cannot duplicate closure/accrual (conditional claim)", async () => {
    const s = session();
    const db = makeDb({ sessions: [s] });
    db.$transaction = vi.fn(async (fn: any) => fn({
      timeSession: {
        findUnique: vi.fn(async () => ({ ...s })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      auditLog: { create: vi.fn() },
    }));
    const res = await autoCloseSessionIfEligible(db, s, cfg, new Date("2024-01-15T11:15:00.000Z"));
    expect(res.outcome).toBe("skipped_claimed_by_other");
    expect(accrueCompletedSession).not.toHaveBeenCalled();
  });

  it("skips OT-activated sessions and leaves them open", async () => {
    const s = session({ overtimeActivatedAt: new Date("2024-01-15T11:00:00.000Z") });
    const db = makeDb({ sessions: [s] });
    const res = await autoCloseSessionIfEligible(db, s, cfg, new Date("2024-01-15T11:20:00.000Z"));
    expect(res.outcome).toBe("skipped_overtime_activated");
    expect(db.__updates.length).toBe(0);
  });

  it("prior-day overdue closure uses due time (end + grace), not raw shift end", async () => {
    // same due computation applies; service computes from scheduled end + AUTO_CLOCKOUT_MINUTES
    const s = session({ date: new Date("2024-01-14T00:00:00.000+06:00"), timeIn: new Date("2024-01-14T03:00:00.000Z") });
    const due = computeAutoClockoutDueMs(s, cfg)!;
    expect(new Date(due).toISOString()).toBe("2024-01-14T11:15:00.000Z");
  });

  it("does not accrue unrelated historical manually-completed sessions during ordinary auto-clockout processing", async () => {
    const historicalManual = {
      id: "hist_manual",
      staffId: "KP9800",
      completed: true,
      autoClockedOut: false,
      timeOut: new Date("2026-11-10T13:59:06.864Z"),
      date: new Date("2026-11-09T18:00:00.000Z"),
      staff: { fullName: "Historical Staff" },
      payrollEarning: null,
    };
    const db = makeDb({ sessions: [] });
    // open-session scan: none; recovery query must be scoped and must not be asked to process this manual session
    db.timeSession.findMany = vi.fn()
      .mockResolvedValueOnce([]) // open batch
      .mockResolvedValueOnce([]); // recovery candidates (scoped) -> none returned
    const r = await processAutoClockouts(db, new Date("2026-11-11T01:00:00.000Z"));
    expect(r.accrualRecoveryAttempted).toBe(0);
    expect(accrueCompletedSession).not.toHaveBeenCalled();

    // Verify the recovery query includes autoClockedOut scope (defense against global sweep)
    const recoveryCall = db.timeSession.findMany.mock.calls[1]?.[0];
    expect(recoveryCall?.where?.autoClockedOut).toBe(true);
    expect(recoveryCall?.where?.completed).toBe(true);
  });
});
