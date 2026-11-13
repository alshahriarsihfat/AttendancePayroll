// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-session", () => ({ sessionFromRequest: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { __prisma: true } }));
vi.mock("@/lib/auto-clockout-service", () => ({ processAutoClockouts: vi.fn() }));

import { GET, POST } from "./route";
import { sessionFromRequest } from "@/lib/auth-session";
import { processAutoClockouts } from "@/lib/auto-clockout-service";

function req(url: string, headers: Record<string, string> = {}, method = "GET") {
  return new Request(url, { method, headers });
}

const emptyResult = { ok: true, ranAt: "x", now: "y", autoClockoutMinutes: 15, scannedOpen: 0, eligibleOverdue: 0, processed: 0, autoClosedAccrued: 0, autoClosedAccrualIncomplete: 0, autoClosedAccrualFailed: 0, alreadyClosedOrClaimed: 0, skippedNotEligible: 0, skippedOvertimeActivated: 0, accrualRecoveryAttempted: 0, accrualRecovered: 0, accrualRecoveryIncomplete: 0, accrualRecoveryFailed: 0, errors: [], results: [] };

describe("auto-clockout route auth", () => {
  beforeEach(() => { vi.clearAllMocks(); delete (process.env as any).CRON_SECRET; });

  it("rejects unauthorized without secret/session", async () => {
    (sessionFromRequest as any).mockReturnValue(null);
    const res = await GET(req("http://localhost/api/attendance/auto-clockout"));
    expect(res.status).toBe(401);
  });

  it("accepts Bearer CRON_SECRET", async () => {
    (sessionFromRequest as any).mockReturnValue(null);
    process.env.CRON_SECRET = "s3cret";
    (processAutoClockouts as any).mockResolvedValue(emptyResult);
    const res = await POST(req("http://localhost/api/attendance/auto-clockout", { authorization: "Bearer s3cret" }, "POST"));
    expect(res.status).toBe(200);
  });

  it("accepts authenticated ADMIN session without secret", async () => {
    (sessionFromRequest as any).mockReturnValue({ role: "ADMIN", name: "A" });
    (processAutoClockouts as any).mockResolvedValue(emptyResult);
    const res = await GET(req("http://localhost/api/attendance/auto-clockout"));
    expect(res.status).toBe(200);
  });
});
