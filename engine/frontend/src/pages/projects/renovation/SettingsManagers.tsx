/* Project Maintenance in renovation mode (owner requirements 11 Oct 2026):
   the building list the new-project form picks from, property types, and the
   renovation subcontractors. A contractor is always an engine supplier, so a
   purchase order can go to it: adding one links an existing supplier or creates
   one (code SC-<NAME>). Nothing is deleted; a row is switched off instead. */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { Box } from "./RenovationMaintenance";
import { errorText } from "./renovationModel";
import { inputClass } from "./renovationUi";
import {
  MY_STATES, settingsApi, usePropertyTypes,
  type Building, type Contractor, type PropertyType,
} from "./settingsApi";

function useRun(reload: () => void) {
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try { await fn(); reload(); return true; } catch (e) { setError(errorText(e)); return false; }
  }
  return { error, run };
}

function StateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <>
      <input className={inputClass} list="my-states" value={value} onChange={(e) => onChange(e.target.value)} placeholder="State" aria-label={label} />
      <datalist id="my-states">{MY_STATES.map((s) => <option key={s} value={s} />)}</datalist>
    </>
  );
}

function PropertyTypeSelect({ value, onChange, types, label }: { value: number | null; onChange: (v: number | null) => void; types: readonly PropertyType[]; label: string }) {
  return (
    <select className={inputClass} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label={label}>
      <option value="">No default type</option>
      {types.filter((t) => t.active || t.id === value).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

// ── Buildings ────────────────────────────────────────────────────────────

export function BuildingsManager() {
  const q = useQuery(["renovation", "buildings"], () => settingsApi.buildings());
  const types = usePropertyTypes();
  const { error, run } = useRun(q.reload);
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [pt, setPt] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const all = q.data?.data ?? [];
  const list = useMemo(() => {
    const w = search.trim().toUpperCase();
    return w ? all.filter((b) => b.name.includes(w) || (b.state ?? "").toUpperCase().includes(w)) : all;
  }, [all, search]);
  const shown = open || search ? list : list.slice(0, 8);

  return (
    <Box title="Buildings" hint="The buildings a new project picks from. The state and property type fill in on the project when the building is picked, and can be changed there.">
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      <div className="mb-3 grid grid-cols-1 sm:grid-cols-[1fr_9rem_10rem_auto] gap-2">
        <input className={inputClass} placeholder="Building name, e.g. SKYLINE KL" value={name} onChange={(e) => setName(e.target.value)} aria-label="New building name" />
        <StateInput value={state} onChange={setState} label="New building state" />
        <PropertyTypeSelect value={pt} onChange={setPt} types={types.data?.data ?? []} label="New building property type" />
        <Button icon={<Plus size={14} />} disabled={!name.trim()}
          onClick={() => run(async () => { await settingsApi.createBuilding({ name, state: state || null, propertyTypeId: pt }); setName(""); setState(""); setPt(null); })}>Add</Button>
      </div>
      <input className={inputClass + " mb-2 sm:max-w-xs"} placeholder={`Search ${all.length} buildings`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search buildings" />
      {q.loading && !q.data && <p className="text-sm text-ink-secondary">Loading...</p>}
      <ul className="divide-y divide-border">
        {shown.map((b) => <BuildingRow key={b.id} b={b} types={types.data?.data ?? []} onSave={(body) => run(() => settingsApi.patchBuilding(b.id, body))} />)}
        {!q.loading && list.length === 0 && <li className="py-2 text-sm text-ink-secondary">{all.length ? "No building matches." : "No buildings yet."}</li>}
      </ul>
      {!search && list.length > 8 && (
        <button type="button" className="mt-2 text-sm text-primary" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{open ? "Show fewer" : `Show all ${list.length}`}</button>
      )}
    </Box>
  );
}

function BuildingRow({ b, types, onSave }: { b: Building; types: readonly PropertyType[]; onSave: (body: Partial<{ name: string; state: string | null; propertyTypeId: number | null; active: boolean }>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(b.name);
  const [state, setState] = useState(b.state ?? "");
  const [pt, setPt] = useState<number | null>(b.property_type_id);
  if (editing) {
    return (
      <li className="py-2 grid grid-cols-1 sm:grid-cols-[1fr_9rem_10rem] gap-2">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label="Building name" />
        <StateInput value={state} onChange={setState} label="State" />
        <PropertyTypeSelect value={pt} onChange={setPt} types={types} label="Default property type" />
        <div className="flex gap-2 sm:col-span-3">
          <Button disabled={!name.trim()} onClick={async () => { if (await onSave({ name, state: state || null, propertyTypeId: pt })) setEditing(false); }}>Save</Button>
          <Button variant="secondary" onClick={() => { setName(b.name); setState(b.state ?? ""); setPt(b.property_type_id); setEditing(false); }}>Cancel</Button>
        </div>
      </li>
    );
  }
  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-2 py-1.5", !b.active && "opacity-60")}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{b.name}</div>
        <div className="text-[11px] text-ink-secondary">
          {[b.state ?? "No state", b.property_type_name ?? "No default type", b.project_count ? `${b.project_count} project${b.project_count === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="ghost" onClick={() => onSave({ active: !b.active })}>{b.active ? "Switch off" : "Switch on"}</Button>
      </div>
    </li>
  );
}

// ── Property types ───────────────────────────────────────────────────────

export function PropertyTypesManager() {
  const q = usePropertyTypes();
  const { error, run } = useRun(q.reload);
  const [name, setName] = useState("");
  const list = q.data?.data ?? [];
  return (
    <Box title="Property types" hint="Offered on a project and as a building's default type.">
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      <div className="mb-3 flex gap-2">
        <input className={inputClass} placeholder="New property type" value={name} onChange={(e) => setName(e.target.value)} aria-label="New property type" />
        <Button icon={<Plus size={14} />} disabled={!name.trim()} onClick={() => run(async () => { await settingsApi.createPropertyType(name.trim()); setName(""); })}>Add</Button>
      </div>
      <ul className="divide-y divide-border">
        {list.map((t) => <PropertyTypeRow key={t.id} t={t} onSave={(b) => run(() => settingsApi.patchPropertyType(t.id, b))} />)}
        {!q.loading && list.length === 0 && <li className="py-2 text-sm text-ink-secondary">No property types yet.</li>}
      </ul>
    </Box>
  );
}

function PropertyTypeRow({ t, onSave }: { t: PropertyType; onSave: (b: Partial<{ name: string; active: boolean }>) => Promise<boolean> }) {
  const [name, setName] = useState(t.name);
  return (
    <li className={cn("flex flex-wrap items-center gap-2 py-1.5", !t.active && "opacity-60")}>
      <input className={inputClass + " flex-1 min-w-[8rem]"} value={name} onChange={(e) => setName(e.target.value)} aria-label={`Name of ${t.name}`} />
      {name.trim() && name !== t.name && <Button variant="secondary" onClick={() => onSave({ name })}>Save</Button>}
      <label className="flex items-center gap-1 text-xs text-ink-secondary"><input type="checkbox" checked={t.active} onChange={(e) => onSave({ active: e.target.checked })} />On</label>
    </li>
  );
}

// ── Contractors ──────────────────────────────────────────────────────────

export function ContractorsManager() {
  const q = useQuery(["renovation", "contractors"], () => settingsApi.contractors());
  const { error, run } = useRun(q.reload);
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [supplierQ, setSupplierQ] = useState("");
  const [linking, setLinking] = useState(false);
  const opts = useQuery(["renovation", "contractor-suppliers", supplierQ], () => settingsApi.supplierOptions(supplierQ), [supplierQ, linking], { enabled: linking });
  const list = q.data?.data ?? [];

  return (
    <Box title="Contractors" hint="Subcontractors and outside suppliers who do site work. Each one is also a supplier in Procurement, so a purchase order can be raised to it from the sales order. In-house crew are people (role Site crew), not contractors.">
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      <div className="mb-3 grid grid-cols-1 sm:grid-cols-[1fr_10rem_auto] gap-2">
        <input className={inputClass} placeholder="Contractor name, e.g. YILLON" value={name} onChange={(e) => setName(e.target.value)} aria-label="New contractor name" />
        <input className={inputClass} placeholder="Trade, e.g. Carpentry" value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="New contractor trade" />
        <Button icon={<Plus size={14} />} disabled={!name.trim()}
          onClick={() => run(async () => { await settingsApi.createContractor({ name, trade: trade || null, supplierId: linkTo || null }); setName(""); setTrade(""); setLinkTo(""); setLinking(false); })}>Add</Button>
      </div>
      <div className="mb-3 text-xs text-ink-secondary">
        {!linking
          ? <button type="button" className="text-primary" onClick={() => setLinking(true)}>Already a supplier? Link it instead of creating a new one</button>
          : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input className={inputClass} placeholder="Search suppliers" value={supplierQ} onChange={(e) => setSupplierQ(e.target.value)} aria-label="Search suppliers to link" />
              <select className={inputClass} value={linkTo} onChange={(e) => { setLinkTo(e.target.value); const s = opts.data?.data.find((x) => x.id === e.target.value); if (s && !name.trim()) setName(s.name); }} aria-label="Supplier to link">
                <option value="">New supplier (code SC-NAME)</option>
                {(opts.data?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </select>
            </div>
          )}
      </div>
      {q.loading && !q.data && <p className="text-sm text-ink-secondary">Loading...</p>}
      <ul className="divide-y divide-border">
        {list.map((k) => <ContractorRow key={k.id} k={k} onSave={(b) => run(() => settingsApi.patchContractor(k.id, b))} />)}
        {!q.loading && list.length === 0 && <li className="py-2 text-sm text-ink-secondary">No contractors yet.</li>}
      </ul>
    </Box>
  );
}

function ContractorRow({ k, onSave }: { k: Contractor; onSave: (b: Partial<{ name: string; trade: string | null; active: boolean }>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(k.name);
  const [trade, setTrade] = useState(k.trade ?? "");
  if (editing) {
    return (
      <li className="py-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label="Contractor name" />
        <input className={inputClass} value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Trade" aria-label="Trade" />
        <div className="flex gap-2 sm:col-span-2">
          <Button disabled={!name.trim()} onClick={async () => { if (await onSave({ name, trade: trade || null })) setEditing(false); }}>Save</Button>
          <Button variant="secondary" onClick={() => { setName(k.name); setTrade(k.trade ?? ""); setEditing(false); }}>Cancel</Button>
        </div>
      </li>
    );
  }
  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-2 py-1.5", !k.active && "opacity-60")}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{k.name}{k.trade ? <span className="ml-2 text-[12px] font-normal text-ink-secondary">{k.trade}</span> : null}</div>
        <div className="text-[11px] text-ink-secondary">Supplier {k.supplier_code ?? "?"}{k.supplier_name && k.supplier_name !== k.name ? ` · ${k.supplier_name}` : ""}</div>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="ghost" onClick={() => onSave({ active: !k.active })}>{k.active ? "Switch off" : "Switch on"}</Button>
      </div>
    </li>
  );
}
