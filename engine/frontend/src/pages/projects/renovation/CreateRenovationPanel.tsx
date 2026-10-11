/* New renovation project (owner requirements 11 Oct 2026).
   Required: customer name, building (from the building list; its state fills in
   and can be changed), unit no, sales person, project type, brand (Dream Crafter
   by default). Optional: customer phone, property type (the building's default),
   bedrooms, bathrooms, built-up sqft, designer, notes.
   Not asked: the name (made "<BUILDING> <UNIT> <CUSTOMER>", editable on the
   project), start date (the day it is created), end date (the SLA due date
   follows from the project type), venue, organizer, event type. The server
   checks the same required set. */

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { renovationApi } from "./renovationApi";
import { errorText } from "./renovationModel";
import { Dialog, Field, inputClass } from "./renovationUi";
import { PersonSelect } from "./PersonSelect";
import { MY_STATES, autoProjectName, defaultBrandId, useBrands, useBuildings, usePropertyTypes } from "./settingsApi";

export interface NewProjectForm {
  customerName: string; customerPhone: string; buildingId: number | null; state: string; unitNo: string;
  salesPersonId: number | null; projectTypeId: number | null; brandId: number | null;
  propertyTypeId: number | null; bedrooms: string; bathrooms: string; builtUpSqft: string; designerPersonId: number | null; notes: string;
}

/** What is missing from the required set, in form order; empty when the form can be sent. */
export function missingFields(f: NewProjectForm): string[] {
  const out: string[] = [];
  if (!f.customerName.trim()) out.push("customer name");
  if (!f.buildingId) out.push("building");
  if (!f.unitNo.trim()) out.push("unit no");
  if (!f.salesPersonId) out.push("sales person");
  if (!f.projectTypeId) out.push("project type");
  if (!f.brandId) out.push("brand");
  for (const [k, label] of [["bedrooms", "bedrooms"], ["bathrooms", "bathrooms"]] as const) {
    const v = f[k].trim();
    if (v && !(/^\d+$/.test(v) && Number(v) <= 50)) out.push(`${label} (a whole number)`);
  }
  if (f.builtUpSqft.trim() && !(Number(f.builtUpSqft) > 0)) out.push("built-up size (a number above 0)");
  return out;
}

export function newProjectBody(f: NewProjectForm) {
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    customerKind: "customer" as const,
    customerName: f.customerName.trim(), customerPhone: f.customerPhone.trim() || null,
    buildingId: f.buildingId, state: f.state.trim() || null, unitNo: f.unitNo.trim(),
    salesPersonId: f.salesPersonId, projectTypeId: f.projectTypeId, brandId: f.brandId,
    propertyTypeId: f.propertyTypeId, bedrooms: n(f.bedrooms), bathrooms: n(f.bathrooms), builtUpSqft: n(f.builtUpSqft),
    designerPersonId: f.designerPersonId, notes: f.notes.trim() || null,
  };
}

export function CreateRenovationPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const types = useQuery(["renovation", "types"], () => renovationApi.types());
  const buildings = useBuildings();
  const propertyTypes = usePropertyTypes();
  const brands = useBrands();
  const [f, setF] = useState<NewProjectForm>({
    customerName: "", customerPhone: "", buildingId: null, state: "", unitNo: "", salesPersonId: null, projectTypeId: null,
    brandId: null, propertyTypeId: null, bedrooms: "", bathrooms: "", builtUpSqft: "", designerPersonId: null, notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof NewProjectForm>(k: K, v: NewProjectForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const activeTypes = (types.data?.data ?? []).filter((t) => t.active);
  const activeBuildings = (buildings.data?.data ?? []).filter((b) => b.active);
  const building = activeBuildings.find((b) => b.id === f.buildingId) ?? null;
  const type = activeTypes.find((t) => t.id === f.projectTypeId) ?? null;

  // Defaults once the lists arrive: Dream Crafter, and the first type.
  useEffect(() => {
    if (f.brandId == null && brands.data) set("brandId", defaultBrandId(brands.data.data));
  }, [brands.data]);
  useEffect(() => {
    if (f.projectTypeId == null && activeTypes[0]) set("projectTypeId", activeTypes[0].id);
  }, [types.data]);

  function pickBuilding(id: number | null) {
    const b = activeBuildings.find((x) => x.id === id) ?? null;
    setF((x) => ({ ...x, buildingId: id, state: b?.state ?? "", propertyTypeId: b?.property_type_id ?? x.propertyTypeId }));
  }

  const name = useMemo(() => autoProjectName(building?.name, f.unitNo, f.customerName), [building, f.unitNo, f.customerName]);

  async function submit() {
    const missing = missingFields(f);
    if (missing.length) { setError(`Fill in: ${missing.join(", ")}.`); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await renovationApi.create(newProjectBody(f));
      onCreated(r.id);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  const req = (label: string) => `${label} *`;
  return (
    <Dialog
      title="New renovation project"
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? "Creating..." : "Create project"}</Button></>}
    >
      <div className="space-y-3">
        <Field label={req("Customer name")}><input className={inputClass} value={f.customerName} onChange={(e) => set("customerName", e.target.value)} placeholder="MR ALBERT" /></Field>
        <Field label="Customer phone"><input className={inputClass} value={f.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} inputMode="tel" /></Field>
        <Field label={req("Building")}>
          <select className={inputClass} value={f.buildingId ?? ""} onChange={(e) => pickBuilding(e.target.value ? Number(e.target.value) : null)} disabled={buildings.loading}>
            <option value="">{buildings.loading ? "Loading..." : activeBuildings.length ? "Pick the building" : "No buildings yet: add them in Project Maintenance"}</option>
            {activeBuildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={req("Unit no")}><input className={inputClass} value={f.unitNo} onChange={(e) => set("unitNo", e.target.value)} placeholder="C-20-08" /></Field>
          <Field label="State">
            <input className={inputClass} list="new-project-states" value={f.state} onChange={(e) => set("state", e.target.value)} />
            <datalist id="new-project-states">{MY_STATES.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={req("Sales person")}><PersonSelect label="Sales person" role="sales" value={f.salesPersonId} onChange={(v) => set("salesPersonId", v)} placeholder="Pick" /></Field>
          <Field label="Designer"><PersonSelect label="Designer" role="designer" value={f.designerPersonId} onChange={(v) => set("designerPersonId", v)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={req("Project type")}>
            <select className={inputClass} value={f.projectTypeId ?? ""} onChange={(e) => set("projectTypeId", e.target.value ? Number(e.target.value) : null)}>
              {!activeTypes.length && <option value="">{types.loading ? "Loading..." : "No project types"}</option>}
              {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.sla_days ? ` (${t.sla_days} days)` : ""}</option>)}
            </select>
          </Field>
          <Field label={req("Brand")}>
            <select className={inputClass} value={f.brandId ?? ""} onChange={(e) => set("brandId", e.target.value ? Number(e.target.value) : null)}>
              {!brands.data && <option value="">Loading...</option>}
              {(brands.data?.data ?? []).filter((b) => b.active || b.id === f.brandId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <details className="rounded-md border border-border px-3 py-2" open={!!(f.propertyTypeId || f.bedrooms || f.bathrooms || f.builtUpSqft || f.notes)}>
          <summary className="cursor-pointer text-sm text-ink-secondary">Unit details and notes (optional)</summary>
          <div className="mt-2 space-y-3">
            <Field label="Property type">
              <select className={inputClass} value={f.propertyTypeId ?? ""} onChange={(e) => set("propertyTypeId", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Not set</option>
                {(propertyTypes.data?.data ?? []).filter((t) => t.active || t.id === f.propertyTypeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Bedrooms"><input className={inputClass} inputMode="numeric" value={f.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} /></Field>
              <Field label="Bathrooms"><input className={inputClass} inputMode="numeric" value={f.bathrooms} onChange={(e) => set("bathrooms", e.target.value)} /></Field>
              <Field label="Built-up sqft"><input className={inputClass} inputMode="decimal" value={f.builtUpSqft} onChange={(e) => set("builtUpSqft", e.target.value)} /></Field>
            </div>
            <Field label="Notes"><textarea className={inputClass} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>
        </details>
        <div className="rounded-md bg-surface-dim px-3 py-2 text-xs text-ink-secondary">
          <div>Project name: <span className="font-medium text-ink">{name || "fills in from building, unit and customer"}</span> (can be changed on the project)</div>
          <div>Starts today{type?.sla_days ? `; SLA due in ${type.sla_days} days` : ""}.</div>
        </div>
        {error && <p role="alert" className="text-sm text-err">{error}</p>}
      </div>
    </Dialog>
  );
}
