import { Prisma } from "@prisma/client";
import { DEFAULT_CONFIG } from "@/lib/config";
import { prisma } from "@/server/db";

export const runtime = "nodejs";

const STATE_KEY = "default";

type StatePayload = {
  data?: unknown;
  session?: unknown;
};

export async function GET() {
  const state = await prisma.appState.findUnique({ where: { key: STATE_KEY } });
  const staffRows = await prisma.staff.findMany({ orderBy: { employeeId: "asc" } });
  let configRows = await prisma.config.findMany({ orderBy: { key: "asc" } });
  if (configRows.length === 0) {
    await prisma.config.createMany({ data: DEFAULT_CONFIG, skipDuplicates: true });
    configRows = await prisma.config.findMany({ orderBy: { key: "asc" } });
  }
  const snapshot = state?.data as { staff?: unknown } | null;
  const data = snapshot && staffRows.length > 0
    ? {
        ...snapshot,
        staff: staffRows.map((staff) => ({
          recordId: staff.id,
          employeeId: staff.employeeId,
          username: staff.username,
          password: "",
          fullName: staff.fullName,
          email: staff.email ?? "",
          phone: staff.phone ?? "",
          department: staff.department,
          jobTitle: staff.jobTitle,
          section: staff.section,
          counter: staff.counter,
          joinDate: staff.joinDate.toISOString().slice(0, 10),
          endDate: staff.endDate?.toISOString().slice(0, 10) ?? null,
          role: staff.role === "SUPERVISOR" ? "SUPERVISOR" : "STAFF",
          salaryType: staff.salaryType.charAt(0) + staff.salaryType.slice(1).toLowerCase(),
          baseSalary: staff.baseSalary,
          dailyRate: staff.dailyRate,
          hourlyRate: staff.hourlyRate,
          shiftStart: staff.shiftStart,
          shiftEnd: staff.shiftEnd,
          mealBreakMin: staff.mealBreakMin,
          restMin: staff.restMin,
          shiftId: "SH-FULL",
          photoUrl: staff.photoUrl ?? "",
          status: staff.status === "ON_LEAVE" ? "On-leave" : staff.status === "TERMINATED" ? "Terminated" : "Active",
          isActive: staff.isActive,
          arrears: staff.arrears,
          advance: staff.advance,
        })),
        config: configRows,
      }
    : state?.data ? { ...(state.data as object), config: configRows } : { config: configRows };
  return Response.json({ data });
}

export async function PUT(request: Request) {
  const payload = await request.json() as StatePayload;
  if (!payload.data || typeof payload.data !== "object") {
    return Response.json({ error: "Invalid state payload" }, { status: 400 });
  }

  const state = await prisma.appState.upsert({
    where: { key: STATE_KEY },
    create: {
      key: STATE_KEY,
      data: payload.data as Prisma.InputJsonValue,
      session: Prisma.JsonNull,
    },
    update: {
      data: payload.data as Prisma.InputJsonValue,
      session: Prisma.JsonNull,
    },
  });

  return Response.json({ ok: true, updatedAt: state.updatedAt });
}
