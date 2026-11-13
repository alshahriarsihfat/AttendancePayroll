// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getPayrollSummary } from "./payroll-summary-service";

function makeDb(overrides: any = {}) {
  const db = {
    timeSession: { findMany: async () => overrides.sessions ?? [] },
    payrollEarning: {
      findMany: async () => overrides.earnings ?? [],
      findUnique: async ({ where }: any) => (overrides.earningById ?? {})[where.id] ?? null,
    },
    payment: { findMany: async ({ where }: any) => {
      if (where?.paidAt?.gte) return overrides.paymentsPaidOnDate ?? [];
      if (where?.sessionId?.in) return overrides.legacyPayments ?? [];
      return [];
    } },
    staff: { findMany: async () => overrides.staff ?? [] },
    advanceAdjustment: {
      findMany: async ({ where }: any) => {
        const all = overrides.advanceAdjustments ?? [];
        if (where?.staffId) return all.filter((a: any) => a.staffId === where.staffId);
        return all;
      },
    },
    advanceLog: { findMany: async ({ where }: any) => {
      const all = overrides.advanceLogs ?? [];
      if (where?.staffId) return all.filter((a: any) => a.staffId === where.staffId);
      return all;
    } },
  };
  return db;
}

const d = (iso: string) => new Date(iso);
const staff = (id: string, fullName = id) => ({ employeeId: id, fullName });

describe("getPayrollSummary (mocked db)", () => {
  it("empty data state returns zeroed/empty metrics", async () => {
    const res = await getPayrollSummary(makeDb({}) as any, { date: "2026-11-10" });
    expect(res.date).toBe("2026-11-10");
    expect(res.timezone).toBe("Asia/Dhaka");
    expect(res.summary.todayEarnedAmount).toEqual({ available: true, value: 0 });
    expect(res.summary.totalOutstandingAmount).toEqual({ available: true, value: 0 });
    expect(res.summary.clockedOutCount).toEqual({ available: true, value: 0 });
    expect(res.summary.stillWorkingCount).toEqual({ available: true, value: 0 });
    expect(res.staffPayables.rows).toEqual([]);
    expect(res.staffPayables.total).toBe(0);
  });

  it("Asia/Dhaka date boundary: work date and paidAt range are evaluated in Dhaka context", async () => {
    // Earning work date from periodStart at 18:30Z previous UTC day is 2026-11-11 in +06
    const earnings = [{
      id: "e1", sessionId: "s1", staffId: "ST1", netEarning: 1000, calculationStatus: "CALCULATED",
      periodStart: d("2026-11-10T18:30:00.000Z"), periodEnd: d("2026-11-11T17:59:59.000Z"), periodKind: "DAILY",
      payableHours: 8, incompleteReason: null,
      staff: staff("ST1", "A"), session: { id: "s1", date: d("2026-11-10T18:00:00.000Z"), timeIn: d("x"), timeOut: d("y"), completed: true },
      allocations: [],
    }];
    // Payment paid at 18:10Z (2026-11-11 Dhaka) must be counted for date 2026-11-11, not 2026-11-10
    const paymentsPaidOnDate = [{ id: "p1", staffId: "ST1", sessionId: null, netPay: 400, paidAt: d("2026-11-10T18:10:00.000Z"), date: d("2026-11-11T00:00:00.000Z"), allocations: [{ amount: 400, payrollEarningId: "e1" }] }];
    const res = await getPayrollSummary(makeDb({ earnings, paymentsPaidOnDate, staff: [staff("ST1","A")] }) as any, { date: "2026-11-11" });
    expect(res.summary.todayEarnedAmount).toEqual({ available: true, value: 1000 });
    expect(res.summary.todayPaidAmount).toEqual({ available: true, value: 400 });
    expect(res.summary.todayPaidTowardTodayEarningsAmount).toEqual({ available: true, value: 400 });
  });

  it("today earned total sums only CALCULATED eligible earnings for selected work date", async () => {
    const earnings = [
      { id: "e1", sessionId: "s1", staffId: "ST1", netEarning: 500, calculationStatus: "CALCULATED", periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null, staff: staff("ST1"), session: { id: "s1", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [] },
      { id: "e2", sessionId: "s2", staffId: "ST1", netEarning: 300, calculationStatus: "INCOMPLETE", periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: null, incompleteReason: "MISSING", staff: staff("ST1"), session: { id: "s2", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [] },
      { id: "e3", sessionId: "s3", staffId: "ST1", netEarning: 700, calculationStatus: "CALCULATED", periodStart: d("2026-11-09T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null, staff: staff("ST1"), session: { id: "s3", date: d("2026-11-09T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [] },
    ];
    const res = await getPayrollSummary(makeDb({ earnings, staff: [staff("ST1")] }) as any, { date: "2026-11-10" });
    expect(res.summary.todayEarnedAmount).toEqual({ available: true, value: 500 });
  });

  it("distinguishes today available from historical outstanding and totals", async () => {
    const earnings = [
      { id: "e1", sessionId: "s1", staffId: "ST1", netEarning: 500, calculationStatus: "CALCULATED", periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null, staff: staff("ST1"), session: { id: "s1", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [] },
      { id: "e2", sessionId: "s2", staffId: "ST1", netEarning: 700, calculationStatus: "CALCULATED", periodStart: d("2026-11-08T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null, staff: staff("ST1"), session: { id: "s2", date: d("2026-11-08T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [] },
    ];
    const res = await getPayrollSummary(makeDb({ earnings, staff: [staff("ST1")] }) as any, { date: "2026-11-10" });
    expect(res.summary.todayAvailableAmount).toEqual({ available: true, value: 500 });
    expect(res.summary.todayAvailableFromOlderOutstandingAmount).toEqual({ available: true, value: 700 });
    expect(res.summary.totalOutstandingAmount).toEqual({ available: true, value: 1200 });
  });

  it("today payment toward today earning vs older earning (allocation payments)", async () => {
    const earnings = [
      { id: "eToday", sessionId: "s1", staffId: "ST1", netEarning: 500, calculationStatus: "CALCULATED", periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null, staff: staff("ST1"), session: { id: "s1", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [{ amount: 200, paymentId: "p1" }] },
      { id: "eOld", sessionId: "s2", staffId: "ST1", netEarning: 700, calculationStatus: "CALCULATED", periodStart: d("2026-11-08T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null, staff: staff("ST1"), session: { id: "s2", date: d("2026-11-08T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [{ amount: 100, paymentId: "p1" }] },
    ];
    const paymentsPaidOnDate = [{ id: "p1", staffId: "ST1", sessionId: null, netPay: 300, paidAt: d("2026-11-10T03:00:00.000Z"), date: d("2026-11-10T00:00:00.000Z"), allocations: [{ amount: 200, payrollEarningId: "eToday" }, { amount: 100, payrollEarningId: "eOld" }] }];
    const res = await getPayrollSummary(makeDb({ earnings, paymentsPaidOnDate, staff: [staff("ST1")] }) as any, { date: "2026-11-10" });
    expect(res.summary.todayPaidAmount).toEqual({ available: true, value: 300 });
    expect(res.summary.todayPaidTowardTodayEarningsAmount).toEqual({ available: true, value: 200 });
    expect(res.summary.todayPaidTowardOlderEarningsAmount).toEqual({ available: true, value: 100 });
  });

  it("legacy session settlement exclusion prevents double-counting and re-payment", async () => {
    const earnings = [{
      id: "e1", sessionId: "s1", staffId: "ST1", netEarning: 500, calculationStatus: "CALCULATED",
      periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null,
      staff: staff("ST1"), session: { id: "s1", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true },
      allocations: [{ amount: 999, paymentId: "ghost" }], // would be ignored for legacy-settled
    }];
    const legacyPayments = [{ id: "lp1", sessionId: "s1", staffId: "ST1", netPay: 500, paidAt: d("2026-11-09T10:00:00.000Z"), date: d("2026-11-10T00:00:00.000Z") }];
    const res = await getPayrollSummary(makeDb({ earnings, legacyPayments, staff: [staff("ST1")] }) as any, { date: "2026-11-10" });
    expect(res.summary.todayAvailableAmount).toEqual({ available: true, value: 0 });
    expect(res.summary.totalOutstandingAmount).toEqual({ available: true, value: 0 });
    expect(res.summary.fullyPaidCount).toEqual({ available: true, value: 0 }); // legacy settled handled separately
    const row = res.staffPayables.rows.find(r => r.earningId === "e1");
    expect(row?.paymentStatus).toBe("SETTLED");
    expect(row?.paymentPermitted).toBe(false);
    expect(row?.remainingOutstandingAmount).toBe(0);
    expect(row?.legacySettled).toBe(true);
  });

  it("partial allocation balance and fully settled earning", async () => {
    const earnings = [
      { id: "e1", sessionId: "s1", staffId: "ST1", netEarning: 1000, calculationStatus: "CALCULATED", periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null, staff: staff("ST1"), session: { id: "s1", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [{ amount: 400, paymentId: "p1" }] },
      { id: "e2", sessionId: "s2", staffId: "ST1", netEarning: 600, calculationStatus: "CALCULATED", periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null, staff: staff("ST1"), session: { id: "s2", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [{ amount: 600, paymentId: "p2" }] },
    ];
    const res = await getPayrollSummary(makeDb({ earnings, staff: [staff("ST1")] }) as any, { date: "2026-11-10" });
    const partial = res.staffPayables.rows.find(r => r.earningId === "e1");
    const settled = res.staffPayables.rows.find(r => r.earningId === "e2");
    expect(partial).toMatchObject({ earnedAmount: 1000, previouslyAllocatedAmount: 400, remainingOutstandingAmount: 600, paymentStatus: "PARTIAL", paymentPermitted: true });
    expect(settled).toMatchObject({ earnedAmount: 600, previouslyAllocatedAmount: 600, remainingOutstandingAmount: 0, paymentStatus: "SETTLED", paymentPermitted: false });
    expect(res.summary.partiallyPaidCount).toEqual({ available: true, value: 1 });
    expect(res.summary.fullyPaidCount).toEqual({ available: true, value: 1 });
  });

  it("incomplete earning exclusion: no guessed payable amount, counted, not allocatable", async () => {
    const earnings = [{
      id: "e1", sessionId: "s1", staffId: "ST1", netEarning: 0, calculationStatus: "INCOMPLETE",
      periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: null, incompleteReason: "MISSING_DAILY_DUTY_HOURS",
      staff: staff("ST1"), session: { id: "s1", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true }, allocations: [],
    }];
    const res = await getPayrollSummary(makeDb({ earnings, staff: [staff("ST1")] }) as any, { date: "2026-11-10" });
    expect(res.summary.incompleteEarningCount).toEqual({ available: true, value: 1 });
    expect(res.summary.todayEarnedAmount).toEqual({ available: true, value: 0 });
    expect(res.summary.totalOutstandingAmount).toEqual({ available: true, value: 0 });
    const row = res.staffPayables.rows[0];
    expect(row.earningStatus).toBe("INCOMPLETE");
    expect(row.paymentStatus).toBe("INCOMPLETE");
    expect(row.earnedAmount).toBeNull();
    expect(row.paymentPermitted).toBe(false);
  });

  it("working/not-clocked-out status prevents payment", async () => {
    const sessions = [
      { id: "s1", staffId: "ST1", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: d("x"), timeOut: null, completed: false },
      { id: "s2", staffId: "ST2", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: d("x"), timeOut: d("y"), completed: true },
    ];
    const res = await getPayrollSummary(makeDb({ sessions, staff: [staff("ST1"), staff("ST2")] }) as any, { date: "2026-11-10" });
    expect(res.summary.stillWorkingCount).toEqual({ available: true, value: 1 });
    expect(res.summary.clockedOutCount).toEqual({ available: true, value: 1 });
    const working = res.staffPayables.rows.find(r => r.sessionId === "s1");
    const notReady = res.staffPayables.rows.find(r => r.sessionId === "s2");
    expect(working).toMatchObject({ paymentStatus: "WORKING", paymentPermitted: false, earningStatus: "NONE" });
    expect(notReady).toMatchObject({ paymentStatus: "NOT_READY", paymentPermitted: false, earningStatus: "NONE" });
  });

it("duplicate prevention: each earning contributes once; legacy+alloc sums not double-counted", async () => {
    const earnings = [{
      id: "e1", sessionId: "s1", staffId: "ST1", netEarning: 500, calculationStatus: "CALCULATED",
      periodStart: d("2026-11-10T00:00:00.000+06:00"), periodEnd: null, periodKind: "DAILY", payableHours: 8, incompleteReason: null,
      staff: staff("ST1"), session: { id: "s1", date: d("2026-11-10T00:00:00.000+06:00"), timeIn: 1, timeOut: 2, completed: true },
      allocations: [{ amount: 200, paymentId: "p1" }, { amount: 100, paymentId: "p2" }],
    }];
    const res = await getPayrollSummary(makeDb({ earnings, staff: [staff("ST1")] }) as any, { date: "2026-11-10" });
    expect(res.summary.todayEarnedAmount).toEqual({ available: true, value: 500 });
    expect(res.summary.totalOutstandingAmount).toEqual({ available: true, value: 200 });
    const row = res.staffPayables.rows.find(r => r.earningId === "e1");
    expect(row?.previouslyAllocatedAmount).toBe(300);
    expect(row?.remainingOutstandingAmount).toBe(200);
  });

  it("advance ledger: genuine empty ledger returns empty successful result (not unavailable)", async () => {
    const res = await getPayrollSummary(makeDb({ advanceAdjustments: [], advanceLogs: [] }) as any, { date: "2026-11-10" });
    expect(res.summary.todayAdvanceAdjustmentsAmount).toEqual({ available: true, value: 0 });
    expect(res.summary.outstandingAdvancesAmount).toEqual({ available: true, value: 0 });
    expect(res.advances).toMatchObject({ available: true, items: [], adjustments: [] });
    expect(res.notes.some((n: string) => n.includes("Advance adjustment ledger unavailable"))).toBe(false);
  });

  it("advance ledger: failed query remains explicit error and never fabricates zero balance", async () => {
    const db = makeDb({});
    db.advanceAdjustment = { findMany: async () => { throw new Error("connection reset"); } };
    const res = await getPayrollSummary(db as any, { date: "2026-11-10" });
    expect(res.summary.todayAdvanceAdjustmentsAmount).toEqual({ available: false, reason: expect.stringContaining("ADVANCE_ADJUSTMENT_LEDGER_FAILED") });
    expect(res.summary.outstandingAdvancesAmount).toEqual({ available: true, value: 0 });
    const adv: any = res.advances;
    expect(adv).toMatchObject({ available: false, reason: expect.stringContaining("ADVANCE_ADJUSTMENT_LEDGER_FAILED") });
    expect(adv.items).toEqual([]);
    expect(adv.adjustments).toEqual([]);
    expect(res.notes.some((n: string) => n.includes("Advance adjustment ledger unavailable: ADVANCE_ADJUSTMENT_LEDGER_FAILED"))).toBe(true);
  });

  it("advance ledger: unavailable model (no findMany) surfaces explicit reason without throwing", async () => {
    const db = makeDb({});
    delete (db as any).advanceAdjustment;
    const res = await getPayrollSummary(db as any, { date: "2026-11-10" });
    expect(res.summary.todayAdvanceAdjustmentsAmount).toEqual({ available: false, reason: "ADVANCE_ADJUSTMENT_LEDGER_UNAVAILABLE" });
    const adv2: any = res.advances;
    expect(adv2).toMatchObject({ available: false, reason: "ADVANCE_ADJUSTMENT_LEDGER_UNAVAILABLE", items: [], adjustments: [] });
  });

  it("advance ledger: staff-scoped adjustments are not leaked across staff members", async () => {
    const adjustments = [
      { id: "a1", staffId: "ST1", advanceLogId: "l1", payrollEarningId: "e1", amount: 100, note: null, adjustedAt: d("2026-11-10T00:00:00.000+06:00"), adjustedBy: "Admin", idempotencyKey: "k1", workDate: "2026-11-10" },
      { id: "a2", staffId: "ST2", advanceLogId: "l2", payrollEarningId: "e2", amount: 250, note: null, adjustedAt: d("2026-11-10T00:00:00.000+06:00"), adjustedBy: "Admin", idempotencyKey: "k2", workDate: "2026-11-10" },
    ];
    const res = await getPayrollSummary(makeDb({ advanceAdjustments: adjustments }) as any, { date: "2026-11-10", staffId: "ST1" });
    const adv3: any = res.advances;
    expect(adv3.adjustments).toHaveLength(1);
    expect(adv3.adjustments[0].staffId).toBe("ST1");
    expect(res.summary.todayAdvanceAdjustmentsAmount).toEqual({ available: true, value: 100 });
  });
});

