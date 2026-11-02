// Conts only: the project and unit pickers on a payment voucher and an AP invoice (chew 2 Nov 2026: "选 project 时无法
// 快速打关键字眼", "做成 table"; SOP 3.2; plan 2026-11-02-voucher-purpose-unit-project-pickers.md Task 3). A button
// shows what is chosen; it opens a searchable table. Projects not yet done first, newest first; the completed ones
// below, still pickable; test projects last.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Modal } from "../vendor/scm/components/Modal";
import { useProjectOptions, useUnitOptions, type ProjectOption } from "./projectLimitQueries";
import { cleanProjectName, contractStatusLabel, projectRows, unitRows, type PickProject, type PickUnit } from "./pickerRows";

const MUTED = "var(--fg-muted)";
const cell: CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--line, rgba(34,31,32,0.12))", textAlign: "left", whiteSpace: "nowrap" };
const head: CSSProperties = { ...cell, position: "sticky", top: 0, background: "var(--c-paper, #fff)", fontSize: "var(--fs-12)", color: MUTED, fontWeight: 600 };
const section: CSSProperties = { ...cell, background: "var(--c-surface-2, rgba(0,0,0,0.03))", fontSize: "var(--fs-12)", fontWeight: 700, color: MUTED };
const day = (v: string | null): string => {
  if (!v) return "—";
  const t = Date.parse(v.length <= 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? new Date(t + (v.length <= 10 ? 0 : 8 * 3_600_000)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
};

function PickerButton({ label, placeholder, disabled, onOpen, onClear, inputClass, ariaLabel }: {
  label: string | null; placeholder: string; disabled?: boolean; onOpen: () => void; onClear?: () => void; inputClass?: string; ariaLabel: string;
}) {
  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
      <button type="button" aria-label={ariaLabel} className={inputClass} disabled={disabled} onClick={onOpen}
        style={{ flex: 1, minWidth: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: disabled ? "default" : "pointer", color: label ? undefined : MUTED }}>
        {label ?? placeholder}
      </button>
      {label && onClear && !disabled && (
        <button type="button" aria-label={`Clear ${ariaLabel.toLowerCase()}`} onClick={onClear} style={{ border: "none", background: "none", cursor: "pointer", color: MUTED, padding: 4 }}>×</button>
      )}
    </span>
  );
}

function PickerModal({ title, query, setQuery, onClose, placeholder, children }: {
  title: string; query: string; setQuery: (q: string) => void; onClose: () => void; placeholder: string; children: ReactNode;
}) {
  return (
    <Modal title={title} ariaLabel={title} onClose={onClose} width="min(880px, 100%)">
      <input autoFocus aria-label="Search" placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)}
        style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line, rgba(34,31,32,0.2))", borderRadius: 6, fontSize: "var(--fs-14)", background: "transparent", color: "inherit" }} />
      <div style={{ maxHeight: "60vh", overflow: "auto", border: "1px solid var(--line, rgba(34,31,32,0.12))", borderRadius: 6 }}>
        {children}
      </div>
    </Modal>
  );
}

/** The project label everywhere it shows: the name without "SO - ", then the code. */
export const projectLabel = (p: Pick<ProjectOption, "name" | "code">): string => `${cleanProjectName(p.name)}${p.code ? ` · ${p.code}` : ""}`;

export function ProjectPicker({ value, onChange, disabled, inputClass, placeholder = "Choose a project…", ariaLabel = "Project" }: {
  value: number | null; onChange: (id: number | null) => void; disabled?: boolean; inputClass?: string; placeholder?: string; ariaLabel?: string;
}) {
  const q = useProjectOptions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const all = (q.data?.projects ?? []) as PickProject[] & ProjectOption[];
  const chosen = value == null ? null : all.find((p) => p.id === value) ?? null;
  const groups = useMemo(() => projectRows(all, query), [all, query]);
  const pick = (id: number) => { onChange(id); setOpen(false); setQuery(""); };
  const row = (p: PickProject, tag?: string) => (
    <tr key={p.id} onClick={() => pick(p.id)} style={{ cursor: "pointer", background: p.id === value ? "var(--c-accent-soft, rgba(47,93,79,0.10))" : undefined }}
      onKeyDown={(e) => { if (e.key === "Enter") pick(p.id); }} tabIndex={0} aria-label={cleanProjectName(p.name)}>
      <td style={{ ...cell, fontWeight: 600, whiteSpace: "normal" }}>{cleanProjectName(p.name)}{tag && <span style={{ marginLeft: 6, fontSize: "var(--fs-11)", color: MUTED, border: `1px solid ${MUTED}`, borderRadius: 4, padding: "0 4px" }}>{tag}</span>}</td>
      <td style={{ ...cell, whiteSpace: "normal" }}>{p.customer_name ?? "—"}</td>
      <td style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)" }}>{p.code ?? "—"}</td>
      <td style={cell}>{contractStatusLabel(p)}</td>
      <td style={{ ...cell, fontVariantNumeric: "tabular-nums" }}>{day(p.handed_over_at ?? p.planned_handover_date)}</td>
    </tr>
  );
  const empty = groups.open.length + groups.completed.length + groups.test.length === 0;
  return (
    <>
      <PickerButton ariaLabel={ariaLabel} label={chosen ? projectLabel(chosen) : value != null ? `Project ${value}` : null} placeholder={placeholder}
        disabled={disabled} inputClass={inputClass} onOpen={() => setOpen(true)} onClear={() => onChange(null)} />
      {open && (
        <PickerModal title="Choose a project" query={query} setQuery={setQuery} onClose={() => setOpen(false)} placeholder="Project, customer or code">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
            <thead><tr><th style={head}>Project</th><th style={head}>Customer</th><th style={head}>Code</th><th style={head}>Status</th><th style={head}>Handover</th></tr></thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={5} style={{ ...cell, color: MUTED }}>Loading…</td></tr>}
              {!q.isLoading && empty && <tr><td colSpan={5} style={{ ...cell, color: MUTED }}>No project matches.</td></tr>}
              {groups.open.map((p) => row(p))}
              {groups.completed.length > 0 && <tr><td colSpan={5} style={section}>Completed</td></tr>}
              {groups.completed.map((p) => row(p))}
              {groups.test.length > 0 && <tr><td colSpan={5} style={section}>Test</td></tr>}
              {groups.test.map((p) => row(p, "Test"))}
            </tbody>
          </table>
        </PickerModal>
      )}
    </>
  );
}

export const unitLabel = (u: PickUnit): string => `${u.building} ${u.unitNumber}`.trim();

/** A unit's building and number, on a voucher line on screen (nothing when none). */
export function UnitName({ id }: { id: string | null | undefined }) {
  const q = useUnitOptions();
  if (!id) return null;
  const u = (q.data?.units ?? []).find((x) => x.id === id);
  return <>{u ? unitLabel(u) : "Unit"}</>;
}

export function UnitPicker({ value, onChange, disabled, inputClass, ariaLabel = "Unit" }: {
  value: string | null; onChange: (id: string | null) => void; disabled?: boolean; inputClass?: string; ariaLabel?: string;
}) {
  const q = useUnitOptions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const all = q.data?.units ?? [];
  const chosen = value == null ? null : all.find((u) => u.id === value) ?? null;
  const rows = useMemo(() => unitRows(all, query), [all, query]);
  const pick = (id: string) => { onChange(id); setOpen(false); setQuery(""); };
  return (
    <>
      <PickerButton ariaLabel={ariaLabel} label={chosen ? unitLabel(chosen) : value ? "Unit" : null} placeholder="No unit"
        disabled={disabled} inputClass={inputClass} onOpen={() => setOpen(true)} onClear={() => onChange(null)} />
      {open && (
        <PickerModal title="Choose a unit" query={query} setQuery={setQuery} onClose={() => setOpen(false)} placeholder="Building or unit, e.g. A-3-1">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
            <thead><tr><th style={head}>Building</th><th style={head}>Unit</th></tr></thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={2} style={{ ...cell, color: MUTED }}>Loading…</td></tr>}
              {!q.isLoading && rows.length === 0 && <tr><td colSpan={2} style={{ ...cell, color: MUTED }}>No unit matches.</td></tr>}
              {rows.map((u) => (
                <tr key={u.id} onClick={() => pick(u.id)} tabIndex={0} aria-label={unitLabel(u)} onKeyDown={(e) => { if (e.key === "Enter") pick(u.id); }}
                  style={{ cursor: "pointer", background: u.id === value ? "var(--c-accent-soft, rgba(47,93,79,0.10))" : undefined }}>
                  <td style={cell}>{u.building}</td>
                  <td style={{ ...cell, fontWeight: 600 }}>{u.unitNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PickerModal>
      )}
    </>
  );
}
