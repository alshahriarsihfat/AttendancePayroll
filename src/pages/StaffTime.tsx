import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { Card, Button, Select, EmptyState } from "../components/ui";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon } from "../components/icons";
import { Modal } from "../components/Modal";
import { Field, Input, Textarea } from "../components/ui";
import { computeSession, empShift } from "../lib/timeclock";
import { formatCountdown, formatDuration, formatElapsed, formatMinSec, formatTime12 } from "../lib/dates";
import { cn } from "../lib/utils";
import type { Employee } from "../types";

// ============================================================================
// Staff Time Management — Supervisor tool.
// Visible to supervisors only AFTER they have clocked in themselves.
// Lets them run the full clock workflow (in / breaks / go-out / out) for any
// staff member. Every action is written to the audit log with `managed_by`.
// ============================================================================

/** Reusable staff-time manager — embedded in the supervisor's clock terminal. */
export function StaffTimeManager() {
  const {
    data, session, todaySession, isOnLeaveToday, clockIn, clockOut,
    startBreak, endBreak, startGoOut, endGoOut, staffById, toast, navigate,
    canPerm, role,
  } = useApp();
  const now = useNow(1000);

  // RBAC: only Admin or Supervisor may manage other staff's time.
  if (!canPerm("view.floor") || role === "STAFF") {
    return (
      <Card className="p-8">
        <EmptyState icon="shield" title="Access restricted" desc="Only supervisors and admins can manage staff time." />
      </Card>
    );
  }

  const active = data.staff.filter((s) => s.isActive);
  const [selected, setSelected] = useState<string>(active[0]?.employeeId ?? "");
  const [goOutOpen, setGoOutOpen] = useState(false);

  const staff: Employee | undefined = staffById(selected);
  const shift = staff ? empShift(staff) : null;
  const sess = staff ? todaySession(staff.employeeId) : undefined;
  const onLeave = staff ? isOnLeaveToday(staff.employeeId) : false;
  const calc = useMemo(
    () => (staff ? computeSession(sess, staff, data.config, now) : null),
    [staff, sess, data.config, now]
  );

  const supervisorName = session?.name ?? "Supervisor";

  if (!staff || !shift || !calc) {
    return <Card className="p-10"><EmptyState icon="users2" title="No staff available" /></Card>;
  }

  const isOnBreak = calc.clockStatus === "on-meal" || calc.clockStatus === "on-rest" || calc.clockStatus === "on-unpaid" || calc.clockStatus === "on-goout";
  const isWorking = calc.clockStatus === "working";
  const isOff = calc.clockStatus === "off";
  const isDone = calc.clockStatus === "completed";
  const isActiveState = isWorking || isOnBreak;
  const elapsedMs = sess ? now - new Date(sess.timeIn).getTime() : 0;

  // Wrapper that stamps the supervisor on every action (audit trail).
  const managed = (label: string, fn: () => void) => () => {
    fn();
    toast(`${label} — managed by ${supervisorName}`, "info");
  };

  return (
    <div className="space-y-5 animate-fade">
      {/* Staff selector */}
      <Card className="p-4">
        <label className="mb-1.5 block text-[13px] font-medium text-slate-700">Select Staff Member</label>
        <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {active.map((s) => (
            <option key={s.employeeId} value={s.employeeId}>
              {s.fullName} · {s.employeeId} · {s.department}
            </option>
          ))}
        </Select>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
          <Icon name="info" size={12} /> All actions are logged with "managed by {supervisorName}".
        </p>
      </Card>

      {/* Selected staff panel — mirrors the staff Clock terminal identity card */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 p-4">
          <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-slate-900">{staff.fullName}</h1>
            <p className="truncate text-sm text-slate-500">{staff.jobTitle}</p>
            <p className="text-xs text-slate-400">{staff.section}{staff.counter ? ` · Counter ${staff.counter}` : ""} · {staff.employeeId}</p>
          </div>
        </div>
        {/* Center-aligned shift schedule — identical to staff terminal */}
        <div className="flex justify-center border-b border-slate-100 pb-3">
          <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-slate-700">
            <Icon name="clock" size={15} className="text-slate-700" />
            Shift {shift.startTime} – {shift.endTime}
          </p>
        </div>

        {onLeave ? (
          <div className="p-6 text-center">
            <Icon name="calendar" size={32} className="mx-auto text-amber-500" />
            <p className="mt-2 font-semibold text-amber-700">On approved leave today</p>
          </div>
        ) : (
          <>
            {/* Live status card — identical styling to the staff Clock terminal */}
            <div className={cn("p-6 text-center text-white", statusBg(calc.clockStatus))}>
              {isOff ? (
                <>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15"><Icon name="power" size={28} className="text-white" /></div>
                  <p className="mt-3 text-2xl font-bold">Shift Not Started</p>
                  <p className="mt-2 text-sm opacity-80">Clock in below to begin tracking.</p>
                </>
              ) : isDone ? (
                <>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15"><Icon name="check" size={30} className="text-white" /></div>
                  <p className="mt-3 text-2xl font-bold">Shift Complete</p>
                  <p className="mt-1 text-xs opacity-70">Clocked out · {formatTime12(sess?.timeOut)}</p>
                </>
              ) : isOnBreak ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
                    {calc.clockStatus === "on-goout" ? "On Paid Go-Out" : calc.clockStatus === "on-unpaid" ? "Unpaid Break" : calc.poolsExhausted ? "Meal & Break Complete" : statusLabel(calc.clockStatus)}
                  </p>
                  <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight">{formatCountdown(Math.abs(calc.activeElapsedSec))}</p>
                  <p className={cn("mt-2 text-sm font-medium", calc.breakRemainingSec < 0 ? "text-rose-200" : "opacity-80")}>
                    {calc.clockStatus === "on-goout" ? (calc.activeGoOutReason ?? "Field work — no deduction")
                      : calc.clockStatus === "on-unpaid" ? "Unpaid — salary deducting"
                      : calc.poolsExhausted ? "Paid break exhausted — deducting"
                      : `${formatMinSec(calc.mealRemaining)} meal · ${formatMinSec(calc.restRemaining)} rest left`}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-widest opacity-80">On Duty</p>
                  <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight">{formatElapsed(elapsedMs)}</p>
                  <p className="mt-2 text-sm opacity-80">Since {formatTime12(sess?.timeIn)}</p>
                </>
              )}
              {calc.lateMin > 0 && !isOff && !isDone && (
                <p className="mt-2 inline-block rounded-md bg-white/15 px-2 py-0.5 text-xs">⏰ {formatDuration(calc.lateMin)} late</p>
              )}
            </div>

            {/* Controls — identical styling to the staff Clock terminal */}
            <div className="space-y-3 p-4">
              {isOff && (
                <button onClick={managed(`Clocked in ${staff.fullName}`, () => clockIn(staff.employeeId))}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 active:scale-[0.99]">
                  <Icon name="power" size={22} /> Clock In
                </button>
              )}

              {isWorking && (
                <>
                  <div className="grid grid-cols-3 gap-2.5">
                    <button onClick={managed(`Meal break for ${staff.fullName}`, () => startBreak(staff.employeeId, "meal"))}
                      className="flex flex-col items-center gap-1 rounded-xl bg-orange-500 py-3.5 font-bold text-white shadow-md shadow-orange-200 transition hover:bg-orange-600 active:scale-[0.99]">
                      <Icon name="meal" size={20} /> Meal<span className="text-[10px] font-normal opacity-90">{calc.paidMealAllow}m paid</span>
                    </button>
                    <button onClick={managed(`Rest break for ${staff.fullName}`, () => startBreak(staff.employeeId, "rest"))}
                      className="flex flex-col items-center gap-1 rounded-xl bg-sky-500 py-3.5 font-bold text-white shadow-md shadow-sky-200 transition hover:bg-sky-600 active:scale-[0.99]">
                      <Icon name="coffee" size={20} /> Rest<span className="text-[10px] font-normal opacity-90">{calc.paidRestAllow}m paid</span>
                    </button>
                    <button onClick={managed(`Unpaid break for ${staff.fullName}`, () => startBreak(staff.employeeId, "unpaid"))}
                      className="flex flex-col items-center gap-1 rounded-xl bg-rose-500 py-3.5 font-bold text-white shadow-md shadow-rose-200 transition hover:bg-rose-600 active:scale-[0.99]">
                      <Icon name="pause" size={20} /> Unpaid<span className="text-[10px] font-normal opacity-90">deducted</span>
                    </button>
                  </div>
                  {/* Paid Go-Out — field work, no deduction */}
                  <button onClick={() => setGoOutOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 py-3 font-bold text-white shadow-md shadow-violet-200 transition hover:bg-violet-600 active:scale-[0.99]">
                    <Icon name="arrowRight" size={18} /> Paid Go-Out<span className="text-[11px] font-normal opacity-90">field work · no deduction</span>
                  </button>
                </>
              )}

              {isOnBreak && (
                <button onClick={managed(`Ended break for ${staff.fullName}`, () => calc.clockStatus === "on-goout" ? endGoOut(staff.employeeId) : endBreak(staff.employeeId))}
                  className={cn("flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold text-white shadow-lg transition active:scale-[0.99]", calc.breakRemainingSec < 0 ? "bg-rose-600 hover:bg-rose-700 shadow-rose-200" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200")}>
                  <Icon name="check" size={22} /> {calc.clockStatus === "on-goout" ? "Back from Go-Out" : "Back to Work"}
                </button>
              )}

              {isActiveState && (
                <button onClick={managed(`Clocked out ${staff.fullName}`, () => clockOut(staff.employeeId))}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3.5 font-bold text-white transition hover:bg-slate-900 active:scale-[0.99]">
                  <Icon name="power" size={20} /> Clock Out
                </button>
              )}

              {isDone && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                  <p className="text-sm font-semibold text-slate-700">Worked {formatDuration(calc.grossMin)}</p>
                  <p className="text-xs text-slate-400">Process payment from the Live Floor or Payments page.</p>
                  <Button size="sm" variant="ghost" icon="store" className="mt-2" onClick={() => navigate("monitor")}>Go to Live Floor</Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      {/* Audit trail note */}
      <Card className="p-4">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
          <Icon name="shield" size={14} className="mt-0.5 shrink-0 text-slate-400" />
          Every action you perform here is recorded in the audit log with your name as the manager, so there is a full
          trace of who changed which staff member's time records.
        </p>
      </Card>

      {goOutOpen && (
        <GoOutModal
          onClose={() => setGoOutOpen(false)}
          onSubmit={(reason, min) => {
            setGoOutOpen(false);
            startGoOut(staff.employeeId, reason, min);
            toast(`Go-Out for ${staff.fullName} — managed by ${supervisorName}`, "info");
          }}
        />
      )}
    </div>
  );
}

function GoOutModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string, min: number) => void }) {
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("15");
  return (
    <Modal open onClose={onClose} title="Paid Go-Out" subtitle="Field work — no deduction" icon="arrowRight" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button icon="arrowRight" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim(), Number(minutes) || 15)}>Start Go-Out</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Reason / Customer Name" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Home delivery to customer at Mirpur" />
        </Field>
        <Field label="Estimated Time (minutes)">
          <Input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function statusBg(s: string) {
  if (s === "on-meal") return "bg-gradient-to-br from-orange-500 to-orange-600";
  if (s === "on-rest") return "bg-gradient-to-br from-sky-500 to-sky-600";
  if (s === "on-unpaid") return "bg-gradient-to-br from-rose-500 to-rose-600";
  if (s === "on-goout") return "bg-gradient-to-br from-violet-500 to-violet-600";
  if (s === "completed") return "bg-gradient-to-br from-slate-600 to-slate-700";
  return "bg-gradient-to-br from-emerald-500 to-teal-600";
}
function statusLabel(s: string) {
  if (s === "on-meal") return "On Meal Break";
  if (s === "on-rest") return "On Rest Break";
  if (s === "working") return "On Duty";
  return "Clocked Out";
}

/** Standalone page wrapper (kept for the router). */
export function StaffTime() {
  return <StaffTimeManager />;
}
