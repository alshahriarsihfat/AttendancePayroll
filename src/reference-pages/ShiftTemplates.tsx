"use client";
import { useEffect, useState } from "react";
import { Card, Button, Field, Input } from "../components/ui";
import { Modal } from "../components/Modal";
import { useUI } from "../context/UIContext";

interface Template { id: string; name: string; startTime: string; endTime: string; mealBreakMin: number; restMin: number; isActive: boolean; }

export function ShiftTemplates() {
  const ui = useUI();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [start, setStart] = useState("09:00 AM");
  const [end, setEnd] = useState("08:00 PM");
  const [meal, setMeal] = useState(30);
  const [rest, setRest] = useState(15);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/shift-templates", { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load templates");
      setItems(Array.isArray(json.templates) ? json.templates : []);
    } catch (e: any) { setError(e?.message || "Failed"); setItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openCreate = () => { setEditing(null); setName(""); setStart("09:00 AM"); setEnd("08:00 PM"); setMeal(30); setRest(15); setActive(true); setSaveError(""); setOpen(true); };
  const openEdit = (t: Template) => { setEditing(t); setName(t.name); setStart(t.startTime); setEnd(t.endTime); setMeal(t.mealBreakMin); setRest(t.restMin); setActive(t.isActive); setSaveError(""); setOpen(true); };

  const save = async () => {
    setSaving(true); setSaveError("");
    try {
      const body = { name, startTime: start, endTime: end, mealBreakMin: meal, restMin: rest, isActive: active };
      const url = editing ? `/api/shift-templates/${editing.id}` : "/api/shift-templates";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setOpen(false); void load();
    } catch (e: any) { setSaveError(e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const toggle = async (t: Template) => {
    await fetch(`/api/shift-templates/${t.id}`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !t.isActive }) });
    void load();
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" onClick={() => ui.goBack()}>← Back</Button>
        </div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Shift Templates</h2>
          <Button onClick={openCreate}>Add Template</Button>
        </div>
        {loading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {!loading && items.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No templates.</p>}
        <div className="mt-3 space-y-2">
          {items.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-edge p-3">
              <div>
                <p className="font-medium">{t.name} {t.isActive ? "" : "(inactive)"}</p>
                <p className="text-xs text-muted-foreground">{t.startTime} – {t.endTime} · meal {t.mealBreakMin}m · rest {t.restMin}m</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEdit(t)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => void toggle(t)}>{t.isActive ? "Deactivate" : "Activate"}</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Template" : "Add Template"}>
        <div className="space-y-3">
          <Field label="Shift Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Start Time"><Input value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End Time"><Input value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Meal Break (min)"><Input type="number" value={meal} onChange={(e) => setMeal(Number(e.target.value))} /></Field>
          <Field label="Rest Break (min)"><Input type="number" value={rest} onChange={(e) => setRest(Number(e.target.value))} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
          {saveError && <p className="text-sm text-rose-600">{saveError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
