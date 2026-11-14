import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { hashPassword } from "@/lib/password";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";
import {
  isStaffInputError,
  normalizeDepartment,
  normalizeEndDate,
  normalizeJoinDate,
} from "@/lib/staff-input";

export const runtime = "nodejs";

const StaffSchema = z.object({
  employeeId: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  // Department is optional: a missing/blank value is stored as a neutral label
  // (the DB column is NOT NULL) so the form never has to force a selection.
  department: z.string().max(120).optional(),
  jobTitle: z.string().min(1),
  section: z.string().min(1),
  counter: z.number().int().nullable(),
  role: z.enum(["STAFF", "SUPERVISOR"]),
  salaryType: z.enum(["Daily", "Weekly", "Monthly", "Hourly"]),
  // Legacy DB columns preserved (not used for active earning derivation under 2C.6.2).
  baseSalary: z.number().finite().nonnegative().optional(),
  dailyRate: z.number().finite().nonnegative().optional(),
  hourlyRate: z.number().positive(),
  dailyDutyHours: z.number().positive(),
  workingDaysPerWeek: z.number().int().min(1).max(7).nullable().optional(),
  shiftStart: z.string(),
  shiftEnd: z.string(),
  mealBreakMin: z.number().int(),
  restMin: z.number().int(),
  photoUrl: z.string().optional(),
  status: z.enum(["Active", "On-leave", "Terminated"]),
  isActive: z.boolean(),
  arrears: z.number(),
  advance: z.number(),
  joinDate: z.string().nullish(),
  endDate: z.string().nullish(),
});

function staffData(
  input: z.infer<typeof StaffSchema>,
  dates: { joinDate: Date; endDate: Date | null }
) {
  return {
    employeeId: input.employeeId,
    username: input.username,
    password: hashPassword(input.password),
    fullName: input.fullName,
    email: input.email || null,
    phone: input.phone || null,
    department: normalizeDepartment(input.department),
    jobTitle: input.jobTitle,
    section: input.section,
    counter: input.counter,
    role: input.role,
    salaryType: input.salaryType.toUpperCase() as "DAILY" | "WEEKLY" | "MONTHLY" | "HOURLY",
    baseSalary: input.baseSalary ?? 0,
    dailyRate: input.dailyRate ?? 0,
    hourlyRate: input.hourlyRate,
    dailyDutyHours: input.dailyDutyHours,
    workingDaysPerWeek: input.workingDaysPerWeek ?? null,
    shiftStart: input.shiftStart,
    shiftEnd: input.shiftEnd,
    mealBreakMin: input.mealBreakMin,
    restMin: input.restMin,
    photoUrl: input.photoUrl || null,
    status: input.status === "On-leave" ? "ON_LEAVE" as const : input.status.toUpperCase() as "ACTIVE" | "TERMINATED",
    isActive: input.isActive,
    arrears: input.arrears,
    advance: input.advance,
    joinDate: dates.joinDate,
    endDate: dates.endDate,
  } satisfies Prisma.StaffCreateInput;
}

/** Maps a field-specific input error to a safe 400 response. */
function fieldErrorResponse(error: unknown): Response | null {
  if (isStaffInputError(error)) {
    return Response.json({ error: error.message, field: error.field }, { status: 400 });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Audit trail
//
// Only non-sensitive, identity-relevant columns are copied into AuditLog.before
// / .after. Credentials (password hash) and unnecessary personal data (phone,
// email, photo) are deliberately excluded. Dates are serialised to ISO strings
// because the column is JSON.
// ---------------------------------------------------------------------------
const AUDIT_FIELDS = [
  "employeeId",
  "fullName",
  "jobTitle",
  "department",
  "section",
  "counter",
  "role",
  "salaryType",
  "baseSalary",
  "dailyRate",
  "hourlyRate",
  "dailyDutyHours",
  "workingDaysPerWeek",
  "shiftStart",
  "shiftEnd",
  "status",
  "isActive",
  "joinDate",
  "endDate",
] as const;

type AuditValues = Prisma.InputJsonObject;

function auditValues(row: Record<string, unknown>): AuditValues {
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const field of AUDIT_FIELDS) {
    if (!(field in row)) continue;
    const value = row[field];
    out[field] = value instanceof Date ? value.toISOString() : (value as Prisma.InputJsonValue);
  }
  return out;
}

/** Fields whose value differs between the before and after snapshots. */
function changedAuditFields(before: AuditValues, after: AuditValues): string[] {
  return Object.keys(after).filter(
    (field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)
  );
}

function describeChange(changed: string[]): string {
  if (changed.length === 0) return "no field changes";
  return changed.join(", ");
}

/** PUT is a PARTIAL update — absent fields keep their DB values. This is what
 *  makes lightweight mutations (e.g. assigning a counter) work without sending
 *  the entire record, and lets admin edits skip the password when unchanged. */
const StaffUpdateSchema = z.object({
  employeeId: z.string().min(1),
  username: z.string().min(1).optional(),
  password: z.string().optional(),
  fullName: z.string().min(1).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  department: z.string().max(120).optional(),
  jobTitle: z.string().min(1).optional(),
  section: z.string().min(1).optional(),
  counter: z.number().int().nullable().optional(),
  role: z.enum(["STAFF", "SUPERVISOR"]).optional(),
  salaryType: z.enum(["Daily", "Weekly", "Monthly", "Hourly"]).optional(),
  baseSalary: z.number().finite().nonnegative().optional(),
  dailyRate: z.number().finite().nonnegative().optional(),
  hourlyRate: z.number().positive().optional(),
  dailyDutyHours: z.number().positive().optional(),
  workingDaysPerWeek: z.number().int().min(1).max(7).nullable().optional(),
  shiftStart: z.string().optional(),
  shiftEnd: z.string().optional(),
  mealBreakMin: z.number().int().optional(),
  restMin: z.number().int().optional(),
  photoUrl: z.string().optional(),
  status: z.enum(["Active", "On-leave", "Terminated"]).optional(),
  isActive: z.boolean().optional(),
  arrears: z.number().optional(),
  advance: z.number().optional(),
  joinDate: z.string().nullish(),
  endDate: z.string().nullish(),
});

function staffUpdateData(
  input: z.infer<typeof StaffUpdateSchema>,
  dates: { joinDate?: Date; endDate?: Date | null }
) {
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
      case "department":
        data.department = normalizeDepartment(value);
        break;
      case "joinDate":
        // Normalized to a valid Date (or omitted) before this point.
        if (dates.joinDate) data.joinDate = dates.joinDate;
        break;
      case "endDate":
        // Blank/absent keeps `null`; never an Invalid Date.
        data.endDate = dates.endDate ?? null;
        break;
      case "email":
      case "phone":
      case "photoUrl":
        data[key] = (value as string) || null;
        break;
      default:
        data[key] = value;
    }
  }
  return data;
}

export async function POST(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN") return Response.json({ error: "Admin access required" }, { status: 403 });
  const parsed = StaffSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid staff payload" }, { status: 400 });
  if (!/^KP98\d{2}$/.test(parsed.data.employeeId)) {
    return Response.json({ error: "Staff ID must be in KP98XX format" }, { status: 400 });
  }
  const existing = await prisma.staff.findUnique({ where: { employeeId: parsed.data.employeeId } });
  if (existing) return Response.json({ error: "Employee ID taken" }, { status: 409 });

  // Normalize dates BEFORE any Prisma call: an invalid value must surface as a
  // field-specific 400, never as an Invalid Date handed to the database.
  let dates: { joinDate: Date; endDate: Date | null };
  try {
    dates = {
      joinDate: normalizeJoinDate(parsed.data.joinDate),
      endDate: normalizeEndDate(parsed.data.endDate),
    };
  } catch (error) {
    const response = fieldErrorResponse(error);
    if (response) return response;
    throw error;
  }

  try {
    // Staff row and its audit entry are written in one transaction: an audit
    // failure rolls back the creation instead of leaving an untracked record.
    const staff = await prisma.$transaction(async (tx) => {
      const created = await tx.staff.create({ data: staffData(parsed.data, dates) });
      await tx.auditLog.create({
        data: {
          action: "STAFF_CREATED",
          entityType: "Staff",
          entityId: created.employeeId,
          actorName: actor.name,
          actorRole: actor.role,
          summary: `${actor.name} created staff ${created.employeeId} (${created.fullName})`,
          after: auditValues(created as unknown as Record<string, unknown>),
        },
      });
      return created;
    });
    const { password: _password, ...safeStaff } = staff;
    return Response.json(safeStaff, { status: 201 });
  } catch (error) {
    return dbErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN") return Response.json({ error: "Admin access required" }, { status: 403 });
  const parsed = StaffUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid staff payload", details: parsed.error.flatten() }, { status: 400 });

  // Same guarantee as POST: normalize before touching the database.
  // A null joinDate on update means "leave unchanged" (the column is NOT NULL),
  // while a null endDate explicitly clears it.
  let dates: { joinDate?: Date; endDate?: Date | null };
  try {
    dates = {
      joinDate: parsed.data.joinDate == null ? undefined : normalizeJoinDate(parsed.data.joinDate),
      endDate: parsed.data.endDate === undefined ? undefined : normalizeEndDate(parsed.data.endDate),
    };
  } catch (error) {
    const response = fieldErrorResponse(error);
    if (response) return response;
    throw error;
  }

  try {
    const staff = await prisma.$transaction(async (tx) => {
      const before = await tx.staff.findUnique({ where: { employeeId: parsed.data.employeeId! } });
      if (!before) return null;
      const data = staffUpdateData(parsed.data, dates);
      const updated = await tx.staff.update({ where: { employeeId: parsed.data.employeeId! }, data });
      // A no-op update (no fields supplied) is still successful, but there is
      // nothing meaningful to record.
      if (Object.keys(data).length > 0) {
        const beforeValues = auditValues(before as unknown as Record<string, unknown>);
        const afterValues = auditValues(updated as unknown as Record<string, unknown>);
        const changed = changedAuditFields(beforeValues, afterValues);
        await tx.auditLog.create({
          data: {
            action: "STAFF_UPDATED",
            entityType: "Staff",
            entityId: updated.employeeId,
            actorName: actor.name,
            actorRole: actor.role,
            summary: `${actor.name} updated staff ${updated.employeeId} (${updated.fullName}): ${describeChange(changed)}`,
            before: beforeValues,
            after: afterValues,
          },
        });
      }
      return updated;
    });
    if (!staff) return Response.json({ error: "Staff not found." }, { status: 404 });
    const { password: _password, ...safeStaff } = staff;
    return Response.json(safeStaff);
  } catch (error) {
    return dbErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN") return Response.json({ error: "Admin access required" }, { status: 403 });
  const body = await request.json() as { employeeId?: string };
  if (!body.employeeId) return Response.json({ error: "employeeId is required" }, { status: 400 });
  try {
    const staff = await prisma.$transaction(async (tx) => {
      const before = await tx.staff.findUnique({ where: { employeeId: body.employeeId! } });
      if (!before) return null;
      // Termination is a soft delete: the row (and its payroll history) is kept.
      const updated = await tx.staff.update({
        where: { employeeId: body.employeeId! },
        data: { isActive: false, status: "TERMINATED", endDate: new Date() },
      });
      await tx.auditLog.create({
        data: {
          action: "STAFF_TERMINATED",
          entityType: "Staff",
          entityId: updated.employeeId,
          actorName: actor.name,
          actorRole: actor.role,
          summary: `${actor.name} terminated staff ${updated.employeeId} (${updated.fullName})`,
          before: auditValues(before as unknown as Record<string, unknown>),
          after: auditValues(updated as unknown as Record<string, unknown>),
        },
      });
      return updated;
    });
    if (!staff) return Response.json({ error: "Staff not found." }, { status: 404 });
    const { password: _password, ...safeStaff } = staff;
    return Response.json(safeStaff);
  } catch (error) {
    return dbErrorResponse(error);
  }
}