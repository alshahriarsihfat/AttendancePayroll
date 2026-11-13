// @vitest-environment node
import { describe, it, expect } from "vitest";
import { POST } from "./route";

describe("POST /api/payments (legacy retired)", () => {
  it("returns 410 with stable retirement error code and performs no financial write path", async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      error: "Legacy payment endpoint retired. Use /api/payments/allocate or /api/payments/coordinated.",
      code: "LEGACY_PAYMENT_ENDPOINT_RETIRED",
    });
  });
});
