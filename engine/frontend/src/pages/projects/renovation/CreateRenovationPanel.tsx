/* New renovation project: type, customer (owner or outside customer), building
   and unit, and the sales person and designer from the people list. No brand,
   event type or venue: those belong to exhibitions. */

import { useState } from "react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { renovationApi } from "./renovationApi";
import { errorText } from "./renovationModel";
import { Dialog, Field, inputClass } from "./renovationUi";
import { PersonSelect } from "./PersonSelect";

export function CreateRenovationPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const types = useQuery(["renovation", "types"], () => renovationApi.types());
  const [f, setF] = useState({
    name: "", projectTypeId: "", customerKind: "customer" as "owner" | "customer", customerName: "", customerPhone: "",
    building: "", unitNo: "", siteAddress: "", plannedHandoverDate: "",
  });
  const [salesPersonId, setSalesPersonId] = useState<number | null>(null);
  const [designerPersonId, setDesignerPersonId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const activeTypes = (types.data?.data ?? []).filter((t) => t.active);
  const typeId = f.projectTypeId || (activeTypes[0] ? String(activeTypes[0].id) : "");

  async function submit() {
    if (!f.name.trim()) { setError("Give the project a name."); return; }
    if (!f.customerName.trim()) { setError("Enter the customer or owner name."); return; }
    if (!typeId) { setError("Pick a project type."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await renovationApi.create({
        name: f.name.trim(), projectTypeId: Number(typeId), customerKind: f.customerKind, customerName: f.customerName.trim(),
        customerPhone: f.customerPhone || null, building: f.building || null, unitNo: f.unitNo || null, siteAddress: f.siteAddress || null,
        plannedHandoverDate: f.plannedHandoverDate || null, salesPersonId, designerPersonId,
      });
      onCreated(r.id);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="New renovation project"
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? "Creating..." : "Create project"}</Button></>}
    >
      <div className="space-y-3">
        <Field label="Project name"><input className={inputClass} value={f.name} onChange={set("name")} placeholder="Skyline Embassy A-12-3" /></Field>
        <Field label="Project type">
          <select className={inputClass} value={typeId} onChange={set("projectTypeId")}>
            {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Customer is">
            <select className={inputClass} value={f.customerKind} onChange={set("customerKind")}>
              <option value="customer">Outside customer</option>
              <option value="owner">Conts-managed owner</option>
            </select>
          </Field>
          <Field label="Phone"><input className={inputClass} value={f.customerPhone} onChange={set("customerPhone")} inputMode="tel" /></Field>
        </div>
        <Field label={f.customerKind === "owner" ? "Owner name" : "Customer name"}><input className={inputClass} value={f.customerName} onChange={set("customerName")} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Building"><input className={inputClass} value={f.building} onChange={set("building")} /></Field>
          <Field label="Unit"><input className={inputClass} value={f.unitNo} onChange={set("unitNo")} /></Field>
        </div>
        <Field label="Site address"><input className={inputClass} value={f.siteAddress} onChange={set("siteAddress")} /></Field>
        <Field label="Planned handover"><input type="date" className={inputClass} value={f.plannedHandoverDate} onChange={set("plannedHandoverDate")} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sales"><PersonSelect label="Sales" role="sales" value={salesPersonId} onChange={setSalesPersonId} /></Field>
          <Field label="Designer"><PersonSelect label="Designer" role="designer" value={designerPersonId} onChange={setDesignerPersonId} /></Field>
        </div>
        {error && <p role="alert" className="text-sm text-err">{error}</p>}
      </div>
    </Dialog>
  );
}
