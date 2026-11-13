"use client";

import {
  createContext, useCallback, useContext, useEffect, useState,
  type ReactNode,
} from "react";
import type { Role, Session } from "@/types";
import { can, type Permission } from "@/lib/auth";

interface AuthContextValue {
  session: Session | null;
  role: Role;
  hydrated: boolean;
  loginAdmin: (session: Session) => void;
  loginEmployee: (session: Session) => void;
  clearSession: () => void;
  logout: () => void;
  canPerm: (p: string) => boolean;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const role: Role = session?.role ?? "STAFF";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth", { credentials: "same-origin", cache: "no-store" })
      .then((response) => {
        if (response.status === 401) {
          if (!cancelled) setSession(null);
          return null;
        }
        return response.ok ? response.json() : Promise.reject(new Error("Unable to load session"));
      })
      .then((payload: { session?: Session | null } | null) => {
        if (cancelled) return;
        setSession(payload?.session ?? null);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
          setHydrated(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const clearSession = useCallback(() => {
    setSession(null);
  }, []);

  const loginAdmin = useCallback((session: Session) => {
    setSession(session);
  }, []);

  const loginEmployee = useCallback((session: Session) => {
    setSession(session);
  }, []);

  const logout = useCallback(() => {
    void fetch("/api/auth", {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
    }).finally(() => {
      setSession(null);
      // Use replace so Back does not return to an authenticated page after logout.
      window.location.replace("/login");
    });
  }, []);

  const canPerm = useCallback((p: string) => can(role, p as Permission), [role]);

  return (
    <AuthCtx.Provider value={{ session, role, hydrated, loginAdmin, loginEmployee, clearSession, logout, canPerm }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
