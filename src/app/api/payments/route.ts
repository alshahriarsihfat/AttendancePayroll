export const runtime = "nodejs";

const RETIRED = {
  error: "Legacy payment endpoint retired. Use /api/payments/allocate or /api/payments/coordinated.",
  code: "LEGACY_PAYMENT_ENDPOINT_RETIRED",
} as const;

export async function POST(): Promise<Response> {
  return Response.json(RETIRED, { status: 410 });
}
