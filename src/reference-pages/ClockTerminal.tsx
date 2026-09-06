import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Button, Field, Input, Textarea } from "../components/ui";
import { Modal } from "../components/Modal";
import { Icon } from "../components/icons";
import { ClockInModal, ClockOutConfirm } from "../components/QuoteModal";
import { StaffTimeManager } from "./StaffTime";
import { empShift, computeSession, scheduledBoundary, nextShiftAt, isWithinOperatingWindow } from "../lib/timeclock";
import { formatCountdown, formatElapsed, formatTime12, formatDuration, formatLongDate, formatMinSec, formatLongDuration } from "../lib/dates";
import { cn } from "../lib/utils";
import { MOTIVATION_QUOTES, pickRandom, configValue } from "../lib/config";
import type { LeaveType } from "../types";

export function ClockTerminal() {
  const { session, data, staffById, todaySession, isOnLeaveToday, clockIn, clockOut, startBreak, endBreak, toggleExtraTime, startGoOut, endGoOut, logout, navigate, submitLeave } = useApp();
  const now = useNow(1000);
  const [modal, setModal] = useState<{ open: boolean; kind: "quote" | "praise" | "late" | "early"; quote?: string; minutes?: number }>({ open: false, kind: "quote" });
  const [tab, setTab] = useState<"clock" | "stafftime" | "leave" | "history">("clock");
  const [outConfirm, setOutConfirm] = useState(false);
  const [goOutOpen, setGoOutOpen] = useState(false);
  const [clockActionBusy, setClockActionBusy] = useState(false);

  const staff = session?.staffId ? staffById(session.staffId) : undefined;
  const shift = staff ? empShift(staff) : null;
  const sess = staff ? todaySession(staff.employeeId) : undefined;
  const onLeave = staff ? isOnLeaveToday(staff.employeeId) : false;
  // Compute the session state even when there's no session yet today (→ "off").
  // This lets supervisors & staff who haven't clocked in still see the terminal.
  const calc = useMemo(() => (staff ? computeSession(sess, staff, data.config, now) : null), [staff, sess, data.config, now]);

  if (!staff || !shift || !calc) {
    return <div className="flex min-h-screen items-center justify-center"><button onClick={logout} className="text-slate-500">Back to login</button></div>;
  }

  // On-break covers meal, rest, unpaid AND go-out (all show Back-to-Work + a timer).
  const isOnBreak = calc.clockStatus === "on-meal" || calc.clockStatus === "on-rest" || calc.clockStatus === "on-unpaid" || calc.clockStatus === "on-goout";
  const isWorking = calc.clockStatus === "working";
  const isOff = calc.clockStatus === "off";
  const isDone = calc.clockStatus === "completed";
  const elapsedMs = sess ? now - new Date(sess.timeIn).getTime() : 0;
  const isSupervisor = session?.role === "SUPERVISOR";
  // Active shift = working or on-break (clock-out is allowed in both).
  const isActive = isWorking || isOnBreak;
  // Early-departure minutes — uses actual clock-out time once done, else live now.
  const earlyDepartureMin = sess
    ? Math.max(0, Math.round((scheduledBoundary(sess.timeIn, shift.endMin) - new Date(sess.timeOut ?? now).getTime()) / 60000))
    : 0;
  // Clock actions are available throughout the broad 09:00 AM-11:00 PM floor window.
  const beforeWindow = !sess && !isWithinOperatingWindow(new Date(now));
  // Next scheduled shift (shown after clock-out).
  const nextShift = nextShiftAt(shift.startMin, now);
  const nextShiftDay = new Date(nextShift).toLocaleDateString("en-US", { weekday: "long" });
  const nextShiftTime = formatTime12(new Date(nextShift).toISOString());

  const doClockIn = () => {
    if (clockActionBusy) return;
    setClockActionBusy(true);
    const res = clockIn(staff.employeeId);
    if (res.ok) {
      // Late → calculated variance warning. Timely → randomized Bangla care quote.
      if (res.isLate) setModal({ open: true, kind: "late", minutes: res.lateMin });
      else setModal({ open: true, kind: "quote", quote: pickRandom(MOTIVATION_QUOTES).text });
    }
    setClockActionBusy(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header — text brand on the left, live time + date stacked on the right */}
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        {/* Left: text brand only (no logo) */}
        <div>
          <p className="text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">Khan Pharmacy</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-600">Trusted Care Since 1998</p>
        </div>
        {/* Right: live time module with the system date stacked directly beneath it */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-base font-bold tabular-nums leading-tight text-slate-900 sm:text-lg">{formatTime12(new Date(now).toISOString())}</p>
            <p className="text-[11px] leading-tight text-slate-400">{formatLongDate(now)}</p>
          </div>
          {isSupervisor && <button onClick={() => navigate("monitor")} className="hidden items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 sm:inline-flex"><Icon name="store" size={15} /> Floor</button>}
          <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"><Icon name="logout" size={16} /> Exit</button>
        </div>
      </header>

      <div className="mx-auto max-w-md px-4 py-6">
        {/* Identity */}
        <div className="flex items-center gap-4">
          <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-slate-900">{staff.fullName}</h1>
            <p className="truncate text-sm text-slate-500">{staff.jobTitle}</p>
            <p className="text-xs text-slate-400">{staff.section}{staff.counter ? ` · Counter ${staff.counter}` : ""} · {staff.employeeId}</p>
          </div>
        </div>

        {/* Shift schedule — CENTER-ALIGNED across the full card width, high contrast */}
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-slate-700">
            <Icon name="clock" size={15} className="text-slate-700" />
            Shift {shift.startTime} – {shift.endTime}
          </p>
          {isSupervisor && <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600 ring-1 ring-inset ring-indigo-200">Supervisor</span>}
        </div>

        {onLeave && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Icon name="calendar" size={22} className="text-amber-600" />
            <div><p className="font-semibold text-amber-800">You're on approved leave today</p><p className="text-sm text-amber-600">Enjoy your day off.</p></div>
          </div>
        )}

        {/* Tabs — supervisors get an extra "Staff Time" tab */}
        {!onLeave && (
          <div className={cn("mt-5 grid gap-1 rounded-xl bg-slate-100 p-1", isSupervisor ? "grid-cols-4" : "grid-cols-3")}>
            {(isSupervisor
              ? ([["clock", "Clock"], ["stafftime", "Staff"], ["leave", "Leave"], ["history", "History"]] as const)
              : ([["clock", "Clock"], ["leave", "Leave"], ["history", "History"]] as const)
            ).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("rounded-lg py-2 text-sm font-semibold transition", tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{l}</button>
            ))}
          </div>
        )}

        {/* ===== STAFF TIME TAB (supervisor only) ===== */}
        {isSupervisor && tab === "stafftime" && (
          <div key="stafftime" className="tab-panel"><StaffTimeManager /></div>
        )}

        {/* ===== CLOCK TAB ===== */}
        {!onLeave && tab === "clock" && (
          <div key="clock" className="tab-panel">
            {/* Active tracking / countdown card */}
            <div className={cn("mt-5 overflow-hidden rounded-2xl shadow-lg", isDone ? "bg-gradient-to-br from-indigo-600 to-blue-700" : statusBg(calc.clockStatus))}>
              <div className="p-6 text-center text-white">
                {isOff ? (
                  beforeWindow ? (
                    // Too early — outside the clock-in window
                    <>
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15"><Icon name="clock" size={28} className="text-white" /></div>
                      <p className="mt-3 text-2xl font-bold">Shift Complete</p>
                      <p className="mt-2 text-sm opacity-80">Thank you for your dedicated service today!</p>
                      <p className="mt-2 inline-block rounded-lg bg-white/15 px-3 py-1 text-xs">Clock-In is available from 09:00 AM to 11:00 PM</p>
                    </>
                  ) : (
                    // Within window — ready to clock in
                    <>
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15"><Icon name="power" size={28} className="text-white" /></div>
                      <p className="mt-3 text-2xl font-bold">Ready to Start</p>
                      <p className="mt-2 text-sm opacity-80">Tap Clock In below to begin your shift.</p>
                    </>
                  )
                ) : isDone ? (
                  // Clock-out complete — thank-you + next scheduled shift
                  <>
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15">{earlyDepartureMin >= 10 ? <Icon name="alert" size={30} className="text-amber-200" /> : <Icon name="check" size={30} className="text-white" />}</div>
                    <p className="mt-3 text-2xl font-bold">{earlyDepartureMin >= 10 ? "Early Departure" : "Shift Complete"}</p>
                    <p className="mt-2 text-sm opacity-90">
                      {earlyDepartureMin >= 10
                        ? `You left ${formatLongDuration(earlyDepartureMin)} before your scheduled shift end.`
                        : "Thank you for your dedicated service today!"}
                    </p>
                    <p className="mt-1 text-xs opacity-70">Clocked out · {formatTime12(sess?.timeOut)}</p>
                    <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2">
                      <Icon name="calendar" size={16} className="opacity-80" />
                      <span className="text-sm font-semibold">Next shift: {nextShiftDay} · {nextShiftTime}</span>
                    </div>
                  </>
                ) : isOnBreak ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
                      {calc.clockStatus === "on-goout" ? "On Paid Go-Out" : calc.clockStatus === "on-unpaid" ? "Unpaid Break" : calc.poolsExhausted ? "Meal & Break Complete" : statusLabel(calc.clockStatus)}
                    </p>
                    <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight">{formatCountdown(Math.abs(calc.activeElapsedSec))}</p>
                    <p className={cn("mt-2 text-sm font-medium", calc.breakRemainingSec < 0 ? "text-rose-200" : "opacity-80")}>
                      {calc.clockStatus === "on-goout"
                        ? calc.activeGoOutReason ?? "Field work — no deduction"
                        : calc.clockStatus === "on-unpaid"
                        ? "Unpaid — salary deducting"
                        : calc.poolsExhausted
                        ? "Paid break exhausted — deducting"
                        : `${formatMinSec(calc.mealRemaining)} meal · ${formatMinSec(calc.restRemaining)} rest left`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-widest opacity-80">On Duty</p>
                    <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight">{formatElapsed(elapsedMs)}</p>
                    <p className="mt-2 text-sm opacity-80">Since {formatTime12(sess?.timeIn)}</p>
                    {calc.extraTimeActive && <p className="mt-1 inline-block rounded-md bg-white/20 px-2 py-0.5 text-xs font-semibold">⚡ Extra Time ON</p>}
                  </>
                )}
                {calc.lateMin > 0 && !isOff && !isDone && <p className="mt-2 inline-block rounded-md bg-white/15 px-2 py-0.5 text-xs">⏰ {formatDuration(calc.lateMin)} late</p>}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 space-y-3">
              {isOff && !beforeWindow && <button disabled={clockActionBusy} onClick={doClockIn} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"><Icon name="power" size={22} /> {clockActionBusy ? "Starting..." : "Clock In"}</button>}
              {isWorking && (
                <>
                  <div className="grid grid-cols-3 gap-2.5">
                    <button onClick={() => startBreak(staff.employeeId, "meal")} className="flex flex-col items-center gap-1 rounded-xl bg-orange-500 py-3.5 font-bold text-white shadow-md shadow-orange-200 transition hover:bg-orange-600 active:scale-[0.99]"><Icon name="meal" size={20} /> Meal<span className="text-[10px] font-normal opacity-90">{calc.paidMealAllow}m paid</span></button>
                    <button onClick={() => startBreak(staff.employeeId, "rest")} className="flex flex-col items-center gap-1 rounded-xl bg-sky-500 py-3.5 font-bold text-white shadow-md shadow-sky-200 transition hover:bg-sky-600 active:scale-[0.99]"><Icon name="coffee" size={20} /> Rest<span className="text-[10px] font-normal opacity-90">{calc.paidRestAllow}m paid</span></button>
                    <button onClick={() => startBreak(staff.employeeId, "unpaid")} className="flex flex-col items-center gap-1 rounded-xl bg-rose-500 py-3.5 font-bold text-white shadow-md shadow-rose-200 transition hover:bg-rose-600 active:scale-[0.99]"><Icon name="pause" size={20} /> Unpaid<span className="text-[10px] font-normal opacity-90">deducted</span></button>
                  </div>
                  {/* Paid Go-Out — field work, no deduction */}
                  <button onClick={() => setGoOutOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 py-3 font-bold text-white shadow-md shadow-violet-200 transition hover:bg-violet-600 active:scale-[0.99]"><Icon name="arrowRight" size={18} /> Paid Go-Out<span className="text-[11px] font-normal opacity-90">field work · no deduction</span></button>
                  {/* Extra Time toggle */}
                  <button onClick={() => toggleExtraTime(staff.employeeId)} className={cn("flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 font-bold transition active:scale-[0.99]", calc.extraTimeActive ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
                    <span className="flex items-center gap-2"><Icon name="trendUp" size={18} /> Extra Time</span>
                    <span className={cn("relative h-6 w-11 rounded-full transition", calc.extraTimeActive ? "bg-indigo-500" : "bg-slate-300")}>
                      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", calc.extraTimeActive ? "left-[22px]" : "left-0.5")} />
                    </span>
                  </button>
                </>
              )}
              {isOnBreak && (
                <button onClick={() => calc.clockStatus === "on-goout" ? endGoOut(staff.employeeId) : endBreak(staff.employeeId)} className={cn("flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold text-white shadow-lg transition active:scale-[0.99]", calc.breakRemainingSec < 0 ? "bg-rose-600 hover:bg-rose-700 shadow-rose-200" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200")}>
                  <Icon name="check" size={22} /> {calc.clockStatus === "on-goout" ? "Back from Go-Out" : "Back to Work"}
                </button>
              )}
              {/* Clock Out is available in every active state (working or on break). */}
              {isActive && (
                <button onClick={() => setOutConfirm(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3.5 font-bold text-white transition hover:bg-slate-900 active:scale-[0.99]"><Icon name="power" size={20} /> Clock Out</button>
              )}
            </div>

            {/* Summary */}
            {sess && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Today's Summary</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Stat icon="clock" label="Worked" value={formatDuration(calc.grossMin)} />
                  <Stat icon="meal" label="Meal + Rest" value={formatDuration(calc.breakMin)} />
                  <Stat icon="alert" label="Over-break" value={formatDuration(calc.overBreakMin)} tone={calc.overBreakMin > 0 ? "rose" : "slate"} />
                  <Stat icon="trendUp" label="Overtime" value={calc.overtimeMin > 0 ? formatDuration(calc.overtimeMin) : "—"} tone={calc.overtimeMin > 0 ? "emerald" : "slate"} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== LEAVE TAB (inline self-service) ===== */}
        {!onLeave && tab === "leave" && (
          <div key="leave" className="tab-panel"><InlineLeave staffId={staff.employeeId} submitLeave={submitLeave} /></div>
        )}

        {/* ===== HISTORY TAB (check-in analytics) ===== */}
        {!onLeave && tab === "history" && (
          <div key="history" className="tab-panel"><CheckInHistory staffId={staff.employeeId} /></div>
        )}
      </div>

      <ClockInModal open={modal.open} onClose={() => setModal({ open: false, kind: "quote" })} kind={modal.kind} quote={modal.quote} minutes={modal.minutes} />
      <ClockOutConfirm
        open={outConfirm}
        earlyMin={earlyDepartureMin}
        onClose={() => setOutConfirm(false)}
        onConfirm={() => {
          if (clockActionBusy) return;
          setClockActionBusy(true);
          setOutConfirm(false);
          const res = clockOut(staff.employeeId);
          if (res.ok) {
            // Timely → praise/quote popup; early → calculated variance warning.
            if (res.earlyDepartureMin >= 10) setModal({ open: true, kind: "early", minutes: res.earlyDepartureMin });
            else setModal({ open: true, kind: "praise" });
          }
          setClockActionBusy(false);
        }}
      />
      {goOutOpen && <GoOutModal onClose={() => setGoOutOpen(false)} onSubmit={(reason, min) => { setGoOutOpen(false); startGoOut(staff.employeeId, reason, min); }} />}
    </div>
  );
}

/** Paid Go-Out modal — requires reason + estimated time. */
function GoOutModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string, min: number) => void }) {
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("15");
  return (
    <Modal open onClose={onClose} title="Paid Go-Out" subtitle="Field work / customer service — no deduction" icon="arrowRight" size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="arrowRight" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim(), Number(minutes) || 15)}>Start Go-Out</Button></>}>
      <div className="space-y-4">
        <Field label="Reason / Customer Name" required hint="Where are you going and why?">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Home delivery to customer at Mirpur" />
        </Field>
        <Field label="Estimated Time (minutes)">
          <Input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="15" />
        </Field>
        <div className="rounded-lg bg-violet-50 p-3 text-xs text-violet-600">
          <Icon name="info" size={12} className="mr-1 inline" /> Time outside is tracked for records but not deducted from your pay.
        </div>
      </div>
    </Modal>
  );
}

function InlineLeave({ staffId, submitLeave }: { staffId: string; submitLeave: ReturnType<typeof useApp>["submitLeave"] }) {
  const { data } = useApp();
  const [type, setType] = useState<LeaveType>("Annual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);

  const mine = data.leaveRequests.filter((r) => r.staffId === staffId).slice(0, 5);

  const submit = () => {
    const res = submitLeave({ staffId, leaveType: type, fromDate: from, toDate: to, reason });
    if (res.ok) { setDone(true); setFrom(""); setTo(""); setReason(""); setTimeout(() => setDone(false), 2500); }
  };

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Leave Application</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <select value={type} onChange={(e) => setType(e.target.value as LeaveType)} className="h-10 rounded-lg border border-slate-300 px-2 text-sm focus:border-emerald-500 focus:outline-none">
              {["Annual", "Sick", "Casual", "Maternity", "Paternity", "Unpaid"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {type === "Sick" && <input placeholder="Reason required" value={reason} onChange={(e) => setReason(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-2 text-sm focus:border-emerald-500 focus:outline-none" />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-2 text-sm focus:border-emerald-500 focus:outline-none" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-2 text-sm focus:border-emerald-500 focus:outline-none" />
          </div>
          {type !== "Sick" && <textarea placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-emerald-500 focus:outline-none" />}
          <button onClick={submit} className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">{done ? "Submitted ✓" : "Submit Request"}</button>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">My Recent Requests</p>
        {mine.length === 0 ? <p className="text-sm text-slate-400">No requests yet.</p> : (
          <div className="space-y-1.5">
            {mine.map((r) => (
              <div key={r.recordId} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{r.leaveType} · {r.fromDate}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", r.status === "Approved" ? "bg-emerald-50 text-emerald-700" : r.status === "Rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700")}>{r.status}</span>
                {r.comment && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600"><b>Reviewer note:</b> {r.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CheckInHistory({ staffId }: { staffId: string }) {
  const { data } = useApp();
  const sessions = data.sessions.filter((s) => s.staffId === staffId).sort((a, b) => b.date.localeCompare(a.date));
  const onTime = sessions.filter((s) => { const c = computeSession(s, data.staff.find((e) => e.employeeId === staffId)!, data.config, s.timeOut ? new Date(s.timeOut).getTime() : Date.now()); return !c.isLate; }).length;
  const punctuality = sessions.length ? Math.round((onTime / sessions.length) * 100) : 0;

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Check-in Analytics</p>
        <div className="mt-3 flex items-end gap-4">
          <p className="text-4xl font-bold tabular-nums text-emerald-600">{punctuality}%</p>
          <p className="pb-1 text-sm text-slate-500">{onTime}/{sessions.length} on-time arrivals</p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${punctuality}%` }} /></div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent Check-ins</p>
        {sessions.length === 0 ? <p className="text-sm text-slate-400">No history yet.</p> : (
          <div className="space-y-1.5">
            {sessions.slice(0, 8).map((s) => {
              const c = computeSession(s, data.staff.find((e) => e.employeeId === staffId)!, data.config, s.timeOut ? new Date(s.timeOut).getTime() : Date.now());
              return (
                <div key={s.id} className="flex items-center justify-between text-sm border-b border-slate-50 py-1.5 last:border-0">
                  <span className="text-slate-600">{formatLongDate(s.date)}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-xs text-slate-400">{formatTime12(s.timeIn)}–{s.timeOut ? formatTime12(s.timeOut) : "…"}</span>
                    {c.isLate ? <span className="rounded bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-700">+{formatDuration(c.lateMin)} late</span> : <span className="rounded bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700">On time</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function statusBg(s: string) {
  if (s === "on-meal") return "bg-gradient-to-br from-orange-500 to-orange-600";
  if (s === "on-rest") return "bg-gradient-to-br from-sky-500 to-sky-600";
  if (s === "completed") return "bg-gradient-to-br from-slate-600 to-slate-700";
  return "bg-gradient-to-br from-emerald-500 to-teal-600";
}
function statusLabel(s: string) {
  if (s === "on-meal") return "On Meal Break";
  if (s === "on-rest") return "On Rest Break";
  if (s === "working") return "On Duty";
  return "Clocked Out";
}
function Stat({ icon, label, value, tone = "slate" }: { icon: "clock" | "meal" | "alert" | "trendUp"; label: string; value: string; tone?: "slate" | "rose" | "emerald" }) {
  const c = { slate: "bg-slate-100 text-slate-500", rose: "bg-rose-50 text-rose-500", emerald: "bg-emerald-50 text-emerald-600" }[tone];
  const tc = { slate: "text-slate-800", rose: "text-rose-600", emerald: "text-emerald-600" }[tone];
  return <div className="flex items-center gap-2"><span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", c)}><Icon name={icon} size={15} /></span><div><p className="text-[11px] text-slate-400">{label}</p><p className={cn("font-semibold tabular-nums", tc)}>{value}</p></div></div>;
}
