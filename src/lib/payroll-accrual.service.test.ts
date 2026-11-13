// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { accrueCompletedSession } from "./payroll-accrual-service";

const cfg = { MEAL_BREAK_MINUTES: "30", REST_BREAK_MINUTES: "15", OVERTIME_MULTIPLIER: "1.0" };
const actor = { name: "Tester", role: "ADMIN" as const };

function baseSession(o: any = {}) {
  return {
    id: "sess1", staffId: "E1", date: new Date("2024-01-15T00:00:00+06:00"), completed: true,
    timeIn: new Date("2024-01-15T03:00:00Z"), timeOut: new Date("2024-01-15T11:00:00Z"),
    breaks: [], extraTime: [], goOuts: [], overtimeStatus: "NotRequired", overtimeMinutes: 0,
    shiftStartMin: 540, shiftEndMin: 1020, dailyDutyHoursSnapshot: 8, ...o,
  };
}
function baseStaff(o: any = {}) {
  // 2C.6.2: active earning requires configured hourlyRate + dailyDutyHours.
  return { employeeId: "E1", fullName: "T", salaryType: "DAILY", baseSalary: 0, dailyRate: 0, hourlyRate: 100, dailyDutyHours: 8, workingDaysPerWeek: null, ...o };
}

function makeTx(opts: { existing?: any; createThrowsP2002?: boolean; session?: any; staff?: any; allocCount?: number; legacyPayment?: any; updateManyCount?: number }) {
  const session = opts.session ?? baseSession();
  const staff = opts.staff ?? baseStaff();
  const updates: any[] = [];
  const earningUpdates: any[] = [];
  const audits: any[] = [];
  return {
    updates, earningUpdates, audits,
    tx: {
      timeSession: { findUnique: vi.fn(async () => session), update: vi.fn(async (a: any) => { updates.push(a); return a; }) },
      staff: { findUnique: vi.fn(async () => staff) },
      paymentAllocation: { count: vi.fn(async () => opts.allocCount ?? 0) },
      payment: { findFirst: vi.fn(async () => opts.legacyPayment ?? null) },
      payrollEarning: {
        findUnique: vi.fn(async () => (opts.existing ?? (opts.createThrowsP2002 ? { id: "won", calculationStatus: "CALCULATED" } : null))),
        create: vi.fn(async () => { if (opts.createThrowsP2002) { const e: any = new Error("dup"); e.code = "P2002"; throw e; } return { id: "earn1" }; }),
        updateMany: vi.fn(async (a: any) => { earningUpdates.push(a); return { count: opts.updateManyCount ?? 1 }; }),
      },
      auditLog: { create: vi.fn(async (a: any) => { audits.push(a); return a; }) },
    },
  };
}

describe("accrueCompletedSession integrity/recovery (mocked tx)", () => {
  it("duplicate create attempt returns EXISTS without overwriting", async () => {
    const { tx, updates, audits } = makeTx({ existing: { id: "existing1", calculationStatus: "CALCULATED" } });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "RETRY", config: cfg });
    expect(r.skipped).toBe("EXISTS");
    expect(r.earningId).toBe("existing1");
    expect(updates.length).toBe(0);
    expect(audits.length).toBe(0);
  });

  it("concurrent create race (P2002) resolves to EXISTS idempotently", async () => {
    const { tx } = makeTx({ createThrowsP2002: true });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "CLOCK_OUT", config: cfg });
    expect(r.skipped).toBe("EXISTS");
    expect(r.earningId).toBe("won");
  });

  it("failed ledger write propagates (safe retry path)", async () => {
    const base = makeTx({});
    base.tx.payrollEarning.create = vi.fn(async () => { throw new Error("DB_DOWN"); });
    await expect(accrueCompletedSession(base.tx as any, { sessionId: "sess1", actor, source: "CLOCK_OUT", config: cfg })).rejects.toThrow("DB_DOWN");
  });

  it("missing config creates INCOMPLETE with explicit reason", async () => {
    const { tx } = makeTx({ session: baseSession({ dailyDutyHoursSnapshot: null }), staff: baseStaff({ dailyDutyHours: null }) });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "CLOCK_OUT", config: cfg });
    expect(r.created).toBe(true);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.reason).toBe("MISSING_DAILY_DUTY_HOURS");
  });

  it("INCOMPLETE earning recovers to CALCULATED via authorized RETRY (same earning, no duplicate)", async () => {
    const { tx, earningUpdates, updates, audits } = makeTx({ existing: { id: "earn1", calculationStatus: "INCOMPLETE" } });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "RETRY", config: cfg });
    expect(r.created).toBe(false);
    expect(r.recovered).toBe(true);
    expect(r.status).toBe("CALCULATED");
    expect(r.earningId).toBe("earn1");
    expect(earningUpdates.length).toBe(1);
    expect(earningUpdates[0].where.calculationStatus).toBe("INCOMPLETE");
    expect(updates.length).toBe(1);
    expect(audits[0].data.action).toBe("PAYROLL_ACCRUAL_RECOVERED");
  });

  it("still-missing config keeps INCOMPLETE with safe reason update", async () => {
    const { tx, earningUpdates, audits } = makeTx({ existing: { id: "earn1", calculationStatus: "INCOMPLETE" }, session: baseSession({ dailyDutyHoursSnapshot: null }), staff: baseStaff({ dailyDutyHours: null }) });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "RETRY", config: cfg });
    expect(r.recovered).toBe(true);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.reason).toBe("MISSING_DAILY_DUTY_HOURS");
    expect(earningUpdates.length).toBe(1);
    expect(audits[0].data.action).toBe("PAYROLL_ACCRUAL_INCOMPLETE_RETAINED");
  });

  it("allocated earning cannot be recalculated", async () => {
    const { tx, earningUpdates } = makeTx({ existing: { id: "earn1", calculationStatus: "INCOMPLETE" }, allocCount: 1 });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "RETRY", config: cfg });
    expect(r.skipped).toBe("EARNING_LOCKED_SETTLED");
    expect(earningUpdates.length).toBe(0);
  });

  it("legacy-paid earning cannot be recalculated", async () => {
    const { tx, earningUpdates } = makeTx({ existing: { id: "earn1", calculationStatus: "INCOMPLETE" }, legacyPayment: { id: "p1" } });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "RETRY", config: cfg });
    expect(r.skipped).toBe("EARNING_LOCKED_SETTLED");
    expect(earningUpdates.length).toBe(0);
  });

  it("existing CALCULATED earning is not overwritten by normal RETRY", async () => {
    const { tx, earningUpdates } = makeTx({ existing: { id: "earn1", calculationStatus: "CALCULATED" } });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "RETRY", config: cfg });
    expect(r.skipped).toBe("EXISTS");
    expect(r.recovered).not.toBe(true);
    expect(earningUpdates.length).toBe(0);
  });

  it("concurrent recovery updateMany count=0 is safe (no partial corruption path)", async () => {
    const { tx, updates } = makeTx({ existing: { id: "earn1", calculationStatus: "INCOMPLETE" }, updateManyCount: 0 });
    // after failed conditional update, findUnique returns current row
    tx.payrollEarning.findUnique = vi.fn().mockResolvedValueOnce({ id: "earn1", calculationStatus: "INCOMPLETE" }).mockResolvedValueOnce({ id: "earn1", calculationStatus: "CALCULATED" });
    const r = await accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "RETRY", config: cfg });
    expect(r.skipped).toBe("EXISTS");
    expect(updates.length).toBe(0);
  });

  it("failed recovery update propagates without session snapshot mutation", async () => {
    const { tx, updates } = makeTx({ existing: { id: "earn1", calculationStatus: "INCOMPLETE" } });
    tx.payrollEarning.updateMany = vi.fn(async () => { throw new Error("TX_FAIL"); });
    await expect(accrueCompletedSession(tx as any, { sessionId: "sess1", actor, source: "RETRY", config: cfg })).rejects.toThrow("TX_FAIL");
    expect(updates.length).toBe(0);
  });
});
