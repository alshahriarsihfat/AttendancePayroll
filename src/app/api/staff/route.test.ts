import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/server/db", () => ({
  prisma: {
    staff: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { POST, PUT } from "./route";
import { prisma } from "@/server/db";
import { COOKIE_NAME, encodeSession } from "@/lib/auth-session";
import { DEFAULT_DEPARTMENT, toDateKey } from "@/lib/staff-input";

const staffCreate = prisma.staff.create as unknown as ReturnType<typeof vi.fn>;
const staffUpdate = prisma.staff.update as unknown as ReturnType<typeof vi.fn>;
const staffFindUnique = prisma.staff.findUnique as unknown as ReturnType<typeof vi.fn>;

const SESSION = {
  role: "ADMIN" as const,
  name: "Admin",
  loginAt: new Date().toISOString(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function request(body: unknown, method: "POST" | "PUT" = "POST"): Request {
  return new Request("http://localhost/api/staff", {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `${COOKIE_NAME}=${encodeSession(SESSION)}`,
    },
    body: JSON.stringify(body),
  });
}

const baseStaff = (overrides: Record<string, unknown> = {}) => ({
  employeeId: "KP9801",
  username: "kp9801",
  password: "correct-horse",
  fullName: "Test Staff",
  phone: "01767854321",
  department: "Pharmacy Counter",
  jobTitle: "Pharmacist",
  section: "Sales Floor",
  counter: 2,
  role: "STAFF",
  salaryType: "Hourly",
  baseSalary: 0,
  dailyRate: 0,
  hourlyRate: 60,
  dailyDutyHours: 8,
  shiftStart: "09:00 AM",
  shiftEnd: "08:00 PM",
  mealBreakMin: 30,
  restMin: 15,
  photoUrl: "",
  status: "Active",
  isActive: true,
  arrears: 0,
  advance: 0,
  joinDate: "2024-01-05",
  endDate: null,
  ...overrides,
});

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

beforeEach(() => {
  vi.clearAllMocks();
  staffFindUnique.mockResolvedValue(null);
  staffCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    id: "cuid_1",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  staffUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "cuid_1",
    employeeId: "KP9801",
    ...data,
  }));
});

describe("POST /api/staff — department is optional", () => {
  it("creates a staff member when no department is provided", async () => {
    const payload = baseStaff();
    delete (payload as Record<string, unknown>).department;
    const response = await POST(request(payload));
    expect(response.status).toBe(201);
    expect(staffCreate).toHaveBeenCalledTimes(1);
    const data = staffCreate.mock.calls[0][0].data;
    expect(data.department).toBe(DEFAULT_DEPARTMENT);
  });

  it("stores the neutral label for a blank department", async () => {
    const response = await POST(request(baseStaff({ department: "" })));
    expect(response.status).toBe(201);
    expect(staffCreate.mock.calls[0][0].data.department).toBe(DEFAULT_DEPARTMENT);
  });

  it("stores the neutral label for a whitespace-only department", async () => {
    const response = await POST(request(baseStaff({ department: "   " })));
    expect(response.status).toBe(201);
    expect(staffCreate.mock.calls[0][0].data.department).toBe(DEFAULT_DEPARTMENT);
  });

  it("preserves a selected department when provided", async () => {
    const response = await POST(request(baseStaff({ department: "  Cash Counter  " })));
    expect(response.status).toBe(201);
    expect(staffCreate.mock.calls[0][0].data.department).toBe("Cash Counter");
  });

  it("returns 201 with no department field in the response payload", async () => {
    const response = await POST(request(baseStaff({ department: "" })));
    const body = await response.json() as Record<string, unknown>;
    expect(body.department).toBe(DEFAULT_DEPARTMENT);
  });
});

describe("POST /api/staff — joinDate normalization", () => {
  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["null", null],
  ])("uses today's date when joinDate is %s", async (_label, value) => {
    const payload = baseStaff();
    if (value === undefined) delete (payload as Record<string, unknown>).joinDate;
    else (payload as Record<string, unknown>).joinDate = value;

    const response = await POST(request(payload));
    expect(response.status).toBe(201);

    const data = staffCreate.mock.calls[0][0].data;
    expect(data.joinDate).toBeInstanceOf(Date);
    expect(Number.isNaN((data.joinDate as Date).getTime())).toBe(false);
    expect(toDateKey(data.joinDate as Date)).toBe(todayKey());
  });

  it("preserves a valid explicit joinDate", async () => {
    const response = await POST(request(baseStaff({ joinDate: "2019-03-08" })));
    expect(response.status).toBe(201);
    const data = staffCreate.mock.calls[0][0].data;
    expect(toDateKey(data.joinDate as Date)).toBe("2019-03-08");
  });

  it("rejects an invalid non-empty joinDate with a field-specific 400", async () => {
    const response = await POST(request(baseStaff({ joinDate: "not-a-date" })));
    expect(response.status).toBe(400);
    const body = await response.json() as { error?: string; field?: string };
    expect(body.field).toBe("joinDate");
    expect(body.error).toMatch(/valid date/i);
    expect(staffCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-existent calendar date (2024-02-30)", async () => {
    const response = await POST(request(baseStaff({ joinDate: "2024-02-30" })));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { field?: string }).field).toBe("joinDate");
    expect(staffCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid non-empty endDate with a field-specific 400", async () => {
    const response = await POST(request(baseStaff({ endDate: "tomorrow" })));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { field?: string }).field).toBe("endDate");
    expect(staffCreate).not.toHaveBeenCalled();
  });

  it("never passes an Invalid Date to Prisma", async () => {
    await POST(request(baseStaff({ joinDate: "" })));
    const data = staffCreate.mock.calls[0][0].data;
    expect(data.joinDate).toBeInstanceOf(Date);
    expect(Number.isNaN((data.joinDate as Date).getTime())).toBe(false);
  });
});

describe("POST /api/staff — response and log hygiene", () => {
  it("never returns the password or its hash", async () => {
    const response = await POST(request(baseStaff()));
    const raw = await response.text();
    expect(raw).not.toContain("correct-horse");
    expect(raw.toLowerCase()).not.toContain("password");
    expect(raw).not.toMatch(/[0-9a-f]{32}:[0-9a-f]{128}/);
  });

  it("does not leak Prisma validation payloads when the client/schema mismatch", async () => {
    const secret = "deadbeefdeadbeefdeadbeefdeadbeef:cafebabecafebabecafebabecafebabe";
    staffCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientValidationError(
        `Invalid \`prisma.staff.create()\` invocation:\n\n{\n  data: {\n    password: "${secret}"\n  }\n}`,
        { clientVersion: "test" }
      )
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request(baseStaff()));
    expect(response.status).toBe(500);
    const body = await response.json() as Record<string, unknown>;
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(secret);

    const logged = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toContain(secret);
    errorSpy.mockRestore();
  });
});

describe("PUT /api/staff — optional department and dates", () => {
  it("normalizes a blank department to the neutral label", async () => {
    const response = await PUT(
      request({ employeeId: "KP9801", department: "  " }, "PUT")
    );
    expect(response.status).toBe(200);
    expect(staffUpdate.mock.calls[0][0].data.department).toBe(DEFAULT_DEPARTMENT);
  });

  it("uses today when joinDate is blank on update", async () => {
    const response = await PUT(request({ employeeId: "KP9801", joinDate: "" }, "PUT"));
    expect(response.status).toBe(200);
    const data = staffUpdate.mock.calls[0][0].data;
    expect(toDateKey(data.joinDate as Date)).toBe(todayKey());
  });

  it("rejects an invalid joinDate on update without touching the database", async () => {
    const response = await PUT(request({ employeeId: "KP9801", joinDate: "nope" }, "PUT"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { field?: string }).field).toBe("joinDate");
    expect(staffUpdate).not.toHaveBeenCalled();
  });

  it("keeps endDate null when cleared on update", async () => {
    const response = await PUT(request({ employeeId: "KP9801", endDate: null }, "PUT"));
    expect(response.status).toBe(200);
    expect(staffUpdate.mock.calls[0][0].data.endDate).toBeNull();
  });

  it("leaves joinDate unchanged when the client sends null", async () => {
    const response = await PUT(request({ employeeId: "KP9801", joinDate: null }, "PUT"));
    expect(response.status).toBe(200);
    expect(staffUpdate.mock.calls[0][0].data).not.toHaveProperty("joinDate");
  });
});