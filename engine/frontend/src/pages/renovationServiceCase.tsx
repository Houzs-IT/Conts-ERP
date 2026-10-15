/* Renovation-mode service cases (owner, 15 Oct 2026: "It shouldn't look up the SO, it should look up the
   PROJECT"). The project picker, the item category and the project link the Service Cases screens use when
   app_settings projects_mode = 'renovation'. Houzs mode never renders any of this. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AlertCircle, X } from "lucide-react";
import { api } from "../api/client";
import { useQuery } from "../hooks/useQuery";
import { useAnchoredPanel, anchoredPanelStyle } from "../lib/anchoredPanel";
import { formatPhone } from "../vendor/shared/phone";
import {
  caseCategoryValue,
  caseProjectOf,
  parseCaseCategory,
  projectAddress,
  projectOptionLabel,
  type RenoCaseCategory,
  type RenoCaseProject,
} from "./renovationServiceCaseModel";

export { caseCategoryValue, caseProjectOf, parseCaseCategory };
export type { RenoCaseCategory, RenoCaseProject };

/** null while unknown; then whether this install runs renovation projects, with its item categories.
    Read from /api/assr so a service-case user without Projects access still gets the right form. */
export function useServiceCaseRenovation(): { renovation: boolean; categories: RenoCaseCategory[] } | null {
  const q = useQuery<{ renovation: boolean; categories: RenoCaseCategory[] }>(
    ["assr", "renovation-context"],
    () => api.get("/api/assr/renovation/context"),
    [],
    { staleTime: 300_000 },
  );
  if (q.loading && !q.data) return null;
  return { renovation: q.data?.renovation === true, categories: q.data?.categories ?? [] };
}

const MAX_H = 288;
const inputCls = "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary";

/** Project lookup: code, name, building / unit, customer name or phone. Picking fills the customer from the project. */
export function RenovationProjectPicker({
  value,
  onChange,
}: {
  value: RenoCaseProject | null;
  onChange: (p: RenoCaseProject | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  /* Searching starts on first focus and follows the text; closing the list (blur) never cancels it. */
  const [touched, setTouched] = useState(false);
  const [results, setResults] = useState<RenoCaseProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!touched || value) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.get<{ data: RenoCaseProject[] }>(`/api/assr/renovation/projects?q=${encodeURIComponent(q.trim())}`);
        setResults(res.data);
        setError(null);
      } catch (e) {
        setResults([]);
        setError(e instanceof Error && e.message ? e.message : "Projects could not be loaded.");
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [q, touched, value]);

  const rect = useAnchoredPanel(inputRef, open && !value && (results.length > 0 || !searching), MAX_H);

  if (value) {
    const address = projectAddress(value);
    return (
      <div className="rounded-md border border-border bg-bg/40 px-3 py-2.5" data-testid="picked-project">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {value.code && <span className="font-mono text-[12px] font-semibold text-ink">{value.code}</span>}
              <Link to={`/projects/${value.id}`} target="_blank" rel="noopener" className="break-words text-[13px] font-semibold text-primary hover:underline">
                {value.name || "Project"}
              </Link>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-secondary">
              <span className="font-medium text-ink">{value.customerName || "No customer name"}</span>
              {value.customerPhone ? <span className="whitespace-nowrap">{formatPhone(value.customerPhone)}</span> : null}
              {value.customerEmail ? <span className="break-all">{value.customerEmail}</span> : null}
            </div>
            {address && <div className="mt-0.5 text-[11.5px] text-ink-muted">{address}</div>}
          </div>
          <button
            type="button"
            onClick={() => { onChange(null); setQ(""); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="inline-flex flex-none items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-ink-secondary hover:border-accent/40"
            aria-label="Change project"
          >
            <X size={12} /> Change
          </button>
        </div>
        {value.openCaseCount > 0 && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/60 bg-amber-50/60 px-2.5 py-1.5 text-[11.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertCircle size={13} className="mt-px flex-none" />
            <span>
              This project already has {value.openCaseCount} open service case{value.openCaseCount > 1 ? "s" : ""}.{" "}
              <Link to={`/projects/${value.id}`} target="_blank" rel="noopener" className="font-semibold underline">See them on the project</Link>{" "}
              before opening a new one.
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setTouched(true); }}
        onFocus={() => { setOpen(true); setTouched(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Project code, name, building / unit, customer or phone"
        aria-label="Project"
        className={inputCls}
      />
      <div className="mt-1.5 text-[11px] text-ink-muted">
        {searching ? "Searching..." : error ? <span className="text-red-600">{error}</span> : "The customer, phone, email and site address come from the project."}
      </div>
      {rect && createPortal(
        <div
          style={{ ...anchoredPanelStyle(rect), zIndex: 60 }}
          className="overflow-auto rounded-md border border-border bg-surface shadow-lg"
          role="listbox"
          aria-label="Projects"
        >
          {results.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-ink-muted">No project matches "{q.trim()}".</div>
          ) : results.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => { e.preventDefault(); onChange(p); setOpen(false); }}
              className="flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2 text-left text-[12px] last:border-b-0 hover:bg-accent-soft/20"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate font-semibold text-ink">{projectOptionLabel(p)}</span>
                {p.openCaseCount > 0 && (
                  <span className="ml-auto flex-none rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                    {p.openCaseCount} open case{p.openCaseCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ink-secondary">
                {[p.customerPhone ? formatPhone(p.customerPhone) : "", p.soDocNo ? `SO ${p.soDocNo}` : "No sales order yet"].filter(Boolean).join(" · ")}
              </div>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const selectCls = "w-full appearance-none rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

/** "If the case is about an item": the renovation category and sub-category (the procurement list). Optional. */
export function RenovationItemCategory({
  categories,
  group,
  sub,
  onChange,
}: {
  categories: RenoCaseCategory[];
  group: string;
  sub: string;
  onChange: (group: string, sub: string) => void;
}) {
  const subs = categories.find((g) => g.code === group)?.subs ?? [];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <select aria-label="Item category" value={group} onChange={(e) => onChange(e.target.value, "")} className={selectCls}>
        <option value="">Not about an item</option>
        {categories.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
      </select>
      <select aria-label="Item sub-category" value={sub} onChange={(e) => onChange(group, e.target.value)} disabled={!group || subs.length === 0} className={selectCls}>
        <option value="">{group ? "Any sub-category" : "Pick a category first"}</option>
        {subs.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
      </select>
    </div>
  );
}

/** The case's project as a link to the project page, or a dash. */
export function CaseProjectLink({ row, className }: { row: Record<string, unknown> | null | undefined; className?: string }) {
  const p = caseProjectOf(row);
  if (!p) return <span className="text-ink-muted">—</span>;
  return (
    <Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()} className={className ?? "text-xs font-medium text-primary hover:underline"}>
      {p.label}
    </Link>
  );
}
