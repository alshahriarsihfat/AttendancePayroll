import { useApp } from "../context/AppContext";
import { Card, Button } from "../components/ui";
import { Icon, type IconName } from "../components/icons";
import { Callout } from "../components/CodeBlock";

// ============================================================================
// Setup & Data Guide — how to manage and edit everything in the app.
// (Google Sheets sync was removed; data lives locally + JSON backup/restore.)
// ============================================================================

export function Guide() {
  const { navigate } = useApp();

  return (
    <div className="space-y-5 animate-fade">
      {/* Hero */}
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-br from-emerald-700 via-teal-700 to-emerald-900 p-6 text-white">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <p className="text-xs font-medium uppercase tracking-wider text-emerald-200">Setup &amp; Data Guide</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Manage &amp; edit your data</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-emerald-100/80">
              Everything you need to edit records inside the app, back up your data, and keep it safe.
            </p>
          </div>
        </div>
      </Card>

      <AppDataGuide navigate={navigate} />
    </div>
  );
}

/* ============================ In-App Data ============================ */
function AppDataGuide({ navigate }: { navigate: (p: "staff" | "settings" | "attendance" | "payments") => void }) {
  const steps: { icon: IconName; title: string; body: React.ReactNode; action?: React.ReactNode }[] = [
    {
      icon: "users2",
      title: "Add or edit staff",
      body: (
        <>
          Open <b>Staff Management</b> and use <b>Add Staff</b>. To change someone's duty time, salary type
          (Daily / Hourly / Monthly), rates, shift, login username or password, click the <b>pencil</b> icon on
          their row. Admin only.
        </>
      ),
      action: <Button size="sm" variant="secondary" icon="users2" onClick={() => navigate("staff")}>Open Staff</Button>,
    },
    {
      icon: "image",
      title: "Add a staff photo",
      body: (
        <>
          In the staff form, paste an image or Google Drive share link into the <b>Photo</b> field. The app converts
          Drive links automatically and shows a coloured-initials fallback if the link is private or broken.
        </>
      ),
    },
    {
      icon: "receipt",
      title: "Edit payslip letterhead",
      body: (
        <>
          In <b>Settings → Payslip Details</b> you can edit the pharmacy name, address, phone, email, drug licence
          and footer note. These appear on every printed payslip immediately.
        </>
      ),
      action: <Button size="sm" variant="secondary" icon="settings" onClick={() => navigate("settings")}>Open Settings</Button>,
    },
    {
      icon: "settings",
      title: "Change business rules",
      body: (
        <>
          <b>Settings</b> controls paid meal (30m) and rest (15m) break pools, the clock-in window, late grace,
          auto clock-out timing, overtime multiplier and leave entitlements. Leave entitlement changes apply
          instantly to every active staff member's balance.
        </>
      ),
      action: <Button size="sm" variant="secondary" icon="settings" onClick={() => navigate("settings")}>Open Settings</Button>,
    },
    {
      icon: "clock",
      title: "Attendance analytics",
      body: (
        <>
          <b>Attendance</b> supports custom date ranges (Today / 7d / 30d / This month / Last month / Custom) with
          punctuality, over-break and overtime metrics, plus CSV export.
        </>
      ),
      action: <Button size="sm" variant="secondary" icon="clock" onClick={() => navigate("attendance")}>Open Attendance</Button>,
    },
    {
      icon: "download",
      title: "Back up & restore data",
      body: (
        <>
          In <b>Settings → Manual Data Editing</b>, click <b>Export Data (JSON)</b> to download a full backup.
          Open it in any text editor, change whatever you need, then <b>Import Data (JSON)</b> to load it back.
        </>
      ),
      action: <Button size="sm" variant="secondary" icon="download" onClick={() => navigate("settings")}>Open Settings</Button>,
    },
    {
      icon: "refresh",
      title: "Reset demo data",
      body: (
        <>
          <b>Settings → Demo Data → Reset to Seed Data</b> restores the original sample staff, sessions and
          payments. Use this to return to a clean state.
        </>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Callout tone="emerald" icon={<Icon name="info" size={16} />} title="Where is my data stored?">
        Data is stored locally in your browser, so it works fully offline. Use <b>Export Data (JSON)</b> in Settings
        to move it between devices or keep a safe backup.
      </Callout>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {steps.map((s, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Icon name={s.icon} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-bold text-emerald-600">STEP {i + 1}</span>
                <h3 className="mt-0.5 text-sm font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
                {s.action && <div className="mt-3">{s.action}</div>}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon name="list" size={16} className="text-slate-400" /> Data model</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {[
            ["Staff", "ID, name, dept, counter, shift, salary, login, arrears"],
            ["Sessions", "Clock in/out, meal & rest breaks, go-outs, extra time"],
            ["Payments", "Gross, deductions, overtime, net pay, payee"],
            ["Overtime", "Minutes past shift end, rate, amount"],
            ["Approvals", "Late / early-exit / break-overrun flags for managers"],
            ["Leave", "Requests, reviewer notes, balances per year"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 p-3">
              <p className="font-semibold text-slate-800">{k}</p>
              <p className="text-xs text-slate-500">{v}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
