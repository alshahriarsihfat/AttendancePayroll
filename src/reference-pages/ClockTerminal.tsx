"use client";

import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Button, Field, Input, Textarea } from "../components/ui";
import { Modal } from "../components/Modal";
import { Icon } from "../components/icons";
import { ClockInModal, ClockOutConfirm } from "../components/QuoteModal";
import { StaffSelector } from "./StaffTime";
import { empShift, computeSession, scheduledBoundary, nextShiftAt, isWithinIndividualShiftWindow, dhakaTodayKey } from "../lib/timeclock";
import { formatCountdown, formatElapsed, formatTime12, formatDuration, formatLongDate, formatMinSec, formatLongDuration } from "../lib/dates";
import { cn } from "../lib/utils";
import { MOTIVATION_QUOTES, pickRandom, configValue } from "../lib/config";
import type { BreakType, LeaveRequest, LeaveType, TimeSession } from "../types";

export function ClockTerminal({ targetStaffId }: { targetStaffId?: string }) {
  const { session, data, staffById, todaySession, isOnLeaveToday, clockOut, startBreak, endBreak, toggleExtraTime, startGoOut, endGoOut, logout, navigate, submitLeave, refreshData, toast } = useApp();
  const now = useNow(1000);
  const [modal, setModal] = useState<{ open: boolean; kind: "quote" | "praise" | "late" | "early"; quote?: string; minutes?: number }>({ open: false, kind: "quote" });
  const [tab, setTab] = useState<"clock" | "stafftime" | "leave" | "history">("clock");
  const [outConfirm, setOutConfirm] = useState(false);
  const [goOutOpen, setGoOutOpen] = useState(false);
  const [clockActionBusy, setClockActionBusy] = useState(false);
  // Supervisor's selected staff member — when set, the Clock tab renders
  // the EXACT SAME clock terminal UI for that staff as they would see it.
  const [managedStaffId, setManagedStaffId] = useState<string | null>(targetStaffId ?? null);

  const activeStaffId = targetStaffId ?? managedStaffId ?? session?.staffId;
  const staff = activeStaffId ? staffById(activeStaffId) : undefined;
  const shift = staff ? empShift(staff) : null;
  const sess = staff ? todaySession(staff.employeeId) : undefined;
  const onLeave = staff ? isOnLeaveToday(staff.employeeId) : false;
  const calc = useMemo(() => (staff ? computeSession(sess, staff, data.config, now) : null), [staff, sess, data.config, now]);

  // NOTE: every hook must be called on every render, regardless of whether
  // `staff`/`shift`/`calc` resolve. `activeStaffId` changes whenever a
  // Supervisor switches the selected staff member, so `staff` can be
  // undefined for a render or two. Computing `flushedSess`/`flushedCalc`
  // unconditionally here (instead of after an early return) keeps the hook
  // count identical across renders and avoids
  // "Rendered fewer hooks than expected" crashes in Supervisor mode.
  const todayDhaka = dhakaTodayKey();
  const isDonePreFlush = calc?.clockStatus === "completed";
const shiftStartMs = shift ? scheduledBoundary(new Date().toISOString(), shift.startMin) : 0;
  const sessionCompletedBeforeShift = sess && isDonePreFlush && sess.timeOut
    ? new Date(sess.timeOut).getTime() < shiftStartMs
    : false;
  const sessionFromPreviousDate = sess && sess.date !== todayDhaka;
  const flushedSess = (sessionFromPreviousDate || sessionCompletedBeforeShift) ? undefined : sess;
  const flushedCalc = useMemo(() => (staff ? computeSession(flushedSess, staff, data.config, now) : null), [staff, flushedSess, data.config, now]);

  // Single combined early return — placed AFTER every hook above has run,
  // so hook order/count never varies between renders.
  if (!staff || !shift || !calc || !flushedCalc) {
    return <div className="flex min-h-screen items-center justify-center"><button onClick={logout} className="text-slate-500">Back to login</button></div>;
  }

  const isOnBreak = calc.clockStatus === "on-meal" || calc.clockStatus === "on-rest" || calc.clockStatus === "on-unpaid" || calc.clockStatus === "on-goout";
  const isWorking = calc.clockStatus === "working";
  const isOff = calc.clockStatus === "off";
  const isDone = calc.clockStatus === "completed";
  const elapsedMs = sess ? now - new Date(sess.timeIn).getTime() : 0;
  const isSupervisor = session?.role === "SUPERVISOR";
  const isManaged = isSupervisor && (!!targetStaffId || !!managedStaffId);
  const isActive = isWorking || isOnBreak;
  const rawEarlyDeparture = sess && sess.date === todayDhaka
? Math.round((scheduledBoundary(sess.timeIn, shift.endMin) - new Date(sess.timeOut ?? now).getTime()) / 60000)    : 0;
  const shiftDurationMin = shift.endMin >= shift.startMin
    ? shift.endMin - shift.startMin
    : (24 * 60 - shift.startMin) + shift.endMin;
  const earlyDepartureMin = Math.max(0, Math.min(rawEarlyDeparture, shiftDurationMin));
  const nextShift = nextShiftAt(shift.startMin, now);
  const nextShiftDay = new Date(nextShift).toLocaleDateString("en-US", { weekday: "long" });
  const nextShiftTime = formatTime12(new Date(nextShift).toISOString());

  const withinShiftWindow = isWithinIndividualShiftWindow(new Date(now), shift, data.config);

  const isOffFlushed = flushedCalc.clockStatus === "off";
  const isDoneFlushed = flushedCalc.clockStatus === "completed";
  const dhakaMinutes = new Date(now).toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour12: false }).split(":").map(Number);
  const currentMinutes = dhakaMinutes[0] * 60 + dhakaMinutes[1];
  const shiftStarted = currentMinutes >= shift.startMin;
  const beforeShift = !flushedSess && !withinShiftWindow && !shiftStarted;
  const absent = !flushedSess && !withinShiftWindow && shiftStarted;
  const canClockIn = isOffFlushed && withinShiftWindow && !onLeave;

  const doClockIn = async () => {
  if (clockActionBusy) return;

  setClockActionBusy(true);
  try {
    await refreshData();
    // Re-check canClockIn with fresh data
    if (!staff || !shift || !canClockIn) {
      toast("Clock in is not available right now.", "error");
      return;
    }
    const response = await fetch("/api/clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: staff.employeeId,
        staffId: staff.employeeId,
        action: "in",
      }),
    });

    const data = await response.json();

    // ✅ সার্ভার এরর দিলে (যেমন: 409 Conflict বা 400 Bad Request)
    if (!response.ok) {
      toast(data.error || "Clock in failed.", "error");
      // ডাটাবেসের সঠিক স্টেট UI-তে আনেন
      await refreshData(); 
      return;
    }

    toast("Clocked in successfully!", "success");
    await refreshData();
  } catch (err) {
    console.error("Clock In Network Error:", err);
    toast("Network error. Please try again.", "error");
  } finally {
    setClockActionBusy(false);
  }
};

  const withRefresh = async (fn: () => void | Promise<void>) => {
    await fn();
    await refreshData();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div>
          <p className="text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">Khan Pharmacy</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-600">Trusted Care Since 1998</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-base font-bold tabular-nums leading-tight text-slate-900 sm:text-lg">{formatTime12(new Date(now).toISOString())}</p>
            <p className="text-[11px] leading-tight text-slate-400">{formatLongDate(now)}</p>
          </div>
          {isManaged && <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600 ring-1 ring-inset ring-indigo-200">Managed by {session?.name}</span>}
          {isManaged && <button onClick={() => { setManagedStaffId(null); setTab("clock"); }} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200"><Icon name="chevronLeft" size={15} /> My Clock</button>}
          {isSupervisor && !isManaged && <button onClick={() => navigate("monitor")} className="hidden items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 sm:inline-flex"><Icon name="store" size={15} /> Floor</button>}
          <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"><Icon name="logout" size={16} /> Exit</button>
        </div>
      </header>

      <div className="mx-auto max-w-md px-4 py-6">
        <div className="flex items-center gap-4">
          <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-slate-900">{staff.fullName}</h1>
            <p className="truncate text-sm text-slate-500">{staff.jobTitle}</p>
            <p className="text-xs text-slate-400">{staff.section}{staff.counter ? ` · Counter ${staff.counter}` : ""} · {staff.employeeId}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-col items-center gap-1.5">
          <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-slate-700">
            <Icon name="clock" size={15} className="text-slate-700" />
            Shift {shift.startTime} – {shift.endTime}
          </p>
          {/* "Managed by" badge intentionally shown only once, in the header above,
              to avoid redundant duplication of the same information. */}
        </div>

        {onLeave && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Icon name="calendar" size={22} className="text-amber-600" />
            <div><p className="font-semibold text-amber-800">You're on approved leave today</p><p className="text-sm text-amber-600">Enjoy your day off.</p></div>
          </div>
        )}

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

        {isSupervisor && tab === "stafftime" && (
          <div key="stafftime" className="tab-panel transform-gpu will-change-transform">
            <StaffSelector
              selectedId={managedStaffId}
              onSelect={(id) => {
                setManagedStaffId(id);
                setTab("clock");
              }}
            />
          </div>
        )}

        {!onLeave && tab === "clock" && (
          <div key="clock" className="tab-panel transform-gpu will-change-transform">
            <div className={cn("mt-5 overflow-hidden rounded-2xl shadow-lg", isDoneFlushed ? "bg-linear-to-br from-indigo-600 to-blue-700" : statusBg(flushedCalc.clockStatus))}>
              <div className="p-6 text-center text-white">
                {isOffFlushed ? (
                  beforeShift ? (
                    <>
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15"><Icon name="lock" size={28} className="text-white" /></div>
                      <p className="mt-3 text-2xl font-bold">Shift Not Started</p>
                      <p className="mt-2 text-sm opacity-80">Your shift begins at {shift.startTime}.</p>
                      <p className="mt-2 inline-block rounded-lg bg-white/15 px-3 py-1 text-xs">Clock-In opens {configValue(data.config, "EARLY_CHECKIN_MINUTES", "5")} min before shift start.</p>
                    </>
                  ) : absent ? (
                    <>
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15"><Icon name="alert" size={28} className="text-white" /></div>
                      <p className="mt-3 text-2xl font-bold">Absent / Not Clocked In</p>
                      <p className="mt-2 text-sm opacity-80">Shift started at {shift.startTime} — please clock in.</p>
                    </>
                  ) : (
                    <>
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15"><Icon name="power" size={28} className="text-white" /></div>
                      <p className="mt-3 text-2xl font-bold">Ready to Start</p>
                      <p className="mt-2 text-sm opacity-80">Tap Clock In below to begin your shift.</p>
                    </>
                  )
                ) : isDoneFlushed ? (
                  <>
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/15">{earlyDepartureMin >= 10 ? <Icon name="alert" size={30} className="text-amber-200" /> : <Icon name="check" size={30} className="text-white" />}</div>
                    <p className="mt-3 text-2xl font-bold">{earlyDepartureMin >= 10 ? "Early Departure" : "Shift Complete"}</p>
                    <p className="mt-2 text-sm opacity-90">
                      {earlyDepartureMin >= 10
                        ? `You left ${formatLongDuration(earlyDepartureMin)} before your scheduled shift end.`
                        : "Thank you for your dedicated service today!"}
                    </p>
                    <p className="mt-1 text-xs opacity-70">Clocked out · {formatTime12(flushedSess?.timeOut)}</p>
                    <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2">
                      <Icon name="calendar" size={16} className="opacity-80" />
                      <span className="text-sm font-semibold">Next shift: {nextShiftDay} · {nextShiftTime}</span>
                    </div>
                  </>
                ) : flushedCalc.clockStatus === "on-meal" || flushedCalc.clockStatus === "on-rest" || flushedCalc.clockStatus === "on-unpaid" || flushedCalc.clockStatus === "on-goout" ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
                      {flushedCalc.clockStatus === "on-goout" ? "On Paid Go-Out" : flushedCalc.clockStatus === "on-unpaid" ? "Unpaid Break" : flushedCalc.poolsExhausted ? "Meal & Break Complete" : statusLabel(flushedCalc.clockStatus)}
                    </p>
                    <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight">{formatCountdown(Math.abs(flushedCalc.activeElapsedSec))}</p>
                    <p className={cn("mt-2 text-sm font-medium", flushedCalc.breakRemainingSec < 0 ? "text-rose-200" : "opacity-80")}>
                      {flushedCalc.clockStatus === "on-goout"
                        ? flushedCalc.activeGoOutReason ?? "Field work — no deduction"
                        : flushedCalc.clockStatus === "on-unpaid"
                          ? "Unpaid — salary deducting"
                          : flushedCalc.poolsExhausted
                            ? "Paid break exhausted — deducting"
                            : `${formatMinSec(flushedCalc.mealRemaining)} meal · ${formatMinSec(flushedCalc.restRemaining)} rest left`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-widest opacity-80">On Duty</p>
                    <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight">{formatElapsed(flushedSess ? now - new Date(flushedSess.timeIn).getTime() : 0)}</p>
                    <p className="mt-2 text-sm opacity-80">Since {formatTime12(flushedSess?.timeIn)}</p>
                    {flushedCalc.extraTimeActive && <p className="mt-1 inline-block rounded-md bg-white/20 px-2 py-0.5 text-xs font-semibold">⚡ Extra Time ON</p>}
                  </>
                )}
                {flushedCalc.lateMin > 0 && !isOffFlushed && !isDoneFlushed && <p className="mt-2 inline-block rounded-md bg-white/15 px-2 py-0.5 text-xs">⏰ {formatDuration(flushedCalc.lateMin)} late</p>}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {isOffFlushed && !beforeShift && !absent && canClockIn && <button disabled={clockActionBusy}
                onClick={() => void doClockIn()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"><Icon name="power" size={22} /> {clockActionBusy ? "Starting..." : "Clock In"}</button>}
              {flushedCalc.clockStatus === "working" && (
                <>
                  <div className="grid grid-cols-3 gap-2.5">
                    <button onClick={() => void withRefresh(() => startBreak(staff.employeeId, "meal"))} className="flex flex-col items-center gap-1 rounded-xl bg-orange-500 py-3.5 font-bold text-white shadow-md shadow-orange-200 transition hover:bg-orange-600 active:scale-[0.99]"><Icon name="meal" size={20} /> Meal<span className="text-[10px] font-normal opacity-90">{flushedCalc.paidMealAllow}m paid</span></button>
                    <button onClick={() => void withRefresh(() => startBreak(staff.employeeId, "rest"))} className="flex flex-col items-center gap-1 rounded-xl bg-sky-500 py-3.5 font-bold text-white shadow-md shadow-sky-200 transition hover:bg-sky-600 active:scale-[0.99]"><Icon name="coffee" size={20} /> Rest<span className="text-[10px] font-normal opacity-90">{flushedCalc.paidRestAllow}m paid</span></button>
                    <button onClick={() => void withRefresh(() => startBreak(staff.employeeId, "unpaid"))} className="flex flex-col items-center gap-1 rounded-xl bg-rose-500 py-3.5 font-bold text-white shadow-md shadow-rose-200 transition hover:bg-rose-600 active:scale-[0.99]"><Icon name="pause" size={20} /> Unpaid<span className="text-[10px] font-normal opacity-90">deducted</span></button>
                  </div>
                  <button onClick={() => setGoOutOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 py-3 font-bold text-white shadow-md shadow-violet-200 transition hover:bg-violet-600 active:scale-[0.99]"><Icon name="arrowRight" size={18} /> Paid Go-Out<span className="text-[11px] font-normal opacity-90">field work · no deduction</span></button>
                  <button onClick={() => void withRefresh(() => toggleExtraTime(staff.employeeId))} className={cn("flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 font-bold transition active:scale-[0.99]", flushedCalc.extraTimeActive ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
                    <span className="flex items-center gap-2"><Icon name="trendUp" size={18} /> Extra Time</span>
                    <span className={cn("relative h-6 w-11 rounded-full transition", flushedCalc.extraTimeActive ? "bg-indigo-500" : "bg-slate-300")}>
                      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", flushedCalc.extraTimeActive ? "left-[22px]" : "left-0.5")} />
                    </span>
                  </button>
                </>
              )}
              {/* FIX: wrapped the OR-chain in parentheses so it evaluates as
                  (A || B || C || D) instead of A || B || C || (D && <button>) —
                  the original operator precedence bug made this block render
                  nothing at all whenever the staff was on meal/rest/unpaid break. */}
              {(flushedCalc.clockStatus === "on-meal" || flushedCalc.clockStatus === "on-rest" || flushedCalc.clockStatus === "on-unpaid" || flushedCalc.clockStatus === "on-goout") && (
                <button onClick={() => void withRefresh(() => flushedCalc.clockStatus === "on-goout" ? endGoOut(staff.employeeId) : endBreak(staff.employeeId))} className={cn("flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold text-white shadow-lg transition active:scale-[0.99]", flushedCalc.breakRemainingSec < 0 ? "bg-rose-600 hover:bg-rose-700 shadow-rose-200" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200")}>
                  <Icon name="check" size={22} /> {flushedCalc.clockStatus === "on-goout" ? "Back from Go-Out" : "Back to Work"}
                </button>
              )}
              {/* FIX: same operator-precedence bug — wrapped in parentheses.
                  Previously this evaluated to the boolean `true` (not JSX)
                  for "working" and every break status, so the Clock Out
                  button never rendered during an active shift. */}
              {(flushedCalc.clockStatus === "working" || flushedCalc.clockStatus === "on-meal" || flushedCalc.clockStatus === "on-rest" || flushedCalc.clockStatus === "on-unpaid" || flushedCalc.clockStatus === "on-goout") && (
                <button disabled={clockActionBusy} onClick={() => { setOutConfirm(true); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3.5 font-bold text-white transition hover:bg-slate-900 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"><Icon name="power" size={20} /> {clockActionBusy ? "Processing..." : "Clock Out"}</button>
              )}
            </div>

            {flushedSess && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Today's Summary</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Stat icon="clock" label="Worked" value={formatDuration(flushedCalc.grossMin)} />
                  <Stat icon="meal" label="Meal + Rest" value={formatDuration(flushedCalc.breakMin)} />
                  <Stat icon="alert" label="Over-break" value={formatDuration(flushedCalc.overBreakMin)} tone={flushedCalc.overBreakMin > 0 ? "rose" : "slate"} />
                  <Stat icon="trendUp" label="Overtime" value={flushedCalc.overtimeMin > 0 ? formatDuration(flushedCalc.overtimeMin) : "—"} tone={flushedCalc.overtimeMin > 0 ? "emerald" : "slate"} />
                </div>
              </div>
            )}
          </div>
        )}

        {!onLeave && tab === "leave" && (
          <div key="leave" className="tab-panel transform-gpu will-change-transform"><InlineLeave staffId={staff.employeeId} submitLeave={submitLeave} /></div>
        )}

        {!onLeave && tab === "history" && (
          <div key="history" className="tab-panel transform-gpu will-change-transform"><CheckInHistory staffId={staff.employeeId} /></div>
        )}
      </div>

      <ClockInModal open={modal.open} onClose={() => setModal({ open: false, kind: "quote" })} kind={modal.kind} quote={modal.quote} minutes={modal.minutes} />
      <ClockOutConfirm
        open={outConfirm}
        earlyMin={earlyDepartureMin}
        onClose={() => setOutConfirm(false)}
        onConfirm={async () => {
          if (clockActionBusy) return;
          setClockActionBusy(true);
          setOutConfirm(false);
          const res = clockOut(staff.employeeId);
          if (res.ok) {
            if (res.earlyDepartureMin >= 10) setModal({ open: true, kind: "early", minutes: res.earlyDepartureMin });
            else setModal({ open: true, kind: "praise" });
          }
          await refreshData();
          setClockActionBusy(false);
        }}
      />
      {goOutOpen && <GoOutModal onClose={() => setGoOutOpen(false)} onSubmit={async (reason, min) => { setGoOutOpen(false); await withRefresh(() => startGoOut(staff.employeeId, reason, min)); }} />}
    </div>
  );
}

function GoOutModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string, min: number) => void }) {
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("15");
  return (
    <Modal open onClose={onClose} title="Paid Go-Out" subtitle="Field work / customer service — no deduction" icon="arrowRight" size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="arrowRight" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim(), Number(minutes) || 15)}>Start Go-Out</Button></>}>
      <div className="space-y-4">
        <Field label="Reason / Customer Name" required hint="Where are you going and why?">
          <Textarea rows={2} value={reason} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)} placeholder="e.g. Home delivery to customer at Mirpur" />
        </Field>
        <Field label="Estimated Time (minutes)">
          <Input type="number" value={minutes} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinutes(e.target.value)} placeholder="15" />
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
            {mine.map((r: LeaveRequest) => (
              <div key={r.recordId} className="rounded-lg border border-slate-100 p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">{r.leaveType} · {r.fromDate}</span>
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", r.status === "Approved" ? "bg-emerald-50 text-emerald-700" : r.status === "Rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700")}>{r.status}</span>
                </div>
                {r.comment && (
                  <div className="mt-2 rounded bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    <span className="font-semibold">Reviewer note:</span> {r.comment}
                  </div>
                )}
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
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-linear-to-r from-emerald-500 to-teal-500" style={{ width: `${punctuality}%` }} /></div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent Check-ins</p>
        {sessions.length === 0 ? <p className="text-sm text-slate-400">No history yet.</p> : (
          <div className="space-y-1.5">
            {sessions.slice(0, 8).map((s: TimeSession) => {
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
  if (s === "on-meal") return "bg-linear-to-br from-orange-500 to-orange-600";
  if (s === "on-rest") return "bg-linear-to-br from-sky-500 to-sky-600";
  if (s === "completed") return "bg-linear-to-br from-slate-600 to-slate-700";
  return "bg-linear-to-br from-emerald-500 to-teal-600";
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