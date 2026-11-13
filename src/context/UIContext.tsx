"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import { PageId } from "./AppContext.types";
import { uid } from "@/lib/utils";
import { parseViewFromLocation, viewToSearch, type AppView } from "@/lib/app-routes";

export interface Toast { id: string; message: string; type: "success" | "error" | "info"; }
export interface View { page: PageId; params?: Record<string, string>; }

interface UIContextValue {
  view: View;
  navigate: (page: PageId, params?: Record<string, string>, opts?: { replace?: boolean }) => void;
  goBack: () => void;
  toasts: Toast[];
  toast: (message: string, type?: Toast["type"]) => void;
  dismissToast: (id: string) => void;
  setView: (view: View, opts?: { replace?: boolean; syncUrl?: boolean }) => void;
}

const UICtx = createContext<UIContextValue | null>(null);

function readViewFromWindow(): View | null {
  if (typeof window === "undefined") return null;
  return parseViewFromLocation(window.location) as View | null;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<View>(() => readViewFromWindow() ?? { page: "dashboard" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, number>>({});

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = uid("T");
    setToasts((t) => [...t, { id, message, type }]);
    timers.current[id] = window.setTimeout(() => dismissToast(id), 3400);
  }, [dismissToast]);

  const syncUrl = useCallback((v: View, mode: "push" | "replace") => {
    if (typeof window === "undefined") return;
    const url = viewToSearch(v as AppView);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === url) return;
    if (mode === "replace") window.history.replaceState({ view: v }, "", url);
    else window.history.pushState({ view: v }, "", url);
  }, []);

  const setView = useCallback((v: View, opts?: { replace?: boolean; syncUrl?: boolean }) => {
    setViewState(v);
    if (opts?.syncUrl !== false) syncUrl(v, opts?.replace ? "replace" : "push");
  }, [syncUrl]);

  const navigate = useCallback((page: PageId, params?: Record<string, string>, opts?: { replace?: boolean }) => {
    const next: View = { page, params };
    setViewState(next);
    syncUrl(next, opts?.replace ? "replace" : "push");
    const el = document.getElementById("pl-scroll"); if (el) el.scrollTo({ top: 0 });
  }, [syncUrl]);

  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    // fallback: no-op if nowhere to go
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const next = readViewFromWindow();
      if (next) setViewState(next);
      else setViewState({ page: "dashboard" });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <UICtx.Provider value={{ view, navigate, goBack, toasts, toast, dismissToast, setView }}>
      {children}
    </UICtx.Provider>
  );
}

export function useUI(): UIContextValue {
  const v = useContext(UICtx);
  if (!v) throw new Error("useUI must be used within UIProvider");
  return v;
}
