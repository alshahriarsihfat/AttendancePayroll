import { z } from "zod";
import { DEFAULT_CONFIG } from "@/lib/config";
import { prisma } from "@/server/db";

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

export async function GET() {
  return Response.json({ config: await ensureConfig() });
}

const ConfigUpdate = z.object({ key: z.string().min(1), value: z.string() });

export async function PUT(request: Request) {
  const parsed = ConfigUpdate.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid config payload" }, { status: 400 });
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
}
