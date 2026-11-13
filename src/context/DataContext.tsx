"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import type { Dataset, ConfigEntry, Employee, TimeSession, Shift, Payment, LeaveRequest, LeaveBalance, Holiday, ApprovalRequest, AuditEntry } from "@/types";
import { createSeedData } from "@/lib/seed";
import { useAuth } from "./AuthContext";
import { sanitizeReturnTo } from "@/lib/app-routes";

const STATE_ENDPOINT = "/api/state";

function migrate(data: Dataset): Dataset {
  const empty = {
    staff: [], departments: [], shifts: [], sessions: [], payments: [],
    overtimeLogs: [], leaveRequests: [], leaveBalances: [], holidays: [],
    approvalRequests: [], auditLog: [], config: [],
  };
  return { ...empty, ...data, ...Object.fromEntries(
    (Object.keys(empty) as (keyof typeof empty)[]).map((k) => [k, Array.isArray(data?.[k]) ? data[k] : empty[k]])
  ) };
}

interface DataContextValue {
  data: Dataset;
  setData: React.Dispatch<React.SetStateAction<Dataset>>;
  updateDataset: (fn: (d: Dataset) => Dataset) => void;
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  refreshData: () => Promise<boolean>;
  exportData: () => void;
  importData: (jsonText: string) => boolean;
  resetData: () => void;
}

const DataCtx = createContext<DataContextValue | null>(null);

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const current = `${window.location.pathname}${window.location.search}`;
  const ret = sanitizeReturnTo(current);
  const url = ret ? `/login?returnTo=${encodeURIComponent(ret)}` : "/login";
  window.location.replace(url);
}

function postJson(path: string, body: unknown, method = "POST", onUnauthorized?: () => void) {
  return fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => {
    if (response.status === 401) onUnauthorized?.();
    return response;
  }).catch(() => new Response(null, { status: 503 }));
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dataset>(() => createSeedData());
  const [hydrated, setHydrated] = useState(false);
  const { session, clearSession } = useAuth();

  useEffect(() => {
    if (!session) {
      setHydrated(true);
      return;
    }

    let cancelled = false;
    setHydrated(false);
    void fetch(STATE_ENDPOINT, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 401) {
          clearSession();
          redirectToLogin();
          return;
        }
        if (!response.ok) throw new Error("Unable to load application state");
        const payload = await response.json() as { data?: Dataset };
        if (cancelled) return;
        if (payload.data) setData(migrate(payload.data));
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => { cancelled = true; };
  }, [session, clearSession]);

  useEffect(() => {
    if (!hydrated || !session || (session.role !== "ADMIN" && session.role !== "SUPERVISOR")) return;
    const timer = window.setTimeout(() => {
      void postJson(STATE_ENDPOINT, { data }, "PUT", () => { clearSession(); redirectToLogin(); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data, hydrated, session, clearSession]);

  const refreshData = useCallback(async () => {
    try {
      const response = await fetch(STATE_ENDPOINT, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        clearSession();
        redirectToLogin();
        return false;
      }
      if (!response.ok) throw new Error("Unable to refresh application state");
      const payload = await response.json() as { data?: Dataset };
      if (!payload.data) throw new Error("Application state is missing");
      setData(migrate(payload.data));
      return true;
    } catch {
      return false;
    }
  }, [clearSession]);

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
    } catch { /* ignore */ }
  }, [data]);

  const importData = useCallback((jsonText: string): boolean => {
    try {
      const parsed = migrate(JSON.parse(jsonText) as Dataset);
      setData(parsed);
      return true;
    } catch {
      return false;
    }
  }, []);

  const resetData = useCallback(() => {
    const seed = createSeedData();
    setData(seed);
    if (session) {
      void fetch(STATE_ENDPOINT, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: seed, reset: true }),
      }).catch(() => { /* best-effort */ });
    }
  }, [session, setData]);

  const updateDataset = useCallback((fn: (d: Dataset) => Dataset) => {
    setData(fn);
  }, []);

  return (
    <DataCtx.Provider value={{ data, setData, updateDataset, hydrated, setHydrated, refreshData, exportData, importData, resetData }}>
      {children}
    </DataCtx.Provider>
  );
}

export function useData(): DataContextValue {
  const v = useContext(DataCtx);
  if (!v) throw new Error("useData must be used within DataProvider");
  return v;
}
