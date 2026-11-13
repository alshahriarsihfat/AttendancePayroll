export type AppPageId =
  | "dashboard" | "staff" | "payments" | "attendance" | "settings"
  | "leave" | "payslip" | "guide" | "terminal" | "profile" | "stafftime" | "monitor";

export interface AppView { page: AppPageId; params?: Record<string, string>; }

export const APP_PAGE_IDS: AppPageId[] = [
  "dashboard", "staff", "payments", "attendance", "settings",
  "leave", "payslip", "guide", "terminal", "profile", "stafftime", "monitor",
];

const PAGE_SET = new Set<string>(APP_PAGE_IDS);

export function isAppPageId(value: string | null | undefined): value is AppPageId {
  return typeof value === "string" && PAGE_SET.has(value);
}

export function sanitizeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Reject protocol-relative/external-looking forms and backslashes
  if (value.includes("\\")) return null;
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return null;
    // only allow same-app root paths (app is served from /)
    if (url.pathname !== "/") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function defaultViewForRole(role: "ADMIN" | "SUPERVISOR" | "STAFF"): AppView {
  if (role === "SUPERVISOR") return { page: "attendance" };
  if (role === "STAFF") return { page: "terminal" };
  return { page: "dashboard" };
}

export function isViewAllowedForRole(role: "ADMIN" | "SUPERVISOR" | "STAFF", view: AppView): boolean {
  if (role === "STAFF") return view.page === "terminal";
  if (role === "SUPERVISOR") {
    const allowed = new Set<AppPageId>(["attendance", "monitor", "payments", "leave", "payslip", "stafftime", "guide"]);
    if (!allowed.has(view.page)) return false;
  }
  if (role === "ADMIN") {
    // admin has broad access in shell; keep known pages
  }
  if (view.page === "payslip" && !view.params?.id) return false;
  return true;
}

export function parseViewFromLocation(loc: Location | { search: string }): AppView | null {
  try {
    const sp = new URLSearchParams(loc.search);
    const raw = sp.get("view");
    if (!raw) return null;
    if (!isAppPageId(raw)) return null;
    const params: Record<string, string> = {};
    const id = sp.get("id");
    if (id) params.id = id;
    const staffId = sp.get("staffId");
    if (staffId) params.staffId = staffId;
    return Object.keys(params).length ? { page: raw, params } : { page: raw };
  } catch {
    return null;
  }
}

export function viewToSearch(view: AppView): string {
  // default clean URL for role defaults handled by caller; otherwise encode
  const sp = new URLSearchParams();
  sp.set("view", view.page);
  if (view.params) {
    for (const [k, v] of Object.entries(view.params)) {
      if (v != null && v !== "") sp.set(k, String(v));
    }
  }
  const q = sp.toString();
  return q ? `/?${q}` : "/";
}

export function resolveInitialView(role: "ADMIN" | "SUPERVISOR" | "STAFF", loc: Location | { search: string }): AppView {
  const parsed = parseViewFromLocation(loc);
  if (parsed && isViewAllowedForRole(role, parsed)) return parsed;
  return defaultViewForRole(role);
}
