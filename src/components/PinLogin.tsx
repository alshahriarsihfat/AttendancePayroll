import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { Icon } from "../components/icons";
import { cn } from "../lib/utils";

export function PinLogin() {
  const { tryLogin, loginAdmin, loginEmployee } = useApp();
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
    const res = tryLogin(username, password);
    if (res.type === "invalid") { setError(res.reason); setShake(true); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error("Unable to sign in. Please try again.");
      if (res.type === "admin") loginAdmin();
      else loginEmployee(res.staffId);
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 p-4">
      {/* Ambient modern background */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-teal-50 via-white to-emerald-50" />
      <div className="pointer-events-none absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-emerald-300/30 blur-[100px]" />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[28rem] w-[28rem] rounded-full bg-teal-300/30 blur-[100px]" />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-emerald-900/10 ring-1 ring-black/5 lg:grid-cols-2">
        {/* ===== LEFT — Brand panel ===== */}
        <aside className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex" style={{ background: "linear-gradient(160deg, #0f766e 0%, #0d9488 45%, #047857 100%)" }}>
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl" />

          {/* Brand text only — no logo */}
          <div className="relative flex flex-col items-start gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20"><Icon name="pill" size={26} className="text-white" /></span>
            <div>
              <p className="text-2xl font-extrabold tracking-tight">Khan Pharmacy</p>
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-emerald-100/80">Trusted Care Since 1998</p>
            </div>
          </div>

          <div className="relative">
            <h2 className="text-[1.75rem] font-bold leading-tight tracking-tight">
              Care that never <br /> leaves our village.
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-emerald-50/80">
              A pharmacy built on service and compassion — honouring the legacy of our late founder,
              Alhajj Kamal Ahmed.
            </p>
          </div>

          <p className="relative text-[11px] text-emerald-100/50">Serving our community</p>
        </aside>

        {/* ===== RIGHT — Login ===== */}
        <section className="flex flex-col justify-center p-8 sm:p-12">
          {/* Mobile brand header — visible only on small screens (left panel is hidden) */}
          <div className="mb-7 flex flex-col items-center gap-2 text-center lg:hidden">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: "linear-gradient(135deg,#0d9488,#047857)" }}><Icon name="pill" size={30} /></span>
            <p className="text-lg font-extrabold tracking-tight text-slate-900">Khan Pharmacy</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-600">Trusted Care Since 1998</p>
          </div>
          {/* Desktop heading */}
          <div className="mb-7 hidden lg:block">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Login</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to your staff account.</p>
          </div>

          <div className={cn("space-y-4", shake && "animate-[pl-shake_0.42s]")}>
            {/* Username */}
            <div className="group relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition group-focus-within:text-teal-500"><Icon name="idcard" size={18} /></span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={onKey}
                placeholder="Username"
                autoComplete="username"
                autoFocus
                className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-teal-500/10"
              />
            </div>

            {/* Password */}
            <div className="group relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition group-focus-within:text-teal-500"><Icon name="lock" size={18} /></span>
              <input
                ref={passRef}
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onKey}
                placeholder="Password"
                autoComplete="current-password"
                className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-12 text-sm font-medium text-slate-900 placeholder:text-slate-400 transition focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-teal-500/10"
              />
              <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-teal-500" aria-label="Toggle password">
                <Icon name={showPass ? "eyeOff" : "eye"} size={18} />
              </button>
            </div>

            {/* Error */}
            <div className="h-5 text-sm font-medium text-rose-600">{error}</div>
          </div>

          {/* Submit */}
          <button type="button" onClick={() => void submit()} disabled={submitting} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-[15px] font-bold text-white shadow-lg shadow-teal-500/30 transition hover:from-teal-700 hover:to-emerald-700 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60">
            <Icon name="power" size={18} /> {submitting ? "Signing in..." : "Login"}
          </button>

          <p className="mt-6 text-center text-[11px] text-slate-400">
            Forgot your login? Contact your pharmacy administrator.
          </p>
        </section>
      </div>
    </div>
  );
}
