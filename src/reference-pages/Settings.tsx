import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../context/AppContext";
import { Card, Input, Button } from "../components/ui";
import { ConfirmDialog } from "../components/Modal";
import { Icon, type IconName } from "../components/icons";
import { cn } from "../lib/utils";
import type { ConfigEntry } from "../types";

type SectionKey = "quick" | "payslip" | "access" | "rules" | "data" | "danger";
type Meta = { label: string; unit?: string; details?: string };

const SECTIONS: { key: SectionKey; label: string; icon: IconName }[] = [
  { key: "quick", label: "Time & Pay Rules", icon: "clock" },
  { key: "payslip", label: "Payslip Details", icon: "receipt" },
  { key: "access", label: "Login Access", icon: "lock" },
  { key: "rules", label: "All Configuration", icon: "settings" },
  { key: "data", label: "Data Backup", icon: "download" },
  { key: "danger", label: "Demo Reset", icon: "alert" },
];

const PAYSLIP_KEYS = ["ORG_NAME", "ORG_ADDRESS", "ORG_PHONE", "ORG_EMAIL", "ORG_LICENSE", "PAYSPLIT_FOOTER"];
const HIDDEN = new Set(["STAFF_PINS", "STAFF_PIN", "ADMIN_PIN", "SUPERVISOR_PIN", "PIN_HASH", "PIN_SALT", "API_SECRET", "SUPERVISOR_PASSWORD_HASH", "SUPERVISOR_PASSWORD_UPDATED_AT"]);

const META: Record<string, Meta> = {
  ORG_NAME: { label: "Pharmacy Name" },
  ORG_ADDRESS: { label: "Pharmacy Address" },
  ORG_PHONE: { label: "Phone Number" },
  ORG_EMAIL: { label: "Email Address" },
  ORG_LICENSE: { label: "Drug License Number" },
  PAYSPLIT_FOOTER: { label: "Payslip Footer Note" },
  CURRENCY_SYMBOL: { label: "Currency Symbol" },
  CURRENCY_DECIMAL_PLACES: { label: "Currency Decimal Places (rounding)", unit: "decimals", details: "Affects money display/rounding precision where applied." },
  FLOOR_OPEN_TIME: { label: "Live Floor Opening Time", unit: "time" },
  FLOOR_CLOSE_TIME: { label: "Live Floor Closing Time", unit: "time" },
  MEAL_BREAK_MINUTES: { label: "Paid Meal Break Allowance", unit: "minutes", details: "Paid allowance per shift; overage handled by break/deduction rules where implemented." },
  REST_BREAK_MINUTES: { label: "Paid Rest Break Allowance", unit: "minutes", details: "Paid allowance per shift; overage handled by break/deduction rules where implemented." },
  LATE_GRACE_MINUTES: { label: "Late Grace Period", unit: "minutes" },
  EARLY_CHECKIN_MINUTES: { label: "Early Clock-in Limit", unit: "minutes" },
  AUTO_CLOCKOUT_MINUTES: { label: "Auto Clock-out After Shift End", unit: "minutes", details: "Applied after the scheduled shift ends (policy-dependent)." },
  BREAK_REMINDER_MINUTES: { label: "Break Reminder", unit: "minutes", details: "Shown before the paid break allowance runs out." },
  CLOCKIN_WINDOW_MINUTES: { label: "Clock-in Availability Window", unit: "minutes", details: "How early the clock-in option becomes available before shift start." },
  OVERTIME_MULTIPLIER: { label: "Overtime Pay Multiplier", unit: "×", details: "Overtime rate factor used by overtime/pay logic where applicable." },
  ANNUAL_LEAVE_ENTITLEMENT: { label: "Annual Leave Entitlement", unit: "days/year" },
  SICK_LEAVE_ENTITLEMENT: { label: "Sick Leave Entitlement", unit: "days/year" },
  EARNED_LEAVE_PER_COMPLETED_MONTH: { label: "Earned Leave per Completed Month", unit: "days/month" },
  EARNED_LEAVE_MAX: { label: "Maximum Earned Leave", unit: "days/year", details: "Use 0 for no cap, if supported by existing rules." },
  CASUAL_LEAVE_ENTITLEMENT: { label: "Casual Leave Entitlement", unit: "days/year" },
  SHEETS_API_URL: { label: "Google Sheets Sync URL" },
  SHEETS_API_KEY: { label: "Google Sheets Sync Key" },
};

function metaFor(entry: ConfigEntry): Meta {
  if (META[entry.key]) return META[entry.key];
  const label = entry.key.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const unit = /_MINUTES$/i.test(entry.key) ? "minutes" : /_HOURS$/i.test(entry.key) ? "hours" : /_DAYS|_ENTITLEMENT|_MAX$/i.test(entry.key) ? "days" : /_MULTIPLIER$/i.test(entry.key) ? "×" : /_TIME$/i.test(entry.key) ? "time" : undefined;
  return { label, unit };
}

function matches(entry: ConfigEntry, q: string) {
  if (!q) return true;
  const m = metaFor(entry);
  const s = `${m.label} ${m.details ?? ""} ${entry.description} ${entry.category} ${entry.key}`.toLowerCase();
  return s.includes(q.toLowerCase());
}

export function Settings() {
  const { data, canPerm, updateConfig, resetData, exportData, importData } = useApp();
  const canEdit = canPerm("manage.config");
  const [section, setSection] = useState<SectionKey>("quick");
  const [q, setQ] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  const visible = useMemo(() => data.config.filter((c) => !HIDDEN.has(c.key)), [data.config]);
  const byCategory = useMemo(() => {
    const m = new Map<string, ConfigEntry[]>();
    visible.forEach((c) => { if (!matches(c, q)) return; m.set(c.category, [...(m.get(c.category) ?? []), c]); });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible, q]);
  const quickEntries = useMemo(() => visible.filter((c) => (c.category === "Attendance" || c.category === "Payroll" || c.key.includes("LATE") || c.key.includes("OVERTIME") || c.key.includes("GRACE") || c.key.includes("BREAK") || c.key.includes("DECIMAL")) && matches(c, q)), [visible, q]);
  const payslipEntries = useMemo(() => PAYSLIP_KEYS.map((k) => visible.find((c) => c.key === k)).filter((c): c is ConfigEntry => !!c && matches(c, q)), [visible, q]);
  const staffPayConfigIssues = useMemo(() => {
    return data.staff.filter((s) => s.isActive).flatMap((s) => {
      const issues: string[] = [];
      const dutyOk = typeof s.dailyDutyHours === "number" && s.dailyDutyHours > 0;
      const rateOk = Number(s.hourlyRate) > 0;
      if (!dutyOk) issues.push("Daily Duty Hours missing");
      if (!rateOk) issues.push("Hourly rate missing");
      return issues.length ? [{ id: s.employeeId, name: s.fullName, salaryType: s.salaryType, issues }] : [];
    });
  }, [data.staff]);

  const show = (key: SectionKey) => !q || key === "rules" || (key === "quick" && quickEntries.length > 0) || (key === "payslip" && payslipEntries.length > 0) || (key === "access" && ["access", "login", "permission", "pin", "role"].some((t) => q.toLowerCase().includes(t)));
  useEffect(() => { if (q && !show(section)) setSection(quickEntries.length ? "quick" : payslipEntries.length ? "payslip" : "rules"); }, [q]);

  return (
    <div className="space-y-5 animate-fade">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{canEdit ? "Changes save when you leave a field or press Enter." : "View only. Configuration changes require permission."}</p>
        </div>
        <div className="w-full sm:w-72">
          <label className="sr-only" htmlFor="settings-search">Search settings</label>
          <div className="relative">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground" />
            <Input id="settings-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by setting name…" className="h-10 pl-9" />
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="settings-section">Category</label>
        <select id="settings-section" value={section} onChange={(e) => setSection(e.target.value as SectionKey)} className="h-10 w-full rounded-xl border border-edge bg-surface px-3 text-sm text-foreground">
          {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Settings categories">
          <div className="rounded-xl border border-edge bg-surface p-1.5">
            {SECTIONS.map((s) => {
              const active = section === s.key;
              if (q && !show(s.key) && s.key !== "data" && s.key !== "danger") return null;
              return (
                <button key={s.key} type="button" onClick={() => setSection(s.key)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition", active ? "bg-primary-soft text-primary font-semibold" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground")}>
                  <Icon name={s.icon} size={16} className={active ? "text-primary" : "text-faint-foreground"} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          {section === "quick" && show("quick") && (
            <Panel title="Time & Pay Rules" desc="Attendance, breaks, overtime, rounding, and payroll-related settings. These values affect time/pay evaluation where the engine reads them. Active earning uses configured Hourly Rate × Approved Payable Hours with required Daily Duty Hours per staff (no guessed defaults/fallbacks).">
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  <p className="font-semibold">Approved salary policy (2C.6.2, staff-level)</p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                    <li><b>Earned Salary:</b> Approved Payable Hours × Configured Hourly Rate</li>
                    <li><b>Daily/Weekly/Monthly:</b> display/summary labels only (not separate earning/payment-cycle engines)</li>
                    <li><b>Required config:</b> Hourly Rate and Daily Duty Hours (no /30, /7, calendar-month, weekly-days, base/daily-rate derivation, or 8h/shift fallback)</li>
                  </ul>
                  <p className="mt-1.5">Missing required config must remain explicitly INCOMPLETE (never estimated). Payments may be made any day (full/partial) after payable hours accrue; advance is never auto-deducted by default.</p>
                </div>
                <div className={cn("rounded-xl border p-3 text-sm", staffPayConfigIssues.length ? "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10" : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10")}>
                  <p className={cn("font-semibold", staffPayConfigIssues.length ? "text-rose-800 dark:text-rose-200" : "text-emerald-800 dark:text-emerald-200")}>
                    Staff salary configuration check (active staff)
                  </p>
                  {staffPayConfigIssues.length === 0 ? (
                    <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">No missing required salary/duty configuration detected for active staff records currently loaded.</p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-xs text-rose-700 dark:text-rose-300">Incomplete configuration found. Payroll for affected staff/periods must remain incomplete/unavailable until corrected (no fabricated amounts).</p>
                      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-rose-800 dark:text-rose-200">
                        {staffPayConfigIssues.slice(0, 12).map((s) => (
                          <li key={s.id}><b>{s.name}</b> ({s.id}, {s.salaryType}): {s.issues.join("; ")}</li>
                        ))}
                        {staffPayConfigIssues.length > 12 && <li>…and {staffPayConfigIssues.length - 12} more</li>}
                      </ul>
                      <p className="text-[11px] text-rose-700/90 dark:text-rose-300/90">Fix in Staff Management → Edit staff. This is a source/UI check, not a DB write.</p>
                    </div>
                  )}
                </div>
                {quickEntries.length === 0 ? <Muted>No matching settings.</Muted> : (
                  <div className="space-y-4">
                    <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint-foreground">Attendance, breaks & overtime</p><Rows entries={quickEntries.filter((e) => /LATE|GRACE|EARLY|AUTO_CLOCKOUT|BREAK|CLOCKIN_WINDOW|FLOOR|OVERTIME/i.test(e.key))} editable={canEdit} onSave={updateConfig} /></div>
                    <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint-foreground">Payroll rounding & currency</p><Rows entries={quickEntries.filter((e) => /DECIMAL|CURRENCY|ROUND/i.test(e.key))} editable={canEdit} onSave={updateConfig} /></div>
                    {quickEntries.some((e) => !/LATE|GRACE|EARLY|AUTO_CLOCKOUT|BREAK|CLOCKIN_WINDOW|FLOOR|OVERTIME|DECIMAL|CURRENCY|ROUND/i.test(e.key)) && (
                      <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint-foreground">Other related rules</p><Rows entries={quickEntries.filter((e) => !/LATE|GRACE|EARLY|AUTO_CLOCKOUT|BREAK|CLOCKIN_WINDOW|FLOOR|OVERTIME|DECIMAL|CURRENCY|ROUND/i.test(e.key))} editable={canEdit} onSave={updateConfig} /></div>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          )}
          {section === "payslip" && show("payslip") && (
            <Panel title="Payslip Details" desc="Organization details shown on payslips.">
              {payslipEntries.length === 0 ? <Muted>No matching settings.</Muted> : <Rows entries={payslipEntries} editable={canEdit} onSave={updateConfig} />}
            </Panel>
          )}
          {section === "access" && show("access") && (
            <Panel title="Login Access" desc="Reference information. Authentication remains server-verified; sensitive values are not shown here.">
              <div className="space-y-3 text-sm text-muted-foreground">
                <p><span className="font-medium text-foreground">Roles:</span> Admin and Supervisor access is managed by server-verified authentication and permissions.</p>
                <p><span className="font-medium text-foreground">Permission:</span> {canEdit ? "This account can change visible configuration values." : "This account cannot change configuration values."}</p>
                <p><span className="font-medium text-foreground">Sensitive data:</span> Passwords, PINs, hashes, and secrets are hidden from this screen.</p>
              </div>
            </Panel>
          )}
          {section === "rules" && (
            <Panel title="All Configuration" desc={q ? `Results for “${q}”.` : "All visible settings grouped by category."}>
              {byCategory.length === 0 ? <Muted>No matching settings found.</Muted> : byCategory.map(([cat, entries]) => (
                <div key={cat} className="mb-5 last:mb-0">
                  <div className="mb-2 flex items-center justify-between gap-2 border-b border-edge pb-2">
                    <h3 className="text-sm font-semibold text-foreground">{cat}</h3>
                    <span className="text-xs text-faint-foreground">{entries.length}</span>
                  </div>
                  <Rows entries={entries} editable={canEdit} onSave={updateConfig} />
                </div>
              ))}
            </Panel>
          )}
          {section === "data" && (
            <Panel title="Data Backup" desc="Export or import a JSON backup. Import replaces the current dataset after confirmation.">
              <DataManager canEdit={canEdit} exportData={exportData} importData={importData} />
            </Panel>
          )}
          {section === "danger" && (
            <Panel title="Demo Reset" desc="Restores seeded demo data. This is destructive and intended for controlled test/demo use.">
              <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/50 dark:bg-rose-950/20">
                <p className="text-sm text-rose-800 dark:text-rose-200">Reset replaces current application data with seeded demo data. Export a backup first if the current test data matters.</p>
                <div className="mt-4">
                  <Button variant="danger" icon="refresh" onClick={() => setResetOpen(true)} disabled={!canEdit}>Reset demo data</Button>
                  {!canEdit && <p className="mt-2 text-xs text-faint-foreground">Reset requires configuration permission.</p>}
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={resetData}
        title="Reset all data?"
        message="This restores seeded demo data and replaces the current dataset. Export a backup first if needed."
        confirmLabel="Reset demo data"
        danger
        icon="refresh"
      />
    </div>
  );
}

function Panel({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-edge px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-faint-foreground">{children}</p>;
}

function Rows({ entries, editable, onSave }: { entries: ConfigEntry[]; editable: boolean; onSave: (k: string, v: string) => void }) {
  return <div className="space-y-3">{entries.map((e) => <Row key={e.key} entry={e} editable={editable} onSave={onSave} />)}</div>;
}

function Row({ entry, editable, onSave }: { entry: ConfigEntry; editable: boolean; onSave: (k: string, v: string) => void }) {
  const [v, setV] = useState(entry.value);
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const meta = metaFor(entry);

  useEffect(() => { setV(entry.value); setState("idle"); setError(null); }, [entry.value]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const numeric = /MINUTES|HOURS|DAYS|MAX|MULTIPLIER|DECIMAL_PLACES/i.test(entry.key);
  const validate = (value: string): string | null => {
    if (!numeric) return null;
    if (value.trim() === "") return "Value required.";
    const n = Number(value);
    if (!Number.isFinite(n)) return "Enter a valid number.";
    if (/MINUTES|HOURS|DAYS|MAX|DECIMAL_PLACES/i.test(entry.key) && n < 0) return "Cannot be negative.";
    if (entry.key.includes("MULTIPLIER") && n <= 0) return "Must be greater than zero.";
    return null;
  };

  const commit = () => {
    if (!editable) return;
    const err = validate(v);
    setError(err);
    if (err || v === entry.value) { setState(v === entry.value ? "idle" : "dirty"); return; }
    setState("saving");
    try {
      onSave(entry.key, v);
      setState("saved");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 1200);
    } catch {
      setState("dirty");
      setError("Save failed.");
    }
  };

  const status = !editable ? "Locked" : state === "saving" ? "Saving" : state === "saved" ? "Saved" : state === "dirty" || error ? "Unsaved" : "";
  const desc = meta.details || entry.description;
  return (
    <div className={cn("rounded-xl border bg-surface px-3 py-3 sm:px-4", error ? "border-rose-200 dark:border-rose-900/50" : "border-edge")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label htmlFor={`cfg-${entry.key}`} className="text-sm font-medium text-foreground">{meta.label}</label>
            {meta.unit && <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{meta.unit}</span>}
            <span className="text-[11px] text-faint-foreground">{entry.category}</span>
            {status && <span className={cn("text-[11px] font-medium", error ? "text-rose-600" : state === "saved" ? "text-emerald-600" : "text-muted-foreground")}>{status}</span>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
          <p className="mt-1 text-[11px] text-faint-foreground/80">Technical name: <code className="rounded bg-surface-muted px-1 py-px font-mono text-[10px]">{entry.key}</code></p>
        </div>
        <div className="w-full sm:w-56">
          <Input
            id={`cfg-${entry.key}`}
            value={v}
            disabled={!editable || state === "saving"}
            inputMode={numeric ? "decimal" : undefined}
            onChange={(e) => { setV(e.target.value); setError(validate(e.target.value)); setState("dirty"); }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            aria-label={meta.label}
            aria-invalid={!!error}
            className={cn("h-10", error && "ring-2 ring-rose-500/20")}
          />
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function DataManager({ canEdit, exportData, importData }: { canEdit: boolean; exportData: () => void; importData: (jsonText: string) => boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState("");
  const [fileName, setFileName] = useState("");
  const [msg, setMsg] = useState<{ tone: "info" | "ok" | "err"; text: string } | null>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setPending(String(reader.result)); setFileName(file.name); setMsg({ tone: "info", text: `Selected ${file.name}. Confirm before replacing data.` }); setConfirm(true); };
    reader.onerror = () => setMsg({ tone: "err", text: "Could not read the selected file." });
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="download" onClick={() => { try { exportData(); setMsg({ tone: "ok", text: "Export started." }); } catch { setMsg({ tone: "err", text: "Export failed." }); } }} disabled={!canEdit}>Export backup</Button>
        <Button variant="secondary" icon="plus" onClick={() => fileRef.current?.click()} disabled={!canEdit}>Import backup</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={onPick} className="hidden" aria-label="Choose JSON backup file" />
      </div>
      {msg && <p className={cn("text-sm", msg.tone === "err" ? "text-rose-600" : msg.tone === "ok" ? "text-emerald-600" : "text-muted-foreground")}>{msg.text}</p>}
      {!canEdit && <p className="text-xs text-faint-foreground">Export/import requires configuration permission.</p>}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => { try { const ok = importData(pending); setMsg(ok ? { tone: "ok", text: `Import completed from ${fileName || "file"}.` } : { tone: "err", text: "Import failed or was not permitted." }); } catch { setMsg({ tone: "err", text: "Import failed." }); } setConfirm(false); }}
        title="Replace all data with this file?"
        message={fileName ? `File: ${fileName}. This replaces the current dataset. Make sure the backup is valid and from this system.` : "This replaces the current dataset."}
        confirmLabel="Import & replace"
        icon="download"
      />
    </div>
  );
}
