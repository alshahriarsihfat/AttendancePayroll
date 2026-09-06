import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";

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
    password: input.password,
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

export async function POST(request: Request) {
  const parsed = StaffSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid staff payload" }, { status: 400 });
  const staff = await prisma.staff.create({ data: staffData(parsed.data) });
  return Response.json(staff, { status: 201 });
}

export async function PUT(request: Request) {
  const parsed = StaffSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid staff payload" }, { status: 400 });
  const staff = await prisma.staff.update({ where: { employeeId: parsed.data.employeeId }, data: staffData(parsed.data) });
  return Response.json(staff);
}

export async function DELETE(request: Request) {
  const body = await request.json() as { employeeId?: string };
  if (!body.employeeId) return Response.json({ error: "employeeId is required" }, { status: 400 });
  const staff = await prisma.staff.update({
    where: { employeeId: body.employeeId },
    data: { isActive: false, status: "TERMINATED", endDate: new Date() },
  });
  return Response.json(staff);
}
