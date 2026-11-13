// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-session", () => ({ sessionFromRequest: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock("@/lib/payment-allocation-service", () => ({ allocateToOutstandingEarnings: vi.fn() }));

import { POST } from "./route";
import { sessionFromRequest } from "@/lib/auth-session";
import { prisma } from "@/server/db";
import { allocateToOutstandingEarnings } from "@/lib/payment-allocation-service";

function req(body: unknown) {
  return new Request("http://localhost/api/payments/allocate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const basePayload = { staffId: "ST1", amount: 500, idempotencyKey: "idem-1" };
const actor = { role: "ADMIN", name: "Admin User", staffId: "AD1", loginAt: "x", exp: 9999999999 };

describe("POST /api/payments/allocate (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn({ __tx: true }));
  });

  it("rejects unauthenticated requests", async () => {
    (sessionFromRequest as any).mockReturnValue(null);
    const res = await POST(req(basePayload));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
    expect(allocateToOutstandingEarnings).not.toHaveBeenCalled();
  });

  it("rejects non-admin/non-supervisor roles", async () => {
    (sessionFromRequest as any).mockReturnValue({ ...actor, role: "STAFF" });
    const res = await POST(req(basePayload));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Admin or Supervisor access required" });
  });

  it("rejects invalid payload and amount", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    const badCases = [
      {},
      { staffId: "ST1", amount: 0, idempotencyKey: "k" },
      { staffId: "ST1", amount: -5, idempotencyKey: "k" },
      { staffId: "", amount: 5, idempotencyKey: "k" },
      { staffId: "ST1", amount: 5, idempotencyKey: "" },
    ];
    for (const body of badCases) {
      const res = await POST(req(body));
      expect(res.status).toBe(400);
    }
    expect(allocateToOutstandingEarnings).not.toHaveBeenCalled();
  });

  it("successful full allocation returns service result contract", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    (allocateToOutstandingEarnings as any).mockResolvedValue({
      ok: true, paymentId: "pay1", staffId: "ST1", requestedAmount: 500, actualAllocatedAmount: 500,
      unfulfilledAmount: 0, remainingOutstanding: 0, allocationStatus: "FULL",
      allocations: [{ id: "a1", payrollEarningId: "e1", amount: 500, idempotencyKey: "idem-1:e1" }],
      skippedDuplicate: false, reason: "FULL_ALLOCATION",
    });
    const res = await POST(req(basePayload));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true, paymentId: "pay1", staffId: "ST1", requestedAmount: 500, actualAllocatedAmount: 500,
      unfulfilledAmount: 0, remainingOutstanding: 0, allocationStatus: "FULL", skippedDuplicate: false,
    });
    const call = (allocateToOutstandingEarnings as any).mock.calls[0][1];
    expect(call.actor).toEqual({ name: "Admin User", role: "ADMIN" });
    expect(call.payment.paidBy).toBe("Admin User");
    expect(call.idempotencyKey).toBe("idem-1");
    expect(call.payment.idempotencyKey).toBe("idem-1");
    expect(call.advanceAdjustment).toBe(0);
  });

  it("successful partial allocation", async () => {
    (sessionFromRequest as any).mockReturnValue({ ...actor, role: "SUPERVISOR", name: "Sup" });
    (allocateToOutstandingEarnings as any).mockResolvedValue({
      ok: true, paymentId: "pay1", staffId: "ST1", requestedAmount: 700, actualAllocatedAmount: 300,
      unfulfilledAmount: 400, remainingOutstanding: 0, allocationStatus: "PARTIAL",
      allocations: [{ id: "a1", payrollEarningId: "e1", amount: 300 }], skippedDuplicate: false, reason: "PARTIAL_ALLOCATION_INSUFFICIENT_OUTSTANDING",
    });
    const res = await POST(req({ ...basePayload, amount: 700 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.allocationStatus).toBe("PARTIAL");
    expect(json.actualAllocatedAmount).toBe(300);
    expect(json.unfulfilledAmount).toBe(400);
  });

  it("zero outstanding returns NONE without payment", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    (allocateToOutstandingEarnings as any).mockResolvedValue({
      ok: true, paymentId: null, staffId: "ST1", requestedAmount: 500, actualAllocatedAmount: 0,
      unfulfilledAmount: 500, remainingOutstanding: 0, allocationStatus: "NONE",
      allocations: [], skippedDuplicate: false, reason: "NO_OUTSTANDING_AVAILABLE",
    });
    const res = await POST(req(basePayload));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.paymentId).toBeNull();
    expect(json.allocationStatus).toBe("NONE");
    expect(json.allocations).toEqual([]);
  });

  it("same-key replay returns original result", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    (allocateToOutstandingEarnings as any).mockResolvedValue({
      ok: true, paymentId: "pay1", staffId: "ST1", requestedAmount: 500, actualAllocatedAmount: 300,
      unfulfilledAmount: 200, remainingOutstanding: 0, allocationStatus: "REPLAY",
      allocations: [{ id: "a1", payrollEarningId: "e1", amount: 300 }], skippedDuplicate: true, reason: "REPLAY_PARTIAL_ALLOCATION",
    });
    const res = await POST(req(basePayload));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.allocationStatus).toBe("REPLAY");
    expect(json.skippedDuplicate).toBe(true);
  });

  it("same-key mismatch maps to safe 409", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    (allocateToOutstandingEarnings as any).mockRejectedValue(Object.assign(new Error("mismatch"), { code: "PAYMENT_IDEMPOTENCY_MISMATCH" }));
    const res = await POST(req(basePayload));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Idempotency key reuse with a different request is not allowed" });
  });

  it("cross-staff rejection maps to safe 403", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    (allocateToOutstandingEarnings as any).mockRejectedValue(Object.assign(new Error("x"), { code: "CROSS_STAFF_EARNING" }));
    const res = await POST(req(basePayload));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Allocation target does not belong to the requested staff member" });
  });

  it("incomplete or settled earning rejection maps to safe 409", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    for (const code of ["INCOMPLETE_EARNING_INELIGIBLE", "EARNING_NOT_FOUND"]) {
      (allocateToOutstandingEarnings as any).mockRejectedValueOnce(Object.assign(new Error(code), { code }));
      const res = await POST(req(basePayload));
      expect(res.status).toBe(409);
    }
  });

  it("advance adjustment rejection maps to safe 400", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    (allocateToOutstandingEarnings as any).mockRejectedValue(Object.assign(new Error("deferred"), { code: "ADVANCE_ADJUSTMENT_DEFERRED" }));
    const res = await POST(req(basePayload));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Advance adjustment is not supported for salary allocation" });
  });
});
