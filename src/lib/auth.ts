import type { EmpRole, Employee, Role } from "../types";

// ============================================================================
// Auth — 3-tier RBAC for Khan Pharmacy.
//   ADMIN (manual credentials)         — full master access.
//   SUPERVISOR (logs in with username) — Live Floor, Leave, Pay. Also clocks in.
//   STAFF (logs in with username)      — own data only; financial fields hidden.
// Admin manually assigns a unique username + password to every employee.
// ============================================================================

export type Permission =
  | "manage.staff"
  | "manage.config"
  | "view.floor"
  | "view.attendance"
  | "manage.leave"
  | "pay.staff"
  | "clock.self"
  | "download.slip"
  | "view.financials";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrator",
  SUPERVISOR: "Supervisor",
  STAFF: "Staff",
};

export const ROLE_COLOR: Record<Role, string> = {
  ADMIN: "bg-rose-100 text-rose-700 ring-rose-200",
  SUPERVISOR: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  STAFF: "bg-emerald-100 text-emerald-700 ring-emerald-200",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  ADMIN: "Full master access — staff, counters, shifts, attendance & config.",
  SUPERVISOR: "Live Floor, Leave Management & Pay. Also clocks in as an employee.",
  STAFF: "Own clock terminal only. Financial fields are hidden.",
};

const PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [
    "manage.staff", "manage.config", "view.floor", "view.attendance",
    "manage.leave", "pay.staff", "clock.self", "download.slip", "view.financials",
  ],
  SUPERVISOR: [
    "view.floor", "manage.leave", "pay.staff", "clock.self", "download.slip", "view.financials",
  ],
  STAFF: ["clock.self", "download.slip"],
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

export type LoginResult =
  | { type: "admin" }
  | { type: "employee"; staffId: string; empRole: EmpRole }
  | { type: "invalid"; reason: string };

/**
 * Legacy client-side login helper.
 *
 * DEPRECATED — authentication now happens server-side through POST /api/auth
 * (which verifies scrypt-hashed passwords). Client-side comparisons are no
 * longer possible because passwords are stored only as salted hashes.
 */
export function resolveLogin(): LoginResult {
  return { type: "invalid", reason: "Sign in through the server login form." };
}
