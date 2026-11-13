// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createAdvanceAdjustment, getEligibleEarningsForStaff, getStaffAdvanceState, adjustmentFingerprint } from "./advance-adjustment-service";

function makeTx(opts: any = {}) {
  const state = {
    staff: opts.staff ?? { employeeId: "S1", fullName: "Staff One", advance: 1000 },
    logs: opts.logs ?? [{ id: "adv1", staffId: "S1", type: "GIVEN", amount: 1000, note: null, createdAt: new Date("2026-11-10T00:00:00Z"), createdBy: "A" }],
    adjustments: [...(opts.adjustments ?? [])],
    earning: opts.earning ?? { id: "e1", staffId: "S1", sessionId: "sess1", netEarning: 800, calculationStatus: "CALCULATED", periodStart: new Date("2026-11-10T00:00:00Z"), session: { date: new Date("2026-11-10T00:00:00Z") } },
    cashAgg: opts.cashAgg ?? { _sum: { amount: 0 } },
    adjAggEarning: opts.adjAggEarning ?? { _sum: { amount: 0 } },
    adjAggAdvance: opts.adjAggAdvance ?? { _sum: { amount: 0 } },
    legacy: opts.legacy ?? null,
    locks: [] as string[],
    audits: [] as any[],
    staffUpdates: [] as any[],
    createConflict: opts.createConflict ?? false,
  };

  const sum = (rows: any[], key: string, by?: any) => rows.filter(by ?? (() => true)).reduce((s, r) => s + (Number(r[key]) || 0), 0);

  const tx: any = {
    $executeRaw: async () => { state.locks.push("locked"); return 1; },
    staff: {
      findUnique: async () => state.staff,
      update: async ({ data }: any) => { state.staffUpdates.push(data); if (data.advance !== undefined) state.staff.advance = data.advance; return state.staff; },
    },
    advanceLog: {
      findMany: async ({ where }: any) => state.logs.filter((l: any) => !where?.staffId || l.staffId === where.staffId),
      findUnique: async ({ where }: any) => state.logs.find((l: any) => (where.id && l.id === where.id)) ?? null,
    },
    advanceAdjustment: {
      findMany: async ({ where }: any) => state.adjustments.filter((a) => (!where?.staffId || a.staffId === where.staffId) && (!where?.payrollEarningId || a.payrollEarningId === where.payrollEarningId) && (!where?.advanceLogId || a.advanceLogId === where.advanceLogId)),
      findUnique: async ({ where }: any) => state.adjustments.find((a) => a.idempotencyKey === where.idempotencyKey || a.id === where.id) ?? null,
      aggregate: async ({ where }: any) => ({ _sum: { amount: sum(state.adjustments, "amount", (a: any) => (!where?.staffId || a.staffId === where.staffId) && (!where?.payrollEarningId || a.payrollEarningId === where.payrollEarningId) && (!where?.advanceLogId || a.advanceLogId === where.advanceLogId)) } }),
      groupBy: async ({ by, where }: any) => {
        const rows = state.adjustments.filter((a) => (!where?.staffId || a.staffId === where.staffId));
        if (by[0] === "advanceLogId") {
          const m = new Map<string, number>();
          for (const r of rows) m.set(r.advanceLogId, (m.get(r.advanceLogId) ?? 0) + r.amount);
          return Array.from(m.entries()).map(([advanceLogId, amount]) => ({ advanceLogId, _sum: { amount } }));
        }
        if (by[0] === "payrollEarningId") {
          const m = new Map<string, number>();
          for (const r of rows.filter((a: any) => !where?.payrollEarningId?.in || where.payrollEarningId.in.includes(a.payrollEarningId))) m.set(r.payrollEarningId, (m.get(r.payrollEarningId) ?? 0) + r.amount);
          return Array.from(m.entries()).map(([payrollEarningId, amount]) => ({ payrollEarningId, _sum: { amount } }));
        }
        return [];
      },
      create: async ({ data }: any) => {
        if (state.createConflict) { const err: any = new Error("conflict"); err.code = "P2002"; throw err; }
        const row = { id: `adj${state.adjustments.length + 1}`, ...data, adjustedAt: new Date("2026-11-11T06:00:00Z"), createdAt: new Date("2026-11-11T06:00:00Z") };
        state.adjustments.push(row);
        state.adjAggEarning = { _sum: { amount: sum(state.adjustments, "amount", (a: any) => a.payrollEarningId === data.payrollEarningId && a.staffId === data.staffId) } };
        state.adjAggAdvance = { _sum: { amount: sum(state.adjustments, "amount", (a: any) => a.advanceLogId === data.advanceLogId && a.staffId === data.staffId) } };
        return row;
      },
    },
    payrollEarning: {
      findUnique: async ({ where }: any) => (state.earning && state.earning.id === where.id ? state.earning : null),
      findMany: async ({ where }: any) => (state.earning && state.earning.staffId === where.staffId && state.earning.calculationStatus === "CALCULATED" ? [state.earning] : []),
    },
    paymentAllocation: {
      aggregate: async () => state.cashAgg,
      groupBy: async () => {
        const amt = Number(state.cashAgg?._sum?.amount ?? 0);
        return amt ? [{ payrollEarningId: state.earning.id, _sum: { amount: amt } }] : [];
      },
      findMany: async () => [],
    },
    payment: {
      findFirst: async () => state.legacy,
      findMany: async () => (state.legacy ? [state.legacy] : []),
    },
    auditLog: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
  };
  return { tx, state };
}

const baseInput = { staffId: "S1", advanceLogId: "adv1", payrollEarningId: "e1", amount: 200, idempotencyKey: "k1", note: "n", actor: { name: "Admin", role: "ADMIN" } as const };

describe("advance-adjustment-service", () => {
  it("computes outstanding advance from GIVEN minus legacy ADJUSTED minus manual adjustments", async () => {
    const { tx } = makeTx({ logs: [
      { id: "adv1", staffId: "S1", type: "GIVEN", amount: 1000, createdAt: new Date(), createdBy: "A" },
      { id: "leg1", staffId: "S1", type: "ADJUSTED", amount: 100, createdAt: new Date(), createdBy: "SYS" },
    ], adjustments: [{ id: "a1", staffId: "S1", advanceLogId: "adv1", payrollEarningId: "e1", amount: 150 }] });
    const st = await getStaffAdvanceState(tx, "S1");
    expect(st.totalGiven).toBe(1000);
    expect(st.totalLegacyAdjusted).toBe(100);
    expect(st.totalManualAdjusted).toBe(150);
    expect(st.outstandingAdvance).toBe(750);
  });

  it("creates partial adjustment, updates derived balances, syncs cache, audits, appends ledger", async () => {
    const { tx, state } = makeTx();
    const res = await createAdvanceAdjustment(tx, baseInput);
    expect(res.ok).toBe(true);
    expect(res.amount).toBe(200);
    expect(res.remainingAdvance).toBe(800);
    expect(res.remainingEarning).toBe(600);
    expect(res.skippedDuplicate).toBe(false);
    expect(state.adjustments).toHaveLength(1);
    expect(state.staff.advance).toBe(800);
    expect(state.audits.some((a) => a.action === "ADVANCE_ADJUSTED")).toBe(true);
  });

  it("supports full adjustment up to min(outstanding advance, remaining eligible earning)", async () => {
    const { tx } = makeTx({ earning: { id: "e1", staffId: "S1", sessionId: "sess1", netEarning: 500, calculationStatus: "CALCULATED", periodStart: new Date(), session: { date: new Date() } } });
    const res = await createAdvanceAdjustment(tx, { ...baseInput, amount: 500 });
    expect(res.remainingEarning).toBe(0);
    expect(res.remainingAdvance).toBe(500);
  });

  it("rejects amount > outstanding advance", async () => {
    const { tx } = makeTx({ staff: { employeeId: "S1", fullName: "S", advance: 100 }, logs: [{ id: "adv1", staffId: "S1", type: "GIVEN", amount: 100, createdAt: new Date(), createdBy: "A" }] });
    await expect(createAdvanceAdjustment(tx, { ...baseInput, amount: 150 })).rejects.toMatchObject({ code: "ADJUSTMENT_EXCEEDS_OUTSTANDING_ADVANCE" });
  });

  it("rejects amount > remaining eligible earning (cash + prior adjustments respected)", async () => {
    const { tx } = makeTx({ cashAgg: { _sum: { amount: 500 } }, adjustments: [{ id: "x", staffId: "S1", advanceLogId: "adv1", payrollEarningId: "e1", amount: 100, idempotencyKey: "old" }] });
    await expect(createAdvanceAdjustment(tx, { ...baseInput, amount: 250, idempotencyKey: "k2" })).rejects.toMatchObject({ code: "ADJUSTMENT_EXCEEDS_ELIGIBLE_EARNING" });
  });

  it("protects cross-staff adjustment", async () => {
    const { tx } = makeTx({ earning: { id: "e1", staffId: "S2", sessionId: "sess1", netEarning: 800, calculationStatus: "CALCULATED", periodStart: new Date(), session: { date: new Date() } } });
    await expect(createAdvanceAdjustment(tx, baseInput)).rejects.toMatchObject({ code: "CROSS_STAFF_EARNING" });
  });

  it("rejects ineligible or legacy-settled earning", async () => {
    const { tx: tx1 } = makeTx({ earning: { id: "e1", staffId: "S1", sessionId: "sess1", netEarning: 0, calculationStatus: "INCOMPLETE", periodStart: new Date(), session: { date: new Date() } } });
    await expect(createAdvanceAdjustment(tx1, baseInput)).rejects.toMatchObject({ code: "EARNING_NOT_ELIGIBLE" });
    const { tx: tx2 } = makeTx({ legacy: { id: "p1", sessionId: "sess1" } });
    await expect(createAdvanceAdjustment(tx2, baseInput)).rejects.toMatchObject({ code: "EARNING_ALREADY_SETTLED" });
  });

  it("replays same idempotency key+payload and rejects different payload", async () => {
    const { tx } = makeTx();
    const first = await createAdvanceAdjustment(tx, baseInput);
    const replay = await createAdvanceAdjustment(tx, baseInput);
    expect(replay.skippedDuplicate).toBe(true);
    expect(replay.adjustmentId).toBe(first.adjustmentId);
    const st = await getStaffAdvanceState(tx, "S1");
    expect(st.totalManualAdjusted).toBe(200);
    await expect(createAdvanceAdjustment(tx, { ...baseInput, amount: 250 })).rejects.toMatchObject({ code: "ADVANCE_ADJUSTMENT_IDEMPOTENCY_MISMATCH" });
  });

  it("maps concurrent duplicate create conflict to safe conflict error", async () => {
    const { tx } = makeTx({ createConflict: true });
    await expect(createAdvanceAdjustment(tx, baseInput)).rejects.toMatchObject({ code: "ADVANCE_ADJUSTMENT_CONFLICT" });
  });

  it("eligible earnings exclude fully paid/adjusted and respect cash+manual adjustments", async () => {
    const { tx } = makeTx({ cashAgg: { _sum: { amount: 300 } }, adjustments: [{ id: "x", staffId: "S1", advanceLogId: "adv1", payrollEarningId: "e1", amount: 100, idempotencyKey: "old" }] });
    const elig = await getEligibleEarningsForStaff(tx, "S1");
    expect(elig).toHaveLength(1);
    expect(elig[0].remainingEligible).toBe(400);
    const { tx: tx2 } = makeTx({ cashAgg: { _sum: { amount: 800 } } });
    expect(await getEligibleEarningsForStaff(tx2, "S1")).toHaveLength(0);
  });
});

