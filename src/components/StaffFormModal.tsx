import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { Modal } from "./Modal";
import { Button, Field, Input, Select, Divider } from "./ui";
import { PhotoAvatar } from "./PhotoAvatar";
import type { Employee, EmpRole, SalaryType } from "../types";
import type { FieldError } from "../lib/validation";
import { DEFAULT_DEPARTMENT } from "../lib/staff-input";
import { COUNTER_NUMBERS, idFromSerial } from "../lib/config";

const EMPTY: Partial<Employee> = {
  fullName: "", employeeId: "", username: "", password: "", email: "", phone: "", department: "Pharmacy Counter",
  jobTitle: "", section: "Sales Floor", counter: 1, joinDate: "", role: "STAFF",
  salaryType: "Daily", baseSalary: 0, dailyRate: 0, hourlyRate: 0,
  dailyDutyHours: undefined, workingDaysPerWeek: undefined,
  shiftStart: "09:00 AM", shiftEnd: "08:00 PM", mealBreakMin: 30, restMin: 15, photoUrl: "",
  status: "Active", isActive: true, arrears: 0, advance: 0,
};
const SALARY: SalaryType[] = ["Daily", "Weekly", "Monthly", "Hourly"];
const PHARMA = "Pharmacy Counter";

export function StaffFormModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: Employee | null }) {
  const { data, createStaff, updateStaff } = useApp();
  const [form, setForm] = useState<Partial<Employee>>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editing) {
      setForm({ ...editing, password: "" });
    }
  else {
      // suggest the next available KP98 id + matching default username/password
      const ids = data.staff.map((s) => s.employeeId);
      const id = nextId(ids);
      setForm({ ...EMPTY, employeeId: id, username: id.toLowerCase(), password: id.slice(-4) });
    }
    setErrors({});
  }, [editing, open, data.staff]);
  const set = (k: keyof Employee, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const isPharma = form.department === PHARMA;

  const submit = async () => {
    const dutyRaw = form.dailyDutyHours as any;
    const payload: Partial<Employee> = {
      ...form,
      // Legacy DB columns preserved but not used for active earning derivation (2C.6.2).
      baseSalary: Number(form.baseSalary) || 0, dailyRate: Number(form.dailyRate) || 0,
      hourlyRate: Number(form.hourlyRate) || 0, mealBreakMin: Number(form.mealBreakMin) || 30,
      restMin: Number(form.restMin) || 15, counter: isPharma ? (form.counter ?? null) : null,
      dailyDutyHours: dutyRaw === "" || dutyRaw == null ? undefined : Number(dutyRaw),
      workingDaysPerWeek: form.workingDaysPerWeek == null ? undefined : Number(form.workingDaysPerWeek),
      status: form.status ?? "Active",
      isActive: form.isActive ?? true,
    };
    // On edit a blank password is a no-op: omit it so the existing login
    // password is kept exactly as-is (the server never re-hashes an empty string).
    if (editing && !payload.password) delete payload.password;
    const res = editing ? await updateStaff(editing.employeeId, payload) : await createStaff(payload);
    if (!res.ok) { const m: Record<string, string> = {}; (res.errors as FieldError[] | undefined)?.forEach((e) => (m[e.field] = e.message)); setErrors(m); }
    else onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={editing ? "Edit Staff" : "Add Staff"} subtitle={editing ? editing.employeeId : "Create a new staff record"} icon="user"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon="check" onClick={submit}>{editing ? "Save Changes" : "Add Staff"}</Button></>}>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <PhotoAvatar name={form.fullName || "?"} photoUrl={form.photoUrl} size={64} ring={false} />
          <div className="flex-1">
            <Field label="Photo (Google Drive link)" hint="Paste a Drive share link — it converts automatically.">
              <Input value={form.photoUrl} onChange={(e) => set("photoUrl", e.target.value)} placeholder="https://drive.google.com/file/d/…/view" />
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full Name" required error={errors.fullName} className="sm:col-span-2">
            <Input value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="e.g. Rahim Uddin" />
          </Field>
          <Field label="Staff ID" required error={errors.employeeId} hint="Internal record id (e.g. KP9830).">
            <Input value={form.employeeId} onChange={(e) => set("employeeId", e.target.value.toUpperCase())} placeholder="KP9830" disabled={!!editing} />
          </Field>
          <Field label="Phone" required error={errors.phone}><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+8801XXXXXXXXX" /></Field>
          <Field label="Email" error={errors.email} hint="Optional"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@khanpharma.bd" /></Field>
        </div>

        <Divider />
        {/* Manual login credentials — admin-assigned */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint-foreground">Login Credentials</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Username" required error={errors.username} hint="Unique login name for this staff.">
              <Input value={form.username} onChange={(e) => set("username", e.target.value.toLowerCase())} placeholder="e.g. rahim" />
            </Field>
            <Field label="Password" required={!editing} error={errors.password} hint={editing ? "Leave blank to keep the current password." : "Set a unique password."}>
              <Input value={form.password} onChange={(e) => set("password", e.target.value)} placeholder={editing ? "Leave blank to keep current" : "Set a password"} />
            </Field>
          </div>
        </div>

        <Divider />
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint-foreground">Role & Assignment</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Role / Access">
              <Select value={form.role} onChange={(e) => set("role", e.target.value as EmpRole)}>
                <option value="STAFF">Staff</option>
                <option value="SUPERVISOR">Supervisor</option>
              </Select>
            </Field>
            <Field label="Designation" required error={errors.jobTitle}><Input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="e.g. Pharmacist" /></Field>
            <Field label="Department" error={errors.department} hint="Optional — unassigned is fine.">
              <Select value={form.department ?? ""} onChange={(e) => set("department", e.target.value)}>
                <option value="">{DEFAULT_DEPARTMENT}</option>
                {data.departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Section"><Input value={form.section} onChange={(e) => set("section", e.target.value)} placeholder="e.g. Sales Floor" /></Field>
            {editing && (
              <>
                <Field label="Employment Status">
                  <Select value={form.status ?? "Active"} onChange={(e) => set("status", e.target.value as any)}>
                    <option value="Active">Active</option>
                    <option value="On-leave">On leave</option>
                    <option value="Terminated">Terminated</option>
                  </Select>
                </Field>
                <Field label="Account Active" hint="Inactive staff cannot authenticate.">
                  <Select value={String(form.isActive ?? true)} onChange={(e) => set("isActive", e.target.value === "true")}>
                    <option value="true">Active (can sign in)</option>
                    <option value="false">Inactive (cannot sign in)</option>
                  </Select>
                </Field>
              </>
            )}
          </div>

          {/* Counter config box — only for Pharmacy Counter */}
          {isPharma && (
            <div className="mt-3 rounded-2xl border border-primary/25 bg-primary-soft/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-linear-to-br from-primary-deep to-primary-bright text-white"><span className="text-[11px] font-bold">C</span></span> Pharmacy Counter Assignment</p>
              <p className="mt-1 text-xs text-primary/80">Allocate this staff to one of the 9 counters.</p>
              <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-9">
                {COUNTER_NUMBERS.map((n) => (
                  <button key={n} type="button" onClick={() => set("counter", form.counter === n ? null : n)}
                    className={`flex h-10 items-center justify-center rounded-lg text-sm font-bold transition ${form.counter === n ? "bg-linear-to-r from-primary-deep to-primary-bright text-white shadow-md shadow-primary/25" : "bg-surface text-muted-foreground ring-1 ring-inset ring-edge hover:bg-primary-soft"}`}>
                    {n}
                  </button>
                ))}
           </div>
             {form.counter && <button type="button" onClick={() => set("counter", null)} className="mt-2 text-xs font-medium text-faint-foreground hover:text-rose-500">Clear counter</button>}
            </div>
          )}
        </div>

        <Divider />
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint-foreground">Shift Hours ({form.shiftStart || "..:.."} – {form.shiftEnd || "..:.."})</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Join Date" error={errors.joinDate} hint="Defaults to today when left blank."><Input type="date" value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} /></Field>
            <Field label="Shift Start" required error={errors.shiftStart}><Input value={form.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} placeholder="09:00 AM" /></Field>
            <Field label="Shift End" required error={errors.shiftEnd}><Input value={form.shiftEnd} onChange={(e) => set("shiftEnd", e.target.value)} placeholder="08:00 PM" /></Field>
            <Field label="Paid Meal (min)"><Input type="number" value={form.mealBreakMin} onChange={(e) => set("mealBreakMin", e.target.value)} /></Field>
            <Field label="Paid Rest (min)"><Input type="number" value={form.restMin} onChange={(e) => set("restMin", e.target.value)} /></Field>
          </div>
        </div>

        <Divider />
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint-foreground">Salary Configuration <span className="font-normal text-faint-foreground">(hidden from staff role)</span></p>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Approved policy: Earned Salary = Approved Payable Hours × Configured Hourly Rate. Daily, Weekly, and Monthly are display/summary labels only (not separate earning/payment-cycle engines). Configure Hourly Rate and Daily Duty Hours directly; missing required config stays INCOMPLETE (no /30, /7, calendar-month, or 8h/shift fallback).
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Salary Type (label)" required error={errors.salaryType}>
              <Select value={form.salaryType} onChange={(e) => set("salaryType", e.target.value as SalaryType)}>
                {SALARY.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Hourly Rate (৳)" required error={errors.hourlyRate} hint="Required for active earning calculation.">
              <Input type="number" step="0.01" min="0" value={form.hourlyRate} onChange={(e) => set("hourlyRate", e.target.value)} />
            </Field>
            <Field label="Daily Duty Hours" required error={errors.dailyDutyHours} hint="Required. No default/fallback assumed.">
              <Input type="number" step="0.25" min="0" value={form.dailyDutyHours ?? ""} onChange={(e) => set("dailyDutyHours", e.target.value === "" ? undefined : Number(e.target.value))} placeholder="e.g. 8" />
            </Field>
            <div className="sm:col-span-2 rounded-lg bg-surface-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Legacy fields (base/daily rate, weekly working days) may remain in stored records/DB for compatibility but are not used to derive active earnings. Payments can be made any day (full or partial) after payable hours accrue.
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// next KP98 serial helper for the parent page
export function nextSerial(existing: string[]): number {
  const used = new Set(existing.map((id) => { const m = id.match(/^KP98(\d{2})$/); return m ? m[1] : null; }).filter(Boolean));
  for (let n = 1; n <= 99; n++) {
    const s = String(n).padStart(2, "0");
    if (!used.has(s)) return n;
  }
  return 100; // exhausted
}
export function nextId(existing: string[]): string {
  const serial = nextSerial(existing);
  if (serial > 99) return ""; // exhausted
  return idFromSerial(serial);
}
