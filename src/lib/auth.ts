import type { EmpRole, Employee, Role } from "../types";
import { ADMIN } from "./config";

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
 * Resolve a username + password login (all credentials admin-assigned).
 *   admin / 9999   → master admin.
 *   otherwise      → username must exist & its stored password must match.
 *   `staffByUsername` maps lowercase username → Employee.
 */
export function resolveLogin(
  username: string,
  password: string,
  staffByUsername: Record<string, Employee>
): LoginResult {
  const u = username.trim();
  // Master admin (manual fallback).
  if (u.toLowerCase() === ADMIN.USERNAME && password === ADMIN.PASSWORD) return { type: "admin" };
  if (!u) return { type: "invalid", reason: "Enter your username." };
  if (!password) return { type: "invalid", reason: "Enter your password." };
  const emp = staffByUsername[u.toLowerCase()];
  if (!emp) return { type: "invalid", reason: "Username not found." };
  if (emp.password !== password) return { type: "invalid", reason: "Incorrect password." };
  return { type: "employee", staffId: emp.employeeId, empRole: emp.role };
}
