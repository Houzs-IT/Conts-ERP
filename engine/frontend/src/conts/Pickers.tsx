// Conts only: the project and unit pickers on a payment voucher and an AP invoice (chew 2 Nov 2026: "选 project 时无法
// 快速打关键字眼", "做成 table"; SOP 3.2; plan 2026-11-02-voucher-purpose-unit-project-pickers.md Task 3). The field
// shows what is chosen; it opens a searchable table. Projects not yet done first, newest first; the completed ones
// below, still pickable; test projects last. Like AutoCount's Proj. No. list (chew 3 Nov 2026: "可能是往下显示", "我希望
// 一点开就直接能search"): the field itself is the search box, the table drops down under it, arrows and Enter pick,
// Esc, Tab or a click outside close it. On a phone it opens as the full box with its own search.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../vendor/scm/components/Modal";
import { placePanel, type Placement } from "./pickerPlace";
import { useProjectOptions, useUnitOptions, type ProjectOption } from "./projectLimitQueries";
import { cleanProjectName, contractStatusLabel, projectRows, unitRows, type PickProject, type PickUnit } from "./pickerRows";

const MUTED = "var(--fg-muted)";
const LINE = "var(--line, rgba(34,31,32,0.2))";
const HIGHLIGHT = "var(--c-accent-soft, rgba(47,93,79,0.10))";
const cell: CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--line, rgba(34,31,32,0.12))", textAlign: "left", whiteSpace: "nowrap" };
const head: CSSProperties = { ...cell, position: "sticky", top: 0, background: "var(--c-paper, #fff)", fontSize: "var(--fs-12)", color: MUTED, fontWeight: 600 };
const section: CSSProperties = { ...cell, background: "var(--c-surface-2, rgba(0,0,0,0.03))", fontSize: "var(--fs-12)", fontWeight: 700, color: MUTED };
const searchStyle: CSSProperties = { width: "100%", padding: "8px 10px", border: `1px solid ${LINE}`, borderRadius: 6, fontSize: "var(--fs-14)", background: "transparent", color: "inherit" };
const clearStyle: CSSProperties = { padding: "4px 14px", border: `1px solid ${LINE}`, borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer", fontSize: "var(--fs-13)" };
const listBox: CSSProperties = { overflow: "auto", border: "1px solid var(--line, rgba(34,31,32,0.12))", borderRadius: 6 };
/** Below this window width the list opens as the full box: no room for a drop-down beside the field. */
const PHONE = 640;
const day = (v: string | null): string => {
  if (!v) return "—";
  const t = Date.parse(v.length <= 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? new Date(t + (v.length <= 10 ? 0 : 8 * 3_600_000)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
};

/** One picker's state: open or not, the search, the highlighted row (moved by the arrow keys; it starts on the chosen
    row, and goes to the first match whenever the search changes or the rows arrive), and picking. */
function usePicker<T>(ids: T[], value: T | null, onChange: (id: T | null) => void, query: string, setQuery: (q: string) => void) {
  const [open, setOpenState] = useState(false);
  const [phone, setPhone] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) return;
    const at = query === "" && value != null ? ids.indexOf(value) : -1;
    setActive(at >= 0 ? at : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on opening, on a new search, and when the rows arrive
  }, [open, query, ids.length > 0]);
  const openList = () => { if (!open) { setPhone(window.innerWidth < PHONE); setOpenState(true); } };
  const close = () => { setOpenState(false); setQuery(""); };
  const pick = (id: T | null) => { onChange(id); close(); };
  const at = Math.min(active, Math.max(ids.length - 1, 0));
  /* The arrow keys, Enter and Esc, from the field (or the phone box's search). While the list is open every key stops
     here: Esc must not also close a box the picker sits in, nor Insert add a line to the table behind it. */
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); openList(); }
      return;
    }
    e.stopPropagation();
    if (e.key === "ArrowDown") { e.preventDefault(); if (ids.length > 0) setActive(Math.min(at + 1, ids.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(at - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (ids.length > 0) pick(ids[at]!); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close();
  };
  return { open, phone, openList, close, pick, active: at, setActive, onKey };
}

type Picker = ReturnType<typeof usePicker<never>> & { pick: (id: never) => void };

/** The field: the chosen label while closed; the search box while open, the chosen label then showing as its hint. */
function PickerField({ pk, label, placeholder, query, setQuery, disabled, inputClass, ariaLabel, anchorRef, onClear }: {
  pk: Omit<Picker, "pick">; label: string | null; placeholder: string; query: string; setQuery: (q: string) => void; disabled?: boolean;
  inputClass?: string; ariaLabel: string; anchorRef: RefObject<HTMLSpanElement | null>; onClear: () => void;
}) {
  const searching = pk.open && !pk.phone;
  return (
    <span ref={anchorRef} style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
      <input type="text" role="combobox" aria-label={ariaLabel} aria-expanded={pk.open} aria-autocomplete="list" autoComplete="off"
        className={inputClass} disabled={disabled} readOnly={pk.phone && pk.open}
        value={searching ? query : label ?? ""} placeholder={searching ? label ?? placeholder : placeholder}
        onFocus={() => { if (window.innerWidth >= PHONE) pk.openList(); }}
        onClick={pk.openList}
        onChange={(e) => {
          /* Typing after Esc (the label showing again) searches for what was typed, not the label plus it. */
          const v = e.target.value;
          setQuery(!pk.open && label && v.startsWith(label) ? v.slice(label.length) : v);
          pk.openList();
        }}
        onKeyDown={pk.onKey}
        onBlur={() => { if (!pk.phone) pk.close(); }}
        style={{ flex: 1, minWidth: 0, textOverflow: "ellipsis" }} />
      {label && !disabled && !pk.open && (
        <button type="button" aria-label={`Clear ${ariaLabel.toLowerCase()}`} onClick={onClear} style={{ border: "none", background: "none", cursor: "pointer", color: MUTED, padding: 4 }}>×</button>
      )}
    </span>
  );
}

/** The table, dropped down under the field (or the full box, with its own search, on a phone). */
function PickerPanel({ pk, title, placeholder, anchorRef, wantWidth, query, setQuery, onClear, children }: {
  pk: Omit<Picker, "pick">; title: string; placeholder: string; anchorRef: RefObject<HTMLSpanElement | null>; wantWidth: number;
  query: string; setQuery: (q: string) => void; onClear: (() => void) | null; children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const closeRef = useRef(pk.close);
  closeRef.current = pk.close;
  const { phone, active } = pk;

  useLayoutEffect(() => {
    if (phone) return;
    const measure = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      /* The field scrolled out of sight: the list goes with it rather than float over something else. */
      if (r && (r.bottom < 0 || r.top > window.innerHeight)) { closeRef.current(); return; }
      if (r) setPlace(placePanel({ top: r.top, bottom: r.bottom, left: r.left, width: r.width }, { width: window.innerWidth, height: window.innerHeight }, wantWidth));
    };
    measure();
    /* Follow the field when the page scrolls or the window changes size; scrolling the list itself moves nothing. */
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) measure(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !anchorRef.current?.contains(t)) closeRef.current();
    };
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [phone, anchorRef, wantWidth]);

  /* Keep the highlighted row in sight. */
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active, place]);

  const clear = onClear && <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" onClick={onClear} style={clearStyle}>Clear</button></div>;

  if (phone) {
    return (
      <Modal title={title} ariaLabel={title} onClose={pk.close} width="min(880px, 100%)">
        <div onKeyDown={pk.onKey} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input autoFocus aria-label="Search" placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} style={searchStyle} />
          <div ref={panelRef} style={{ ...listBox, maxHeight: "60vh" }}>{children}</div>
          {clear}
        </div>
      </Modal>
    );
  }
  return createPortal(
    <div ref={panelRef} role="dialog" aria-label={title}
      /* A click in the list never takes the focus from the field, so typing and the keys keep working there. */
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed", zIndex: 1100, left: place?.left ?? 0, width: place?.width ?? wantWidth, top: place?.top, bottom: place?.bottom,
        maxHeight: place?.maxHeight ?? 420, visibility: place ? "visible" : "hidden", display: "flex", flexDirection: "column", gap: 8, padding: 8,
        background: "var(--c-paper, #fff)", border: `1px solid ${LINE}`, borderRadius: 8, boxShadow: "var(--shadow-3, 0 16px 40px rgba(0,0,0,0.2))",
      }}>
      <div style={{ ...listBox, flex: 1, minHeight: 0 }}>{children}</div>
      {clear}
    </div>,
    document.body,
  );
}

/** A row of the list: the highlighted one shaded, the chosen one in bold. Moving the mouse moves the highlight
    (not merely the list scrolling under a resting pointer, which would undo the arrow keys). */
const rowProps = (on: boolean, chosen: boolean, label: string, onPick: () => void, onHover: () => void) => ({
  role: "option", "aria-selected": on, "aria-label": label, onClick: onPick, onMouseMove: onHover,
  style: { cursor: "pointer", background: on ? HIGHLIGHT : undefined, fontWeight: chosen ? 700 : undefined } as CSSProperties,
});

/** The project label everywhere it shows: the name without "SO - ", then the code. */
export const projectLabel = (p: Pick<ProjectOption, "name" | "code">): string => `${cleanProjectName(p.name)}${p.code ? ` · ${p.code}` : ""}`;

/** A project's name and code, on a voucher line on screen (nothing when none). */
export function ProjectName({ id }: { id: number | null | undefined }) {
  const q = useProjectOptions();
  if (id == null) return null;
  const p = (q.data?.projects ?? []).find((x) => x.id === id);
  return <>{p ? projectLabel(p) : `Project ${id}`}</>;
}

export function ProjectPicker({ value, onChange, disabled, inputClass, placeholder = "Choose a project…", ariaLabel = "Project", filter }: {
  value: number | null; onChange: (id: number | null) => void; disabled?: boolean; inputClass?: string; placeholder?: string; ariaLabel?: string;
  /** Only the projects that fit (a renovation sub-department's own brand, SOP 1.1); the chosen one always shows. */
  filter?: (p: ProjectOption) => boolean;
}) {
  const q = useProjectOptions();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const every = (q.data?.projects ?? []) as PickProject[] & ProjectOption[];
  const all = useMemo(() => (filter ? every.filter((p) => p.id === value || filter(p as ProjectOption)) : every) as PickProject[] & ProjectOption[], [every, filter, value]);
  const chosen = value == null ? null : all.find((p) => p.id === value) ?? null;
  const [query, setQuery] = useState("");
  const groups = useMemo(() => projectRows(all, query), [all, query]);
  const ids = useMemo(() => [...groups.open, ...groups.completed, ...groups.test].map((p) => p.id), [groups]);
  const pk = usePicker(ids, value, onChange, query, setQuery);
  const row = (p: PickProject, tag?: string) => (
    <tr key={p.id} {...rowProps(ids[pk.active] === p.id, p.id === value, cleanProjectName(p.name), () => pk.pick(p.id), () => pk.setActive(ids.indexOf(p.id)))}>
      <td style={{ ...cell, whiteSpace: "normal" }}>{cleanProjectName(p.name)}{tag && <span style={{ marginLeft: 6, fontSize: "var(--fs-11)", color: MUTED, border: `1px solid ${MUTED}`, borderRadius: 4, padding: "0 4px" }}>{tag}</span>}</td>
      <td style={{ ...cell, whiteSpace: "normal" }}>{p.customer_name ?? "—"}</td>
      <td style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)" }}>{p.code ?? "—"}</td>
      <td style={cell}>{contractStatusLabel(p)}</td>
      <td style={{ ...cell, fontVariantNumeric: "tabular-nums" }}>{day(p.handed_over_at ?? p.planned_handover_date)}</td>
    </tr>
  );
  const empty = ids.length === 0;
  return (
    <>
      <PickerField pk={pk} anchorRef={anchorRef} ariaLabel={ariaLabel} label={chosen ? projectLabel(chosen) : value != null ? `Project ${value}` : null}
        placeholder={placeholder} query={query} setQuery={setQuery} disabled={disabled} inputClass={inputClass} onClear={() => onChange(null)} />
      {pk.open && (
        <PickerPanel pk={pk} title="Choose a project" placeholder="Project, customer or code" anchorRef={anchorRef} wantWidth={760}
          query={query} setQuery={setQuery} onClear={value != null ? () => pk.pick(null) : null}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
            <thead><tr><th style={head}>Project</th><th style={head}>Customer</th><th style={head}>Code</th><th style={head}>Status</th><th style={head}>Handover</th></tr></thead>
            <tbody role="listbox">
              {q.isLoading && <tr><td colSpan={5} style={{ ...cell, color: MUTED }}>Loading…</td></tr>}
              {!q.isLoading && empty && <tr><td colSpan={5} style={{ ...cell, color: MUTED }}>No project matches.</td></tr>}
              {groups.open.map((p) => row(p))}
              {groups.completed.length > 0 && <tr><td colSpan={5} style={section}>Completed</td></tr>}
              {groups.completed.map((p) => row(p))}
              {groups.test.length > 0 && <tr><td colSpan={5} style={section}>Test</td></tr>}
              {groups.test.map((p) => row(p, "Test"))}
            </tbody>
          </table>
        </PickerPanel>
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

export function UnitPicker({ value, onChange, disabled, inputClass, ariaLabel = "Unit", placeholder = "No unit" }: {
  value: string | null; onChange: (id: string | null) => void; disabled?: boolean; inputClass?: string; ariaLabel?: string; placeholder?: string;
}) {
  const q = useUnitOptions();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const all = q.data?.units ?? [];
  const chosen = value == null ? null : all.find((u) => u.id === value) ?? null;
  const [query, setQuery] = useState("");
  const rows = useMemo(() => unitRows(all, query), [all, query]);
  const ids = useMemo(() => rows.map((u) => u.id), [rows]);
  const pk = usePicker(ids, value, onChange, query, setQuery);
  return (
    <>
      <PickerField pk={pk} anchorRef={anchorRef} ariaLabel={ariaLabel} label={chosen ? unitLabel(chosen) : value ? "Unit" : null}
        placeholder={placeholder} query={query} setQuery={setQuery} disabled={disabled} inputClass={inputClass} onClear={() => onChange(null)} />
      {pk.open && (
        <PickerPanel pk={pk} title="Choose a unit" placeholder="Building or unit, e.g. A-3-1" anchorRef={anchorRef} wantWidth={360}
          query={query} setQuery={setQuery} onClear={value ? () => pk.pick(null) : null}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
            <thead><tr><th style={head}>Building</th><th style={head}>Unit</th></tr></thead>
            <tbody role="listbox">
              {q.isLoading && <tr><td colSpan={2} style={{ ...cell, color: MUTED }}>Loading…</td></tr>}
              {!q.isLoading && rows.length === 0 && <tr><td colSpan={2} style={{ ...cell, color: MUTED }}>No unit matches.</td></tr>}
              {rows.map((u) => (
                <tr key={u.id} {...rowProps(ids[pk.active] === u.id, u.id === value, unitLabel(u), () => pk.pick(u.id), () => pk.setActive(ids.indexOf(u.id)))}>
                  <td style={cell}>{u.building}</td>
                  <td style={{ ...cell, fontWeight: 600 }}>{u.unitNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PickerPanel>
      )}
    </>
  );
}
