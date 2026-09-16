import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { Icon } from "../components/icons";
import { ThemeToggle } from "../components/ThemeToggle";
import { cn } from "../lib/utils";

export function PinLogin() {
  const { loginAdmin, loginEmployee } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (shake) { const t = setTimeout(() => setShake(false), 420); return () => clearTimeout(t); } }, [shake]);

  const submit = async () => {
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error("Unable to sign in. Please try again.");
      const payload = await response.json() as { session?: { role?: string; staffId?: string } };
      if (payload.session?.role === "ADMIN") loginAdmin();
      else if (payload.session?.staffId) loginEmployee(payload.session.staffId);
      else throw new Error("Unable to establish a valid session.");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in. Please try again.");
      setShake(true);
    } finally {
      setSubmitting(false);
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") void submit(); };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page p-4">
      {/* Ambient modern background — royal blue + dark mode tints */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary-soft/60 via-surface to-sky-100 dark:from-primary-deep/25 dark:via-transparent dark:to-primary-bright/15" />
      <div className="pointer-events-none absolute -left-40 top-0 h-112 w-md rounded-full bg-primary/25 blur-[100px] dark:bg-primary-deep/40" />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-112 w-md rounded-full bg-primary-bright/25 blur-[100px] dark:bg-primary-bright/35" />
      <ThemeToggle className="absolute right-4 top-4 z-20 bg-surface/70 backdrop-blur" />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-4xl bg-surface shadow-card-lg ring-1 ring-edge dark:ring-white/10 lg:grid-cols-2">
        {/* ===== LEFT — Brand panel ===== */}
        <aside className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex" style={{ background: "linear-gradient(160deg, #1e3a8a 0%, #2563eb 45%, #3b82f6 100%)" }}>
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-primary-bright/30 blur-3xl" />

          {/* Brand text only — no logo */}
          <div className="relative flex flex-col items-start gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20"><Icon name="pill" size={26} className="text-white" /></span>
            <div>
              <p className="text-2xl font-extrabold tracking-tight">Khan Pharmacy</p>
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-blue-100/80">Trusted Care Since 1998</p>
            </div>
          </div>

          <div className="relative">
            <h2 className="text-[1.75rem] font-bold leading-tight tracking-tight">
              Care that never <br /> leaves our village.
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-blue-50/85">
              A pharmacy built on service and compassion — honouring the legacy of our late founder,
              Alhajj Kamal Ahmed.
            </p>
          </div>

          <p className="relative text-[11px] text-blue-100/60">Serving our community</p>
        </aside>

        {/* ===== RIGHT — Login ===== */}
        <section className="flex flex-col justify-center p-8 sm:p-12">
          {/* Mobile brand header — visible only on small screens (left panel is hidden) */}
          <div className="mb-7 flex flex-col items-center gap-2 text-center lg:hidden">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-primary/30" style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}><Icon name="pill" size={30} /></span>
            <p className="text-lg font-extrabold tracking-tight text-foreground">Khan Pharmacy</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">Trusted Care Since 1998</p>
          </div>
          {/* Desktop heading */}
          <div className="mb-7 hidden lg:block">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Login</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your staff account.</p>
          </div>

          <div className={cn("space-y-4", shake && "animate-[pl-shake_0.42s]")}>
            {/* Username */}
            <div className="group relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground transition group-focus-within:text-primary"><Icon name="idcard" size={18} /></span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={onKey}
                placeholder="Username"
                autoComplete="username"
                autoFocus
                className="h-12 w-full rounded-full border-0 bg-surface-muted pl-11 pr-3 text-sm font-medium text-foreground placeholder:text-faint-foreground transition focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>

            {/* Password */}
            <div className="group relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground transition group-focus-within:text-primary"><Icon name="lock" size={18} /></span>
              <input
                ref={passRef}
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onKey}
                placeholder="Password"
                autoComplete="current-password"
                className="h-12 w-full rounded-full border-0 bg-surface-muted pl-11 pr-12 text-sm font-medium text-foreground placeholder:text-faint-foreground transition focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
              <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-primary" aria-label="Toggle password">
                <Icon name={showPass ? "eyeOff" : "eye"} size={18} />
              </button>
            </div>

            {/* Error */}
            <div className="h-5 text-sm font-medium text-rose-600">{error}</div>
          </div>

          {/* Submit */}
          <button type="button" onClick={() => void submit()} disabled={submitting} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-primary-deep to-primary-bright text-[15px] font-bold text-white shadow-lg shadow-primary/30 transition hover:from-primary hover:to-primary-bright active:scale-[0.99] disabled:cursor-wait disabled:opacity-60">
            <Icon name="power" size={18} /> {submitting ? "Signing in..." : "Login"}
          </button>

          <p className="mt-6 text-center text-[11px] text-faint-foreground">
            Forgot your login? Contact your pharmacy administrator.
          </p>
        </section>
      </div>
    </div>
  );
}
