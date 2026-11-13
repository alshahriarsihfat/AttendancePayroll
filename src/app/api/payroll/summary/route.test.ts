// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-session", () => ({ sessionFromRequest: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { __prisma: true } }));
vi.mock("@/lib/payroll-summary-service", () => ({ getPayrollSummary: vi.fn() }));
vi.mock("@/lib/dates", async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, dhakaDateKey: vi.fn(() => "2026-11-10") };
});

import { GET } from "./route";
import { sessionFromRequest } from "@/lib/auth-session";
import { getPayrollSummary } from "@/lib/payroll-summary-service";

function req(url: string) { return new Request(url); }

const actor = { role: "ADMIN", name: "Admin", staffId: "AD1", loginAt: "x", exp: 9999999999 };
const emptyDto = {
  date: "2026-11-10", timezone: "Asia/Dhaka", generatedAt: "2026-11-10T00:00:00.000Z",
  summary: {
    todayEarnedAmount: { available: true, value: 0 }, todayAvailableAmount: { available: true, value: 0 },
    todayAvailableFromOlderOutstandingAmount: { available: true, value: 0 }, todayPaidAmount: { available: true, value: 0 },
    todayPaidTowardTodayEarningsAmount: { available: true, value: 0 }, todayPaidTowardOlderEarningsAmount: { available: true, value: 0 },
    totalOutstandingAmount: { available: true, value: 0 }, clockedOutCount: { available: true, value: 0 },
    stillWorkingCount: { available: true, value: 0 }, earningReadyCount: { available: true, value: 0 },
    incompleteEarningCount: { available: true, value: 0 }, partiallyPaidCount: { available: true, value: 0 }, fullyPaidCount: { available: true, value: 0 },
  },
  staffPayables: { rows: [], total: 0, limit: 100, offset: 0, hasMore: false }, notes: [],
};

describe("GET /api/payroll/summary (mocked)", () => {
  beforeEach(() => { vi.clearAllMocks(); (getPayrollSummary as any).mockResolvedValue(emptyDto); });

  it("rejects unauthenticated requests", async () => {
    (sessionFromRequest as any).mockReturnValue(null);
    const res = await GET(req("http://localhost/api/payroll/summary"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("rejects forbidden roles", async () => {
    (sessionFromRequest as any).mockReturnValue({ ...actor, role: "STAFF" });
    const res = await GET(req("http://localhost/api/payroll/summary"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Admin or Supervisor access required" });
  });

  it("defaults date to today in Asia/Dhaka and returns DTO", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    const res = await GET(req("http://localhost/api/payroll/summary"));
    expect(res.status).toBe(200);
    expect(getPayrollSummary).toHaveBeenCalledWith(expect.anything(), { date: "2026-11-10", staffId: undefined, limit: undefined, offset: undefined });
    expect(await res.json()).toEqual(emptyDto);
  });

  it("accepts valid date/staffId/limit/offset", async () => {
    (sessionFromRequest as any).mockReturnValue({ ...actor, role: "SUPERVISOR" });
    await GET(req("http://localhost/api/payroll/summary?date=2026-11-09&staffId=ST1&limit=50&offset=10"));
    expect(getPayrollSummary).toHaveBeenCalledWith(expect.anything(), { date: "2026-11-09", staffId: "ST1", limit: 50, offset: 10 });
  });

  it("rejects invalid query params", async () => {
    (sessionFromRequest as any).mockReturnValue(actor);
    const res = await GET(req("http://localhost/api/payroll/summary?date=11-10-2026&limit=0"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid query parameters");
  });
});
