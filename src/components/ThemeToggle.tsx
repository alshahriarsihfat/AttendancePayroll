"use client";

import { useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { Icon } from "./icons";

export const THEME_STORAGE_KEY = "kpsms-theme";

/** Applies the light/dark class to <html> for the CSS `dark:` variant. */
export function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * Top-level sun/moon toggle. Persists the choice to localStorage and falls
 * back to the OS preference on first load only (the boot script in the root
 * layout applies the same rule before first paint to avoid a flash).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState<boolean>(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      const isDark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      setDark(isDark);
      applyTheme(isDark ? "dark" : "light");
    } catch {
      setDark(false);
    }
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next ? "dark" : "light");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className
      )}
    >
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}