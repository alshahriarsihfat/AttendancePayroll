import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { Card, SectionHeader, Input, Button } from "../components/ui";
import { ConfirmDialog } from "../components/Modal";
import { Icon } from "../components/icons";
import { ADMIN } from "../lib/config";
import type { ConfigEntry } from "../types";

export function Settings() {
  const { data, canPerm, updateConfig, resetData } = useApp();
  const canEdit = canPerm("manage.config");
  const [reset, setReset] = useState(false);

  // Integration keys are managed in the Cloud Sync card — hide from the generic grid.
  const HIDDEN = new Set(["SHEETS_API_URL", "SHEETS_API_KEY"]);
  const grouped = useMemo(() => {
    const m = new Map<string, ConfigEntry[]>();
    data.config.filter((c) => !HIDDEN.has(c.key)).forEach((c) => {
      if (!m.has(c.category)) m.set(c.category, []);
      m.get(c.category)!.push(c);
    });
    return Array.from(m.entries()).filter(([, e]) => e.length > 0);
  }, [data.config]);

  return (
    <div className="space-y-6 animate-fade">
      <Card className="overflow-hidden border-emerald-200">
        <div className="flex items-center gap-2.5 border-b border-emerald-100 bg-emerald-50 px-5 py-3.5">
          <Icon name="store" size={18} className="text-emerald-600" />
          <div><p className="text-sm font-semibold text-emerald-800">Khan Pharmacy — Time & Pay Rules</p><p className="text-xs text-emerald-600/80">Break allowances, login PINs & leave entitlements.</p></div>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.config.filter((c) => ["MEAL_BREAK_MINUTES", "REST_BREAK_MINUTES", "LATE_GRACE_MINUTES"].includes(c.key)).map((c) => <ConfigRow key={c.key} entry={c} editable={canEdit} unit="min" onSave={updateConfig} />)}
          </div>
        </div>
      </Card>

      {/* Payslip letterhead details (admin editable) */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-3.5">
          <Icon name="receipt" size={18} className="text-emerald-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">Payslip Details</p>
            <p className="text-xs text-slate-500">Pharmacy information printed on every pay slip.</p>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {["ORG_NAME", "ORG_ADDRESS", "ORG_PHONE", "ORG_EMAIL", "ORG_LICENSE", "PAYSPLIT_FOOTER"].map((k) => {
              const entry = data.config.find((c) => c.key === k);
              if (!entry) return null;
              return <ConfigRow key={k} entry={entry} editable={canEdit} onSave={updateConfig} />;
            })}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
            <Icon name="info" size={12} /> Changes here appear immediately on printed payslips.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeader title="Login Access" subtitle="How staff & supervisors sign in" icon="pin" />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PinCard label="Admin Login" value={`${ADMIN.USERNAME} / ${ADMIN.PASSWORD}`} tone="rose" />
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Staff &amp; Supervisor</p>
            <p className="mt-1 text-sm font-semibold text-emerald-800">Unique username + password</p>
            <p className="mt-1 text-xs text-emerald-600/80">Admin manually assigns a username and password to each staff member from the staff form.</p>
          </div>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><Icon name="info" size={12} /> Supervisors are created by setting a staff member's role to "Supervisor" — they sign in with their own ID and get a reduced dashboard.</p>
      </Card>

      <Card className="p-5">
        <SectionHeader title="All Configuration" subtitle="Every business rule" icon="settings" />
        <div className="mt-5 space-y-6">
          {grouped.map(([cat, entries]) => (
            <div key={cat}>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{cat}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {entries.map((e) => <ConfigRow key={e.key} entry={e} editable={canEdit} onSave={updateConfig} />)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <DataManager />

      <Card className="border-rose-200 p-5">
        <SectionHeader title="Demo Data" subtitle="Reset the synthetic dataset" icon="refresh" />
        <p className="mt-2 text-sm text-slate-500">Restores all staff, sessions, leave & payments to the original seed state.</p>
        <Button variant="danger" icon="refresh" className="mt-4" onClick={() => setReset(true)}>Reset to Seed Data</Button>
      </Card>

      <ConfirmDialog open={reset} onClose={() => setReset(false)} onConfirm={resetData} title="Reset all data?" message="This restores the original demo dataset and cannot be undone." confirmLabel="Reset" danger icon="refresh" />
    </div>
  );
}

function PinCard({ label, value, tone }: { label: string; value: string; tone: "rose" | "indigo" | "emerald" }) {
  const c = { rose: "border-rose-200 bg-rose-50 text-rose-700", indigo: "border-indigo-200 bg-indigo-50 text-indigo-700", emerald: "border-emerald-200 bg-emerald-50 text-emerald-700" }[tone];
  return (
    <div className={`rounded-xl border p-4 ${c}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums tracking-widest">{value}</p>
    </div>
  );
}

function ConfigRow({ entry, editable, unit, onSave }: { entry: ConfigEntry; editable: boolean; unit?: string; onSave: (k: string, v: string) => void }) {
  const [v, setV] = useState(entry.value);
  useEffect(() => setV(entry.value), [entry.value]);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">{entry.key}</p>
        {!editable && <Icon name="lock" size={13} className="text-slate-300" />}
      </div>
      <p className="mb-2 text-xs text-slate-400">{entry.description}</p>
      <div className="relative">
        <Input value={v} disabled={!editable} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== entry.value) onSave(entry.key, v); }} />
        {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

/* ---------- Local backup manager (Google Sheets removed) ---------- */
function DataManager() {
  const { exportData, importData, canPerm } = useApp();
  const canEdit = canPerm("manage.config");
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [pendingFile, setPendingFile] = useState<string>("");

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setPendingFile(String(reader.result)); setConfirmImport(true); };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-5 py-3.5">
        <Icon name="fileText" size={18} className="text-indigo-600" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-900">Manual Data Editing</p>
          <p className="text-xs text-slate-500">Export everything to a file, edit freely, then import it back.</p>
        </div>
      </div>
      <div className="p-5">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="download" onClick={exportData} disabled={!canEdit}>Export Data (JSON)</Button>
          <Button variant="secondary" icon="plus" onClick={() => fileRef.current?.click()} disabled={!canEdit}>Import Data (JSON)</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onPick} className="hidden" />
        </div>
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><Icon name="info" size={12} /> How to manually edit anything</p>
          <ol className="ml-4 mt-1.5 list-decimal space-y-1 text-xs text-slate-500">
            <li>Click <b>Export Data</b> — a <code className="rounded bg-slate-200 px-1 text-[10px]">.json</code> file downloads.</li>
            <li>Open it in any text editor (Notepad / VS Code) or online JSON editor.</li>
            <li>Edit staff names, salaries, shifts, usernames, passwords, counters, leave, etc.</li>
            <li>Save the file, then click <b>Import Data</b> and choose it.</li>
          </ol>
          <p className="mt-2 text-[11px] text-slate-400">Tip: you can also edit directly in-app — Staff page (people), Settings (rules), or connect Google Sheets (above) for spreadsheet editing.</p>
        </div>
      </div>
      <ConfirmDialog
        open={confirmImport}
        onClose={() => setConfirmImport(false)}
        onConfirm={() => { importData(pendingFile); setConfirmImport(false); }}
        title="Replace all data with this file?"
        message="This overwrites every record on this device with the contents of the imported file. Make sure the file is a valid exported backup."
        confirmLabel="Import & Replace"
        icon="send"
      />
    </Card>
  );
}
