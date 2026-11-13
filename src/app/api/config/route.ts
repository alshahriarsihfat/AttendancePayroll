import { z } from "zod";
import { DEFAULT_CONFIG } from "@/lib/config";
import { prisma } from "@/server/db";
import { dbErrorResponse } from "@/lib/api-error";
import { sessionFromRequest } from "@/lib/auth-session";

export const runtime = "nodejs";

async function ensureConfig() {
  const existing = await prisma.config.findMany({ orderBy: { key: "asc" } });
  if (existing.length > 0) return existing;
  await prisma.config.createMany({
    data: DEFAULT_CONFIG.map((entry) => ({
      key: entry.key,
      value: entry.value,
      description: entry.description,
      category: entry.category,
    })),
    skipDuplicates: true,
  });
  return prisma.config.findMany({ orderBy: { key: "asc" } });
}

const SENSITIVE_CONFIG_KEY = /(KEY|SECRET|TOKEN|PASSWORD|API_URL)/i;

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const config = await ensureConfig();
    const visible = session.role === "ADMIN"
      ? config
      : config.filter((entry) => !SENSITIVE_CONFIG_KEY.test(entry.key));
    return Response.json({ config: visible });
  } catch (error) {
    return dbErrorResponse(error);
  }
}

const ConfigUpdate = z.object({ key: z.string().min(1), value: z.string() });

export async function PUT(request: Request) {
  const actor = sessionFromRequest(request);
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (actor.role !== "ADMIN") return Response.json({ error: "Admin access required" }, { status: 403 });
  const parsed = ConfigUpdate.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid config payload" }, { status: 400 });
  try {
    const fallback = DEFAULT_CONFIG.find((entry) => entry.key === parsed.data.key);
    const config = await prisma.config.upsert({
      where: { key: parsed.data.key },
      create: {
        key: parsed.data.key,
        value: parsed.data.value,
        description: fallback?.description ?? "",
        category: fallback?.category ?? "General",
      },
      update: { value: parsed.data.value },
    });
    return Response.json({ config });
  } catch (error) {
    return dbErrorResponse(error);
  }
}