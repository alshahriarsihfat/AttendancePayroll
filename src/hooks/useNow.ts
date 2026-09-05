import { useEffect, useState } from "react";

/** A ticking "now" timestamp — drives live elapsed timers & countdowns.
 *  Scoped to the components that use it to avoid app-wide re-renders. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
