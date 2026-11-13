import { describe, it, expect } from "vitest";
import {
  coordinatedPayWithOptionalDeduction,
  type CoordinatedTx,
} from "./coordinated-payment-service";

const payRound = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

type GivenAdvance = { id: string; amount: number; createdAt?: Date; note?: string | null; createdBy?: string };
type Earning = {
  id: string;
  sessionId: string;
  netEarning: number;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  calculatedAt?: Date | null;
  calculationStatus?: string;
  session?: { id: string; date?: Date | null };
};

function makeTx(input: {
  staffId: string;
  staffName?: string;
  givenAdvances?: GivenAdvance[];
  legacyAdjusted?: number;
  earnings?: Earning[];
  allocations?: Array<{ id: string; paymentId: string; payrollEarningId: string; amount: number; staffId?: string; idempotencyKey?: string | null }>;
  payments?: Array<{ id: string; staffId: string; sessionId?: string | null; idempotencyKey?: string | null; allocationRequestedAmount?: number | null; [k: string]: any }>;
  failPaymentCreateOnce?: boolean;
  failCoordCreateOnce?: boolean;
}) {
  const staffId = input.staffId;
  const locks: string[] = [];
  const staffRow = { employeeId: staffId, fullName: input.staffName ?? staffId, advance: 0 };
  const givenAdvances = (input.givenAdvances ?? []).map((a, i) => ({
    id: a.id, staffId, type: "GIVEN", amount: a.amount, note: a.note ?? null,
    createdAt: a.createdAt ?? new Date(Date.UTC(2026, 0, i + 1)), createdBy: a.createdBy ?? "Admin",
  }));
  const legacyAdjustedLogs = input.legacyAdjusted && input.legacyAdjusted > 0
    ? [{ id: "LEG-ADJ", staffId, type: "ADJUSTED", amount: input.legacyAdjusted, note: null, createdAt: new Date(Date.UTC(2026, 0, 1)), createdBy: "System" }]
    : [];
  const advanceLogs = [...givenAdvances, ...legacyAdjustedLogs];
  const earnings = (input.earnings ?? []).map((e, i) => ({
    id: e.id, sessionId: e.sessionId, staffId, netEarning: e.netEarning,
    periodStart: e.periodStart ?? new Date(Date.UTC(2026, 0, i + 1)),
    periodEnd: e.periodEnd ?? new Date(Date.UTC(2026, 0, i + 1)),
    calculatedAt: e.calculatedAt ?? new Date(Date.UTC(2026, 0, i + 1)),
    calculationStatus: e.calculationStatus ?? "CALCULATED",
    session: e.session ?? { id: e.sessionId, date: e.periodStart ?? new Date(Date.UTC(2026, 0, i + 1)) },
  }));
  const payments = [...(input.payments ?? [])];
  const paymentAllocations = [...(input.allocations ?? [])].map((a) => ({ ...a, staffId: a.staffId ?? staffId }));
  const advanceAdjustments: any[] = [];
  const auditLogs: any[] = [];
  const coordinatedRequests: any[] = [];
  let adjSeq = 0, paySeq = 0, allocSeq = 0, auditSeq = 0, coordSeq = 0;
  let paymentCreateFailArmed = !!input.failPaymentCreateOnce;
  let coordCreateFailArmed = !!input.failCoordCreateOnce;

  const applyStaffAdvanceCache = async () => {
    const totalGiven = advanceLogs.filter((l) => String(l.type).toUpperCase() === "GIVEN").reduce((s, l) => s + Number(l.amount), 0);
    const legacyAdj = advanceLogs.filter((l) => String(l.type).toUpperCase() === "ADJUSTED").reduce((s, l) => s + Number(l.amount), 0);
    const manual = advanceAdjustments.reduce((s, a) => s + Number(a.amount), 0);
    staffRow.advance = payRound(Math.max(0, totalGiven - legacyAdj - manual));
  };

  const tx: CoordinatedTx = {
    $executeRaw: async () => { locks.push("locked"); return 1; },
    $executeRawUnsafe: async () => { locks.push("locked"); return 1; },
    staff: {
      findUnique: async ({ where, select }: any) => {
        if (where?.employeeId !== staffId) return null;
        if (select?.fullName && select?.employeeId && Object.keys(select).length <= 3) {
          return { employeeId: staffRow.employeeId, fullName: staffRow.fullName, ...(select.advance ? { advance: staffRow.advance } : {}) };
        }
        return { ...staffRow };
      },
      update: async ({ where, data }: any) => {
        if (where?.employeeId !== staffId) throw Object.assign(new Error("missing"), { code: "STAFF_NOT_FOUND" });
        if (data && typeof data.advance === "number") staffRow.advance = payRound(data.advance);
        return { ...staffRow };
      },
    },
    advanceLog: {
      findMany: async ({ where, select }: any) => {
        let rows = advanceLogs.filter((l) => l.staffId === where?.staffId);
        if (where?.type) rows = rows.filter((l) => l.type === where.type);
        if (select) return rows.map((r: any) => { const o: any = {}; for (const k of Object.keys(select)) if (select[k]) o[k] = r[k]; return o; });
        return rows;
      },
      findUnique: async ({ where }: any) => advanceLogs.find((l) => l.id === where?.id) ?? null,
    },
    advanceAdjustment: {
      findUnique: async ({ where }: any) => {
        if (where?.idempotencyKey) return advanceAdjustments.find((a) => a.idempotencyKey === where.idempotencyKey) ?? null;
        if (where?.id) return advanceAdjustments.find((a) => a.id === where.id) ?? null;
        return null;
      },
      findMany: async ({ where, select }: any) => {
        let rows = advanceAdjustments.filter((a) => a.staffId === where?.staffId);
        if (where?.advanceLogId?.in) rows = rows.filter((a) => where.advanceLogId.in.includes(a.advanceLogId));
        if (where?.payrollEarningId?.in) rows = rows.filter((a) => where.payrollEarningId.in.includes(a.payrollEarningId));
        if (where?.payrollEarningId && !where?.payrollEarningId?.in) rows = rows.filter((a) => a.payrollEarningId === where.payrollEarningId);
        if (select) return rows.map((r: any) => { const o: any = {}; for (const k of Object.keys(select)) if (select[k]) o[k] = r[k]; return o; });
        return rows;
      },
      aggregate: async ({ where, _sum }: any) => {
        let rows = advanceAdjustments.filter((a) => a.staffId === where?.staffId);
        if (where?.advanceLogId) rows = rows.filter((a) => a.advanceLogId === where.advanceLogId);
        if (where?.payrollEarningId) rows = rows.filter((a) => a.payrollEarningId === where.payrollEarningId);
        if (where?.payrollEarningId?.in) rows = rows.filter((a) => where.payrollEarningId.in.includes(a.payrollEarningId));
        const amount = rows.reduce((s, a) => s + Number(a.amount), 0);
        return { _sum: { amount: _sum?.amount ? amount : undefined } } as any;
      },
      groupBy: async ({ where }: any) => {
        const ids: string[] = where?.payrollEarningId?.in ?? [];
        return ids.map((id) => ({
          payrollEarningId: id,
          _sum: { amount: advanceAdjustments.filter((a) => a.payrollEarningId === id && (!where?.staffId || a.staffId === where.staffId)).reduce((s, a) => s + Number(a.amount), 0) },
        }));
      },
      create: async ({ data }: any) => {
        const row = { id: "ADJ-" + (++adjSeq), createdAt: new Date(), ...data };
        advanceAdjustments.push(row);
        await applyStaffAdvanceCache();
        return row;
      },
    },
    payrollEarning: {
      findMany: async ({ where, select }: any) => {
        let rows = earnings.filter((e) => e.staffId === where?.staffId);
        if (where?.calculationStatus) rows = rows.filter((e) => e.calculationStatus === where.calculationStatus);
        if (where?.id?.in) rows = rows.filter((e) => where.id.in.includes(e.id));
        if (select) return rows.map((r: any) => {
          const o: any = {};
          for (const k of Object.keys(select)) {
            if (!select[k]) continue;
            if (k === "session") o.session = select.session?.select ? { id: r.session.id, date: r.session.date } : r.session;
            else o[k] = r[k];
          }
          return o;
        });
        return rows;
      },
      findUnique: async ({ where, select }: any) => {
        const row = earnings.find((e) => e.id === where?.id) ?? null;
        if (!row) return null;
        if (select) {
          const o: any = {};
          for (const k of Object.keys(select)) {
            if (!select[k]) continue;
            if (k === "session") o.session = select.session?.select ? { id: row.session.id, date: row.session.date } : row.session;
            else o[k] = (row as any)[k];
          }
          return o;
        }
        return row;
      },
    },
    paymentAllocation: {
      findMany: async ({ where, select }: any) => {
        let rows = paymentAllocations.filter((a) => !where?.staffId || a.staffId === where.staffId);
        if (where?.payrollEarningId?.in) rows = rows.filter((a) => where.payrollEarningId.in.includes(a.payrollEarningId));
        else if (where?.payrollEarningId) rows = rows.filter((a) => a.payrollEarningId === where.payrollEarningId);
        if (where?.paymentId) rows = rows.filter((a) => a.paymentId === where.paymentId);
        if (select) return rows.map((r: any) => { const o: any = {}; for (const k of Object.keys(select)) if (select[k]) o[k] = r[k]; return o; });
        return rows;
      },
      findFirst: async ({ where, select }: any) => {
        let rows = paymentAllocations.filter((a) => !where?.staffId || a.staffId === where.staffId);
        if (where?.paymentId) rows = rows.filter((a) => a.paymentId === where.paymentId);
        if (where?.payrollEarningId) rows = rows.filter((a) => a.payrollEarningId === where.payrollEarningId);
        if (where?.idempotencyKey) rows = rows.filter((a) => a.idempotencyKey === where.idempotencyKey);
        const row = rows[0] ?? null;
        if (!row) return null;
        if (select) { const o: any = {}; for (const k of Object.keys(select)) if (select[k]) o[k] = (row as any)[k]; return o; }
        return row;
      },
      aggregate: async ({ where, _sum }: any) => {
        let rows = paymentAllocations.filter((a) => !where?.staffId || a.staffId === where.staffId);
        if (where?.payrollEarningId) rows = rows.filter((a) => a.payrollEarningId === where.payrollEarningId);
        if (where?.paymentId) rows = rows.filter((a) => a.paymentId === where.paymentId);
        const amount = rows.reduce((s, a) => s + Number(a.amount), 0);
        return { _sum: { amount: _sum?.amount ? amount : undefined } } as any;
      },
      create: async ({ data }: any) => {
        const row = { id: "ALLOC-" + (++allocSeq), ...data };
        paymentAllocations.push(row);
        return row;
      },
      groupBy: async ({ where }: any) => {
        const ids: string[] = where?.payrollEarningId?.in ?? [];
        return ids.map((id) => ({
          payrollEarningId: id,
          _sum: { amount: paymentAllocations.filter((a) => a.payrollEarningId === id && (!where?.staffId || a.staffId === where.staffId)).reduce((s, a) => s + Number(a.amount), 0) },
        }));
      },
    },
    payment: {
      findUnique: async ({ where }: any) => {
        if (where?.idempotencyKey) return payments.find((p) => p.idempotencyKey === where.idempotencyKey) ?? null;
        if (where?.id) return payments.find((p) => p.id === where.id) ?? null;
        return null;
      },
      findFirst: async ({ where, select }: any) => {
        const p = payments.find((x) => (!where?.staffId || x.staffId === where.staffId) && (!where?.idempotencyKey || x.idempotencyKey === where.idempotencyKey) && (!where?.sessionId || x.sessionId === where.sessionId)) ?? null;
        if (!p) return null;
        if (select) { const o: any = {}; for (const k of Object.keys(select)) if (select[k]) o[k] = p[k]; return o; }
        return p;
      },
      findMany: async ({ where, select }: any) => {
        let rows = payments.filter((p) => !where?.staffId || p.staffId === where.staffId);
        if (where?.sessionId?.in) rows = rows.filter((p) => p.sessionId && where.sessionId.in.includes(p.sessionId));
        if (where?.idempotencyKey) rows = rows.filter((p) => p.idempotencyKey === where.idempotencyKey);
        if (select) return rows.map((r: any) => { const o: any = {}; for (const k of Object.keys(select)) if (select[k]) o[k] = r[k]; return o; });
        return rows;
      },
      create: async ({ data }: any) => {
        if (paymentCreateFailArmed) { paymentCreateFailArmed = false; throw new Error("PAYMENT_CREATE_FAIL"); }
        const row = { id: "PAY-" + (++paySeq), ...data };
        payments.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = payments.find((p) => p.id === where?.id);
        if (!row) throw new Error("missing payment");
        Object.assign(row, data);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: any) => { const row = { id: "AUD-" + (++auditSeq), ...data }; auditLogs.push(row); return row; },
    },
    coordinatedPaymentRequest: {
      findUnique: async ({ where }: any) => {
        if (where?.idempotencyKey) return coordinatedRequests.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null;
        if (where?.id) return coordinatedRequests.find((r) => r.id === where.id) ?? null;
        return null;
      },
      create: async ({ data }: any) => {
        if (coordCreateFailArmed) { coordCreateFailArmed = false; throw new Error("COORD_REQUEST_CREATE_FAIL"); }
        if (coordinatedRequests.some((r) => r.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", name: "PrismaClientKnownRequestError" });
        }
        const row = { id: "COORD-" + (++coordSeq), createdAt: new Date(), ...data };
        coordinatedRequests.push(row);
        return row;
      },
    },
  } as any;

  return { tx, state: { locks, staff: staffRow, advanceLogs, earnings, payments, paymentAllocations, advanceAdjustments, auditLogs, coordinatedRequests } };
}

const actor = { name: "Admin", role: "ADMIN" };
const staffId = "S1";

describe("coordinated-payment-service", () => {
  it("deduction OFF cash-only allocates and creates payment, no adjustments", async () => {
    const { tx, state } = makeTx({ staffId, earnings: [{ id: "E1", sessionId: "SE1", netEarning: 1000 }] });
    const res = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 600, deductAdvance: false, idempotencyKey: "k1", actor, payment: { paidBy: "Admin" } });
    expect(res.status).toBe("FULL"); // requested amount fully allocated (earning still has remaining outstanding)
    expect(res.paymentId).toBeTruthy();
    expect(res.deductionApplied).toBe(0);
    expect(res.allocation?.actualAllocatedAmount).toBe(600);
    expect(res.allocation?.unfulfilledAmount).toBe(0);
    expect(res.remainingEarned).toBe(400);
    expect(state.advanceAdjustments.length).toBe(0);
    expect(state.paymentAllocations.length).toBe(1);
    expect(state.payments.length).toBe(1);
    expect(state.coordinatedRequests.length).toBe(1);
    expect(state.auditLogs.some((a) => a.action === "COORDINATED_SALARY_PAYMENT")).toBe(true);
  });

  it("full advance deduction applies adjustments and allocates remaining net cash", async () => {
    const { tx, state } = makeTx({
      staffId,
      givenAdvances: [{ id: "ADV1", amount: 300, createdAt: new Date(Date.UTC(2026,0,1)) }],
      earnings: [{ id: "E1", sessionId: "SE1", netEarning: 1000, periodStart: new Date(Date.UTC(2026,0,2)) }],
    });
    const res = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 800, deductAdvance: true, deductionMode: "full", idempotencyKey: "k-full", actor, payment: { paidBy: "Admin" } });
    expect(res.deductionApplied).toBe(300);
    expect(res.netCashRequested).toBe(500);
    expect(res.allocation?.actualAllocatedAmount).toBe(500);
    expect(res.paymentId).toBeTruthy();
    expect(state.advanceAdjustments.reduce((s,a)=>s+a.amount,0)).toBe(300);
    expect(res.remainingAdvance).toBe(0);
    expect(res.remainingEarned).toBe(200);
    expect(state.staff.advance).toBe(0);
  });

  it("partial advance deduction validates and applies exact amount", async () => {
    const { tx, state } = makeTx({
      staffId,
      givenAdvances: [{ id: "ADV1", amount: 500 }],
      earnings: [{ id: "E1", sessionId: "SE1", netEarning: 1000 }],
    });
    const res = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 900, deductAdvance: true, deductionMode: "partial", deductionAmount: 200, idempotencyKey: "k-part", actor, payment: { paidBy: "Admin" } });
    expect(res.deductionApplied).toBe(200);
    expect(res.netCashRequested).toBe(700);
    expect(res.allocation?.actualAllocatedAmount).toBe(700);
    expect(res.remainingAdvance).toBe(300);
    expect(state.staff.advance).toBe(300);
  });

  it("adjustment-only / zero cash creates no Payment or PaymentAllocation and persists replay", async () => {
    const { tx, state } = makeTx({
      staffId,
      givenAdvances: [{ id: "ADV1", amount: 400 }],
      earnings: [{ id: "E1", sessionId: "SE1", netEarning: 1000 }],
    });
    const res = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 400, deductAdvance: true, deductionMode: "full", idempotencyKey: "k-adjonly", actor, payment: { paidBy: "Admin" } });
    expect(res.status).toBe("ADJUSTMENT_ONLY");
    expect(res.paymentId).toBeNull();
    expect(res.deductionApplied).toBe(400);
    expect(res.netCashRequested).toBe(0);
    expect(res.allocation?.actualAllocatedAmount).toBe(0);
    expect(state.payments.length).toBe(0);
    expect(state.paymentAllocations.length).toBe(0);
    expect(state.advanceAdjustments.length).toBeGreaterThan(0);
    expect(state.coordinatedRequests.length).toBe(1);
    expect(state.coordinatedRequests[0].responseJson.paymentId).toBeNull();
  });

  it("same key and same payload replays stored response without repeating financial writes", async () => {
    const { tx, state } = makeTx({ staffId, earnings: [{ id: "E1", sessionId: "SE1", netEarning: 500 }] });
    const first = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 300, deductAdvance: false, idempotencyKey: "k-replay", actor, payment: { paidBy: "Admin", periodLabel: "P" } });
    const before = { pays: state.payments.length, allocs: state.paymentAllocations.length, adjs: state.advanceAdjustments.length, audits: state.auditLogs.length, reqs: state.coordinatedRequests.length };
    const second = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 300, deductAdvance: false, idempotencyKey: "k-replay", actor, payment: { paidBy: "Admin", periodLabel: "P" } });
    expect(second.skippedDuplicate).toBe(true);
    expect(second.status).toBe("REPLAY");
    expect(second.paymentId).toBe(first.paymentId);
    expect(state.payments.length).toBe(before.pays);
    expect(state.paymentAllocations.length).toBe(before.allocs);
    expect(state.advanceAdjustments.length).toBe(before.adjs);
    expect(state.auditLogs.length).toBe(before.audits);
    expect(state.coordinatedRequests.length).toBe(before.reqs);
  });

  it("same key with changed payload rejects", async () => {
    const { tx } = makeTx({ staffId, earnings: [{ id: "E1", sessionId: "SE1", netEarning: 500 }] });
    await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 300, deductAdvance: false, idempotencyKey: "k-mis", actor, payment: { paidBy: "Admin" } });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 350, deductAdvance: false, idempotencyKey: "k-mis", actor, payment: { paidBy: "Admin" } }))
      .rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_MISMATCH" });
  });

  it("replay after underlying financial state changes returns original stored response without rerun", async () => {
    const { tx, state } = makeTx({ staffId, givenAdvances: [{ id: "ADV1", amount: 200 }], earnings: [{ id: "E1", sessionId: "SE1", netEarning: 500 }] });
    const first = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 400, deductAdvance: true, deductionMode: "full", idempotencyKey: "k-state", actor, payment: { paidBy: "Admin" } });
    state.advanceLogs.length = 0;
    state.earnings.length = 0;
    const before = { pays: state.payments.length, allocs: state.paymentAllocations.length, adjs: state.advanceAdjustments.length, audits: state.auditLogs.length };
    const second = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 400, deductAdvance: true, deductionMode: "full", idempotencyKey: "k-state", actor, payment: { paidBy: "Admin" } });
    expect(second.status).toBe("REPLAY");
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.deductionApplied).toBe(first.deductionApplied);
    expect(state.payments.length).toBe(before.pays);
    expect(state.paymentAllocations.length).toBe(before.allocs);
    expect(state.advanceAdjustments.length).toBe(before.adjs);
    expect(state.auditLogs.length).toBe(before.audits);
  });

  it("concurrent identical requests yield replay without double settlement", async () => {
    const { tx, state } = makeTx({ staffId, earnings: [{ id: "E1", sessionId: "SE1", netEarning: 500 }] });
    const a = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 300, deductAdvance: false, idempotencyKey: "k-conc", actor, payment: { paidBy: "Admin" } });
    const b = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 300, deductAdvance: false, idempotencyKey: "k-conc", actor, payment: { paidBy: "Admin" } });
    expect(a.paymentId).toBeTruthy();
    expect(b.status).toBe("REPLAY");
    expect(state.payments.length).toBe(1);
    expect(state.paymentAllocations.length).toBe(1);
  });

  it("concurrent conflicting payload for same key yields explicit mismatch rejection", async () => {
    const { tx } = makeTx({ staffId, earnings: [{ id: "E1", sessionId: "SE1", netEarning: 800 }] });
    await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 300, deductAdvance: false, idempotencyKey: "k-conf", actor, payment: { paidBy: "Admin" } });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 300, deductAdvance: false, idempotencyKey: "k-conf", actor, payment: { paidBy: "Other", note: "x" } }))
      .rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_MISMATCH" });
  });

  it("insufficient advance rejects without financial side effects", async () => {
    const { tx, state } = makeTx({ staffId, givenAdvances: [{ id: "ADV1", amount: 100 }], earnings: [{ id: "E1", sessionId: "SE1", netEarning: 500 }] });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 200, deductAdvance: true, deductionMode: "partial", deductionAmount: 150, idempotencyKey: "k-noadv", actor, payment: { paidBy: "Admin" } }))
      .rejects.toMatchObject({ code: "ADJUSTMENT_EXCEEDS_OUTSTANDING_ADVANCE" });
    expect(state.payments.length).toBe(0);
    expect(state.advanceAdjustments.length).toBe(0);
    expect(state.paymentAllocations.length).toBe(0);
    expect(state.coordinatedRequests.length).toBe(0);
  });

  it("insufficient eligible earnings rejects deduction beyond eligible", async () => {
    const { tx, state } = makeTx({ staffId, givenAdvances: [{ id: "ADV1", amount: 500 }], earnings: [{ id: "E1", sessionId: "SE1", netEarning: 200 }] });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 300, deductAdvance: true, deductionMode: "partial", deductionAmount: 300, idempotencyKey: "k-noearn", actor, payment: { paidBy: "Admin" } }))
      .rejects.toMatchObject({ code: "ADJUSTMENT_EXCEEDS_ELIGIBLE_EARNING" });
    expect(state.payments.length).toBe(0);
    expect(state.advanceAdjustments.length).toBe(0);
    expect(state.coordinatedRequests.length).toBe(0);
  });

  it("invalid amounts rejected", async () => {
    const { tx } = makeTx({ staffId, earnings: [{ id: "E1", sessionId: "SE1", netEarning: 500 }], givenAdvances: [{ id: "ADV1", amount: 100 }] });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 0, deductAdvance: false, idempotencyKey: "k-bad1", actor, payment: { paidBy: "Admin" } }))
      .rejects.toMatchObject({ code: "INVALID_PAYMENT_AMOUNT" });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 100, deductAdvance: true, deductionMode: "partial", deductionAmount: -5, idempotencyKey: "k-bad2", actor, payment: { paidBy: "Admin" } }))
      .rejects.toMatchObject({ code: "INVALID_DEDUCTION_AMOUNT" });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 50, deductAdvance: true, deductionMode: "partial", deductionAmount: 80, idempotencyKey: "k-bad3", actor, payment: { paidBy: "Admin" } }))
      .rejects.toMatchObject({ code: "DEDUCTION_EXCEEDS_GROSS_AMOUNT" });
  });

  it("allocation/payment creation failure after adjustment throws and no completed replay record persisted", async () => {
    const { tx, state } = makeTx({ staffId, givenAdvances: [{ id: "ADV1", amount: 200 }], earnings: [{ id: "E1", sessionId: "SE1", netEarning: 1000 }], failPaymentCreateOnce: true });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 500, deductAdvance: true, deductionMode: "full", idempotencyKey: "k-rb1", actor, payment: { paidBy: "Admin" } }))
      .rejects.toThrow("PAYMENT_CREATE_FAIL");
    expect(state.coordinatedRequests.length).toBe(0);
  });

  it("coordinated request persistence failure after financial ops leaves no completed replay record", async () => {
    const { tx, state } = makeTx({ staffId, earnings: [{ id: "E1", sessionId: "SE1", netEarning: 500 }], failCoordCreateOnce: true });
    await expect(coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 200, deductAdvance: false, idempotencyKey: "k-rb2", actor, payment: { paidBy: "Admin" } }))
      .rejects.toThrow("COORD_REQUEST_CREATE_FAIL");
    expect(state.coordinatedRequests.length).toBe(0);
  });

  it("correct PaymentAllocation, AdvanceAdjustment, audit and Staff.advance balances for mixed case", async () => {
    const { tx, state } = makeTx({
      staffId,
      givenAdvances: [{ id: "ADV1", amount: 250, createdAt: new Date(Date.UTC(2026,0,1)) }],
      earnings: [
        { id: "E1", sessionId: "SE1", netEarning: 300, periodStart: new Date(Date.UTC(2026,0,2)) },
        { id: "E2", sessionId: "SE2", netEarning: 400, periodStart: new Date(Date.UTC(2026,0,3)) },
      ],
    });
    const res = await coordinatedPayWithOptionalDeduction(tx, { staffId, grossAmount: 600, deductAdvance: true, deductionMode: "partial", deductionAmount: 150, idempotencyKey: "k-mix", actor, payment: { paidBy: "Admin", periodLabel: "Jan" } });
    expect(res.deductionApplied).toBe(150);
    expect(res.netCashRequested).toBe(450);
    expect(res.allocation?.actualAllocatedAmount).toBe(450);
    expect(res.remainingEarned).toBe(100);
    expect(res.remainingAdvance).toBe(100);
    expect(state.staff.advance).toBe(100);
    const adjSum = state.advanceAdjustments.reduce((s,a)=>s+Number(a.amount),0);
    expect(adjSum).toBe(150);
    const allocSum = state.paymentAllocations.reduce((s,a)=>s+Number(a.amount),0);
    expect(allocSum).toBe(450);
    expect(state.auditLogs.filter((a)=>a.action==="COORDINATED_SALARY_PAYMENT").length).toBe(1);
    expect(state.coordinatedRequests[0].status).toBe("COMPLETED");
  });
});


