/* The one customer block the renovation sales order and the project share (owner,
   14 Oct 2026: "the project and the sales order must ask for exactly the same
   information"; migrations 0112, 0115). Three sections, the same fields, order,
   labels and required marks everywhere it is used:

     Customer           Customer name *, Phone *, Email, Salesperson
     Delivery address   Address line 1 *, Address line 2, State, City, Postcode, Country, Sales location
     Order information  Project, Start date, End date, Building, Unit, Property type *, Layout *, Built-up sq ft *

   Used by New SO and Edit SO (renovation mode), the New project form, the project's
   Customer info Edit dialog, and read-only (`readOnly`) by the project's Customer
   info card. The required list and the two-way sync rule live in
   vendor/shared/renovation-property.ts, the same file the server runs. */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { PhoneInput } from "../../../vendor/scm/components/PhoneInput";
import { StatePicker } from "../../../vendor/scm/components/StatePicker";
import { SearchableSelect } from "../../../vendor/scm/components/SearchableSelect";
import { AddressPostcodeField } from "../../../vendor/scm/components/AddressPostcodeField";
import { useLocalities, countryForState } from "../../../vendor/scm/lib/localities-queries";
import { useAddressCascade, pickState, pickCity, pickPostcode, cityPlaceholder, postcodePlaceholder } from "../../../vendor/scm/lib/address-cascade";
import { useStateWarehouseMappings } from "../../../vendor/scm/lib/state-warehouse-queries";
import { usePickableStaff } from "../../../vendor/scm/lib/admin-queries";
import { soInfoApi } from "./customerPropertyApi";
import {
  applyLayout,
  layoutFor,
  projectGaps,
  showDate,
  type CustomerPropertyValue,
  type ProjectShared,
  type PropertyLists,
} from "./customerPropertyModel";

const input = "h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-dim disabled:text-ink-secondary";
const ring = "border-err ring-2 ring-err/15";
const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-wide";

function Cell({ label, required, missing, className, children, htmlFor }: {
  label: string; required?: boolean; missing?: boolean; className?: string; children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className={cn(labelCls, missing ? "text-err" : "text-ink-secondary")}>
        {label}{required && <span className="text-err"> *</span>}
      </label>
      {children}
    </div>
  );
}

function ReadOnly({ children }: { children: ReactNode }) {
  return <div className="flex h-9 min-w-0 items-center truncate rounded-md border border-dashed border-border bg-surface-dim px-2.5 text-sm text-ink-secondary">{children}</div>;
}

function Section({ title, children, note, compact }: { title: string; children: ReactNode; note?: ReactNode; compact?: boolean }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-surface", compact ? "p-3" : "p-3 sm:p-4")}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink">{title}</h3>
        {note}
      </div>
      {children}
    </section>
  );
}

/** Search renovation projects by code, name, building or customer; picking one fills the block. */
function ProjectPicker({ value, project, onPick, disabled, id }: {
  value: number | null; project: ProjectShared | null; onPick: (p: ProjectShared | null) => void; disabled?: boolean; id: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProjectShared[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState("loading");
    const t = setTimeout(() => {
      soInfoApi.projects(q.trim())
        .then((r) => { if (live) { setRows(r.data); setState("idle"); } })
        .catch(() => { if (live) setState("error"); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (value != null && !open) {
    return (
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm">
        <span className="min-w-0 flex-1 truncate">
          {project ? <><span className="font-semibold">{project.code ?? `#${project.id}`}</span> · {project.name}</> : `Project #${value}`}
        </span>
        {!disabled && (
          <>
            <button type="button" className="text-xs font-semibold text-primary" onClick={() => { setQ(""); setOpen(true); }}>Change</button>
            <button type="button" aria-label="Remove the project" className="text-ink-secondary hover:text-ink" onClick={() => onPick(null)}><X size={14} /></button>
          </>
        )}
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-secondary" />
        <input
          id={id}
          className={cn(input, "pl-8")}
          placeholder="Search project, building or customer"
          value={q}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          autoComplete="off"
        />
      </div>
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {state === "loading" && rows.length === 0 && <li className="px-3 py-2 text-sm text-ink-secondary">Searching...</li>}
          {state === "error" && <li className="px-3 py-2 text-sm text-err">Projects could not be loaded. Try again.</li>}
          {state !== "error" && rows.length === 0 && state !== "loading" && <li className="px-3 py-2 text-sm text-ink-secondary">No project matches. Create it under Projects first.</li>}
          {rows.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={p.id === value}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-primary-soft"
                onClick={() => { onPick(p); setOpen(false); }}
              >
                <span className="font-semibold">{p.code ?? `#${p.id}`}</span> · {p.name}
                <span className="block truncate text-xs text-ink-secondary">{[p.building, p.unitNo, p.customerName].filter(Boolean).join(" · ") || "No building or customer yet"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


export interface CustomerBlockProps {
  /** "so": the Project field picks a project; "project": it names the project itself. */
  mode: "so" | "project";
  value: CustomerPropertyValue;
  onChange: (next: CustomerPropertyValue) => void;
  lists: PropertyLists | undefined;
  /** SO: the picked project (its name, dates, and what it has no details for). Project: the project itself, null when new. */
  project?: ProjectShared | null;
  onPickProject?: (p: ProjectShared | null) => void;
  /** Required fields still missing, by their check name (REQUIRED_FIELDS): ringed red. */
  missing?: ReadonlySet<string>;
  disabled?: boolean;
  /** Fields that stay locked while the rest is editable (an SO whose delivery order already went out). */
  lockedKeys?: ReadonlySet<keyof CustomerPropertyValue>;
  readOnly?: boolean;
  /** Only managers may give an order to another salesperson (the SO's own rule); the project lets anyone with edit rights. */
  canChangeSalesperson?: boolean;
  /** Before migration 0112: no property lists, so the property fields are left out. */
  hideProperty?: boolean;
  /** "columns": Customer and Delivery address on the left, Order information on the right (wide pages). */
  arrangement?: "columns" | "stack";
  /** Extra content under the Order information grid (the SO's own note, nothing on the project). */
  orderInfoFooter?: ReactNode;
}

export function CustomerBlock({
  mode, value, onChange, lists, project, onPickProject, missing, disabled, lockedKeys, readOnly = false,
  canChangeSalesperson = true, hideProperty = false, arrangement = "stack", orderInfoFooter,
}: CustomerBlockProps) {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const set = (patch: Partial<CustomerPropertyValue>) => onChange({ ...value, ...patch });
  const miss = (label: string) => !!missing?.has(label);
  const off = (k: keyof CustomerPropertyValue) => disabled || !!lockedKeys?.has(k);
  const layouts = lists?.layouts ?? [];
  const types = lists?.propertyTypes ?? [];
  const pickedLayout = layoutFor(value, layouts);
  const typeOptions = types.filter((t) => t.active || t.label === value.propertyType);
  const typeMissingFromList = value.propertyType && !types.some((t) => t.label === value.propertyType);
  const layoutOptions = layouts.filter((l) => l.active || l.id === pickedLayout?.id);

  /* Address: the same locality cascade the sales order uses (scm.my_localities). */
  const loc = useLocalities();
  const rows = useMemo(() => loc.data ?? [], [loc.data]);
  const { cities, postcodes } = useAddressCascade(rows, value.state, value.city);
  const triple = { state: value.state, city: value.city, postcode: value.postcode };
  const country = (value.state ? countryForState(rows, value.state) : null) ?? (value.country || "Malaysia");
  const mappings = useStateWarehouseMappings();
  const salesLocation = useMemo(() => {
    if (!value.state) return value.salesLocation;
    const hit = (mappings.data?.mappings ?? []).find((m) => m.state === value.state);
    return hit?.warehouse?.code ?? value.salesLocation;
  }, [mappings.data, value.state, value.salesLocation]);
  /* Country and Sales location follow the State, as on the sales order. */
  useEffect(() => {
    if (readOnly) return;
    if (country !== value.country || salesLocation !== value.salesLocation) onChange({ ...value, country, salesLocation });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when what they derive from changes
  }, [country, salesLocation, readOnly]);

  const staff = usePickableStaff({ onlySales: true, include: [value.salespersonId] });
  const staffRows = (staff.data ?? []).filter((s) => s.active || s.id === value.salespersonId);
  const staffName = (sid: string) => {
    const s = staffRows.find((x) => x.id === sid);
    return s ? `${s.name} (${s.staffCode})` : sid && project?.salespersonId === sid ? project.salespersonName : "";
  };

  const gaps = mode === "so" && project ? projectGaps(project) : [];
  const projectLabel = project ? `${project.code ?? `#${project.id}`} · ${project.name}` : mode === "project" ? "New project" : "";
  const startDate = project?.startDate ?? null;
  const endDate = project?.endDate ?? null;
  const layoutText = value.layoutLabel || (value.bedrooms !== "" ? `${value.bedrooms} bed ${value.bathrooms} bath` : "");

  /* Read-only: the same sections, fields, order and labels, as text. */
  if (readOnly) {
    const T = ({ label, v, wide }: { label: string; v: ReactNode; wide?: boolean }) => (
      <div className={cn("min-w-0", wide && "col-span-2")}>
        <div className={cn(labelCls, "text-ink-secondary")}>{label}</div>
        <div className="break-words text-sm text-ink">{v || <span className="text-ink-secondary">Not set</span>}</div>
      </div>
    );
    return (
      <div className="space-y-3">
        <Section title="Customer" compact>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <T label="Customer name" v={value.customerName} wide />
            <T label="Phone" v={value.customerPhone} />
            <T label="Email" v={value.customerEmail} />
            <T label="Salesperson" v={staffName(value.salespersonId) || project?.salespersonName} wide />
          </div>
        </Section>
        <Section title="Delivery address" compact>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <T label="Address line 1" v={value.address1} wide />
            <T label="Address line 2" v={value.address2} wide />
            <T label="State" v={value.state} />
            <T label="City" v={value.city} />
            <T label="Postcode" v={value.postcode} />
            <T label="Country" v={value.country} />
            <T label="Sales location" v={value.salesLocation} wide />
          </div>
        </Section>
        <Section title="Order information" compact>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <T label="Project" v={projectLabel} wide />
            <T label="Start date" v={startDate ? showDate(startDate) : ""} />
            <T label="End date" v={endDate ? showDate(endDate) : ""} />
            <T label="Building" v={value.building} />
            <T label="Unit" v={value.unitNo} />
            {!hideProperty && (
              <>
                <T label="Property type" v={value.propertyType} />
                <T label="Layout" v={layoutText} />
                <T label="Built-up sq ft" v={value.builtUpSqft ? `${Number(value.builtUpSqft).toLocaleString("en-MY")} sq ft` : ""} />
              </>
            )}
          </div>
        </Section>
      </div>
    );
  }

  const customer = (
    <Section title="Customer">
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
        <Cell label="Customer name" required missing={miss("Customer name")} className="col-span-2" htmlFor={id("name")}>
          <input id={id("name")} className={cn(input, miss("Customer name") && ring)} value={value.customerName} disabled={off("customerName")}
            placeholder="e.g. Lim Mei Hua" onChange={(e) => set({ customerName: e.target.value })} />
        </Cell>
        <Cell label="Phone" required missing={miss("Phone number")} className="col-span-2">
          <div className={cn(miss("Phone number") && "rounded-md ring-2 ring-err/30")}>
            <PhoneInput className={input} value={value.customerPhone} onChange={(v) => set({ customerPhone: v })} disabled={off("customerPhone")} aria-label="Phone" />
          </div>
        </Cell>
        <Cell label="Email" className="col-span-2" htmlFor={id("email")}>
          <input id={id("email")} type="email" className={input} value={value.customerEmail} disabled={off("customerEmail")}
            placeholder="customer@example.com" onChange={(e) => set({ customerEmail: e.target.value })} />
        </Cell>
        <Cell label="Salesperson" className="col-span-2" htmlFor={id("sales")}>
          <select id={id("sales")} className={input} value={value.salespersonId} disabled={off("salespersonId") || !canChangeSalesperson}
            onChange={(e) => set({ salespersonId: e.target.value })}>
            <option value="">{staff.isLoading ? "Loading..." : "Not set"}</option>
            {value.salespersonId && !staffRows.some((s) => s.id === value.salespersonId) && (
              <option value={value.salespersonId}>{project?.salespersonName || "Former staff"}</option>
            )}
            {staffRows.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.staffCode})</option>)}
          </select>
        </Cell>
      </div>
    </Section>
  );

  const address = (
    <Section title="Delivery address">
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
        <Cell label="Address line 1" required missing={miss("Address line 1")} className="col-span-2 sm:col-span-4" htmlFor={id("a1")}>
          <input id={id("a1")} className={cn(input, miss("Address line 1") && ring)} value={value.address1} disabled={off("address1")}
            placeholder="Unit, street, area" onChange={(e) => set({ address1: e.target.value })} />
        </Cell>
        <Cell label="Address line 2" className="col-span-2 sm:col-span-4" htmlFor={id("a2")}>
          <input id={id("a2")} className={input} value={value.address2} disabled={off("address2")}
            placeholder="Apt, floor, building (optional)" onChange={(e) => set({ address2: e.target.value })} />
        </Cell>
        <Cell label="State" className="col-span-2">
          <StatePicker value={value.state} selectClassName={input} disabled={off("state")}
            onChange={(next) => onChange({ ...value, ...pickState(next) })} />
        </Cell>
        <Cell label="City" className="col-span-2">
          <SearchableSelect className={input} value={value.city} disabled={off("city") || loc.isLoading} ariaLabel="City"
            placeholder={loc.isLoading ? "Loading..." : cityPlaceholder(value.state)}
            options={cities.map((c) => ({ value: c, label: c }))}
            onChange={(c) => onChange({ ...value, ...pickCity(rows, triple, c) })} />
        </Cell>
        <div className="col-span-2 min-w-0">
          <AddressPostcodeField
            country={country}
            value={value.postcode}
            onChange={(v) => set({ postcode: v })}
            onCascadePick={(pc) => onChange({ ...value, ...pickPostcode(rows, triple, pc) })}
            onResolve={(r) => onChange({ ...value, address1: r.address || value.address1, ...(r.state && r.city ? { state: r.state, city: r.city } : {}) })}
            postcodeChoices={postcodes}
            placeholder={loc.isLoading ? "Loading..." : postcodePlaceholder(value.state, value.city)}
            disabled={off("postcode") || loc.isLoading}
            classes={{ field: "block min-w-0", label: cn(labelCls, "text-ink-secondary"), select: input, input, selectWrap: "relative block", chevron: "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-secondary" }}
          />
        </div>
        <Cell label="Country">
          <ReadOnly>{country}</ReadOnly>
        </Cell>
        <Cell label="Sales location">
          <ReadOnly>{salesLocation || "—"}</ReadOnly>
        </Cell>
      </div>
    </Section>
  );

  const orderInfo = (
    <Section
      title="Order information"
      note={mode === "so" ? <span className="text-[11px] text-ink-secondary">Shared with the project</span> : undefined}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
        <Cell label="Project" className="col-span-2" htmlFor={id("project")}>
          {mode === "so"
            ? <ProjectPicker id={id("project")} value={value.projectId} project={project ?? null} onPick={(p) => onPickProject?.(p)} disabled={disabled} />
            : <ReadOnly>{projectLabel}</ReadOnly>}
          {gaps.length > 0 && (
            <p className="mt-1 text-[11px] text-ink-secondary">
              This project has no {gaps.join(", ")} details yet. What you type here will be saved to it.
            </p>
          )}
        </Cell>
        <Cell label="Start date"><ReadOnly>{startDate ? showDate(startDate) : mode === "so" && !project ? "Pick a project" : "Not set"}</ReadOnly></Cell>
        <Cell label="End date"><ReadOnly>{endDate ? showDate(endDate) : mode === "so" && !project ? "Pick a project" : "Not set"}</ReadOnly></Cell>
        <Cell label="Building" className="col-span-2" htmlFor={id("building")}>
          <input id={id("building")} className={input} value={value.building} disabled={off("building")} placeholder="e.g. Skyline Residence"
            onChange={(e) => set({ building: e.target.value })} />
        </Cell>
        <Cell label="Unit" htmlFor={id("unit")}>
          <input id={id("unit")} className={input} value={value.unitNo} disabled={off("unitNo")} placeholder="A-12-3"
            onChange={(e) => set({ unitNo: e.target.value })} />
        </Cell>
        {!hideProperty && (
          <>
            <Cell label="Property type" required missing={miss("Property type")} htmlFor={id("ptype")}>
              <select id={id("ptype")} className={cn(input, miss("Property type") && ring)} value={value.propertyType} disabled={off("propertyType")}
                onChange={(e) => set({ propertyType: e.target.value })}>
                <option value="">Choose...</option>
                {typeMissingFromList && <option value={value.propertyType}>{value.propertyType}</option>}
                {typeOptions.map((t) => <option key={t.id} value={t.label}>{t.label}{t.active ? "" : " (off)"}</option>)}
              </select>
            </Cell>
            <Cell label="Layout" required missing={miss("Layout")} className="col-span-2" htmlFor={id("layout")}>
              <select id={id("layout")} className={cn(input, miss("Layout") && ring)} disabled={off("layoutLabel")}
                value={pickedLayout ? String(pickedLayout.id) : value.layoutLabel ? "custom" : ""}
                onChange={(e) => {
                  if (e.target.value === "custom") return;
                  onChange(applyLayout(value, layouts.find((l) => String(l.id) === e.target.value) ?? null));
                }}>
                <option value="">Choose...</option>
                {!pickedLayout && value.layoutLabel && <option value="custom">{value.layoutLabel}</option>}
                {layoutOptions.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </Cell>
            <Cell label="Built-up sq ft" required missing={miss("Built-up sq ft")} htmlFor={id("sqft")}>
              <input id={id("sqft")} inputMode="decimal" className={cn(input, miss("Built-up sq ft") && ring)} value={value.builtUpSqft}
                disabled={off("builtUpSqft")} placeholder="e.g. 1,100" onChange={(e) => set({ builtUpSqft: e.target.value.replace(/[^\d.,]/g, "") })} />
            </Cell>
          </>
        )}
      </div>
      {orderInfoFooter}
    </Section>
  );

  if (arrangement === "columns") {
    return (
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-3">{customer}{address}</div>
        <div className="min-w-0">{orderInfo}</div>
      </div>
    );
  }
  return <div className="flex min-w-0 flex-col gap-3">{customer}{address}{orderInfo}</div>;
}
