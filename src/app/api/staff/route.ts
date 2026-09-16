import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { hashPassword } from "@/lib/password";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";

export const runtime = "nodejs";

const StaffSchema = z.object({
  employeeId: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  department: z.string().min(1),
  jobTitle: z.string().min(1),
  section: z.string().min(1),
  counter: z.number().int().nullable(),
  role: z.enum(["STAFF", "SUPERVISOR"]),
  salaryType: z.enum(["Daily", "Weekly", "Monthly", "Hourly"]),
  baseSalary: z.number(),
  dailyRate: z.number(),
  hourlyRate: z.number(),
  shiftStart: z.string(),
  shiftEnd: z.string(),
  mealBreakMin: z.number().int(),
  restMin: z.number().int(),
  photoUrl: z.string().optional(),
  status: z.enum(["Active", "On-leave", "Terminated"]),
  isActive: z.boolean(),
  arrears: z.number(),
  advance: z.number(),
  joinDate: z.string(),
  endDate: z.string().nullable().optional(),
});

function staffData(input: z.infer<typeof StaffSchema>) {
  return {
    employeeId: input.employeeId,
    username: input.username,
    password: hashPassword(input.password),
    fullName: input.fullName,
    email: input.email || null,
    phone: input.phone || null,
    department: input.department,
    jobTitle: input.jobTitle,
    section: input.section,
    counter: input.counter,
    role: input.role,
    salaryType: input.salaryType.toUpperCase() as "DAILY" | "WEEKLY" | "MONTHLY" | "HOURLY",
    baseSalary: input.baseSalary,
    dailyRate: input.dailyRate,
    hourlyRate: input.hourlyRate,
    shiftStart: input.shiftStart,
    shiftEnd: input.shiftEnd,
    mealBreakMin: input.mealBreakMin,
    restMin: input.restMin,
    photoUrl: input.photoUrl || null,
    status: input.status === "On-leave" ? "ON_LEAVE" as const : input.status.toUpperCase() as "ACTIVE" | "TERMINATED",
    isActive: input.isActive,
    arrears: input.arrears,
    advance: input.advance,
    joinDate: new Date(input.joinDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
  } satisfies Prisma.StaffCreateInput;
}

/** PUT is a PARTIAL update — absent fields keep their DB values. This is what
 *  makes lightweight mutations (e.g. assigning a counter) work without sending
 *  the entire record, and lets admin edits skip the password when unchanged. */
const StaffUpdateSchema = StaffSchema.partial().extend({
  employeeId: z.string().min(1),
  password: z.string().optional(),
});

function staffUpdateData(input: z.infer<typeof StaffUpdateSchema>) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "employeeId") continue;
    switch (key) {
      case "password":
        // Empty → keep the existing hash; non-empty → re-hash the new secret.
        if (typeof value === "string" && value.length > 0) data.password = hashPassword(value);
        break;
      case "salaryType":
        data.salaryType = (value as string).toUpperCase();
        break;
      case "status":
        data.status = value === "On-leave" ? "ON_LEAVE" : (value as string).toUpperCase();
        break;
      case "email":
      case "phone":
      case "photoUrl":
        data[key] = (value as string) || null;
        break;
      case "joinDate":
        data.joinDate = new Date(value as string);
        break;
      case "endDate":
        data.endDate = value ? new Date(value as string) : null;
        break;
      default:
        data[key] = value;
    }
  }
  return data;
}

export async function POST(request: Request) {
  if (!sessionFromRequest(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const parsed = StaffSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid staff payload" }, { status: 400 });
  try {
    const staff = await prisma.staff.create({ data: staffData(parsed.data) });
    return Response.json(staff, { status: 201 });
  } catch (error) {
    return dbErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  if (!sessionFromRequest(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const parsed = StaffUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid staff payload", details: parsed.error.flatten() }, { status: 400 });
  try {
    const staff = await prisma.staff.update({
      where: { employeeId: parsed.data.employeeId! },
      data: staffUpdateData(parsed.data),
    });
    return Response.json(staff);
  } catch (error) {
    return dbErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!sessionFromRequest(request)) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json() as { employeeId?: string };
  if (!body.employeeId) return Response.json({ error: "employeeId is required" }, { status: 400 });
  try {
    const staff = await prisma.staff.update({
      where: { employeeId: body.employeeId },
      data: { isActive: false, status: "TERMINATED", endDate: new Date() },
    });
    return Response.json(staff);
  } catch (error) {
    return dbErrorResponse(error);
  }
}