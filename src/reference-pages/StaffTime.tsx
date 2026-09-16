// ============================================================================
// Staff Time Management — Supervisor tool.
// Provides a searchable staff selector. When a supervisor picks a staff
// member, the ClockTerminal switches to that staff's full clock UI
// (the EXACT same terminal the staff member sees).
// ============================================================================
"use client";

import { useState } from "react";
import { useApp } from "../context/AppContext";
import { useNow } from "../hooks/useNow";
import { Card, EmptyState } from "../components/ui";
import { Icon } from "../components/icons";
import { computeSession, empShift } from "../lib/timeclock";

interface StaffSelectorProps {
  selectedId: string | null;
  onSelect: (employeeId: string) => void;
}

/** Searchable listbox with live status indicators for supervisors to pick a staff. */
export function StaffSelector({ selectedId, onSelect }: StaffSelectorProps) {
  const { data, session, todaySession, isOnLeaveToday, staffById } = useApp();
  const now = useNow(1000);

  const active = data.staff.filter((s) => s.isActive);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const isSupervisor = session?.role === "SUPERVISOR";
  const supervisorName = session?.name ?? "Supervisor";

  const selectedStaff = selectedId ? staffById(selectedId) : undefined;

  const searchFiltered = active.filter((s) =>
    s.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.employeeId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (s: typeof active[number]) => {
    const sSess = todaySession(s.employeeId);
    const sOnLeave = isOnLeaveToday(s.employeeId);
    const sShift = empShift(s);
    const sCalc = computeSession(sSess, s, data.config, now);
    const clockStatus = sCalc ? sCalc.clockStatus : "off";
    if (sOnLeave) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"><span className="text-sm">&#128197;</span> Leave</span>;
    if (clockStatus === "working") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 "><span className="text-sm">&#128994;</span> On Duty</span>;
    if (clockStatus === "on-meal") return <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700"><span className="text-sm">&#128339;</span> Meal</span>;
    if (clockStatus === "on-rest") return <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700"><span className="text-sm">&#9749;</span> Rest</span>;
    return <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"><span className="text-sm">&#9898;</span> Off</span>;
  };

  if (!isSupervisor) {
    return (
      <Card className="p-8">
        <EmptyState icon="shield" title="Access restricted" desc="Only supervisors and admins can manage staff time." />
      </Card>
    );
  }

  return (
    <div className="space-y-5 animate-fade">
      <Card className="p-4">
        <label className="mb-1.5 block text-[13px] font-medium text-foreground">Select Staff Member</label>
        <input
          type="text"
          placeholder="Search staff..."
          value={searchTerm}
          onFocus={() => setIsDropdownOpen(true)}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-edge px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        {isDropdownOpen && (
          <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-edge bg-surface shadow-lg transform-gpu will-change-transform transition-all duration-200">
            {searchFiltered.map((s) => (
              <button
                key={s.employeeId}
                onClick={() => {
                  onSelect(s.employeeId);
                  setSearchTerm("");
                  setIsDropdownOpen(false);
                }}
                className={s.employeeId === selectedId ? "flex w-full items-center justify-between rounded-lg bg-primary-soft p-3 text-left" : "flex w-full items-center justify-between rounded-lg p-3 text-left hover:bg-surface-muted"}
              >
                <div className="flex-1">
                  <p className="font-medium text-foreground">{s.fullName}</p>
                  <p className="text-xs text-muted-foreground">{s.employeeId} · {s.jobTitle}</p>
                </div>
                {getStatusBadge(s)}
              </button>
            ))}
            {searchFiltered.length === 0 && searchTerm && (
              <p className="py-3 text-center text-muted-foreground">No staff match found.</p>
            )}
          </div>
        )}
        {selectedStaff && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary">
            <Icon name="check" size={15} className="shrink-0" />
            <span className="font-semibold">{selectedStaff.fullName}</span>
            <span className="text-xs text-primary">{selectedStaff.employeeId} · now showing in the Clock tab</span>
          </div>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-xs text-faint-foreground">
          <Icon name="info" size={12} /> Selecting a staff member opens their full Clock Terminal. All actions are logged with "managed by {supervisorName}".
        </p>
      </Card>
    </div>
  );
}

/** Standalone page wrapper (kept for the router). */
export function StaffTime() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div>
      <StaffSelector selectedId={selected} onSelect={setSelected} />
    </div>
  );
}