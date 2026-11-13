import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-session", () => ({ sessionFromRequest: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock("@/lib/coordinated-payment-service", () => ({ coordinatedPayWithOptionalDeduction: vi.fn() }));

import { POST } from "./route";
import { sessionFromRequest } from "@/lib/auth-session";
import { prisma } from "@/server/db";
import { coordinatedPayWithOptionalDeduction } from "@/lib/coordinated-payment-service";

const actor = { id: "A1", name: "Admin", role: "ADMIN", employeeId: "A1" };
const base = { staffId: "S1", grossAmount: 500, deductAdvance: false, idempotencyKey: "k1" };
const req = (body: any) => new Request("http://localhost/api/payments/coordinated", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/payments/coordinated (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn({ __tx: true }));
  });

  it("rejects unauthenticated", async () => {
    (sessionFromRequest as any).mockReturnValue(null);
    const res = await POST(req(base));
    expect(res.status).toBe(401);
  });

  it("rejects forbidden role", async () => {
    (sessionFromRequest as any).mockReturnValue({ ...actor, role: "STAFF" });
    const res = await POST(req(base));
    expect(res.status).toBe(403);
  });

  it("rejects invalid payload (partial deduction requires amount)", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    const res = await POST(req({ ...base, deductAdvance: true, deductionMode: "partial" }));
    expect(res.status).toBe(400);
  });

  it("returns service result on success", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    (coordinatedPayWithOptionalDeduction as any).mockResolvedValue({ ok: true, status: "PARTIAL", paymentId: "P1" });
    const res = await POST(req(base));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("PARTIAL");
    expect((coordinatedPayWithOptionalDeduction as any).mock.calls[0][1].staffId).toBe("S1");
  });

  it("maps idempotency mismatch to 409", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    (coordinatedPayWithOptionalDeduction as any).mockRejectedValue(Object.assign(new Error("m"), { code: "PAYMENT_IDEMPOTENCY_MISMATCH" }));
    const res = await POST(req(base));
    expect(res.status).toBe(409);
  });
});
