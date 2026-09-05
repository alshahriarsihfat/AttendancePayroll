import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { Modal } from "./Modal";
import { Button, Field, Input, Select, Divider } from "./ui";
import { PhotoAvatar } from "./PhotoAvatar";
import type { Employee, EmpRole, SalaryType } from "../types";
import type { FieldError } from "../lib/validation";
import { COUNTER_NUMBERS, idFromSerial } from "../lib/config";

const EMPTY: Partial<Employee> = {
  fullName: "", employeeId: "", username: "", password: "", email: "", phone: "", department: "Pharmacy Counter",
  jobTitle: "", section: "Sales Floor", counter: 1, joinDate: "", role: "STAFF",
  salaryType: "Daily", baseSalary: 0, dailyRate: 0, hourlyRate: 0,
  shiftStart: "09:00 AM", shiftEnd: "08:00 PM", mealBreakMin: 30, restMin: 15, shiftId: "SH-FULL", photoUrl: "",
};
const SALARY: SalaryType[] = ["Daily", "Weekly", "Monthly", "Hourly"];
const PHARMA = "Pharmacy Counter";

export function StaffFormModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: Employee | null }) {
  const { data, createStaff, updateStaff } = useApp();
  const [form, setForm] = useState<Partial<Employee>>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editing) { setForm({ ...editing }); }
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

  const applyShift = (id: string) => {
    const t = data.shifts.find((s) => s.id === id);
    if (t) setForm((f) => ({ ...f, shiftId: id, shiftStart: t.startTime, shiftEnd: t.endTime, mealBreakMin: t.mealBreakMin, restMin: t.restMin }));
  };

  const submit = () => {
    const payload: Partial<Employee> = {
      ...form,
      baseSalary: Number(form.baseSalary) || 0, dailyRate: Number(form.dailyRate) || 0,
      hourlyRate: Number(form.hourlyRate) || 0, mealBreakMin: Number(form.mealBreakMin) || 30,
      restMin: Number(form.restMin) || 15, counter: isPharma ? (form.counter ?? null) : null,
    };
    const res = editing ? updateStaff(editing.employeeId, payload) : createStaff(payload);
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
            <Input value={form.employeeId} onChange={(e) => set("employeeId", e.target.value.toUpperCase())} placeholder="KP9830" />
          </Field>
          <Field label="Phone" required error={errors.phone}><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+8801XXXXXXXXX" /></Field>
          <Field label="Email" error={errors.email} hint="Optional"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@khanpharma.bd" /></Field>
        </div>

        <Divider />
        {/* Manual login credentials — admin-assigned */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Login Credentials</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Username" required error={errors.username} hint="Unique login name for this staff.">
              <Input value={form.username} onChange={(e) => set("username", e.target.value.toLowerCase())} placeholder="e.g. rahim" />
            </Field>
            <Field label="Password" required error={errors.password} hint="Set a unique password.">
              <Input value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="e.g. 4271" />
            </Field>
          </div>
        </div>

        <Divider />
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Role & Assignment</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Role / Access">
              <Select value={form.role} onChange={(e) => set("role", e.target.value as EmpRole)}>
                <option value="STAFF">Staff</option>
                <option value="SUPERVISOR">Supervisor</option>
              </Select>
            </Field>
            <Field label="Designation" required error={errors.jobTitle}><Input value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="e.g. Pharmacist" /></Field>
            <Field label="Department" required error={errors.department}>
              <Select value={form.department} onChange={(e) => set("department", e.target.value)}>
                {data.departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Section"><Input value={form.section} onChange={(e) => set("section", e.target.value)} placeholder="e.g. Sales Floor" /></Field>
          </div>

          {/* Counter config box — only for Pharmacy Counter */}
          {isPharma && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-600 text-white"><span className="text-[11px] font-bold">C</span></span> Pharmacy Counter Assignment</p>
              <p className="mt-1 text-xs text-emerald-600/80">Allocate this staff to one of the 9 counters.</p>
              <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-9">
                {COUNTER_NUMBERS.map((n) => (
                  <button key={n} type="button" onClick={() => set("counter", form.counter === n ? null : n)}
                    className={`flex h-10 items-center justify-center rounded-lg text-sm font-bold transition ${form.counter === n ? "bg-emerald-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-emerald-50"}`}>
                    {n}
                  </button>
                ))}
              </div>
              {form.counter && <button type="button" onClick={() => set("counter", null)} className="mt-2 text-xs font-medium text-slate-400 hover:text-rose-500">Clear counter</button>}
            </div>
          )}
        </div>

        <Divider />
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Custom Shift (9AM–11PM window)</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Shift Template" hint="Pick to pre-fill, then customize">
              <Select value={form.shiftId} onChange={(e) => applyShift(e.target.value)}>
                {data.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Join Date" required error={errors.joinDate}><Input type="date" value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} /></Field>
            <Field label="Shift Start" required error={errors.shiftStart}><Input value={form.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} placeholder="09:00 AM" /></Field>
            <Field label="Shift End" required error={errors.shiftEnd}><Input value={form.shiftEnd} onChange={(e) => set("shiftEnd", e.target.value)} placeholder="08:00 PM" /></Field>
            <Field label="Paid Meal (min)"><Input type="number" value={form.mealBreakMin} onChange={(e) => set("mealBreakMin", e.target.value)} /></Field>
            <Field label="Paid Rest (min)"><Input type="number" value={form.restMin} onChange={(e) => set("restMin", e.target.value)} /></Field>
          </div>
        </div>

        <Divider />
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Salary Structure <span className="font-normal text-slate-300">(hidden from staff role)</span></p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Salary Type" required error={errors.salaryType}>
              <Select value={form.salaryType} onChange={(e) => set("salaryType", e.target.value as SalaryType)}>
                {SALARY.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            {(form.salaryType === "Monthly" || form.salaryType === "Weekly") && (
              <Field label={`${form.salaryType} Salary (৳)`} required error={errors.baseSalary}><Input type="number" value={form.baseSalary} onChange={(e) => set("baseSalary", e.target.value)} /></Field>
            )}
            {form.salaryType === "Daily" && <Field label="Daily Rate (৳)" required error={errors.dailyRate}><Input type="number" value={form.dailyRate} onChange={(e) => set("dailyRate", e.target.value)} /></Field>}
            {form.salaryType === "Hourly" && <Field label="Hourly Rate (৳)" required error={errors.hourlyRate}><Input type="number" value={form.hourlyRate} onChange={(e) => set("hourlyRate", e.target.value)} /></Field>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// next KP98 serial helper for the parent page
export function nextSerial(existing: string[]): number {
  const max = existing.reduce((m, id) => { const n = parseInt(id.replace(/\D/g, ""), 10); return Number.isFinite(n) ? Math.max(m, n) : m; }, 20);
  return max + 1;
}
export function nextId(existing: string[]): string {
  return idFromSerial(nextSerial(existing));
}
