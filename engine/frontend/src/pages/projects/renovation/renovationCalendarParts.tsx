/* Pieces of the Notion-style renovation calendar (owner, 16 Oct 2026): the coloured task card, the department
   chips that are also the colour legend, the person picker, the filter controls (a bar on a desktop, a bottom
   sheet on a phone), and the dialogs for one item and for one day. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Circle, ExternalLink, FileText, Search, User, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { itemEnd, RENO_ITEM_KINDS, type RenoCalendarItem, type RenoDepartment, type RenoPerson } from "./renovationCalendarItems";
import {
  DEPARTMENT_BY_KEY,
  RENO_DEPARTMENTS,
  STATUS_LABEL,
  dayLabel,
  daysBetween,
  initials,
  itemDepartment,
  itemStatus,
  itemTitle,
  personDepartment,
  spanLabel,
  type PersonOption,
  type RenoCalendarFilters,
  type RenoItemStatus,
} from "./renovationCalendarModel";

// ── Small pieces ──────────────────────────────────────────────

export function PersonAvatar({ person, size = 16, className }: { person: Pick<RenoPerson, "name" | "roles">; size?: number; className?: string }) {
  const dept = personDepartment(person);
  const style = dept ? DEPARTMENT_BY_KEY[dept] : null;
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none ring-1 ring-white", className)}
      style={{
        width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.5)),
        background: style?.dot ?? "#8a8780", color: style?.dotInk ?? "#ffffff",
      }}
    >
      {initials(person.name)}
    </span>
  );
}

export function DepartmentSwatch({ dept, className }: { dept: RenoDepartment; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ background: DEPARTMENT_BY_KEY[dept].dot }} />;
}

const STATUS_PILL: Readonly<Record<RenoItemStatus, string>> = {
  done: "bg-white/70 text-[#1b5527] ring-1 ring-[#1b5527]/25",
  overdue: "bg-white/80 text-[#9b1c1c] ring-1 ring-[#9b1c1c]/35",
  open: "bg-white/60 text-current ring-1 ring-black/15",
};
export function StatusPill({ status, className }: { status: RenoItemStatus; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-semibold leading-[14px]", STATUS_PILL[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function StatusTick({ status }: { status: RenoItemStatus }) {
  return status === "done" ? (
    <span aria-hidden className="mt-px inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-current">
      <Check size={9} strokeWidth={3.5} className="text-white" />
    </span>
  ) : (
    <Circle aria-hidden size={14} strokeWidth={2} className={cn("mt-px shrink-0", status === "overdue" ? "text-[#9b1c1c]" : "opacity-60")} />
  );
}

function PeopleLine({ item, max }: { item: RenoCalendarItem; max: number }) {
  const people = item.people ?? [];
  if (people.length === 0) {
    return (
      <span className="flex min-w-0 items-center gap-1 opacity-75">
        <User aria-hidden size={12} className="shrink-0" />
        <span className="truncate">{item.supplier || "Unassigned"}</span>
      </span>
    );
  }
  const shown = people.slice(0, max);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="flex shrink-0 -space-x-1">
        {shown.map((p) => <PersonAvatar key={p.id} person={p} />)}
      </span>
      <span className="truncate font-medium">
        {shown.map((p) => p.name).join(", ")}
        {people.length > shown.length && ` +${people.length - shown.length}`}
      </span>
    </span>
  );
}

// ── The card ──────────────────────────────────────────────────

export type CardVariant = "month" | "week" | "list";

/** One item as a coloured card: tick + heading, people, project, status and department.
    month: compact, one line each; week / list: everything, wrapping. */
export function RenoCalendarCard({ item, variant, today, clipLeft = false, clipRight = false, onOpen }: {
  item: RenoCalendarItem;
  variant: CardVariant;
  today: string;
  clipLeft?: boolean;
  clipRight?: boolean;
  onOpen: (item: RenoCalendarItem) => void;
}) {
  const dept = DEPARTMENT_BY_KEY[itemDepartment(item)];
  const status = itemStatus(item, today);
  const compact = variant === "month";
  const multiDay = itemEnd(item) !== item.date;
  const title = itemTitle(item);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      data-reno-card={item.key}
      data-department={dept.key}
      title={`${title} · ${item.projectName} · ${dept.label} · ${STATUS_LABEL[status]}`}
      style={{ ...(clipLeft ? { borderLeftStyle: "dashed" } : {}), ...(clipRight ? { borderRightStyle: "dashed" } : {}) }}
      className={cn(
        "block w-full min-w-0 border text-left shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40",
        dept.card,
        clipLeft ? "rounded-l-none" : "rounded-l-md",
        clipRight ? "rounded-r-none" : "rounded-r-md",
        compact ? "px-1.5 py-1 text-[11px] leading-[15px]" : "px-2 py-1.5 text-[12px] leading-[16px]",
        status === "done" && "opacity-[0.82]",
      )}
    >
      <span className="flex items-start gap-1">
        <StatusTick status={status} />
        <span className={cn("min-w-0 flex-1 font-bold tracking-[0.01em]", compact ? "truncate" : "break-words")}>
          {title}
        </span>
      </span>
      <span className="mt-0.5 block min-w-0">
        <PeopleLine item={item} max={compact ? 2 : 4} />
      </span>
      <span className="mt-0.5 flex min-w-0 items-start gap-1">
        <FileText aria-hidden size={12} className="mt-[2px] shrink-0 opacity-70" />
        <span className={cn("min-w-0 uppercase", compact ? "truncate" : "break-words")}>{compact ? item.short : item.projectName}</span>
      </span>
      {!compact && item.supplier && (item.people?.length ?? 0) > 0 && (
        <span className="mt-0.5 block truncate opacity-80">Subcon: {item.supplier}</span>
      )}
      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
        <StatusPill status={status} />
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide opacity-80">{dept.label}</span>
        {!compact && multiDay && <span className="ml-auto text-[10px] font-medium opacity-80">{spanLabel(item)}</span>}
      </span>
    </button>
  );
}

// ── Filters ───────────────────────────────────────────────────

/** Department chips: pick several; also the colour legend. */
export function DepartmentChips({ value, counts, onChange, className }: {
  value: RenoDepartment[];
  counts: Map<RenoDepartment, number>;
  onChange: (next: RenoDepartment[]) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="Departments (colour legend)">
      {RENO_DEPARTMENTS.map((d) => {
        const on = value.includes(d.key);
        return (
          <button
            key={d.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d.key) : [...value, d.key])}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold transition-colors",
              d.card,
              on ? "ring-2 ring-ink/70 ring-offset-1" : value.length ? "opacity-55 hover:opacity-90" : "hover:brightness-[0.97]",
            )}
          >
            <DepartmentSwatch dept={d.key} />
            {d.label}
            <span className="font-normal opacity-75">{counts.get(d.key) ?? 0}</span>
            {on && <Check aria-hidden size={12} strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

/** Pick several people (avatars, item counts, a search box). `known` names people picked earlier who have
    nothing in this period. */
export function PersonPicker({ options, value, known, onChange, inline = false }: {
  options: PersonOption[];
  value: number[];
  known: Map<number, RenoPerson>;
  onChange: (next: number[]) => void;
  /** in the phone sheet: the list itself, no dropdown */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || inline) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, inline]);

  const rows = useMemo(() => {
    const listed = new Set(options.map((o) => o.person.id));
    const extra: PersonOption[] = value.filter((id) => !listed.has(id)).map((id) => {
      const p = known.get(id) ?? { id, name: `Person ${id}`, roles: [] };
      return { person: p, department: personDepartment(p), count: 0 };
    });
    const n = needle.trim().toLowerCase();
    return [...options, ...extra].filter((o) => !n || o.person.name.toLowerCase().includes(n));
  }, [options, value, known, needle]);
  const picked = value.map((id) => options.find((o) => o.person.id === id)?.person ?? known.get(id)).filter((p): p is RenoPerson => !!p);
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const list = (
    <div className={cn(inline ? "" : "absolute left-0 top-full z-40 mt-1 w-72 rounded-md border border-border bg-surface p-2 shadow-lg")}>
      <label className="relative mb-1.5 flex items-center">
        <Search aria-hidden size={12} className="pointer-events-none absolute left-2 text-ink-muted" />
        <input
          type="search"
          value={needle}
          onChange={(e) => setNeedle(e.target.value)}
          placeholder="Find a person"
          aria-label="Find a person"
          className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-[12px] outline-none focus:border-primary"
        />
      </label>
      <ul className={cn("thin-scroll overflow-y-auto", inline ? "max-h-56" : "max-h-72")} role="listbox" aria-multiselectable aria-label="People">
        {rows.length === 0 && <li className="px-2 py-2 text-[12px] text-ink-muted">Nobody on this period's items.</li>}
        {rows.map((o) => {
          const on = value.includes(o.person.id);
          return (
            <li key={o.person.id} role="option" aria-selected={on}>
              <button type="button" onClick={() => toggle(o.person.id)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2", on && "bg-surface-2")}>
                <span className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-ink bg-ink text-white" : "border-border-strong")}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <PersonAvatar person={o.person} size={20} />
                <span className="min-w-0 flex-1 truncate">{o.person.name}</span>
                {o.department && <span className="shrink-0 text-[10.5px] text-ink-muted">{DEPARTMENT_BY_KEY[o.department].label}</span>}
                <span className="w-5 shrink-0 text-right font-mono text-[10.5px] text-ink-muted">{o.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {value.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="mt-1.5 text-[11.5px] font-semibold text-ink-secondary hover:text-err">
          Clear people
        </button>
      )}
    </div>
  );
  if (inline) return list;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border bg-surface px-2.5 text-[12px] transition-colors hover:border-primary/40",
          value.length ? "border-ink/60 font-semibold text-ink" : "border-border text-ink-secondary",
        )}
      >
        {picked.length > 0 ? (
          <>
            <span className="flex -space-x-1">{picked.slice(0, 3).map((p) => <PersonAvatar key={p.id} person={p} size={18} />)}</span>
            <span className="max-w-[140px] truncate">{picked.length === 1 ? picked[0]!.name : `${picked.length} people`}</span>
          </>
        ) : (
          <>
            <User aria-hidden size={13} /> Person
          </>
        )}
        <ChevronDown aria-hidden size={12} className="text-ink-muted" />
      </button>
      {open && list}
    </div>
  );
}

const STATES: ReadonlyArray<{ v: RenoCalendarFilters["state"]; label: string }> = [
  { v: "", label: "All" },
  { v: "open", label: "Open" },
  { v: "done", label: "Done" },
];

export function StatusSegments({ value, onChange }: { value: RenoCalendarFilters["state"]; onChange: (v: RenoCalendarFilters["state"]) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Status">
      {STATES.map((s) => (
        <button
          key={s.v || "all"}
          type="button"
          aria-pressed={value === s.v}
          onClick={() => onChange(s.v)}
          className={cn("h-8 px-3 text-[11.5px] font-semibold transition-colors", value === s.v ? "bg-ink text-white" : "bg-surface text-ink-secondary hover:bg-surface-2")}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function MyTasksToggle({ on, linked, onChange }: { on: boolean; linked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!linked && !on}
      onClick={() => onChange(!on)}
      title={linked ? "Only items you are on" : "Your account is not linked to a person on projects yet"}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on ? "border-ink bg-ink text-white" : "border-border bg-surface text-ink-secondary hover:border-primary/40",
      )}
    >
      {on ? <Check aria-hidden size={13} strokeWidth={3} /> : <User aria-hidden size={13} />} My tasks
    </button>
  );
}

export function ProjectSearch({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <label className={cn("relative inline-flex h-8 items-center", className)}>
      <Search aria-hidden size={12} className="pointer-events-none absolute left-2 text-ink-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search project or task"
        aria-label="Search project or task"
        className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-6 text-[12px] text-ink outline-none transition-colors hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-1 flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:text-ink">
          <X size={11} />
        </button>
      )}
    </label>
  );
}

// ── Overlays ──────────────────────────────────────────────────

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
}

/** A centred dialog on a desktop, a sheet from the bottom on a phone. */
export function Overlay({ title, eyebrow, onClose, children, footer }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        className="thin-scroll flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl md:max-w-lg md:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {eyebrow && <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-muted">{eyebrow}</div>}
            <h2 className="break-words font-display text-[16px] font-bold leading-snug text-ink">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-full border border-border p-1.5 text-ink-secondary hover:text-ink">
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="border-t border-border px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const KIND_LABEL = new Map(RENO_ITEM_KINDS.map((k) => [k.kind, k.label] as const));
const PROJECT_SECTION: Partial<Record<RenoCalendarItem["kind"], string>> = {
  onsite: "#reno-design", "3d": "#reno-design", "2d": "#reno-design", amendment: "#reno-design", po: "#reno-procurement", delivery: "#reno-procurement",
};
/** Where "Open project" goes: the project, at the section the item belongs to. */
export const projectLink = (i: Pick<RenoCalendarItem, "projectId" | "kind">): string => `/projects/${i.projectId}${PROJECT_SECTION[i.kind] ?? ""}`;

const ROLE_LABEL: Readonly<Record<string, string>> = { sales: "Sales", designer: "Designer", reno_pic: "Renovation PIC", admin: "Admin", boss: "Boss", site_crew: "Site crew" };

export function RenoItemDialog({ item, today, onClose, onOpenProject }: { item: RenoCalendarItem; today: string; onClose: () => void; onOpenProject: (href: string) => void }) {
  const dept = DEPARTMENT_BY_KEY[itemDepartment(item)];
  const status = itemStatus(item, today);
  const end = itemEnd(item);
  const days = daysBetween(item.date, end) + 1;
  const rows: Array<[string, ReactNode]> = [
    ["When", `${dayLabel(item.date)}${end !== item.date ? ` – ${dayLabel(end)} (${days} days)` : ""} ${item.date.slice(0, 4)}`],
    ["What", `${KIND_LABEL.get(item.kind) ?? item.kind}: ${item.what}`],
    ["Project", <span key="p" className="break-words">{item.projectName}{item.projectCode ? <span className="text-ink-muted"> · {item.projectCode}</span> : null}</span>],
  ];
  if (item.supplier) rows.push(["Subcon", item.supplier]);
  return (
    <Overlay
      title={itemTitle(item)}
      eyebrow={`${dept.label} · ${spanLabel(item)}`}
      onClose={onClose}
      footer={
        <button type="button" onClick={() => onOpenProject(projectLink(item))} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90 md:w-auto">
          <ExternalLink aria-hidden size={14} /> Open project
        </button>
      }
    >
      <div className={cn("mb-3 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-[12px]", dept.card)}>
        <StatusPill status={status} />
        <DepartmentSwatch dept={dept.key} />
        <span className="font-semibold">{dept.label}</span>
      </div>
      <dl className="space-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-16 shrink-0 text-ink-muted">{k}</dt>
            <dd className="min-w-0 flex-1 text-ink">{v}</dd>
          </div>
        ))}
        <div className="flex gap-3">
          <dt className="w-16 shrink-0 text-ink-muted">People</dt>
          <dd className="min-w-0 flex-1">
            {(item.people ?? []).length === 0 ? (
              <span className="text-ink-muted">Nobody assigned</span>
            ) : (
              <ul className="space-y-1">
                {(item.people ?? []).map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <PersonAvatar person={p} size={22} />
                    <span className="text-ink">{p.name}</span>
                    <span className="text-[11.5px] text-ink-muted">{p.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </Overlay>
  );
}

export function RenoDayDialog({ iso, items, today, onClose, onOpenItem }: {
  iso: string;
  items: RenoCalendarItem[];
  today: string;
  onClose: () => void;
  onOpenItem: (item: RenoCalendarItem) => void;
}) {
  return (
    <Overlay title={`${dayLabel(iso)} ${iso.slice(0, 4)}`} eyebrow={`${items.length} item${items.length === 1 ? "" : "s"}`} onClose={onClose}>
      <div className="space-y-1.5">
        {items.map((i) => <RenoCalendarCard key={i.key} item={i} variant="list" today={today} onOpen={onOpenItem} />)}
        {items.length === 0 && <p className="py-4 text-center text-[12.5px] text-ink-muted">Nothing on this day.</p>}
      </div>
    </Overlay>
  );
}
