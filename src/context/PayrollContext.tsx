"use client";

const STATE_ENDPOINT = "/api/state";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import type { Employee, TimeSession, Payment, Dataset } from "@/types";
import { FormResult, FieldError } from "./AppContext.types";
import { useData } from "./DataContext";
import { useAuth } from "./AuthContext";
import { useUI } from "./UIContext";
import { computeSession, dhakaTodayKey } from "@/lib/timeclock";
import { payRound } from "@/lib/currency";
import { validateStaff } from "@/lib/validation";
import { configValue, SUPERVISOR_MAX } from "@/lib/config";
import { uid } from "@/lib/utils";
import { nowISO } from "@/lib/dates";
import { sanitizeReturnTo } from "@/lib/app-routes";

interface PayrollContextValue {
  paySessions: (sessionIds: string[]) => string | null;
  payCustomAdvance: (staffId: string, amount: number) => void;
  takeAdvance: (staffId: string, amount: number) => void;
  unpaidShifts: { sessionId: string; staffId: string; date: string; netPay: number }[];
  anyOnDuty: boolean;
}

const PayrollCtx = createContext<PayrollContextValue | null>(null);

export function PayrollProvider({ children }: { children: ReactNode }) {
  const { data, setData, refreshData } = useData();
  const { session, canPerm, clearSession } = useAuth();
  const { toast } = useUI();
  const handleUnauthorized = useCallback(() => {
    clearSession();
    if (typeof window !== "undefined") {
      const current = window.location.pathname + window.location.search;
      const ret = sanitizeReturnTo(current);
      window.location.replace(ret ? "/login?returnTo=" + encodeURIComponent(ret) : "/login");
    }
  }, [clearSession]);

  const postJson = useCallback((path: string, body: unknown, method = "POST") => {
    return fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => {
      if (response.status === 401) handleUnauthorized();
      return response;
    }).catch(() => new Response(null, { status: 503 }));
  }, [handleUnauthorized]);

  const guard = useCallback((perm: string): boolean => {
    if (canPerm(perm as any)) return true;
    toast(`Your role can't perform this action.`, "error");
    return false;
  }, [canPerm, toast]);

  const staffById = useCallback((id: string) => data.staff.find((e) => e.employeeId === id), [data.staff]);
  const todaySession = useCallback((staffId: string) => data.sessions.find((s) => s.staffId === staffId && s.date === dhakaTodayKey()), [data.sessions]);

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

  const paySessions = useCallback((_sessionIds: string[]): string | null => {
    if (!guard("pay.staff")) return null;
    toast("Legacy payment path is retired. Use canonical allocation/payment workflows.", "error");
    return null;
  }, [guard, toast]);

  const payCustomAdvance = useCallback(async (staffId: string, amount: number) => {
    if (!guard("pay.staff")) return;
    const staff = staffById(staffId);
    const amt = payRound(amount);
    if (!staff) { toast("Staff not found.", "error"); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast("Enter a valid amount.", "error"); return; }
    const newArrears = Math.max(0, payRound((staff.arrears ?? 0) - amt));
    try {
      const response = await fetch("/api/staff", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: staff.employeeId, arrears: newArrears }),
      });
      if (!response.ok) {
        let message = "Advance payment was not saved to the server.";
        try { const p = await response.json(); if (p?.error) message = p.error; } catch { /* ignore */ }
        toast(message, "error");
        return;
      }
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
        staff: d.staff.map((e) => (e.employeeId === staffId ? { ...e, arrears: newArrears } : e)),
      }));
      toast(`Paid ৳${amt.toFixed(2)} advance to ${staff.fullName}.`, "success");
    } catch {
      toast("Advance payment was not saved to the server.", "error");
    }
  }, [guard, staffById, session, toast]);

  const pendingTakeAdvance = useRef<Set<string>>(new Set());

  const takeAdvance = useCallback(async (staffId: string, amount: number) => {
    if (!guard("pay.staff")) return;
    if (pendingTakeAdvance.current.has(staffId)) { toast("Advance request already in progress.", "info"); return; }
    const staff = staffById(staffId);
    const amt = payRound(amount);
    if (!staff) { toast("Staff not found.", "error"); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toast("Enter a valid amount.", "error"); return; }

    const previousStaff = data.staff;
    pendingTakeAdvance.current.add(staffId);
    try {
      const response = await postJson("/api/advance", { staffId, amount: amt, createdBy: session?.name ?? "Admin" });
      if (!response.ok) {
        setData((d) => ({ ...d, staff: previousStaff }));
        let message = "Advance was not saved to the server.";
        try { const p = await response.json(); if (p?.error) message = p.error; } catch { /* ignore */ }
        toast(message, "error");
        return;
      }
      setData((d) => ({
        ...d,
        staff: d.staff.map((e) => (e.employeeId === staffId ? { ...e, advance: payRound((e.advance ?? 0) + amt) } : e)),
      }));
      toast(`Advance ৳${amt.toFixed(2)} logged for ${staff.fullName}.`, "success");
    } catch {
      setData((d) => ({ ...d, staff: previousStaff }));
      toast("Advance was not saved to the server.", "error");
    } finally {
      pendingTakeAdvance.current.delete(staffId);
    }
  }, [guard, staffById, session, toast, data.staff, setData]);

  return (
    <PayrollCtx.Provider value={{ paySessions, payCustomAdvance, takeAdvance, unpaidShifts, anyOnDuty }}>
      {children}
    </PayrollCtx.Provider>
  );
}

export function usePayroll(): PayrollContextValue {
  const v = useContext(PayrollCtx);
  if (!v) throw new Error("usePayroll must be used within PayrollProvider");
  return v;
}