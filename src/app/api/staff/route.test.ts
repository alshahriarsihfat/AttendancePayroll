import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/server/db", () => ({
  prisma: {
    staff: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { POST, PUT, DELETE } from "./route";
import { prisma } from "@/server/db";
import { COOKIE_NAME, encodeSession } from "@/lib/auth-session";
import { DEFAULT_DEPARTMENT, toDateKey } from "@/lib/staff-input";

const staffCreate = prisma.staff.create as unknown as ReturnType<typeof vi.fn>;
const staffUpdate = prisma.staff.update as unknown as ReturnType<typeof vi.fn>;
const staffFindUnique = prisma.staff.findUnique as unknown as ReturnType<typeof vi.fn>;
const auditCreate = prisma.auditLog.create as unknown as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

const SESSION = {
  role: "ADMIN" as const,
  name: "Admin",
  loginAt: new Date().toISOString(),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

function request(body: unknown, method: "POST" | "PUT" | "DELETE" = "POST"): Request {
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

/** A stored row as Prisma returns it (includes credentials to prove exclusion). */
const existingRow = (overrides: Record<string, unknown> = {}) => ({
  id: "cuid_1",
  employeeId: "KP9801",
  username: "kp9801",
  password: "stored-hash-value",
  fullName: "Test Staff",
  email: "staff@example.test",
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
  workingDaysPerWeek: null,
  shiftStart: "09:00 AM",
  shiftEnd: "08:00 PM",
  mealBreakMin: 30,
  restMin: 15,
  photoUrl: "",
  status: "ACTIVE",
  isActive: true,
  arrears: 0,
  advance: 0,
  joinDate: new Date("2024-01-05T00:00:00.000Z"),
  endDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

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
  auditCreate.mockResolvedValue({});
  // Run the callback with a transaction client backed by the same mocks.
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      staff: { findUnique: staffFindUnique, create: staffCreate, update: staffUpdate },
      auditLog: { create: auditCreate },
    })
  );
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
  beforeEach(() => {
    const row = existingRow();
    staffFindUnique.mockResolvedValue(row);
    // Prisma returns the full updated row.
    staffUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...row,
      ...data,
    }));
  });

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

describe("Staff audit trail", () => {
  describe("creation", () => {
    it("records STAFF_CREATED with the server-side actor and after values", async () => {
      const response = await POST(request(baseStaff()));
      expect(response.status).toBe(201);
      expect(auditCreate).toHaveBeenCalledTimes(1);

      const entry = auditCreate.mock.calls[0][0].data;
      expect(entry.action).toBe("STAFF_CREATED");
      expect(entry.entityType).toBe("Staff");
      expect(entry.entityId).toBe("KP9801");
      expect(entry.actorName).toBe("Admin");
      expect(entry.actorRole).toBe("ADMIN");
      expect(entry.before).toBeUndefined();
      expect(entry.after.employeeId).toBe("KP9801");
      expect(entry.after.fullName).toBe("Test Staff");
      expect(entry.after.joinDate).toBe("2024-01-05T00:00:00.000Z");
    });

    it("writes the staff row and its audit entry in one transaction", async () => {
      await POST(request(baseStaff()));
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledTimes(1);
    });

    it("never records passwords, hashes or unnecessary personal data", async () => {
      await POST(request(baseStaff()));
      const entry = auditCreate.mock.calls[0][0].data;
      const serialized = JSON.stringify(entry);

      expect(serialized).not.toContain("correct-horse");
      expect(serialized.toLowerCase()).not.toContain("password");
      expect(entry.after).not.toHaveProperty("password");
      expect(entry.after).not.toHaveProperty("phone");
      expect(entry.after).not.toHaveProperty("email");
      expect(entry.after).not.toHaveProperty("photoUrl");
    });

    it("uses the authenticated actor, ignoring any client-supplied identity", async () => {
      await POST(request(baseStaff({ actorName: "spoofed", actorRole: "STAFF", actorId: "KP9999" })));
      const entry = auditCreate.mock.calls[0][0].data;
      expect(entry.actorName).toBe("Admin");
      expect(entry.actorRole).toBe("ADMIN");
    });

    it("does not write an audit entry when validation fails", async () => {
      const response = await POST(request(baseStaff({ joinDate: "not-a-date" })));
      expect(response.status).toBe(400);
      expect(staffCreate).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it("does not write an audit entry when the employee id is taken", async () => {
      staffFindUnique.mockResolvedValue(existingRow());
      const response = await POST(request(baseStaff()));
      expect(response.status).toBe(409);
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it("fails the whole operation when the audit write fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      auditCreate.mockRejectedValueOnce(new Error("audit unavailable"));

      const response = await POST(request(baseStaff()));

      expect(response.status).toBe(500);
      expect(auditCreate).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });
  });

  describe("update", () => {
    beforeEach(() => {
      const row = existingRow();
      staffFindUnique.mockResolvedValue(row);
      staffUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...row,
        ...data,
      }));
    });

    it("records STAFF_UPDATED with before/after and the changed fields", async () => {
      const response = await PUT(request({ employeeId: "KP9801", department: "Cash Counter" }, "PUT"));
      expect(response.status).toBe(200);
      expect(auditCreate).toHaveBeenCalledTimes(1);

      const entry = auditCreate.mock.calls[0][0].data;
      expect(entry.action).toBe("STAFF_UPDATED");
      expect(entry.entityType).toBe("Staff");
      expect(entry.entityId).toBe("KP9801");
      expect(entry.actorName).toBe("Admin");
      expect(entry.actorRole).toBe("ADMIN");
      expect(entry.before.department).toBe("Pharmacy Counter");
      expect(entry.after.department).toBe("Cash Counter");
      expect(entry.before.joinDate).toBe("2024-01-05T00:00:00.000Z");
      expect(entry.after.joinDate).toBe("2024-01-05T00:00:00.000Z");
      expect(entry.summary).toContain("department");
    });

    it("records only the fields that actually changed", async () => {
      await PUT(request({ employeeId: "KP9801", hourlyRate: 75 }, "PUT"));
      const entry = auditCreate.mock.calls[0][0].data;
      expect(entry.before.hourlyRate).toBe(60);
      expect(entry.after.hourlyRate).toBe(75);
      expect(entry.summary).toContain("hourlyRate");
      expect(entry.summary).not.toContain("department");
    });

    it("never records passwords or personal contact data on update", async () => {
      await PUT(request({ employeeId: "KP9801", fullName: "Renamed Staff", phone: "01700000000" }, "PUT"));
      const serialized = JSON.stringify(auditCreate.mock.calls[0][0].data);
      expect(serialized).not.toContain("stored-hash-value");
      expect(serialized.toLowerCase()).not.toContain("password");
      expect(serialized).not.toContain("01767854321");
      expect(serialized).not.toContain("01700000000");
      expect(serialized).not.toContain("staff@example.test");
    });

    it("does not write an audit entry for a no-op update", async () => {
      const response = await PUT(request({ employeeId: "KP9801" }, "PUT"));
      expect(response.status).toBe(200);
      expect(staffUpdate).toHaveBeenCalledTimes(1);
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it("does not write an audit entry when the staff member does not exist", async () => {
      staffFindUnique.mockResolvedValue(null);
      const response = await PUT(request({ employeeId: "KP9801", department: "Cash Counter" }, "PUT"));
      expect(response.status).toBe(404);
      expect(staffUpdate).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it("does not write an audit entry when the update itself fails", async () => {
      staffUpdate.mockRejectedValueOnce(new Error("db down"));
      const response = await PUT(request({ employeeId: "KP9801", department: "Cash Counter" }, "PUT"));
      expect(response.status).toBe(500);
      expect(auditCreate).not.toHaveBeenCalled();
    });
  });

  describe("termination", () => {
    beforeEach(() => {
      const row = existingRow();
      staffFindUnique.mockResolvedValue(row);
      staffUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...row,
        ...data,
      }));
    });

    it("records STAFF_TERMINATED with before/after", async () => {
      const response = await DELETE(request({ employeeId: "KP9801" }, "DELETE"));
      expect(response.status).toBe(200);
      expect(auditCreate).toHaveBeenCalledTimes(1);

      const entry = auditCreate.mock.calls[0][0].data;
      expect(entry.action).toBe("STAFF_TERMINATED");
      expect(entry.entityType).toBe("Staff");
      expect(entry.entityId).toBe("KP9801");
      expect(entry.actorName).toBe("Admin");
      expect(entry.actorRole).toBe("ADMIN");
      expect(entry.before.isActive).toBe(true);
      expect(entry.before.status).toBe("ACTIVE");
      expect(entry.after.isActive).toBe(false);
      expect(entry.after.status).toBe("TERMINATED");
      expect(typeof entry.after.endDate).toBe("string");
    });

    it("soft-deletes the row and audits it in one transaction", async () => {
      await DELETE(request({ employeeId: "KP9801" }, "DELETE"));
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(staffUpdate.mock.calls[0][0].data.isActive).toBe(false);
      expect(auditCreate).toHaveBeenCalledTimes(1);
    });

    it("never records credentials on termination", async () => {
      await DELETE(request({ employeeId: "KP9801" }, "DELETE"));
      const serialized = JSON.stringify(auditCreate.mock.calls[0][0].data);
      expect(serialized).not.toContain("stored-hash-value");
      expect(serialized.toLowerCase()).not.toContain("password");
    });

    it("does not write an audit entry when the staff member does not exist", async () => {
      staffFindUnique.mockResolvedValue(null);
      const response = await DELETE(request({ employeeId: "KP9801" }, "DELETE"));
      expect(response.status).toBe(404);
      expect(staffUpdate).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it("does not write an audit entry when the termination fails", async () => {
      staffUpdate.mockRejectedValueOnce(new Error("db down"));
      const response = await DELETE(request({ employeeId: "KP9801" }, "DELETE"));
      expect(response.status).toBe(500);
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it("requires an authenticated admin actor", async () => {
      const anon = new Request("http://localhost/api/staff", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeId: "KP9801" }),
      });
      const response = await DELETE(anon);
      expect(response.status).toBe(401);
      expect(auditCreate).not.toHaveBeenCalled();
    });
  });
});