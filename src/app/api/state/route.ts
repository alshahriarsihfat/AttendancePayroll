import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export const runtime = "nodejs";

const STATE_KEY = "default";

type StatePayload = {
  data?: unknown;
  session?: unknown;
};

export async function GET() {
  const state = await prisma.appState.findUnique({ where: { key: STATE_KEY } });
  return Response.json({ data: state?.data ?? null });
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
