/* The project's own details (owner requirements 11 Oct 2026): name (made from
   building, unit and customer at creation, changeable here), customer, building,
   unit, state, property type, rooms, size, brand, type, start and SLA due date. */

import { useState } from "react";
import { Button } from "../../../components/Button";
import { renovationApi } from "./renovationApi";
import { errorText, shortDate } from "./renovationModel";
import { Dialog, Field, Pill, inputClass } from "./renovationUi";
import type { ProjectDetailV2 } from "./simpleApi";
import { MY_STATES, useBrands, useBuildings, usePropertyTypes } from "./settingsApi";

export function ProjectInfoCard({ d, canWrite, onDone, onError }: { d: ProjectDetailV2; canWrite: boolean; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const p = d.project;
  const rooms = [p.bedrooms != null ? `${p.bedrooms} bed` : null, p.bathrooms != null ? `${p.bathrooms} bath` : null, p.built_up_sqft ? `${p.built_up_sqft} sqft` : null].filter(Boolean).join(" · ");
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-0.5"><dt className="text-ink-secondary">{label}</dt><dd className="text-right text-ink min-w-0 break-words">{value || "-"}</dd></div>
  );
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Project details</h3>
        {canWrite && <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      <dl className="mt-1 text-sm">
        {row("Code", p.code)}
        {row("Customer", [p.customer_name, p.customer_phone].filter(Boolean).join(" · "))}
        {row("Building", [p.building, p.unit_no].filter(Boolean).join(" "))}
        {row("State", p.state)}
        {row("Property", [p.property_type_name, rooms].filter(Boolean).join(" · "))}
        {row("Type", d.type?.name)}
        {row("Brand", p.brand)}
        {row("Started", shortDate(d.sla?.startDate ?? p.start_date ?? null))}
        {row("SLA due", d.sla ? (d.sla.overdue ? <Pill tone="err">{shortDate(d.sla.dueDate)} passed</Pill> : `${shortDate(d.sla.dueDate)}${p.handed_over_at ? "" : ` (${d.sla.daysLeft} days left)`}`) : "No SLA for this type")}
        {p.notes ? row("Notes", p.notes) : null}
      </dl>
      {editing && <EditProjectDialog d={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onDone("Project details saved."); }} onError={onError} />}
    </section>
  );
}

function EditProjectDialog({ d, onClose, onSaved, onError }: { d: ProjectDetailV2; onClose: () => void; onSaved: () => void; onError: (t: string) => void }) {
  const p = d.project;
  const buildings = useBuildings();
  const types = usePropertyTypes();
  const brands = useBrands();
  const [f, setF] = useState({
    name: p.name, customerName: p.customer_name ?? "", customerPhone: p.customer_phone ?? "", buildingId: p.building_id ?? null,
    unitNo: p.unit_no ?? "", state: p.state ?? "", propertyTypeId: p.property_type_id ?? null, brandId: p.brand_id ?? null,
    bedrooms: p.bedrooms == null ? "" : String(p.bedrooms), bathrooms: p.bathrooms == null ? "" : String(p.bathrooms),
    builtUpSqft: p.built_up_sqft == null ? "" : String(p.built_up_sqft), notes: p.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => (v.trim() === "" ? null : Number(v));

  async function save() {
    if (!f.name.trim()) { setErr("A project needs a name."); return; }
    setBusy(true);
    setErr(null);
    try {
      await renovationApi.patchProject(p.id, {
        name: f.name.trim(), customerName: f.customerName.trim() || null, customerPhone: f.customerPhone.trim() || null,
        ...(f.buildingId !== (p.building_id ?? null) ? { buildingId: f.buildingId } : {}),
        unitNo: f.unitNo.trim() || null, state: f.state.trim() || null, propertyTypeId: f.propertyTypeId,
        ...(f.brandId ? { brandId: f.brandId } : {}),
        bedrooms: n(f.bedrooms), bathrooms: n(f.bathrooms), builtUpSqft: n(f.builtUpSqft), notes: f.notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      const t = errorText(e);
      setErr(t);
      onError(t);
      setBusy(false);
    }
  }

  return (
    <Dialog title="Edit project details" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button></>}>
      <div className="space-y-3">
        <Field label="Project name"><input className={inputClass} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Customer name"><input className={inputClass} value={f.customerName} onChange={(e) => set("customerName", e.target.value)} /></Field>
          <Field label="Customer phone"><input className={inputClass} value={f.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} inputMode="tel" /></Field>
        </div>
        <Field label="Building">
          <select className={inputClass} value={f.buildingId ?? ""} onChange={(e) => set("buildingId", e.target.value ? Number(e.target.value) : null)}>
            <option value="">{p.building && !p.building_id ? `${p.building} (not on the list)` : "Not set"}</option>
            {(buildings.data?.data ?? []).filter((b) => b.active || b.id === f.buildingId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Unit no"><input className={inputClass} value={f.unitNo} onChange={(e) => set("unitNo", e.target.value)} /></Field>
          <Field label="State">
            <input className={inputClass} list="edit-project-states" value={f.state} onChange={(e) => set("state", e.target.value)} />
            <datalist id="edit-project-states">{MY_STATES.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Property type">
            <select className={inputClass} value={f.propertyTypeId ?? ""} onChange={(e) => set("propertyTypeId", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Not set</option>
              {(types.data?.data ?? []).filter((t) => t.active || t.id === f.propertyTypeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Brand">
            <select className={inputClass} value={f.brandId ?? ""} onChange={(e) => set("brandId", e.target.value ? Number(e.target.value) : null)}>
              {!f.brandId && <option value="">Not set</option>}
              {(brands.data?.data ?? []).filter((b) => b.active || b.id === f.brandId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Bedrooms"><input className={inputClass} inputMode="numeric" value={f.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} /></Field>
          <Field label="Bathrooms"><input className={inputClass} inputMode="numeric" value={f.bathrooms} onChange={(e) => set("bathrooms", e.target.value)} /></Field>
          <Field label="Built-up sqft"><input className={inputClass} inputMode="decimal" value={f.builtUpSqft} onChange={(e) => set("builtUpSqft", e.target.value)} /></Field>
        </div>
        <Field label="Notes"><textarea className={inputClass} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-err">{err}</p>}
      </div>
    </Dialog>
  );
}
