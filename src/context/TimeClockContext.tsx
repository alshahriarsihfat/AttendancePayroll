"use client";

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import type { BreakType, TimeSession } from "@/types";
import { ClockInEvent } from "./AppContext.types";
import { dhakaTodayKey } from "@/lib/timeclock";
import { useData } from "./DataContext";
import { useAuth } from "./AuthContext";
import { useUI } from "./UIContext";
import { sanitizeReturnTo } from "@/lib/app-routes";

interface TimeClockContextValue {
  clockIn: (staffId: string) => ClockInEvent;
  clockOut: (staffId: string) => { ok: boolean; earlyDepartureMin: number };
  startBreak: (staffId: string, type: BreakType) => void;
  endBreak: (staffId: string) => void;
  toggleExtraTime: (staffId: string) => void;
  startGoOut: (staffId: string, reason: string, estimatedMin: number) => void;
  endGoOut: (staffId: string) => void;
  todaySession: (staffId: string) => TimeSession | undefined;
  isOnLeaveToday: (staffId: string) => boolean;
}

const TimeClockCtx = createContext<TimeClockContextValue | null>(null);

const STATE_ENDPOINT = "/api/state";

export function TimeClockProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useData();
  const { clearSession } = useAuth();
  const { toast } = useUI();
  const pendingClockIns = useRef<Set<string>>(new Set());
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
      if (response.status === 401) {
        handleUnauthorized();
      }
      return response;
    }).catch(() => new Response(null, { status: 503 }));
  }, [handleUnauthorized]);

  const todaySession = useCallback((staffId: string) => {
    return data.sessions.find((s) => s.staffId === staffId && s.date === dhakaTodayKey());
  }, [data.sessions]);

  const isOnLeaveToday = useCallback((staffId: string) => {
    const t = dhakaTodayKey();
    return data.leaveRequests.some((r) => r.staffId === staffId && r.status === "Approved" && r.fromDate <= t && r.toDate >= t);
  }, [data.leaveRequests]);

  const updateSession = useCallback((staffId: string, fn: (s: TimeSession) => TimeSession) => {
    setData((d) => {
      const existing = d.sessions.find((s) => s.staffId === staffId && s.date === dhakaTodayKey());
      if (!existing) return d;
      return { ...d, sessions: d.sessions.map((s) => (s.id === existing.id ? fn(s) : s)) };
    });
  }, [setData]);

  const clockIn = useCallback((staffId: string): ClockInEvent => {
    if (pendingClockIns.current.has(staffId)) { toast("Clock-in already in progress.", "info"); return { ok: false, lateMin: 0, isLate: false }; }
    const emp = data.staff.find((e) => e.employeeId === staffId);
    if (todaySession(staffId)) { toast("Already clocked in today.", "info"); return { ok: false, lateMin: 0, isLate: false }; }

    const previousSessions = data.sessions;
    const s: TimeSession = {
      id: `SES-${Date.now()}`, staffId, date: dhakaTodayKey(), timeIn: new Date().toISOString(), timeOut: null,
      breaks: [], extraTime: [], goOuts: [], completed: false,
    };
    setData((d) => ({ ...d, sessions: [...d.sessions, s] }));
    pendingClockIns.current.add(staffId);

    void postJson("/api/clock", { employeeId: staffId, action: "in", timestamp: new Date().toISOString() }).then(async (response) => {
      if (!response.ok) {
        setData((d) => ({ ...d, sessions: previousSessions }));
        let message = "Clock-in was not saved to the server.";
        try { const p = await response.json(); if (p?.error) message = p.error; } catch { /* ignore */ }
        toast(message, "error");
        return;
      }
      const payload = await response.json() as { session?: { id?: string } };
      if (payload.session?.id) {
        setData((current) => ({
          ...current,
          sessions: current.sessions.map((item) => item.id === s.id ? { ...item, id: payload.session!.id! } : item),
        }));
      }
    }).finally(() => {
      pendingClockIns.current.delete(staffId);
    });

    return { ok: true, lateMin: 0, isLate: false };
  }, [data.staff, data.sessions, todaySession, setData, toast]);

  const clockOut = useCallback((staffId: string): { ok: boolean; earlyDepartureMin: number } => {
    const key = `${staffId}:out`;
    if (pendingClockIns.current.has(key)) { toast("Clock-out already in progress.", "info"); return { ok: false, earlyDepartureMin: 0 }; }
    const s = todaySession(staffId);
    if (!s) { toast("Not clocked in.", "error"); return { ok: false, earlyDepartureMin: 0 }; }
    if (s.timeOut) { toast("Already clocked out.", "info"); return { ok: false, earlyDepartureMin: 0 }; }

    const previousSessions = data.sessions;
    const outISO = new Date().toISOString();
    updateSession(staffId, (x) => ({
      ...x, timeOut: outISO, completed: true,
      breaks: x.breaks.map((b) => (b.end ? b : { ...b, end: outISO })),
      extraTime: (x.extraTime ?? []).map((b) => (b.end ? b : { ...b, end: outISO })),
      goOuts: (x.goOuts ?? []).map((g) => (g.end ? g : { ...g, end: outISO })),
    }));

    pendingClockIns.current.add(key);
    void postJson("/api/clock", { employeeId: staffId, action: "out" }).then(async (response) => {
      if (!response.ok) {
        setData((d) => ({ ...d, sessions: previousSessions }));
        let message = "Clock-out was not saved to the server.";
        try { const p = await response.json(); if (p?.error) message = p.error; } catch { /* ignore */ }
        toast(message, "error");
      }
    }).finally(() => {
      pendingClockIns.current.delete(key);
    });
    return { ok: true, earlyDepartureMin: 0 };
  }, [todaySession, updateSession, data.sessions, setData, toast]);

  const startBreak = useCallback((staffId: string, type: BreakType) => {
    const key = `${staffId}:break_start`;
    if (pendingClockIns.current.has(key)) { toast("Break action already in progress.", "info"); return; }
    const s = todaySession(staffId);
    if (!s || s.timeOut) { toast("Clock in first.", "error"); return; }
    if (s.breaks.some((b) => !b.end)) { toast("Finish the current break first.", "error"); return; }
    if ((s.goOuts ?? []).some((g) => !g.end)) { toast("Return from your go-out first.", "error"); return; }

    const previousSessions = data.sessions;
    updateSession(staffId, (x) => ({ ...x, breaks: [...x.breaks, { id: `BK-${Date.now()}`, type, start: new Date().toISOString(), end: null }] }));

    pendingClockIns.current.add(key);
    void postJson("/api/clock", { employeeId: staffId, action: "break_start", breakType: type }).then(async (response) => {
      if (!response.ok) {
        setData((d) => ({ ...d, sessions: previousSessions }));
        let message = "Break start was not saved to the server.";
        try { const p = await response.json(); if (p?.error) message = p.error; } catch { /* ignore */ }
        toast(message, "error");
      }
    }).finally(() => {
      pendingClockIns.current.delete(key);
    });
  }, [todaySession, updateSession, data.sessions, setData, toast]);

  const endBreak = useCallback((staffId: string) => {
    const key = `${staffId}:break_end`;
    if (pendingClockIns.current.has(key)) { toast("Break action already in progress.", "info"); return; }
    const previousSessions = data.sessions;
    updateSession(staffId, (x) => ({ ...x, breaks: x.breaks.map((b) => (b.end ? b : { ...b, end: new Date().toISOString() })) }));

    pendingClockIns.current.add(key);
    void postJson("/api/clock", { employeeId: staffId, action: "break_end" }).then(async (response) => {
      if (!response.ok) {
        setData((d) => ({ ...d, sessions: previousSessions }));
        let message = "Break end was not saved to the server.";
        try { const p = await response.json(); if (p?.error) message = p.error; } catch { /* ignore */ }
        toast(message, "error");
      }
    }).finally(() => {
      pendingClockIns.current.delete(key);
    });
  }, [updateSession, data.sessions, setData, toast]);

  const toggleExtraTime = useCallback((staffId: string) => {
    const s = todaySession(staffId);
    if (!s || s.timeOut) { toast("Clock in first.", "error"); return; }
    if (s.overtimeActivatedAt) {
      toast("Supervisor-authorized Extra Time is running until manual clock-out.", "info");
      return;
    }
    toast("Extra Time (OT) requires supervisor activation after duty end.", "info");
  }, [todaySession, toast]);

  const startGoOut = useCallback((staffId: string, reason: string, estimatedMin: number) => {
    const s = todaySession(staffId);
    if (!s || s.timeOut) { toast("Clock in first.", "error"); return; }
    if (s.breaks.some((b) => !b.end)) { toast("Finish the current break first.", "error"); return; }
    if ((s.goOuts ?? []).some((g) => !g.end)) { toast("Already on a go-out.", "error"); return; }
    setData((d) => ({
      ...d,
      sessions: d.sessions.map((x) => x.id === s.id
        ? { ...x, goOuts: [...(x.goOuts ?? []), { id: `GO-${Date.now()}`, start: new Date().toISOString(), end: null, reason, estimatedMin }] }
        : x),
    }));
    void postJson("/api/clock", { employeeId: staffId, action: "goout_start", goOutReason: reason, goOutEstimatedMin: estimatedMin });
  }, [todaySession, setData, toast]);

  const endGoOut = useCallback((staffId: string) => {
    updateSession(staffId, (x) => ({ ...x, goOuts: (x.goOuts ?? []).map((g) => (g.end ? g : { ...g, end: new Date().toISOString() })) }));
    void postJson("/api/clock", { employeeId: staffId, action: "goout_end" });
  }, [updateSession]);

  return (
    <TimeClockCtx.Provider value={{ clockIn, clockOut, startBreak, endBreak, toggleExtraTime, startGoOut, endGoOut, todaySession, isOnLeaveToday }}>
      {children}
    </TimeClockCtx.Provider>
  );
}

export function useTimeClock(): TimeClockContextValue {
  const v = useContext(TimeClockCtx);
  if (!v) throw new Error("useTimeClock must be used within TimeClockProvider");
  return v;
}