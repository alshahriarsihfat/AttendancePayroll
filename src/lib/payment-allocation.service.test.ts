// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { allocateToOutstandingEarnings, getOutstandingEarnings } from "./payment-allocation-service";

const actor = { name: "Tester", role: "ADMIN" as const };

function earning(o: any = {}) {
  return {
    id: o.id ?? "e1",
    sessionId: o.sessionId ?? "s1",
    staffId: o.staffId ?? "ST1",
    netEarning: o.netEarning ?? 1000,
    periodStart: o.periodStart ?? new Date("2026-01-01T00:00:00Z"),
    periodEnd: o.periodEnd ?? new Date("2026-01-01T23:59:59Z"),
    calculatedAt: o.calculatedAt ?? new Date("2026-01-02T00:00:00Z"),
    calculationStatus: o.calculationStatus ?? "CALCULATED",
  };
}

type TxOpts = {
  staff?: any;
  earnings?: any[];
  allocSums?: Array<{ payrollEarningId: string; _sum: { amount: number } }>;
  allocRows?: any[];
  legacyPayments?: any[];
  payment?: any; // existing payment for paymentId path
  paymentByKey?: any; // existing payment found by idempotencyKey
  adjSums?: Array<{ payrollEarningId: string; _sum: { amount: number } }>;
  createdPaymentId?: string;
  failCreateAllocationAt?: number;
  failAudit?: boolean;
  p2002OnPaymentCreate?: boolean;
  lockSpy?: any;
};

function makeTx(opts: TxOpts = {}) {
  const audits: any[] = [];
  const createdAllocs: any[] = [];
  let allocCreateCount = 0;
  const tx: any = {
    audits,
    createdAllocs,
    $executeRaw: opts.lockSpy ?? vi.fn(async () => 1),
    staff: {
      findUnique: vi.fn(async ({ where }: any) => (opts.staff === null ? null : (opts.staff ?? { employeeId: where.employeeId, fullName: "Staff One" }))),
    },
    payrollEarning: {
      findMany: vi.fn(async () => opts.earnings ?? []),
      findUnique: vi.fn(async ({ where }: any) => (opts.earnings ?? []).find((e) => e.id === where.id) ?? null),
    },
    payment: {
      findMany: vi.fn(async () => opts.legacyPayments ?? []),
      findFirst: vi.fn(async ({ where }: any) => {
        if (where?.idempotencyKey) return opts.paymentByKey ?? null;
        return (opts.legacyPayments ?? []).find((p) => p.sessionId === where.sessionId) ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.idempotencyKey) return opts.paymentByKey ?? null;
        if (opts.payment && opts.payment.id === where.id) return opts.payment;
        if (opts.paymentByKey && opts.paymentByKey.id === where.id) return opts.paymentByKey;
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        if (opts.p2002OnPaymentCreate) { const e: any = new Error("Unique"); e.code = "P2002"; throw e; }
        return { id: opts.createdPaymentId ?? "pay1", ...data };
      }),
    },
    paymentAllocation: {
      groupBy: vi.fn(async () => {
        const base = [...(opts.allocSums ?? [])];
        for (const a of createdAllocs) {
          const row = base.find((b) => b.payrollEarningId === a.payrollEarningId);
          if (row) row._sum.amount = (Number(row._sum.amount) || 0) + (Number(a.amount) || 0);
          else base.push({ payrollEarningId: a.payrollEarningId, _sum: { amount: Number(a.amount) || 0 } });
        }
        return base;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        const all = [...(opts.allocRows ?? []), ...createdAllocs];
        if (where?.paymentId && where?.idempotencyKey?.startsWith) {
          const prefix = where.idempotencyKey.startsWith;
          return all.filter((r) => r.paymentId === where.paymentId && String(r.idempotencyKey || "").startsWith(prefix));
        }
        if (where?.paymentId) return all.filter((r) => r.paymentId === where.paymentId);
        return all;
      }),
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async ({ where }: any) => {
        const sums = (opts.allocSums ?? []).find((s) => s.payrollEarningId === where.payrollEarningId)?._sum?.amount ?? 0;
        const created = createdAllocs.filter((a) => a.payrollEarningId === where.payrollEarningId).reduce((s, a) => s + (Number(a.amount) || 0), 0);
        return { _sum: { amount: sums + created } };
      }),
      create: vi.fn(async ({ data }: any) => {
        allocCreateCount += 1;
        if (opts.failCreateAllocationAt === allocCreateCount) throw new Error("TX_FAIL_ALLOCATION_CREATE");
        const row = { id: `alloc${allocCreateCount}`, ...data };
        createdAllocs.push(row);
        return row;
      }),
    },
    advanceAdjustment: {
      groupBy: vi.fn(async () => opts.adjSums ?? []),
      aggregate: vi.fn(async ({ where }: any) => {
        const v = (opts.adjSums ?? []).find((s: any) => s.payrollEarningId === where.payrollEarningId)?._sum?.amount ?? 0;
        return { _sum: { amount: v } };
      }),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => { if (opts.failAudit) throw new Error("AUDIT_FAIL"); audits.push(data); return data; }) },
  };
  return tx;
}

describe("payment-allocation-service (MOCKED tx) — Phase 2A.4 partial allocation", () => {
  it("acquires staff allocation lock before authoritative reads", async () => {
    const lockSpy = vi.fn(async () => 1);
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 100 })], createdPaymentId: "payA", lockSpy });
    let staffReadAt = 0;
    tx.staff.findUnique = vi.fn(async () => { staffReadAt = lockSpy.mock.calls.length; return { employeeId: "ST1", fullName: "Staff One" }; });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 50, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.ok).toBe(true);
    expect(lockSpy).toHaveBeenCalledTimes(1);
    expect(staffReadAt).toBe(1);
  });

  it("new payment requires request idempotency key", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 100 })] });
    await expect(allocateToOutstandingEarnings(tx as any, { staffId: "ST1", amount: 50, actor, payment: { paidBy: "Tester" } as any }))
      .rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_KEY_REQUIRED" });
  });

  it("1) requested below outstanding: full request allocated", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 1000 })], createdPaymentId: "payA" });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 300, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.allocationStatus).toBe("FULL");
    expect(r.requestedAmount).toBe(300);
    expect(r.actualAllocatedAmount).toBe(300);
    expect(r.unfulfilledAmount).toBe(0);
    expect(r.remainingOutstanding).toBe(700);
    expect(r.paymentId).toBe("payA");
  });

  it("2) requested equal outstanding: full request allocated", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 1000 })], createdPaymentId: "payA" });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 1000, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.allocationStatus).toBe("FULL");
    expect(r.actualAllocatedAmount).toBe(1000);
    expect(r.unfulfilledAmount).toBe(0);
    expect(r.remainingOutstanding).toBe(0);
  });

  it("3) requested above outstanding: partial allocation (no reject)", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 300 })], createdPaymentId: "payA" });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 700, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.allocationStatus).toBe("PARTIAL");
    expect(r.requestedAmount).toBe(700);
    expect(r.actualAllocatedAmount).toBe(300);
    expect(r.unfulfilledAmount).toBe(400);
    expect(r.paymentId).toBe("payA");
  });

  it("4) partial allocation across multiple oldest-first earnings", async () => {
    const eOld = earning({ id: "e-old", sessionId: "s-old", netEarning: 400, periodStart: new Date("2026-01-01T00:00:00Z") });
    const eNew = earning({ id: "e-new", sessionId: "s-new", netEarning: 400, periodStart: new Date("2026-01-05T00:00:00Z") });
    const tx = makeTx({ earnings: [eNew, eOld], createdPaymentId: "payA" });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 900, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.allocationStatus).toBe("PARTIAL");
    expect(r.allocations.map((a) => a.payrollEarningId)).toEqual(["e-old", "e-new"]);
    expect(r.allocations.map((a) => a.amount)).toEqual([400, 400]);
    expect(r.actualAllocatedAmount).toBe(800);
    expect(r.unfulfilledAmount).toBe(100);
  });

  it("5) Payment.netPay equals actual allocation sum (not requested) and stores requested amount", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 300 })], createdPaymentId: "payA" });
    await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 700, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    const create = tx.payment.create.mock.calls[0][0];
    expect(create.data.netPay).toBe(300);
    expect(create.data.netPay).not.toBe(700);
    expect(create.data.allocationRequestedAmount).toBe(700);
    expect(create.data.batchId).toBeUndefined();
  });

  it("6) AuditLog distinguishes requested, actual, and unfulfilled amounts", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 300 })], createdPaymentId: "payA" });
    await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 700, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(tx.audits).toHaveLength(1);
    expect(tx.audits[0].action).toBe("PAYMENT_ALLOCATION");
    expect(tx.audits[0].after.requestedAmount).toBe(700);
    expect(tx.audits[0].after.actualAllocatedAmount).toBe(300);
    expect(tx.audits[0].after.unfulfilledAmount).toBe(400);
    expect(tx.audits[0].after.allocationStatus).toBe("PARTIAL");
  });

  it("7) zero outstanding creates no Payment or allocation", async () => {
    const tx = makeTx({ earnings: [] });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 500, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.allocationStatus).toBe("NONE");
    expect(r.paymentId).toBeNull();
    expect(r.actualAllocatedAmount).toBe(0);
    expect(r.unfulfilledAmount).toBe(500);
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("7b) all earnings legacy-settled => zero allocatable, no payment", async () => {
    const tx = makeTx({
      earnings: [earning({ id: "e1", sessionId: "s1", netEarning: 500 })],
      legacyPayments: [{ sessionId: "s1", id: "legacyPay" }],
    });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 200, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.allocationStatus).toBe("NONE");
    expect(r.paymentId).toBeNull();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("8) same-key replay returns exact original result without duplicate records (partial original)", async () => {
    const allocs = [{ id: "a1", paymentId: "payA", payrollEarningId: "e1", amount: 300, idempotencyKey: "k1:e1" }];
    const tx = makeTx({
      earnings: [earning({ id: "e1", netEarning: 300 })],
      allocRows: allocs,
      paymentByKey: { id: "payA", staffId: "ST1", idempotencyKey: "k1", allocationRequestedAmount: 700 },
    });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 700, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.allocationStatus).toBe("REPLAY");
    expect(r.skippedDuplicate).toBe(true);
    expect(r.paymentId).toBe("payA");
    expect(r.requestedAmount).toBe(700);
    expect(r.actualAllocatedAmount).toBe(300);
    expect(r.unfulfilledAmount).toBe(400);
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("9) same-key mismatched amount rejected", async () => {
    const allocs = [{ id: "a1", paymentId: "payA", payrollEarningId: "e1", amount: 300, idempotencyKey: "k1:e1" }];
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 300 })], allocRows: allocs, paymentByKey: { id: "payA", staffId: "ST1", idempotencyKey: "k1", allocationRequestedAmount: 700 } });
    await expect(allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 500, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } }))
      .rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_MISMATCH" });
  });

  it("9b) same-key mismatched staff rejected", async () => {
    const allocs = [{ id: "a1", paymentId: "payA", payrollEarningId: "e1", amount: 100, idempotencyKey: "k1:e1" }];
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 100 })], allocRows: allocs, paymentByKey: { id: "payA", staffId: "ST2", idempotencyKey: "k1", allocationRequestedAmount: 100 } });
    await expect(allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 100, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } }))
      .rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_MISMATCH" });
  });

  it("10) concurrent different-key requests cannot over-allocate (serialized via lock/cap recheck)", async () => {
    // With same-staff advisory lock and post-lock re-read, second request sees remaining; modeled by prior allocs
    const tx = makeTx({
      earnings: [earning({ id: "e1", netEarning: 1000 })],
      allocSums: [{ payrollEarningId: "e1", _sum: { amount: 700 } }],
      createdPaymentId: "payB",
    });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 700, actor, idempotencyKey: "k2", payment: { paidBy: "Tester", idempotencyKey: "k2" } });
    expect(r.actualAllocatedAmount).toBe(300);
    expect(r.unfulfilledAmount).toBe(400);
    expect(r.allocationStatus).toBe("PARTIAL");
  });

  it("11) legacy session-bound payments remain excluded from outstanding", async () => {
    const tx = makeTx({
      earnings: [earning({ id: "e1", sessionId: "s1", netEarning: 500 }), earning({ id: "e2", sessionId: "s2", netEarning: 200, periodStart: new Date("2026-01-02Z") })],
      legacyPayments: [{ sessionId: "s1", id: "legacyPay" }],
      createdPaymentId: "payA",
    });
    const outstanding = await getOutstandingEarnings(tx, "ST1");
    expect(outstanding.map((o) => o.sessionId)).toEqual(["s2"]);
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 500, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } });
    expect(r.actualAllocatedAmount).toBe(200);
    expect(r.allocations[0].payrollEarningId).toBe("e2");
  });

  it("12) transaction rollback on allocation failure propagates (no audit)", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 100 })], createdPaymentId: "payA", failCreateAllocationAt: 1 });
    await expect(allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 100, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } }))
      .rejects.toThrow("TX_FAIL_ALLOCATION_CREATE");
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("12b) transaction rollback on audit failure propagates", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 100 })], createdPaymentId: "payA", failAudit: true });
    await expect(allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 100, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } }))
      .rejects.toThrow("AUDIT_FAIL");
  });

  it("advance adjustment remains deferred/rejected", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 100 })] });
    await expect(allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 50, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" }, advanceAdjustment: 10 }))
      .rejects.toMatchObject({ code: "ADVANCE_ADJUSTMENT_DEFERRED" });
  });

  it("concurrent duplicate payment create (P2002) aborts tx with conflict for fresh replay", async () => {
    const tx = makeTx({ earnings: [earning({ id: "e1", netEarning: 100 })], p2002OnPaymentCreate: true });
    await expect(allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 100, actor, idempotencyKey: "k1", payment: { paidBy: "Tester", idempotencyKey: "k1" } }))
      .rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_CONFLICT" });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("multiple payments against one earning (existing payment path)", async () => {
    const tx = makeTx({
      earnings: [earning({ id: "e1", netEarning: 1000 })],
      allocSums: [{ payrollEarningId: "e1", _sum: { amount: 400 } }],
      payment: { id: "pay2", staffId: "ST1" },
    });
    const r = await allocateToOutstandingEarnings(tx, { staffId: "ST1", amount: 300, actor, paymentId: "pay2" });
    expect(r.actualAllocatedAmount).toBe(300);
    expect(r.remainingOutstanding).toBe(300);
  });
});


