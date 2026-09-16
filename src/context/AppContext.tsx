"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import type {
  BreakType, ConfigEntry, Dataset, Employee, LeaveRequest, LeaveStatus,
  LeaveType, Payment, Role, Session, TimeSession,
} from "../types";
import { createSeedData } from "../lib/seed";
import { can, type Permission } from "../lib/auth";
import { computeSession, empShift, hourlyRateFor, scheduledShiftBounds, sessionFor, dhakaTodayKey, shiftForSession } from "../lib/timeclock";
import { validateLeave, validateStaff, type FieldError } from "../lib/validation";
import { uid } from "../lib/utils";
import { formatDuration, nowISO, workingDaysBetween } from "../lib/dates";
import { payRound } from "../lib/currency";
import { configValue, SUPERVISOR_MAX } from "../lib/config";

// ============================================================================
// AppContext — single source of truth for Khan Pharmacy. PIN auth, live
// clock sessions, overtime, payments, staff CRUD, leave, cloud sync.
// ============================================================================

export type PageId =
  | "dashboard" | "monitor" | "staff" | "attendance" | "leave" | "payments"
  | "payslip" | "settings" | "guide" | "terminal" | "profile" | "stafftime";
export interface View { page: PageId; params?: Record<string, string>; }
export interface Toast { id: string; message: string; type: "success" | "error" | "info"; }
export interface FormResult { ok: boolean; errors?: FieldError[]; }
export interface ClockInEvent { ok: boolean; lateMin: number; isLate: boolean; }

interface AppContextValue {
  data: Dataset;
  session: Session | null;
  hydrated: boolean;
  role: Role;
  view: View;
  toasts: Toast[];
  // auth / nav
  loginAdmin: () => void;
  loginEmployee: (staffId: string) => void;
  logout: () => void;
  navigate: (page: PageId, params?: Record<string, string>) => void;
  toast: (message: string, type?: Toast["type"]) => void;
  dismissToast: (id: string) => void;
  // rbac
  canPerm: (p: Permission) => boolean;
  // selectors
  staffById: (id: string) => Employee | undefined;
  shiftById: (id: string) => Dataset["shifts"][number] | undefined;
  todaySession: (staffId: string) => TimeSession | undefined;
  paymentFor: (id: string) => Payment | undefined;
  isOnLeaveToday: (staffId: string) => boolean;
  // live clock ops
  clockIn: (staffId: string) => ClockInEvent;
  clockOut: (staffId: string) => { ok: boolean; earlyDepartureMin: number };
  startBreak: (staffId: string, type: BreakType) => void;
  endBreak: (staffId: string) => void;
  toggleExtraTime: (staffId: string) => void;
  startGoOut: (staffId: string, reason: string, estimatedMin: number) => void;
  endGoOut: (staffId: string) => void;
  /** Settle one or several unpaid days (clocked-out shifts only) in a single
   *  transaction; returns the shared settlement batch id. */
  paySessions: (sessionIds: string[]) => string | null;

  /** Pay an arbitrary advance amount; reduces accumulated arrears first. */
  payCustomAdvance: (staffId: string, amount: number) => void;
  takeAdvance: (staffId: string, amount: number) => void;
  /** Completed shifts with no payment record yet (auto-registered dues). */
  unpaidShifts: { sessionId: string; staffId: string; date: string; netPay: number }[];
  /** True if any active session has no clock-out (blocks global payout). */
  anyOnDuty: boolean;
  // staff CRUD
  createStaff: (d: Partial<Employee>) => FormResult;
  updateStaff: (id: string, d: Partial<Employee>) => FormResult;
  deactivateStaff: (id: string) => void;
  assignCounter: (staffId: string, counter: number | null) => void;
  // leave
  submitLeave: (d: { staffId: string; leaveType: LeaveType; fromDate: string; toDate: string; reason: string }) => FormResult;
  decideLeave: (id: string, status: LeaveStatus, comment?: string) => FormResult;
  // manager approval system
  pendingApprovals: Dataset["approvalRequests"];
  resolveApproval: (id: string, status: "approved" | "rejected", note?: string) => void;
  // config + sync
  updateConfig: (key: string, value: string) => void;
  resetData: () => void;
  refreshData: () => Promise<boolean>;
  exportData: () => void;
  importData: (jsonText: string) => boolean;
}

const Ctx = createContext<AppContextValue | null>(null);
const STATE_ENDPOINT = "/api/state";

function postJson(path: string, body: unknown, method = "POST") {
  return fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => new Response(null, { status: 503 }));
}

/**
 * Migrate older cached datasets so they never crash the new code:
 *  - backfill `username` / `password` (manual-credential login)
 *  - backfill `extraTime` array on sessions
 *  - coerce `role` defaults
 * If anything looks structurally broken, fall back to a fresh seed.
 */
function migrate(old: Dataset): Dataset {
  if (!old || !Array.isArray(old.staff) || old.staff.length === 0) return createSeedData();
  try {
    const staff = old.staff.map((s): Employee => ({
      ...s,
      employeeId: s.employeeId || "",
      username: (s.username || (s.employeeId || "").toLowerCase() || "").toString(),
      password: "",
      role: (s.role === "SUPERVISOR" ? "SUPERVISOR" : "STAFF") as Employee["role"],
      salaryType: (s.salaryType ?? "Daily") as Employee["salaryType"],
      shiftStart: s.shiftStart || "09:00 AM",
      shiftEnd: s.shiftEnd || "08:00 PM",
      mealBreakMin: s.mealBreakMin ?? 30,
      restMin: s.restMin ?? 15,
      status: (s.status ?? "Active") as Employee["status"],
      isActive: s.isActive ?? true,
    }));
    const sessions = (old.sessions ?? []).map((s) => ({
      ...s,
      extraTime: Array.isArray(s.extraTime) ? s.extraTime : [],
    }));
    return { ...old, staff, sessions, overtimeLogs: old.overtimeLogs ?? [] };
  } catch {
    return createSeedData();
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset>(() => createSeedData());
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>({ page: "dashboard" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, number>>({});

  const role: Role = session?.role ?? "STAFF";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load session")))
      .then((payload: { session?: Session | null }) => {
        if (cancelled) return;
        setSession(payload.session ?? null);
        if (!payload.session) return null;
        // Route supervisors straight to the Live Floor on every session restore
        // (the login form hard-redirects and page refreshes reset view state, so
        // the supervisor must be re-routed here — not only in loginEmployee).
        setView({
          page: payload.session.role === "SUPERVISOR" ? "monitor"
            : payload.session.role === "ADMIN" ? "dashboard"
            : "terminal",
        });
        return fetch(STATE_ENDPOINT);
      })
      .then((response) => response?.ok ? response.json() : null)
      .then((payload: { data?: Dataset } | null) => {
        if (cancelled) return;
        if (payload?.data) setData(migrate(payload.data));
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated || !session) return;
    const timer = window.setTimeout(() => {
      void postJson(STATE_ENDPOINT, { data }, "PUT");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data, session, hydrated]);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = uid("T");
    setToasts((t) => [...t, { id, message, type }]);
    timers.current[id] = window.setTimeout(() => dismissToast(id), 3400);
  }, [dismissToast]);

  const audit = useCallback((action: string, entityType: string, entityId: string, summary: string) => {
    setData((d) => ({ ...d, auditLog: [{ logId: uid("LOG"), timestamp: nowISO(), action, entityType, entityId, actorName: session?.name ?? "system", actorRole: role, summary }, ...d.auditLog] }));
  }, [session, role]);

  const guard = useCallback((perm: Permission): boolean => {
    if (can(role, perm)) return true;
    toast(`Your role (${role}) can't perform this action.`, "error");
    return false;
  }, [role, toast]);

  const canPerm = useCallback((p: Permission) => can(role, p), [role]);

  // ---- approval system ----
  const flagApproval = useCallback((staffId: string, sessionId: string, type: "late" | "early_exit" | "break_overrun", deltaMin: number) => {
    const id = uid("APR");
    const date = dhakaTodayKey();
    setData((d) => ({
      ...d,
      approvalRequests: [{
        id, staffId, sessionId, type, deltaMin, date, status: "pending",
      }, ...(d.approvalRequests ?? [])],
    }));
    void postJson("/api/approvals", { id, staffId, sessionId, type, deltaMin, date }).then((response) => {
      if (!response.ok) toast("Approval request was not saved to the server.", "error");
    });
  }, [toast]);

  // ---- auth ----
  // Staff lookup keyed by lowercase username. Defensive against missing fields
  // so a single bad cached record can never crash the whole app.
  const loginAdmin = useCallback(() => { setSession({ role: "ADMIN", name: "Admin", loginAt: nowISO() }); setView({ page: "dashboard" }); }, []);
  const loginEmployee = useCallback((staffId: string) => {
    const s = data.staff.find((e) => e.employeeId === staffId || e.username.toLowerCase() === staffId.toLowerCase());
    if (!s) { toast("Account found but record unreadable. Please reset demo data in Settings.", "error"); return; }
    setSession({ role: s.role === "SUPERVISOR" ? "SUPERVISOR" : "STAFF", staffId: s.employeeId, name: s.fullName, loginAt: nowISO() });
    // Supervisors land on the Live Floor; staff are routed to their clock terminal.
    setView({ page: s.role === "SUPERVISOR" ? "monitor" : "terminal" });
    audit("LOGIN", "Session", s.employeeId, `${s.fullName} signed in as ${s.role}.`);
  }, [data.staff, audit, toast]);
  const logout = useCallback(() => {
    void fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    setSession(null);
    setView({ page: "dashboard" });
    window.location.assign("/login");
  }, []);
  const navigate = useCallback((page: PageId, params?: Record<string, string>) => {
    setView({ page, params });
    const el = document.getElementById("pl-scroll"); if (el) el.scrollTo({ top: 0 });
  }, []);

  // ---- selectors ----
  const staffById = useCallback((id: string) => data.staff.find((e) => e.employeeId === id), [data.staff]);
  const shiftById = useCallback((id: string) => data.shifts.find((s) => s.id === id), [data.shifts]);
  const todaySession = useCallback((staffId: string) => sessionFor(data.sessions, staffId, dhakaTodayKey()), [data.sessions]);
  const paymentFor = useCallback((id: string) => data.payments.find((p) => p.id === id), [data.payments]);
  const isOnLeaveToday = useCallback((staffId: string) => {
    const t = dhakaTodayKey();
    return data.leaveRequests.some((r) => r.staffId === staffId && r.status === "Approved" && r.fromDate <= t && r.toDate >= t);
  }, [data.leaveRequests]);

  // ---- live clock ----
  const updateSession = useCallback((staffId: string, fn: (s: TimeSession) => TimeSession) => {
    setData((d) => {
      const existing = d.sessions.find((s) => s.staffId === staffId && s.date === dhakaTodayKey());
      if (!existing) return d;
      return { ...d, sessions: d.sessions.map((s) => (s.id === existing.id ? fn(s) : s)) };
    });
  }, []);

  const clockIn = useCallback((staffId: string): ClockInEvent => {
    const emp = data.staff.find((e) => e.employeeId === staffId);
    if (todaySession(staffId)) { toast("Already clocked in today.", "info"); return { ok: false, lateMin: 0, isLate: false }; }
    // Snapshot the shift that is active at clock-in so historical evaluation
    // (lateness, overtime, early departure) is judged against THIS shift even
    // after the staff member's shift is later edited.
    const snapShift = emp ? empShift(emp) : null;
    const s: TimeSession = {
      id: uid("SES"), staffId, date: dhakaTodayKey(), timeIn: nowISO(), timeOut: null,
      breaks: [], extraTime: [], goOuts: [], completed: false,
      shiftStartMin: snapShift?.startMin, shiftEndMin: snapShift?.endMin,
      shiftStartTime: emp?.shiftStart, shiftEndTime: emp?.shiftEnd,
    };
    setData((d) => ({ ...d, sessions: [...d.sessions, s] }));
    void postJson("/api/clock", { employeeId: staffId, action: "in", timestamp: nowISO() }).then(async (response) => {
      if (!response.ok) {
        toast("Clock-in was not saved to the server.", "error");
        return;
      }
      const payload = await response.json() as { session?: { id?: string } };
      if (payload.session?.id) {
        setData((current) => ({
          ...current,
          sessions: current.sessions.map((item) => item.id === s.id ? { ...item, id: payload.session!.id! } : item),
        }));
      }
    });
    // late detection vs the shift's scheduled start (shift-aware for overnight)
    let lateMin = 0;
    if (emp && snapShift) {
      const schedStart = scheduledShiftBounds(s.timeIn, snapShift).start;
      lateMin = new Date(s.timeIn).getTime() > schedStart ? Math.round((new Date(s.timeIn).getTime() - schedStart) / 60000) : 0;
    }
    const grace = Number(configValue(data.config, "LATE_GRACE_MINUTES", "10"));
    const isLate = lateMin >= grace;
    audit("CLOCK_IN", "Session", staffId, `${emp?.fullName ?? staffId} clocked in${isLate ? ` (${formatDuration(lateMin)} late)` : " on time"}.`);
    // Flag for manager approval if late by 10+ minutes.
    if (isLate) flagApproval(staffId, s.id, "late", lateMin);
    return { ok: true, lateMin, isLate };
  }, [data.staff, data.config, todaySession, audit, toast, flagApproval]);

  const clockOut = useCallback((staffId: string): { ok: boolean; earlyDepartureMin: number } => {
    const s = todaySession(staffId);
    if (!s) { toast("Not clocked in.", "error"); return { ok: false, earlyDepartureMin: 0 }; }
    if (s.timeOut) { toast("Already clocked out.", "info"); return { ok: false, earlyDepartureMin: 0 }; }
    const emp = staffById(staffId);
    const outISO = nowISO();
    let earlyDepartureMin = 0;
    if (emp) {
      const shift = empShift(emp);
      const schedEnd = scheduledShiftBounds(s.timeIn, shift).end;
      const outMs = new Date(outISO).getTime();
      if (outMs < schedEnd) {
        const raw = Math.round((schedEnd - outMs) / 60000);
        const shiftDurationMin = shift.endMin >= shift.startMin
          ? shift.endMin - shift.startMin
          : (24 * 60 - shift.startMin) + shift.endMin;
        earlyDepartureMin = Math.max(0, Math.min(raw, shiftDurationMin));
      }
    }
    updateSession(staffId, (x) => ({
      ...x, timeOut: outISO, completed: true,
      breaks: x.breaks.map((b) => (b.end ? b : { ...b, end: outISO })),
      extraTime: (x.extraTime ?? []).map((b) => (b.end ? b : { ...b, end: outISO })),
      // Close any open go-out too — otherwise the staff stays "on go-out" forever.
      goOuts: (x.goOuts ?? []).map((g) => (g.end ? g : { ...g, end: outISO })),
    }));
    void postJson("/api/clock", { employeeId: staffId, action: "out" }).then(async (response) => {
      if (!response.ok) { toast("Clock-out was not saved to the server.", "error"); return; }
      // Re-sync from the server so the client can never stay out of step with
      // the DB (fixes: client shows "clocked out" while the server still sees
      // the shift "on duty" — which used to block payout server-side).
      try {
        const res = await fetch(STATE_ENDPOINT, { cache: "no-store" });
        if (res.ok) {
          const payload = await res.json() as { data?: Dataset };
          if (payload.data) setData(migrate(payload.data));
        }
      } catch { /* best-effort; local optimistic state remains */ }
    });
    const earlyStr = formatDuration(earlyDepartureMin);
    audit("CLOCK_OUT", "Session", staffId, `${emp?.fullName ?? staffId} clocked out${earlyDepartureMin ? ` (${earlyStr} early)` : ""}.`);
    toast(earlyDepartureMin >= 10 ? `Early departure — left ${earlyStr} before shift end.` : "Clocked out on time. Thank you!", earlyDepartureMin >= 10 ? "error" : "success");
    // Flag for manager approval if early departure >= 10 min.
    if (earlyDepartureMin >= 10 && s.id) flagApproval(staffId, s.id, "early_exit", earlyDepartureMin);
    return { ok: true, earlyDepartureMin };
  }, [todaySession, updateSession, audit, toast, staffById, flagApproval]);

  const toggleExtraTime = useCallback((staffId: string) => {
    const s = todaySession(staffId);
    if (!s || s.timeOut) { toast("Clock in first.", "error"); return; }
    const active = (s.extraTime ?? []).some((b) => !b.end);
    if (active) {
      updateSession(staffId, (x) => ({ ...x, extraTime: (x.extraTime ?? []).map((b) => (b.end ? b : { ...b, end: nowISO() })) }));
      toast("Extra Time paused.", "info");
    } else {
      updateSession(staffId, (x) => ({ ...x, extraTime: [...(x.extraTime ?? []), { id: uid("ET"), type: "rest", start: nowISO(), end: null }] }));
      audit("EXTRA_TIME", "Session", staffId, `${staffById(staffId)?.fullName ?? staffId} enabled Extra Time.`);
      toast("Extra Time ON — routed to overtime pay.", "success");
    }
  }, [todaySession, updateSession, audit, toast, staffById]);

  const startBreak = useCallback((staffId: string, type: BreakType) => {
    const s = todaySession(staffId);
    if (!s || s.timeOut) { toast("Clock in first.", "error"); return; }
    if (s.breaks.some((b) => !b.end)) { toast("Finish the current break first.", "error"); return; }
    // Guard: cannot start a break while on a go-out.
    if ((s.goOuts ?? []).some((g) => !g.end)) { toast("Return from your go-out first.", "error"); return; }
    updateSession(staffId, (x) => ({ ...x, breaks: [...x.breaks, { id: uid("BK"), type, start: nowISO(), end: null }] }));
    void postJson("/api/clock", { employeeId: staffId, action: "break_start", breakType: type }).then((response) => {
      if (!response.ok) toast("Break start was not saved to the server.", "error");
    });
    audit("BREAK_START", "Session", staffId, `${staffById(staffId)?.fullName ?? staffId} started ${type} break.`);
    const label = type === "meal" ? "Meal" : type === "rest" ? "Rest" : type === "unpaid" ? "Unpaid" : "Go-Out";
    toast(`${label} started${type === "unpaid" ? " — deducted from pay" : type === "goout" ? " — tracked, no deduction" : ""}.`, "info");
  }, [todaySession, updateSession, audit, toast, staffById]);

  const endBreak = useCallback((staffId: string) => {
    updateSession(staffId, (x) => ({ ...x, breaks: x.breaks.map((b) => (b.end ? b : { ...b, end: nowISO() })) }));
    void postJson("/api/clock", { employeeId: staffId, action: "break_end" }).then((response) => {
      if (!response.ok) toast("Break end was not saved to the server.", "error");
    });
    audit("BREAK_END", "Session", staffId, `${staffById(staffId)?.fullName ?? staffId} returned from break.`);
    toast("Back to work.", "success");
  }, [updateSession, audit, toast, staffById]);

  // ---- paid go-out (field work — no deduction) ----
  const startGoOut = useCallback((staffId: string, reason: string, estimatedMin: number) => {
    const s = todaySession(staffId);
    if (!s || s.timeOut) { toast("Clock in first.", "error"); return; }
    // Guard: no overlapping break OR go-out (double-tap protection).
    if (s.breaks.some((b) => !b.end)) { toast("Finish the current break first.", "error"); return; }
    if ((s.goOuts ?? []).some((g) => !g.end)) { toast("Already on a go-out.", "error"); return; }
    setData((d) => ({
      ...d,
      sessions: d.sessions.map((x) => x.id === s.id
        ? { ...x, goOuts: [...(x.goOuts ?? []), { id: uid("GO"), start: nowISO(), end: null, reason, estimatedMin }] }
        : x),
    }));
    void postJson("/api/clock", { employeeId: staffId, action: "goout_start", goOutReason: reason, goOutEstimatedMin: estimatedMin }).then((response) => {
      if (!response.ok) toast("Go-out was not saved to the server.", "error");
    });
    audit("GO_OUT_START", "Session", staffId, `${staffById(staffId)?.fullName ?? staffId} went out: ${reason}.`);
    toast("Go-Out started — time tracked, no deduction.", "info");
  }, [todaySession, audit, toast, staffById]);

  const endGoOut = useCallback((staffId: string) => {
    updateSession(staffId, (x) => ({ ...x, goOuts: (x.goOuts ?? []).map((g) => (g.end ? g : { ...g, end: nowISO() })) }));
    void postJson("/api/clock", { employeeId: staffId, action: "goout_end" }).then((response) => {
      if (!response.ok) toast("Go-out return was not saved to the server.", "error");
    });
    audit("GO_OUT_END", "Session", staffId, `${staffById(staffId)?.fullName ?? staffId} returned from go-out.`);
    toast("Welcome back!", "success");
  }, [updateSession, audit, toast, staffById]);

  // ---------------------------------------------------------------------
  // PAYMENTS â€” strictly DAY-WISE and CLOCK-OUT dependent.
  //   â€¢ A shift is payable only after the staff member has clocked out.
  //   â€¢ Each unpaid day keeps its OWN Payment row (date / hours / net).
  //   â€¢ Multiple unpaid days can be settled together â€” ONE transaction,
  //     shared batchId â€” and the payslip itemizes every date covered.
  // ---------------------------------------------------------------------
  const paySessions = useCallback((sessionIds: string[]): string | null => {
    if (!guard("pay.staff")) return null;
    const uniqueIds = [...new Set(sessionIds)];
    if (uniqueIds.length === 0) return null;
    // All selected days must already be clocked out â€” pay is locked otherwise.
    const openSessions = uniqueIds
      .map((id) => data.sessions.find((s) => s.id === id))
      .filter((s) => !s?.timeOut);
    if (openSessions.length > 0) {
      toast("Pay is locked until the staff member clocks out.", "error");
      return null;
    }
    const first = data.sessions.find((s) => s.id === uniqueIds[0]);
    const staff = first ? staffById(first.staffId) : undefined;
    if (!first || !staff) { toast("Session not found.", "error"); return null; }
    const already = uniqueIds.filter((id) => data.payments.some((p) => p.sessionId === id));
    if (already.length > 0) { toast("Already paid.", "info"); return null; }
    if (uniqueIds.some((id) => data.sessions.find((s) => s.id === id)?.staffId !== staff.employeeId)) {
      toast("A settlement can only cover one staff member's days.", "error");
      return null;
    }
    const batchId = uid("BATCH");
    // POST once â€” the server creates one Payment row per day atomically.
    void postJson("/api/payments", { sessionIds: uniqueIds, paidBy: session?.name ?? "Admin" }).then(async (response) => {
      if (!response.ok) { toast("Payment was not saved to the server.", "error"); return; }
      // Adopt the server-authoritative records (amounts, advance adjustment,
      // audit trail, batchId) so client state can never drift from the DB.
      try {
        const res = await fetch(STATE_ENDPOINT, { cache: "no-store" });
        if (res.ok) {
          const payload = await res.json() as { data?: Dataset };
          if (payload.data) setData(migrate(payload.data));
        }
      } catch { /* best-effort; local optimistic records remain */ }
    });
    return batchId;
  }, [guard, data.sessions, data.payments, data.staff, staffById, session, audit, toast]);
  /** Pay an arbitrary advance amount; reduces accumulated arrears first. */
  const payCustomAdvance = useCallback((staffId: string, amount: number) => {
    if (!guard("pay.staff")) return;
    const staff = staffById(staffId);
    const amt = payRound(amount);
    if (!staff) { toast("Staff not found.", "error"); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast("Enter a valid amount.", "error"); return; }
    const paidAt = nowISO();
    const payment: Payment = {
      id: uid("ADV"), staffId, sessionId: "", date: dhakaTodayKey(), paidAt,
      periodLabel: `${dhakaTodayKey()} · Advance`, dutyHours: 0, workedMin: 0, breakMin: 0,
      overBreakMin: 0, overtimeMin: 0, overtimePay: 0, hourlyRate: 0, grossPay: amt,
      advanceAdjusted: 0, overBreakDeduction: 0, netPay: amt, status: "Paid", paidBy: session?.name ?? "Admin",
    };
    setData((d) => ({
      ...d,
      payments: [payment, ...d.payments],
      staff: d.staff.map((e) => (e.employeeId === staffId ? { ...e, arrears: Math.max(0, payRound((e.arrears ?? 0) - amt)) } : e)),
    }));
    audit("ADVANCE", "Payment", staffId, `Paid ৳${amt.toFixed(2)} advance to ${staff.fullName}.`);
    toast(`Paid ৳${amt.toFixed(2)} advance to ${staff.fullName}.`, "success");
  }, [guard, staffById, session, audit, toast]);

  /** Log an advance (অগ্রিম) given to a staff member — deducted from their next payout. */
  const takeAdvance = useCallback((staffId: string, amount: number) => {
    if (!guard("pay.staff")) return;
    const staff = staffById(staffId);
    const amt = payRound(amount);
    if (!staff) { toast("Staff not found.", "error"); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast("Enter a valid amount.", "error"); return; }
    void postJson("/api/advance", { staffId, amount: amt, createdBy: session?.name ?? "Admin" }).then((response) => {
      if (!response.ok) toast("Advance was not saved to the server.", "error");
    });
    setData((d) => ({
      ...d,
      staff: d.staff.map((e) => (e.employeeId === staffId ? { ...e, advance: payRound((e.advance ?? 0) + amt) } : e)),
    }));
    audit("TAKE_ADVANCE", "Payment", staffId, `Advance ৳${amt.toFixed(2)} given to ${staff.fullName}. Will be deducted from next payout.`);
    toast(`Advance ৳${amt.toFixed(2)} logged for ${staff.fullName}.`, "success");
  }, [guard, staffById, session, audit, toast]);

  // ---- staff CRUD ----
  // Maximum of SUPERVISOR_MAX hybrid supervisor/cashier accounts.
  const supervisorCount = useCallback((excludeId?: string) => data.staff.filter((e) => e.employeeId !== excludeId && e.role === "SUPERVISOR").length, [data.staff]);

  const createStaff = useCallback((d: Partial<Employee>): FormResult => {
    if (!guard("manage.staff")) return { ok: false };
    const ids = data.staff.map((e) => e.employeeId);
    const existingUsernames = data.staff.map((e) => e.username.toLowerCase());
    const errors = validateStaff(d, { existingIds: ids, existingUsernames });
    if (d.role === "SUPERVISOR" && supervisorCount() >= SUPERVISOR_MAX) errors.push({ field: "role", message: `Maximum ${SUPERVISOR_MAX} supervisor accounts allowed.` });
    if (errors.length) return { ok: false, errors };
    const s: Employee = {
      recordId: uid("REC"), employeeId: d.employeeId!, username: (d.username ?? d.employeeId!.toLowerCase()).trim().toLowerCase(),
      password: d.password ?? "1111", fullName: d.fullName!.trim(), email: (d.email ?? "").trim(),
      phone: d.phone!.trim(), department: d.department!, jobTitle: d.jobTitle!.trim(), section: d.section ?? "Sales Floor",
      counter: d.counter ?? null, joinDate: d.joinDate!, endDate: null, role: d.role || "STAFF",
      salaryType: d.salaryType || "Daily", baseSalary: Number(d.baseSalary) || 0, dailyRate: Number(d.dailyRate) || 0,
      hourlyRate: Number(d.hourlyRate) || 0, shiftStart: d.shiftStart || "09:00 AM", shiftEnd: d.shiftEnd || "08:00 PM",
      mealBreakMin: Number(d.mealBreakMin) || 30, restMin: Number(d.restMin) || 15, shiftId: d.shiftId || "SH-FULL",
      photoUrl: d.photoUrl ?? "", status: "Active", isActive: true, arrears: 0, advance: 0,
    };
    void postJson("/api/staff", s).then((response) => {
      if (!response.ok) toast("Staff was not saved to the server.", "error");
    });
    setData((st) => ({ ...st, staff: [...st.staff, s] }));
    audit("CREATE", "Staff", s.employeeId, `Added staff ${s.fullName} (${s.employeeId}).`);
    toast(`Staff ${s.fullName} added. Username: ${s.username}`, "success");
    return { ok: true };
  }, [guard, data.staff, audit, toast]);

  const updateStaff = useCallback((id: string, d: Partial<Employee>): FormResult => {
    if (!guard("manage.staff")) return { ok: false };
    const existing = data.staff.find((e) => e.employeeId === id);
    if (!existing) return { ok: false };
    const others = data.staff.filter((e) => e.employeeId !== id);
    const errors = validateStaff(
      { ...existing, ...d },
      { existingIds: others.map((e) => e.employeeId), existingUsernames: others.map((e) => e.username.toLowerCase()), selfUsername: existing.username.toLowerCase(), isUpdate: true }
    );
    if (d.role === "SUPERVISOR" && existing.role !== "SUPERVISOR" && supervisorCount(id) >= SUPERVISOR_MAX) errors.push({ field: "role", message: `Maximum ${SUPERVISOR_MAX} supervisor accounts allowed.` });
    if (errors.length) return { ok: false, errors };
    const next: Employee = {
      ...existing, ...d,
      baseSalary: Number(d.baseSalary ?? existing.baseSalary), dailyRate: Number(d.dailyRate ?? existing.dailyRate),
      hourlyRate: Number(d.hourlyRate ?? existing.hourlyRate), counter: d.counter ?? existing.counter,
    };
    void postJson("/api/staff", next, "PUT").then((response) => {
      if (!response.ok) toast("Staff changes were not saved to the server.", "error");
    });
    setData((st) => ({ ...st, staff: st.staff.map((e) => (e.employeeId === id ? next : e)) }));
    audit("UPDATE", "Staff", id, `Updated ${existing.fullName}.`);
    toast("Staff updated.", "success");
    return { ok: true };
  }, [guard, data.staff, audit, toast]);

  const deactivateStaff = useCallback((id: string) => {
    if (!guard("manage.staff")) return;
    const s = data.staff.find((e) => e.employeeId === id);
    void postJson("/api/staff", { employeeId: id }, "DELETE").then((response) => {
      if (!response.ok) toast("Staff deactivation was not saved to the server.", "error");
    });
    setData((st) => ({ ...st, staff: st.staff.map((e) => (e.employeeId === id ? { ...e, isActive: false, status: "Terminated", endDate: nowISO().slice(0, 10) } : e)) }));
    audit("DELETE", "Staff", id, `Deactivated ${s?.fullName ?? id}.`);
    toast(`${s?.fullName} deactivated.`, "info");
  }, [guard, data.staff, audit, toast]);

  const assignCounter = useCallback((staffId: string, counter: number | null) => {
    if (!guard("manage.staff")) return;
    const staff = data.staff.find((e) => e.employeeId === staffId);
    if (!staff) return;
    const before = data.staff;
    const next = { ...staff, counter };
    // Optimistic local update so the roster grid feels instant…
    setData((st) => ({ ...st, staff: st.staff.map((e) => (e.employeeId === staffId ? next : e)) }));
    // …but NO toast until the server confirms. Success = confirmed 2xx only;
    // failure rolls the local state back so the roster card and the Counters
    // page can never disagree about who owns a counter.
    void postJson("/api/staff", { employeeId: staffId, counter }, "PUT").then((response) => {
      if (!response.ok) {
        setData((st) => ({ ...st, staff: before }));
        toast("Counter assignment was not saved to the server.", "error");
        return;
      }
      audit("UPDATE", "Staff", staffId, `Counter set to ${counter ?? "none"}.`);
      toast(counter == null
        ? `Cleared counter for ${staff.fullName}.`
        : `Assigned ${staff.fullName} to Counter ${counter}.`, "success");
    });
  }, [guard, data.staff, audit, toast]);

  // ---- leave ----
  const submitLeave = useCallback((d: { staffId: string; leaveType: LeaveType; fromDate: string; toDate: string; reason: string }): FormResult => {
    const errors = validateLeave(d);
    if (errors.length) return { ok: false, errors };
    const overlap = data.leaveRequests.some((r) => r.staffId === d.staffId && r.status === "Approved" && !(d.toDate < r.fromDate || d.fromDate > r.toDate));
    if (overlap) { toast("Overlaps an approved leave.", "error"); return { ok: false, errors: [{ field: "toDate", message: "Overlaps approved leave." }] }; }
    const days = workingDaysBetween(d.fromDate, d.toDate, data.holidays);
    const req: LeaveRequest = { recordId: uid("LV"), staffId: d.staffId, leaveType: d.leaveType, fromDate: d.fromDate, toDate: d.toDate, days, reason: d.reason, status: "Pending", approvedBy: null, approvedAt: null };
    void postJson("/api/leave", req).then((response) => {
      if (!response.ok) toast("Leave request was not saved to the server.", "error");
    });
    setData((st) => ({ ...st, leaveRequests: [req, ...st.leaveRequests] }));
    audit("LEAVE_REQUEST", "Leave", req.recordId, `${d.leaveType} leave requested (${days}d).`);
    toast("Leave request submitted.", "success");
    return { ok: true };
  }, [data.leaveRequests, data.holidays, audit, toast]);

  const decideLeave = useCallback((id: string, status: LeaveStatus, comment?: string): FormResult => {
    if (!guard("manage.leave")) return { ok: false };
    const req = data.leaveRequests.find((r) => r.recordId === id);
    if (!req) return { ok: false };
    if (status === "Approved") {
      const bal = data.leaveBalances.find((b) => b.staffId === req.staffId && b.leaveType === req.leaveType);
      const rem = bal ? bal.entitledDays - bal.usedDays : 0;
      if (req.leaveType !== "Unpaid" && rem < req.days) { toast(`Insufficient ${req.leaveType} balance.`, "error"); return { ok: false }; }
    }
    void postJson("/api/leave", { recordId: id, status, approvedBy: session?.name ?? "Admin", comment }, "PATCH").then((response) => {
      if (!response.ok) toast("Leave decision was not saved to the server.", "error");
    });
    setData((st) => ({
      ...st,
      leaveRequests: st.leaveRequests.map((r) => (r.recordId === id ? { ...r, status, comment: comment?.trim() || undefined, approvedBy: session?.name ?? "Admin", approvedAt: nowISO() } : r)),
      leaveBalances: status === "Approved" && req.leaveType !== "Unpaid"
        ? st.leaveBalances.map((b) => (b.staffId === req.staffId && b.leaveType === req.leaveType ? { ...b, usedDays: b.usedDays + req.days } : b))
        : st.leaveBalances,
      staff: status === "Approved" && req.fromDate <= dhakaTodayKey() && req.toDate >= dhakaTodayKey()
        ? st.staff.map((e) => (e.employeeId === req.staffId ? { ...e, status: "On-leave" } : e))
        : status === "Rejected" && st.staff.find((e) => e.employeeId === req.staffId)?.status === "On-leave"
          ? st.staff.map((e) => (e.employeeId === req.staffId ? { ...e, status: "Active" } : e))
          : st.staff,
    }));
    audit(status === "Approved" ? "LEAVE_APPROVE" : "LEAVE_REJECT", "Leave", id, `${status} ${req.leaveType} leave for ${req.staffId}.`);
    toast(`Leave ${status.toLowerCase()}.`, status === "Approved" ? "success" : "info");
    return { ok: true };
  }, [guard, data.leaveRequests, data.leaveBalances, session, audit, toast]);

  // ---- config + sync ----
  const updateConfig = useCallback((key: string, value: string) => {
    if (!guard("manage.config")) return;
    void postJson("/api/config", { key, value }, "PUT").then((response) => {
      if (!response.ok) toast("Setting was not saved to the database.", "error");
    });
    setData((st) => {
      const next = { ...st, config: st.config.map((c) => (c.key === key ? { ...c, value } : c)) };
      // Leave-entitlement keys instantly propagate to every staff balance.
      const entMap: Record<string, string> = {
        ANNUAL_LEAVE_ENTITLEMENT: "Annual",
        SICK_LEAVE_ENTITLEMENT: "Sick",
        CASUAL_LEAVE_ENTITLEMENT: "Casual",
      };
      if (entMap[key]) {
        const lt = entMap[key];
        const days = Number(value) || 0;
        const year = new Date().getFullYear();
        next.leaveBalances = next.leaveBalances.map((b) =>
          b.leaveType === lt && b.year === year ? { ...b, entitledDays: days } : b
        );
        // Ensure any staff missing a balance row get one.
        for (const emp of next.staff.filter((e) => e.isActive)) {
          const has = next.leaveBalances.some((b) => b.staffId === emp.employeeId && b.leaveType === lt && b.year === year);
          if (!has) next.leaveBalances.push({ staffId: emp.employeeId, leaveType: lt as never, entitledDays: days, usedDays: 0, year });
        }
      }
      return next;
    });
    audit("UPDATE", "Settings", key, `Changed ${key} = "${value}".`);
    toast(`${key} updated.`, "success");
  }, [guard, audit, toast]);

  const resetData = useCallback(() => { setData(createSeedData()); toast("Demo data reset.", "info"); }, [toast]);

  /** Re-fetch the latest state from server (used after clock actions to sync UI). */
  const refreshData = useCallback(async () => {
    try {
      const response = await fetch(STATE_ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to refresh application state");
      const payload = await response.json() as { data?: Dataset };
      if (!payload.data) throw new Error("Application state is missing");
      setData(migrate(payload.data));
      return true;
    } catch {
      toast("Refresh failed - using current data.", "error");
      return false;
    }
  }, [toast]);

  // ---- manual data editing (export / import JSON) ----
  const exportData = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `KPSMS-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("Data exported.", "success");
    } catch { toast("Export failed.", "error"); }
  }, [data, toast]);

  const importData = useCallback((jsonText: string): boolean => {
    try {
      const parsed = migrate(JSON.parse(jsonText) as Dataset);
      setData(parsed);
      toast("Data imported successfully.", "success");
      return true;
    } catch {
      toast("Invalid file — must be a valid KPSMS data JSON.", "error");
      return false;
    }
  }, [toast]);

  // ---- approval system ----
  const resolveApproval = useCallback((id: string, status: "approved" | "rejected", note?: string) => {
    if (!guard("manage.leave")) return;
    setData((st) => ({ ...st, approvalRequests: st.approvalRequests.map((a) => (a.id === id ? { ...a, status, managerNote: note, resolvedBy: session?.name ?? "Manager", resolvedAt: nowISO() } : a)) }));
    toast(`Request ${status}.`, status === "approved" ? "success" : "info");
    void postJson("/api/approvals", { id, status, resolvedBy: session?.name ?? "Admin", managerNote: note }, "PATCH").then((response) => {
      if (!response.ok) toast("Approval decision was not saved to the server.", "error");
    });
  }, [guard, session, toast]);

  // ---- auto clock-out: N minutes after scheduled shift end ----
  // Uses a ref for the latest data so the interval is created ONCE (no churn).
  const autoClockRef = useRef({ data, audit });
  autoClockRef.current = { data, audit };
  useEffect(() => {
    const interval = window.setInterval(() => {
      const { data: d, audit: log } = autoClockRef.current;
      const now = Date.now();
      const autoMin = Number(configValue(d.config, "AUTO_CLOCKOUT_MINUTES", "15"));
      const changed: TimeSession[] = [];
      for (const s of d.sessions) {
        if (s.timeOut || s.completed) continue;
        const emp = d.staff.find((e) => e.employeeId === s.staffId);
        if (!emp) continue;
        const shift = shiftForSession(emp, s);
        const schedEnd = scheduledShiftBounds(s.timeIn, shift).end;
        if (now > schedEnd + autoMin * 60000) {
          const outISO = new Date(schedEnd + autoMin * 60000).toISOString();
          changed.push({
            ...s, timeOut: outISO, completed: true, autoClockedOut: true,
            breaks: s.breaks.map((b) => (b.end ? b : { ...b, end: outISO })),
            goOuts: (s.goOuts ?? []).map((g) => (g.end ? g : { ...g, end: outISO })),
            // Close open extra-time segments so overtime stops accruing.
            extraTime: (s.extraTime ?? []).map((b) => (b.end ? b : { ...b, end: outISO })),
          });
        }
      }
      if (changed.length > 0) {
        setData((prev) => ({ ...prev, sessions: prev.sessions.map((s) => changed.find((c) => c.id === s.id) ?? s) }));
        changed.forEach((c) => log("AUTO_CLOCKOUT", "Session", c.staffId, `Auto clocked out ${c.staffId} (auto, ${autoMin}m after shift end).`));
      }
    }, 30000); // check every 30s
    return () => window.clearInterval(interval);
  }, []);

  // ---- live sync ---- Admin/Supervisor dashboards need to reflect leave requests
  // (and other state) submitted from other sessions without a manual refresh.
  // Poll the DB-backed state endpoint when on a managerial role.
  const roleNow = session?.role;
  useEffect(() => {
    if (roleNow !== "ADMIN" && roleNow !== "SUPERVISOR") return;
    const interval = window.setInterval(() => {
      // Silent sync — do not surface "Refresh failed" toasts during background polls.
      fetch(STATE_ENDPOINT, { cache: "no-store" })
        .then((r) => r.ok ? r.json() : null)
        .then((payload: { data?: Dataset } | null) => {
          if (payload?.data) setData(migrate(payload.data));
        })
        .catch(() => { /* keep current state on transient errors */ });
    }, 15000);
    return () => window.clearInterval(interval);
  }, [roleNow]);

  // ---- derived global state ----
  // Completed shifts with no payment record → auto-registered as UNPAID dues.
  const unpaidShifts = useMemo(() => {
    const paidIds = new Set(data.payments.map((p) => p.sessionId));
    return data.sessions
      .filter((s) => s.timeOut && !paidIds.has(s.id))
      .map((s) => {
        const st = data.staff.find((e) => e.employeeId === s.staffId);
        if (!st) return null;
        const calc = computeSession(s, st, data.config, new Date(s.timeOut!).getTime());
        return { sessionId: s.id, staffId: s.staffId, date: s.date, netPay: payRound(calc.netPay) };
      })
      .filter((x): x is { sessionId: string; staffId: string; date: string; netPay: number } => x !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.sessions, data.payments, data.staff, data.config]);

  const anyOnDuty = data.sessions.some((s) => s.completed === false && s.timeOut === null && s.date === dhakaTodayKey());
  const pendingApprovals = data.approvalRequests.filter((a) => a.status === "pending");

  const value: AppContextValue = {
    data, session, hydrated, role, view, toasts,
    loginAdmin, loginEmployee, logout, navigate, toast, dismissToast,
    canPerm, staffById, shiftById, todaySession, paymentFor, isOnLeaveToday,
    clockIn, clockOut, startBreak, endBreak, toggleExtraTime, startGoOut, endGoOut, paySessions,
    payCustomAdvance, takeAdvance, unpaidShifts,
    anyOnDuty, pendingApprovals, resolveApproval,
    createStaff, updateStaff, deactivateStaff, assignCounter,
    submitLeave, decideLeave, updateConfig, resetData, refreshData, exportData, importData,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function today() { return new Date(); }

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}
export type { ConfigEntry };
