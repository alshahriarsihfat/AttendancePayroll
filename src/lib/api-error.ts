import { Prisma } from "@prisma/client";

// ============================================================================
// Shared API error handling (H5)
// ----------------------------------------------------------------------------
// Every Prisma call that can reject must be wrapped in try/catch and routed
// through dbErrorResponse() so unhandled exceptions never surface as opaque
// Next.js 500s to the client.
// ============================================================================

const DB_UNREACHABLE_CODES = new Set(["P1000", "P1001", "P1002", "P1008"]);

// Network/driver failures usually surface as plain Errors whose message
// contains a specific socket/DNS/driver phrase. Match tightly — NEVER broad
// words like "connected"/"timeout": Prisma error bodies embed arbitrary
// identifiers (the TimeSession field `timeOut`, logs mentioning a
// "connection", etc.) and matching those made schema-validation bugs come back
// to the client as "Could not reach the database", hiding the real cause.
const CONNECTION_HINTS =
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENOTFOUND|socket hang up|socket closed|connection (refused|reset|terminated|closed)|too many connections|pool timeout|fetch failed|network request failed|read ECONNRESET)\b/i;

export function dbErrorResponse(error: unknown): Response {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error("[db] Prisma error", error.code, error.message);
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
      case "P2000":
        // Value too long for its column
        return Response.json({ error: "One of the values is too long for its column." }, { status: 400 });
      case "P2010":
        // Raw query failed
        return Response.json({ error: "The database rejected this query." }, { status: 500 });
      case "P2021":
        // Table does not exist
        return Response.json({ error: "A required database table is missing — run `pnpm db:push` to sync the schema." }, { status: 500 });
      case "P2022":
        // Column does not exist (schema drift)
        return Response.json({ error: "The database schema is out of date — run `pnpm db:push` to sync the schema." }, { status: 500 });
      default:
        if (DB_UNREACHABLE_CODES.has(error.code)) {
          return Response.json({ error: "Cannot reach the database — check DATABASE_URL and that the DB is online." }, { status: 500 });
        }
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
  // Generated client disagrees with the schema at runtime — almost always a
  // dev server / bundled client that predates the last `prisma generate`
  // (seen here: TimeSession shift-snapshot columns rejected by a stale
  // long-running server). Say that explicitly instead of guessing.
  if (error instanceof Prisma.PrismaClientValidationError) {
    console.error("[api] prisma client/schema mismatch", error.message);
    const details = process.env.NODE_ENV === "production"
      ? undefined
      : error.message.slice(0, 400);
    return Response.json(
      details
        ? { error: "The database schema and Prisma client are out of sync — restart the dev server after running `prisma generate`.", details }
        : { error: "The database schema and Prisma client are out of sync — restart the server after running `prisma generate`." },
      { status: 500 }
    );
  }
  // Neon/driver adapters often wrap failures in plain Errors instead of Prisma
  // typed errors, so also match the specific connection symptoms by message.
  if (error instanceof Error && CONNECTION_HINTS.test(error.message)) {
    console.error("[api] network/db", error.message);
    return Response.json({ error: "Could not reach the database. Please check the connection and try again." }, { status: 500 });
  }
  console.error("[api]", error);
  const message = "Unexpected server error.";
  // In development, attach the underlying message so the real cause surfaces to
  // the caller instead of a generic crash; production stays opaque.
  const details = process.env.NODE_ENV === "production"
    ? undefined
    : error instanceof Error ? error.message : String(error);
  return Response.json(details ? { error: message, details } : { error: message }, { status: 500 });
}