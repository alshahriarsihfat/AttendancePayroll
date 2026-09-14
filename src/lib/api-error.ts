import { Prisma } from "@prisma/client";

// ============================================================================
// Shared API error handling (H5)
// ----------------------------------------------------------------------------
// Every Prisma call that can reject must be wrapped in try/catch and routed
// through dbErrorResponse() so unhandled exceptions never surface as opaque
// Next.js 500s to the client.
// ============================================================================

export function dbErrorResponse(error: unknown): Response {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        // Unique constraint violation
        return Response.json({ error: "A record with this value already exists." }, { status: 409 });
      case "P2025":
        // Record not found
        return Response.json({ error: "The requested record was not found." }, { status: 404 });
      case "P2003":
        // Foreign key constraint violation
        return Response.json({ error: "A referenced record does not exist." }, { status: 400 });
      default:
        console.error("[db] Prisma error", error.code, error.message);
        return Response.json({ error: "Database error — please try again." }, { status: 500 });
    }
  }
  // Domain errors thrown deliberately by business logic
  if (error instanceof Error && error.message === "INSUFFICIENT_LEAVE_BALANCE") {
    return Response.json({ error: "Insufficient leave balance for this request." }, { status: 422 });
  }
  if (error instanceof Error && error.message === "LEAVE_REQUEST_NOT_FOUND") {
    return Response.json({ error: "Leave request not found." }, { status: 404 });
  }
  console.error("[api]", error);
  return Response.json({ error: "Unexpected server error." }, { status: 500 });
}