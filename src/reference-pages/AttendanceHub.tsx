// ============================================================================
// Unified Attendance Terminal Grid — Supervisor command center.
// Shows EVERY active staff member (including the supervisor) as a live status
// card. Clicking any card expands that person's shift controls INLINE — a
// smooth slide-down accordion right inside the grid, never a page switch or a
// view swap. Every clock action (Clock In / Clock Out / Break / Go-Out /
// Extra Time) runs in place and the grid updates live without ever leaving
// the Attendance tab.
// ============================================================================
"use client";

import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { Button, Card, EmptyState, Field, Input, Textarea } from "../components/ui";
import { Modal } from "../components/Modal";
import { PhotoAvatar } from "../components/PhotoAvatar";
import { Icon } from "../components/icons";
import { HeroBand } from "../components/HeroBand";
import { ClockInModal, ClockOutConfirm } from "../components/QuoteModal";
import {
  computeSession,
  empShift,
  isWithinIndividualShiftWindow,
  scheduledShiftBounds,
  dhakaTodayKey,
  nextShiftAt,
} from "../lib/timeclock";

import { formatCountdown, formatDuration, formatElapsed, formatLongDate, formatMinSec, formatTime12 } from "../lib/dates";
import { configValue } from "../lib/config";
import { cn } from "../lib/utils";
import type { ClockStatus, Employee } from "../types";

function overtimeRunningLabel(sess: any, nowMs: number): string | null {
  if (!sess?.overtimeActivatedAt || sess?.timeOut) return null;
  const t = Date.parse(String(sess.overtimeActivatedAt));
  if (!Number.isFinite(t)) return "OVERTIME RUNNING";
  return `OVERTIME RUNNING · ${formatDuration(Math.max(0, (nowMs - t) / 60000))}`;
}

type StatusFilter = ClockStatus | "all" | "break";

const BREAK_STATUSES: ClockStatus[] = ["on-meal", "on-rest", "on-unpaid", "on-goout"];

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "break", label: "On Break" },
  { key: "working", label: "On Duty" },
  { key: "on-leave", label: "On Leave" },
  { key: "off", label: "Not In" },
  { key: "completed", label: "Done" },
];

export function AttendanceHub() {
  const { data, session, todaySession, isOnLeaveToday, navigate, refreshData, toast } = useApp();
  const now = useNow(1000);

  const [query, setQuery] = useState("");
  const [otBusy, setOtBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clockingId, setClockingId] = useState<string | null>(null);

  // ---- live status for every active employee (including the supervisor) ----
  const rows = useMemo(() => {
    return data.staff
      .filter((s) => s.isActive)
      .map((s) => {
        const sess = todaySession(s.employeeId);
        const onLeave = isOnLeaveToday(s.employeeId);
        const calc = computeSession(sess, s, data.config, now);
        const status: ClockStatus = onLeave ? "on-leave" : sess ? calc.clockStatus : "off";
        // Clock-in eligibility on the card: not clocked in yet, not on leave, and
        // inside the individual shift window (with early check-in grace) — the same
        // rule the ClockTerminal's big Clock In button enforces.
        const canClockIn =
          status === "off" && !onLeave && isWithinIndividualShiftWindow(new Date(now), empShift(s), data.config);
        return { staff: s, sess, calc, status, canClockIn };
      })
      .sort((a, b) => order(a.status) - order(b.status) || a.staff.fullName.localeCompare(b.staff.fullName));
  }, [data.staff, data.config, todaySession, isOnLeaveToday, now]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { working: 0, "on-meal": 0, "on-rest": 0, "on-unpaid": 0, "on-goout": 0, "on-leave": 0, completed: 0, off: 0 };
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);

  const onBreak = BREAK_STATUSES.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
  const lateCount = rows.filter((r) => r.calc.isLate).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const okStatus =
        statusFilter === "all" || statusFilter === "break"
          ? statusFilter === "all" || BREAK_STATUSES.includes(r.status)
          : r.status === statusFilter;
      if (!okStatus) return false;
      if (!q) return true;
      return (
        r.staff.fullName.toLowerCase().includes(q) ||
        r.staff.employeeId.toLowerCase().includes(q) ||
        r.staff.department.toLowerCase().includes(q)
      );
    });
  }, [rows, statusFilter, query]);

  const toggleExpand = (id: string) => setExpandedId((cur) => (cur === id ? null : id));
// One-tap Clock In straight from the staff card or the inline panel — server-
  // first (no optimistic session), mirroring the ClockTerminal flow: fresh
  // refresh, re-validate the shift window, POST to /api/clock, then re-sync
  // live state. Never leaves the Attendance tab and never unmounts the grid.
  const handleClockIn = async (employeeId: string) => {
    if (clockingId) return;
    setClockingId(employeeId);
    try {
      await refreshData();
      const row = rows.find((r) => r.staff.employeeId === employeeId);
      if (!row || !row.canClockIn) {
        toast("Clock in is not available right now.", "error");
        return;
      }
      // Complete, explicit payload: target staff id + action type + client
      // timestamp. The server validates the id/action and keeps its own clock
      // as authoritative for the actual record time.
      const response = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          staffId: employeeId,
          action: "in",
          timestamp: new Date().toISOString(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
      if (!response.ok) {
        const message = payload.error || "Clock in failed — please try again.";
        // A 409 "Already clocked in today" is just a race with another session —
        // it is a success state, so reframe it as info rather than an error.
        if (response.status === 409 && /already clocked/i.test(message)) {
          toast("Already clocked in today. Refreshing…", "info");
        } else {
          // On the generic server failure, surface the underlying cause (when
          // present) so it never looks like a silent generic crash.
          const detail = message === "Unexpected server error." && payload.details
            ? ` — ${payload.details.slice(0, 180)}`
            : "";
          toast(`${message}${detail}`, "error");
        }
        await refreshData();
        return;
      }
      toast("Clocked in successfully!", "success");
      await refreshData();
    } catch (err) {
      console.error("Clock In error:", err);
      toast("Network error. Please try again.", "error");
    } finally {
      setClockingId(null);
    }
  };

  return (
    <div className="space-y-5 animate-fade">
      <Card className="overflow-hidden border-primary/15 bg-linear-to-r from-slate-900 via-slate-900 to-slate-800 text-white ring-1 ring-white/10">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-primary-bright">
                <Icon name="clock" size={13} /> Unified Attendance Terminal
              </p>
              <h2 className="mt-0.5 text-xl font-extrabold tracking-tight sm:text-2xl">Attendance</h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300 sm:text-sm">
                Live staff grid — select a card to manage Clock In/Out, breaks, go-out, and extra time in place.
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              <div className="text-left sm:text-right">
                <p className="text-xl font-bold tabular-nums sm:text-2xl">{formatTime12(new Date(now).toISOString())}</p>
                <p className="text-[11px] text-slate-400">{formatLongDate(now)}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => session?.staffId && toggleExpand(session.staffId)}
                className="inline-flex h-10 min-w-[7.5rem] items-center justify-center gap-2 rounded-xl bg-linear-to-r from-primary-deep to-primary-bright px-4 text-sm font-semibold text-white shadow-md shadow-primary/30 ring-1 ring-inset ring-white/10 transition hover:from-primary hover:to-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                <Icon name="timer" size={16} className="shrink-0" />
                <span className="leading-none">My Clock</span>
              </button>
              <button
                type="button"
                onClick={() => void refreshData()}
                title="Refresh attendance data from server"
                className="inline-flex h-10 min-w-[7.5rem] items-center justify-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <Icon name="refresh" size={16} className="shrink-0" />
                <span className="leading-none">Refresh</span>
              </button>
              <button
                type="button"
                onClick={() => navigate("monitor")}
                className="inline-flex h-10 min-w-[7.5rem] items-center justify-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <Icon name="store" size={16} className="shrink-0" />
                <span className="leading-none">Live Floor</span>
              </button>
              <button
                type="button"
                onClick={() => navigate("payments")}
                className="inline-flex h-10 min-w-[7.5rem] items-center justify-center gap-2 rounded-xl bg-emerald-500/20 px-4 text-sm font-semibold text-emerald-50 ring-1 ring-inset ring-emerald-300/30 transition hover:bg-emerald-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/50"
              >
                <Icon name="receipt" size={16} className="shrink-0" />
                <span className="leading-none">Payroll</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
              <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-semibold ring-1 ring-inset ring-white/15"><span className="text-slate-300">On Duty</span> <span className="tabular-nums text-white">{counts.working}</span></span>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-semibold ring-1 ring-inset ring-white/15"><span className="text-slate-300">On Break</span> <span className="tabular-nums text-white">{onBreak}</span></span>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-semibold ring-1 ring-inset ring-white/15"><span className="text-slate-300">On Leave</span> <span className="tabular-nums text-white">{counts["on-leave"]}</span></span>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-semibold ring-1 ring-inset ring-white/15"><span className="text-slate-300">Late</span> <span className="tabular-nums text-white">{lateCount}</span></span>
            </div>
          </div>
        </div>
      </Card>
      {(session?.role === "ADMIN" || session?.role === "SUPERVISOR") && (
        <div className="rounded-2xl border border-edge bg-surface p-4">
          <h3 className="mb-2 text-sm font-bold">Overtime (Supervisor-Authorized Extra Time)</h3>
          {data.sessions.filter((s) => !!s.overtimeActivatedAt && !s.timeOut).map((s) => (
            <div key={s.id} className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span>{s.staffId} · {s.date} · <span className="font-semibold text-emerald-700 dark:text-emerald-300">{overtimeRunningLabel(s, now) || "OVERTIME RUNNING"}</span></span>
              <span className="text-muted-foreground">Ends on manual clock-out</span>
            </div>
          ))}
          {data.sessions.filter((s) => !!s.overtimeActivatedAt && !s.timeOut).length === 0 && <p className="text-xs text-muted-foreground">No overtime running. Activate Extra Time after duty end to start supervisor-authorized overtime.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search staff, ID or department…"
            className="h-10 w-full rounded-xl border border-edge bg-surface pl-9 pr-3 text-sm shadow-card transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setStatusFilter(chip.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition",
                statusFilter === chip.key ? "bg-linear-to-r from-primary-deep to-primary-bright text-white ring-primary shadow-md shadow-primary/25" : "bg-surface text-muted-foreground ring-edge hover:bg-surface-muted"
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs font-medium text-faint-foreground">{filtered.length} of {rows.length} staff</span>
      </div>

      {/* ---- inline staff card grid — cards open their own accordion in place ---- */}
      {rows.length === 0 ? (
        <Card className="p-10"><EmptyState icon="users2" title="No active staff" desc="Add staff in Staff Management to see them here." /></Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10"><EmptyState icon="search" title="No matching staff" desc="Try adjusting your search or status filter." /></Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((r) => (
            <AttendanceCard
              key={r.staff.employeeId}
              staff={r.staff}
              sess={r.sess}
              calc={r.calc}
              status={r.status}
              now={now}
              expanded={r.staff.employeeId === expandedId}
              isSelf={r.staff.employeeId === session?.staffId}
              canClockIn={r.canClockIn}
              clocking={clockingId === r.staff.employeeId}
              onClockIn={() => void handleClockIn(r.staff.employeeId)}
              onToggle={() => toggleExpand(r.staff.employeeId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   AttendanceCard — single live status card for one employee. Clicking the
   card (or its toggle) slides an inline shift-control panel open IN PLACE.
   ============================================================================ */
type Session = ReturnType<typeof useApp>["data"]["sessions"][number] | undefined;

function AttendanceCard({ staff, sess, calc, status, now, expanded, isSelf, canClockIn, clocking, onClockIn, onToggle }: {
  staff: Employee;
  sess: Session;
  calc: ReturnType<typeof computeSession>;
  status: ClockStatus;
  now: number;
  expanded: boolean;
  isSelf: boolean;
  canClockIn: boolean;
  clocking: boolean;
  onClockIn: () => void;
  onToggle: () => void;
}) {
  const onBreak = BREAK_STATUSES.includes(status);
  const off = status === "off";
  const leave = status === "on-leave";
  const done = status === "completed";
  const elapsedMs = sess ? now - new Date(sess.timeIn).getTime() : 0;
  const late = calc.isLate && (status === "working" || status === "completed" || onBreak);
  const shift = empShift(staff);
  const panelId = `att-panel-${staff.employeeId}`;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-surface text-left shadow-card transition",
        expanded ? "border-primary/50 shadow-card-lg ring-2 ring-primary/40" : "border-edge hover:-translate-y-0.5 hover:shadow-card-lg",
        leave && "border-amber-200 bg-amber-50/40"
      )}
    >
<div className={cn("h-1.5 w-full", stripColor(status))} />

      {/* compact summary — click anywhere on it to expand/collapse */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer select-none flex-col gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {/* header: avatar + identity */}
        <div className="flex items-start gap-3">
          <div className="relative">
            <PhotoAvatar name={staff.fullName} photoUrl={staff.photoUrl} size={46} />
            <span className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-surface", dotColor(status))} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-bold text-foreground">{staff.fullName}</p>
              {isSelf && <span className="rounded bg-primary-soft px-1.5 py-px text-[10px] font-bold text-primary ring-1 ring-inset ring-primary/25">You</span>}
              {staff.counter && <span className="rounded-full bg-primary-soft px-1.5 py-px text-[10px] font-bold text-primary ring-1 ring-inset ring-primary/25">C{staff.counter}</span>}
            </div>
            <p className="truncate text-xs text-faint-foreground">{staff.jobTitle} · {staff.employeeId}</p>
          </div>
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition",
              expanded ? "rotate-180 bg-primary text-white ring-primary" : "bg-surface-muted text-muted-foreground ring-edge group-hover:text-primary"
            )}
            aria-hidden="true"
          >
            <Icon name="chevronDown" size={14} />
          </span>
        </div>

        {/* status pill + shift */}
        <div className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset", badgeCls(status))}>
            <span className={cn("h-1.5 w-1.5 rounded-full", dotColor(status))} />
            {badgeLabel(status)}
          </span>
          <span className="text-[11px] font-medium text-muted-foreground">{shift.startTime}–{shift.endTime}</span>
        </div>

        {/* live metrics panel */}
        <div className="mt-auto flex items-end justify-between gap-2 rounded-xl bg-surface-muted px-3 py-2.5 ring-1 ring-inset ring-edge">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-faint-foreground">
              {done ? "Worked" : onBreak ? "Break" : off || leave ? "Today" : "On duty"}
            </p>
            <p className={cn("truncate text-lg font-bold tabular-nums", onBreak && calc.breakRemainingSec < 0 ? "text-rose-600" : "text-foreground")}>
              {leave ? "Away" : off ? "Not in" : done ? formatDuration(calc.grossMin) : onBreak ? formatCountdown(Math.abs(calc.activeElapsedSec)) : formatElapsed(elapsedMs)}
            </p>
          </div>

        </div>

        {/* footer: in/out + late + CTA */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-faint-foreground">
          <span className="truncate">
            {off || leave ? (
              <span className={off ? "" : "text-amber-600"}>{leave ? "Approved leave today" : "Not clocked in yet"}</span>
            ) : (
              <>In {formatTime12(sess?.timeIn)}{done && ` · Out ${formatTime12(sess?.timeOut)}`}</>
            )}
          </span>
          {late && <span className="shrink-0 font-semibold text-amber-600">+{formatDuration(calc.lateMin)} late</span>}
        </div>
{/* CTA row: one-tap Clock In when eligible, plus the expand/collapse toggle */}
        <div className="mt-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {canClockIn && (
            <button
              type="button"
              onClick={onClockIn}
              disabled={clocking}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-bold transition",
                clocking
                  ? "cursor-wait bg-primary-soft text-primary"
                  : "bg-linear-to-r from-primary-deep to-primary-bright text-white shadow-md shadow-primary/25 hover:from-primary hover:to-primary-bright active:scale-[0.99]"
              )}
            >
              <Icon name="power" size={14} /> {clocking ? "Clocking In..." : "Clock In"}
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition",
              expanded ? "bg-primary text-white" : "bg-surface-muted text-muted-foreground hover:bg-surface-muted group-hover:text-primary"
            )}
          >
            <Icon name="chevronDown" size={14} className={cn("transition-transform", expanded && "rotate-180")} />
            {expanded ? "Collapse" : "Shift Actions"}
          </button>
        </div>
      </div>

      {/* ---- inline slide-down accordion: the staff's shift-control panel ---- */}
      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden" inert={!expanded} aria-hidden={!expanded}>
          <div className="border-t border-edge bg-surface-muted/60 px-3.5 py-3.5">
            <InlineShiftPanel
              staff={staff}
              sess={sess}
              calc={calc}
              status={status}
              now={now}
              canClockIn={canClockIn}
              clocking={clocking}
              onClockIn={onClockIn}
              onCollapse={onToggle}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
/* ============================================================================
   InlineShiftPanel — the compact, direct-action control panel revealed inside
   an expanded AttendanceCard. Uses the exact same context clock operations as
   the full ClockTerminal so every state change lands instantly in the grid.
   ============================================================================ */
function InlineShiftPanel({ staff, sess, calc, status, now, canClockIn, clocking, onClockIn, onCollapse }: {
  staff: Employee;
  sess: Session;
  calc: ReturnType<typeof computeSession>;
  status: ClockStatus;
  now: number;
  canClockIn: boolean;
  clocking: boolean;
  onClockIn: () => void;
  onCollapse: () => void;
}) {
  const { data, clockOut, startBreak, endBreak, toggleExtraTime, startGoOut, endGoOut, refreshData, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [outConfirm, setOutConfirm] = useState(false);
  const [goOutOpen, setGoOutOpen] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; kind: "praise" | "early"; minutes?: number }>({ open: false, kind: "praise" });

  const shift = empShift(staff);
  const isOnBreak = BREAK_STATUSES.includes(status);
  const onBreak = isOnBreak;

  // Early-departure estimate for the Clock Out confirmation — mirrors the
  // ClockTerminal's calculation so the inline flow reports the same warning.
  const todayDhaka = dhakaTodayKey();
  const rawEarlyDeparture = sess && sess.date === todayDhaka
    ? Math.round((scheduledShiftBounds(sess.timeIn, shift).end - new Date(sess.timeOut ?? now).getTime()) / 60000)
    : 0;
  const shiftDurationMin = shift.endMin >= shift.startMin
    ? shift.endMin - shift.startMin
    : (24 * 60 - shift.startMin) + shift.endMin;
  const earlyDepartureMin = Math.max(0, Math.min(rawEarlyDeparture, shiftDurationMin));

  const withRefresh = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refreshData();
    } catch (err) {
      console.error("Clock action error:", err);
      toast("Action failed. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const activateOvertime = async (staffId: string) => {
    if (busy) return;
    const session = data.sessions.find((s) => s.staffId === staffId && !s.timeOut);
    if (!session) { toast("No active session.", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/overtime/activate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!res.ok) {
        let msg = "Overtime activation failed.";
        try { const p = await res.json(); if (p?.error) msg = p.error; } catch { /* ignore */ }
        toast(msg, "error");
        return;
      }
      await refreshData();
      toast("Overtime activated.", "success");
    } finally {
      setBusy(false);
    }
  };

  const doClockOut = async () => {
    if (busy) return;
    setBusy(true);
    setOutConfirm(false);
    const res = clockOut(staff.employeeId);
    if (res.ok) {
      if (res.earlyDepartureMin >= 10) setModal({ open: true, kind: "early", minutes: res.earlyDepartureMin });
      else setModal({ open: true, kind: "praise" });
    }
    await refreshData();
    setBusy(false);
  };

  const nextShift = nextShiftAt(shift.startMin, now);
  const nextShiftDay = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", weekday: "long" }).format(nextShift);
  const nextShiftTime = formatTime12(new Date(nextShift).toISOString());
  const earlyGrace = configValue(data.config, "EARLY_CHECKIN_MINUTES", "5");

  return (
    <div className="space-y-2.5">
      {/* mini shift summary */}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <Icon name="clock" size={13} className="text-primary" /> Shift {shift.startTime}â€“{shift.endTime}
        </span>
        {sess?.overtimeActivatedAt && !sess?.timeOut && <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/25">{overtimeRunningLabel(sess, now) || "OVERTIME RUNNING"}</span>}
        {sess?.overtimeActivatedAt && sess?.timeOut && <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 font-bold text-muted-foreground ring-1 ring-inset ring-edge">OVERTIME ENDED · {formatDuration(calc.overtimeMin)}</span>}
      </div>

      {sess && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface px-3 py-2 ring-1 ring-inset ring-edge sm:grid-cols-4">
          <MiniStat label="Worked" value={formatDuration(calc.grossMin)} />
          <MiniStat label="Break" value={formatDuration(calc.breakMin)} />
          <MiniStat label="Over-break" value={calc.overBreakMin > 0 ? formatDuration(calc.overBreakMin) : "â€”"} />
          <MiniStat label={sess.overtimeActivatedAt && !sess.timeOut ? "OT (running)" : "Overtime"} value={calc.overtimeMin > 0 ? formatDuration(calc.overtimeMin) : "â€”"} />
        </div>
      )}

      {onBreak && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-[11px] ring-1 ring-inset ring-edge">
          <span className="min-w-0 truncate font-semibold text-foreground">
            {status === "on-goout"
              ? calc.activeGoOutReason ?? "On paid go-out"
              : status === "on-unpaid"
                ? "Unpaid break"
                : calc.poolsExhausted
                  ? "Paid break exhausted — deducting"
                  : `${formatMinSec(calc.mealRemaining)} meal · ${formatMinSec(calc.restRemaining)} rest left`}
          </span>
          <span className={cn("shrink-0 tabular-nums font-bold", calc.breakRemainingSec < 0 ? "text-rose-600" : "text-foreground")}>
            {formatCountdown(Math.abs(calc.activeElapsedSec))}
          </span>
        </div>
      )}

      {/* direct actions */}
      {canClockIn && (
        <button
          type="button"
          onClick={onClockIn}
          disabled={clocking || busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-linear-to-r from-primary-deep to-primary-bright py-2.5 text-sm font-bold text-white shadow-md shadow-primary/25 transition hover:from-primary hover:to-primary-bright active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
        >
          <Icon name="power" size={16} /> {clocking ? "Clocking In..." : "Clock In"}
        </button>
      )}
{status === "working" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void withRefresh(() => startBreak(staff.employeeId, "meal"))}
              className="inline-flex flex-col items-center gap-0.5 rounded-xl bg-orange-500 py-2.5 text-xs font-bold text-white shadow-sm shadow-orange-200 transition hover:bg-orange-600 active:scale-[0.99] disabled:opacity-60"
            >
              <Icon name="meal" size={15} /> Meal
              <span className="text-[9px] font-normal opacity-90">{calc.paidMealAllow}m paid</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void withRefresh(() => startBreak(staff.employeeId, "rest"))}
              className="inline-flex flex-col items-center gap-0.5 rounded-xl bg-sky-500 py-2.5 text-xs font-bold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-600 active:scale-[0.99] disabled:opacity-60"
            >
              <Icon name="coffee" size={15} /> Rest
              <span className="text-[9px] font-normal opacity-90">{calc.paidRestAllow}m paid</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void withRefresh(() => startBreak(staff.employeeId, "unpaid"))}
              className="inline-flex flex-col items-center gap-0.5 rounded-xl bg-rose-500 py-2.5 text-xs font-bold text-white shadow-sm shadow-rose-200 transition hover:bg-rose-600 active:scale-[0.99] disabled:opacity-60"
            >
              <Icon name="pause" size={15} /> Unpaid
              <span className="text-[9px] font-normal opacity-90">deducted</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setGoOutOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 py-2.5 text-xs font-bold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-600 active:scale-[0.99]"
          >
            <Icon name="arrowRight" size={15} /> Paid Go-Out
            <span className="text-[10px] font-normal opacity-90">field work · no deduction</span>
          </button>
            {(() => {
              const activeSession = data.sessions.find((s) => s.staffId === staff.employeeId && !s.timeOut);
              const shiftEndMin = activeSession?.shiftEndMin ?? null;
              const activated = !!activeSession?.overtimeActivatedAt;
              const nowDate = new Date(now);
              const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
              const beforeEnd = shiftEndMin !== null && nowMin < shiftEndMin;
              const disabled = busy || beforeEnd || activated || shiftEndMin === null;
              const running = overtimeRunningLabel(activeSession, now);
              const label = activated
                ? (running || "OVERTIME RUNNING")
                : beforeEnd
                ? "Extra Time (after duty end)"
                : "Activate Extra Time";
              return (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void activateOvertime(staff.employeeId)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border-2 px-3 py-2 text-xs font-bold transition active:scale-[0.99] disabled:opacity-60",
                    activated ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-edge bg-surface text-muted-foreground hover:bg-surface-muted"
                  )}
                >
                  <span className="flex items-center gap-2"><Icon name="trendUp" size={15} /> {label}</span>
                  {activated && <span className="text-[10px] font-semibold">Ends on manual clock-out</span>}
                </button>
              );
            })()}
        </>
      )}

      {(status === "on-meal" || status === "on-rest" || status === "on-unpaid" || status === "on-goout") && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void withRefresh(() => (status === "on-goout" ? endGoOut(staff.employeeId) : endBreak(staff.employeeId)))}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-60",
            calc.breakRemainingSec < 0 ? "bg-rose-600 hover:bg-rose-700 shadow-rose-200" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"
          )}
        >
          <Icon name="check" size={17} /> {status === "on-goout" ? "Back from Go-Out" : "Back to Work"}
        </button>
      )}

      {(status === "working" || isOnBreak) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setOutConfirm(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white transition hover:bg-slate-900 active:scale-[0.99] disabled:opacity-60"
        >
          <Icon name="power" size={16} /> {busy ? "Processing..." : (sess?.overtimeActivatedAt ? "Clock Out (End Overtime)" : "Clock Out")}
        </button>
      )}
{status === "on-leave" && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-300">
          <Icon name="calendar" size={15} /> On approved leave today — clocking is disabled.
        </div>
      )}

      {status === "completed" && (
        <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-edge">
          <Icon name="check" size={15} className="shrink-0 text-emerald-600" />
          <span className="min-w-0 truncate">Clocked out{sess?.timeOut ? ` at ${formatTime12(sess.timeOut)}` : ""} · Next shift: {nextShiftDay} {nextShiftTime}</span>
        </div>
      )}

      {status === "off" && !canClockIn && (
        <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-edge">
          <Icon name="lock" size={14} className="shrink-0 text-faint-foreground" />
          <span className="min-w-0 truncate">Not clocked in yet — Clock-In opens {earlyGrace} min before {shift.startTime}.</span>
        </div>
      )}

      {/* collapse control */}
      <button
        type="button"
        onClick={onCollapse}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
      >
        <Icon name="chevronDown" size={13} className="rotate-180" /> Collapse panel
      </button>

      {/* clock-in/out feedback + confirmations */}
      <ClockInModal
        open={modal.open}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        kind={modal.kind}
        minutes={modal.minutes}
      />
      <ClockOutConfirm
        open={outConfirm}
        earlyMin={earlyDepartureMin}
        onClose={() => setOutConfirm(false)}
        onConfirm={() => void doClockOut()}
      />
      {goOutOpen && (
        <GoOutModal
          onClose={() => setGoOutOpen(false)}
          onSubmit={(reason, min) => {
            setGoOutOpen(false);
            void withRefresh(() => startGoOut(staff.employeeId, reason, min));
          }}
        />
      )}
    </div>
  );
}

/* ---- compact stat cell used by the inline shift summary ---- */
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-faint-foreground">{label}</p>
      <p className="truncate text-xs font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
/* ---- paid go-out modal (same flow as the ClockTerminal's) ---- */
function GoOutModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string, min: number) => void }) {
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("15");
  return (
    <Modal
      open
      onClose={onClose}
      title="Paid Go-Out"
      subtitle="Field work / customer service — no deduction"
      icon="arrowRight"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon="arrowRight" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim(), Number(minutes) || 15)}>Start Go-Out</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reason / Customer Name" required hint="Where are you going and why?">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Home delivery to customer at Mirpur" />
        </Field>
        <Field label="Estimated Time (minutes)">
          <Input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="15" />
        </Field>
        <div className="rounded-lg bg-violet-50 p-3 text-xs text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
          <Icon name="info" size={12} className="mr-1 inline" /> Time outside is tracked for records but not deducted from your pay.
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================================
   Status helpers — shared visual language.
   ============================================================================ */
function order(s: ClockStatus): number {
  return { "on-meal": 0, "on-rest": 1, "on-unpaid": 1, "on-goout": 1, working: 2, completed: 3, off: 4, "on-leave": 5 }[s] ?? 9;
}
function stripColor(s: ClockStatus) {
  return {
    working: "bg-linear-to-r from-emerald-500 to-emerald-400",
    "on-meal": "bg-linear-to-r from-orange-500 to-orange-600",
    "on-rest": "bg-linear-to-r from-sky-500 to-sky-600",
    "on-unpaid": "bg-linear-to-r from-rose-500 to-rose-600",
    "on-goout": "bg-linear-to-r from-violet-500 to-violet-600",
    "on-leave": "bg-linear-to-r from-amber-500 to-amber-600",
    completed: "bg-linear-to-r from-slate-400 to-slate-500",
    off: "bg-linear-to-r from-slate-200 to-slate-300",
  }[s];
}
function dotColor(s: ClockStatus) {
  return { working: "bg-emerald-500", "on-meal": "bg-orange-500", "on-rest": "bg-sky-500", "on-unpaid": "bg-rose-500", "on-goout": "bg-violet-500", "on-leave": "bg-amber-500", completed: "bg-slate-400", off: "bg-slate-300" }[s];
}
function badgeCls(s: ClockStatus) {
  return { working: "bg-emerald-50 text-emerald-700 ring-emerald-200", "on-meal": "bg-orange-50 text-orange-700 ring-orange-200", "on-rest": "bg-sky-50 text-sky-700 ring-sky-200", "on-unpaid": "bg-rose-50 text-rose-700 ring-rose-200", "on-goout": "bg-violet-50 text-violet-700 ring-violet-200", "on-leave": "bg-amber-50 text-amber-700 ring-amber-200", completed: "bg-surface-muted text-muted-foreground ring-edge", off: "bg-surface-muted text-faint-foreground ring-edge" }[s];
}
function badgeLabel(s: ClockStatus) {
  return { working: "On Duty", "on-meal": "On Meal Break", "on-rest": "On Rest Break", "on-unpaid": "Unpaid Break", "on-goout": "Go-Out", "on-leave": "On Leave", completed: "Clocked Out", off: "Not Clocked In" }[s];
}
