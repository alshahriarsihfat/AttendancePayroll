import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionFromRequest } from "@/lib/auth-session";
import { dbErrorResponse } from "@/lib/api-error";
import { prisma } from "@/server/db";
import { dhakaDateKey } from "@/lib/dates";
import { getPayrollSummary } from "@/lib/payroll-summary-service";

export const runtime = "nodejs";

const QuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  staffId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") {
    return NextResponse.json({ error: "Admin or Supervisor access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    date: url.searchParams.get("date") ?? undefined,
    staffId: url.searchParams.get("staffId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const date = parsed.data.date ?? dhakaDateKey(new Date());

  try {
    const result = await getPayrollSummary(prisma as any, {
      date,
      staffId: parsed.data.staffId,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return NextResponse.json(result);
  } catch (error) {
    return dbErrorResponse(error);
  }
}
