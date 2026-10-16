/* Projects > Calendar in renovation mode, laid out like the team's Notion calendar (owner, 16 Oct 2026).
   Month: a Sunday-first grid, each day holding coloured task cards, a multi-day item one wide card across its
   days, "+N more" opening the day. Week: one row, taller cards with every detail. Cards are coloured by
   department (legend = the department chips) and filtered by department, person, my tasks, project and status;
   every filter and the period live in the URL. On a phone: a list by day with the same cards, filters in a sheet.
   Data: GET /api/projects/calendar/events?items=1 (renoItems, renoMe). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Circle, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "../../../components/Layout";
import { api } from "../../../api/client";
import { useQuery } from "../../../hooks/useQuery";
import { useStickyFilters } from "../../../hooks/useStickyFilters";
import { booleanPreference, useIdentityPreference } from "../../../hooks/useIdentityPreference";
import { getHolidaysOn } from "../../../lib/holidays";
import { cn, todayInAppTz } from "../../../lib/utils";
import { itemsByDate, type RenoCalendarItem, type RenoDepartment, type RenoPerson } from "./renovationCalendarItems";
import {
  RENO_FILTER_KEYS,
  WEEKDAYS,
  activeFilterCount,
  applyRenoFilters,
  dayLabel,
  itemDepartment,
  jumpTo,
  layoutWeek,
  parseRenoFilters,
  peopleOnItems,
  renoFilterPatch,
  renoWindow,
  stepWindow,
  type RenoCalendarFilters,
  type RenoCalendarMode,
} from "./renovationCalendarModel";
import {
  DepartmentChips,
  MyTasksToggle,
  Overlay,
  PersonPicker,
  ProjectSearch,
  RenoCalendarCard,
  RenoDayDialog,
  RenoItemDialog,
  StatusSegments,
} from "./renovationCalendarParts";

const EMPTY_ITEMS: RenoCalendarItem[] = [];
const EMPTY_IDS: number[] = [];
/** Month view draws this many cards per day before "+N more". */
const MONTH_LANES = 3;

function useNarrow(): boolean {
  const query = "(max-width: 767px)";
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function RenovationNotionCalendar() {
  const navigate = useNavigate();
  const [params, setParams] = useStickyFilters("projects-calendar-reno", ["mode", "month", "week", ...RENO_FILTER_KEYS]);
  const patch = useCallback((p: Record<string, string>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(p)) {
        if (v === "") next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const today = todayInAppTz();
  const mode: RenoCalendarMode = params.get("mode") === "week" ? "week" : "month";
  const win = useMemo(() => renoWindow(mode, params.get("month") ?? "", params.get("week") ?? "", today), [mode, params, today]);
  const filters = useMemo(() => parseRenoFilters(params), [params]);
  const setFilters = useCallback((f: Partial<RenoCalendarFilters>) => patch(renoFilterPatch(f)), [patch]);
  const [showHolidays, setShowHolidays] = useIdentityPreference("projects:cal:showHolidays", true, booleanPreference);
  const narrow = useNarrow();

  const q = useQuery<{ renoItems?: RenoCalendarItem[]; renoMe?: number[] }>(
    "/api/projects/calendar/events#reno-cards",
    () => api.get(`/api/projects/calendar/events?from=${win.from}&to=${win.to}&items=1`),
    [win.from, win.to],
    { keepPreviousData: true },
  );
  const all = q.data?.renoItems ?? EMPTY_ITEMS;
  const me = q.data?.renoMe ?? EMPTY_IDS;
  const items = useMemo(() => applyRenoFilters(all, filters, me), [all, filters, me]);

  // Names of everyone seen, so a picked person stays named in a period where they have nothing.
  const known = useRef(new Map<number, RenoPerson>());
  for (const i of all) for (const p of i.people ?? []) known.current.set(p.id, p);
  // Pickers count what the OTHER filters leave, so a choice never hides its own options.
  const people = useMemo(() => peopleOnItems(applyRenoFilters(all, { ...filters, people: [], mine: false }, me)), [all, filters, me]);
  const deptCounts = useMemo(() => {
    const m = new Map<RenoDepartment, number>();
    for (const i of applyRenoFilters(all, { ...filters, depts: [] }, me)) m.set(itemDepartment(i), (m.get(itemDepartment(i)) ?? 0) + 1);
    return m;
  }, [all, filters, me]);

  const [openItem, setOpenItem] = useState<RenoCalendarItem | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const byDate = useMemo(() => itemsByDate(items), [items]);
  const filterCount = activeFilterCount(filters);
  const clearFilters = () => setFilters({ depts: [], people: [], mine: false, q: "", state: "" });

  const go = (dir: -1 | 1) => patch(stepWindow(win, dir));
  const goToday = () => patch(jumpTo(today));
  const setMode = (m: RenoCalendarMode) => patch({ mode: m === "week" ? "week" : "", ...(m === "week" && !params.get("week") ? { week: jumpTo(today).week } : {}) });

  const filterControls = (inSheet: boolean) => (
    <>
      <DepartmentChips value={filters.depts} counts={deptCounts} onChange={(depts) => setFilters({ depts })} />
      <div className={cn("flex gap-2", inSheet ? "flex-col items-stretch" : "flex-wrap items-center")}>
        {inSheet && <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">People</div>}
        <PersonPicker options={people} value={filters.people} known={known.current} onChange={(p) => setFilters({ people: p })} inline={inSheet} />
        <div className="flex flex-wrap items-center gap-2">
          <MyTasksToggle on={filters.mine} linked={me.length > 0} onChange={(mine) => setFilters({ mine })} />
          <StatusSegments value={filters.state} onChange={(state) => setFilters({ state })} />
        </div>
        <ProjectSearch value={filters.q} onChange={(v) => setFilters({ q: v })} className={inSheet ? "w-full" : "w-56"} />
        {filterCount > 0 && (
          <button type="button" onClick={clearFilters} className="text-left text-[11.5px] font-semibold uppercase tracking-wider text-ink-muted hover:text-err">
            Clear filters
          </button>
        )}
      </div>
    </>
  );

  return (
    <div>
      <PageHeader eyebrow="Operations · Projects" title="Calendar" dense />

      {/* Toolbar: "October 2026  < Today >", Month / Week, a date jump */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-2">
        <h2 className="mr-1 min-w-[150px] font-display text-[20px] font-bold leading-tight tracking-tight text-ink" aria-live="polite">{win.label}</h2>
        <div className="inline-flex items-center gap-1">
          <button type="button" onClick={() => go(-1)} aria-label={mode === "week" ? "Previous week" : "Previous month"} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-ink-secondary hover:border-primary/40 hover:text-ink">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={goToday} className="h-8 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-ink-secondary hover:border-primary/40 hover:text-ink">
            Today
          </button>
          <button type="button" onClick={() => go(1)} aria-label={mode === "week" ? "Next week" : "Next month"} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-ink-secondary hover:border-primary/40 hover:text-ink">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="View">
          {(["month", "week"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("h-8 px-3 text-[12px] font-semibold", mode === m ? "bg-ink text-white" : "bg-surface text-ink-secondary hover:bg-surface-2")}>
              {m === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>
        <label className="relative inline-flex h-8 items-center" title="Go to a date">
          <CalendarDays aria-hidden size={13} className="pointer-events-none absolute left-2 text-ink-muted" />
          <input
            type="date"
            aria-label="Go to date"
            value=""
            onChange={(e) => { if (e.target.value) patch(jumpTo(e.target.value)); }}
            className="h-8 w-[150px] rounded-md border border-border bg-surface pl-7 pr-1 text-[12px] text-ink-secondary outline-none hover:border-primary/40 focus:border-primary"
          />
        </label>
        <button
          type="button"
          onClick={() => setShowHolidays(!showHolidays)}
          aria-pressed={showHolidays}
          className={cn("hidden h-8 items-center gap-1 rounded-md border px-2.5 text-[11px] font-semibold uppercase tracking-wider md:inline-flex", showHolidays ? "border-primary/40 bg-primary-soft text-primary-ink" : "border-border bg-surface text-ink-muted")}
          title="Show Malaysian public holidays"
        >
          {showHolidays ? <Check size={12} /> : <Circle size={12} />} MY Holidays
        </button>
        {narrow && (
          <button type="button" onClick={() => setSheet(true)} className={cn("ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-semibold", filterCount ? "border-ink bg-ink text-white" : "border-border bg-surface text-ink-secondary")}>
            <SlidersHorizontal size={13} /> Filters{filterCount ? ` (${filterCount})` : ""}
          </button>
        )}
      </div>

      {!narrow && <div className="mb-2.5 space-y-2">{filterControls(false)}</div>}

      {q.error && <div className="mb-2 rounded-md border border-err/40 bg-err/5 p-3 text-[12px] text-err">{q.error}</div>}
      {q.loading && !q.data && <div className="mb-2 text-[12px] text-ink-muted">Loading calendar…</div>}

      {narrow ? (
        <AgendaList win={win} byDate={byDate} today={today} showHolidays={showHolidays} loading={q.loading} onOpen={setOpenItem} />
      ) : (
        <div className={cn("overflow-hidden rounded-md border border-border bg-surface transition-opacity", q.placeholder && "opacity-70")} data-testid="reno-calendar-grid">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2">
            {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-muted">{d}</div>)}
          </div>
          {win.weeks.map((week) => (
            <WeekRow
              key={week[0]}
              week={week}
              items={items}
              byDate={byDate}
              mode={mode}
              month={win.month}
              today={today}
              showHolidays={showHolidays}
              onOpen={setOpenItem}
              onMore={setOpenDay}
            />
          ))}
        </div>
      )}
      {!q.loading && all.length > 0 && items.length === 0 && (
        <p className="mt-2 text-center text-[12.5px] text-ink-muted">
          Nothing matches the filters in this {mode}. <button type="button" onClick={clearFilters} className="font-semibold text-ink underline">Clear filters</button>
        </p>
      )}

      {sheet && (
        <Overlay title="Filters" onClose={() => setSheet(false)} footer={
          <button type="button" onClick={() => setSheet(false)} className="h-9 w-full rounded-md bg-ink text-[13px] font-semibold text-white">
            Show {items.length} item{items.length === 1 ? "" : "s"}
          </button>
        }>
          <div className="space-y-3">{filterControls(true)}</div>
        </Overlay>
      )}
      {openDay && (
        <RenoDayDialog
          iso={openDay}
          items={byDate.get(openDay) ?? []}
          today={today}
          onClose={() => setOpenDay(null)}
          onOpenItem={(i) => { setOpenDay(null); setOpenItem(i); }}
        />
      )}
      {openItem && (
        <RenoItemDialog item={openItem} today={today} onClose={() => setOpenItem(null)} onOpenProject={(href) => { setOpenItem(null); navigate(href); }} />
      )}
    </div>
  );
}

function DayHeader({ iso, today, dim, showHolidays }: { iso: string; today: string; dim: boolean; showHolidays: boolean }) {
  const holidays = showHolidays ? getHolidaysOn(iso) : [];
  const n = Number(iso.slice(8, 10));
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-1.5 pt-1">
      {iso === today ? (
        <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#d9534f] px-1 text-[12.5px] font-bold text-white" aria-label={`Today, ${dayLabel(iso)}`}>{n}</span>
      ) : (
        <span className={cn("text-[13px] font-semibold", dim ? "text-ink-muted/70" : "text-ink-secondary")}>{n === 1 ? `${dayLabel(iso).split(" ")[2]} 1` : n}</span>
      )}
      {holidays.length > 0 && (
        <span className="min-w-0 truncate rounded bg-[#e3e4f3] px-1.5 py-px text-[10px] font-semibold text-[#2b3063]" title={holidays.map((h) => h.name).join(", ")}>
          {holidays[0]!.name}
        </span>
      )}
    </div>
  );
}

function WeekRow({ week, items, byDate, mode, month, today, showHolidays, onOpen, onMore }: {
  week: string[];
  items: RenoCalendarItem[];
  byDate: Map<string, RenoCalendarItem[]>;
  mode: RenoCalendarMode;
  month: string;
  today: string;
  showHolidays: boolean;
  onOpen: (i: RenoCalendarItem) => void;
  onMore: (iso: string) => void;
}) {
  const layout = useMemo(() => layoutWeek(items, week, mode === "month" ? MONTH_LANES : Infinity), [items, week, mode]);
  const moreRow = layout.lanes + 2;
  return (
    <div
      className="relative grid grid-cols-7 border-b border-border last:border-b-0"
      style={{ gridTemplateRows: `auto repeat(${layout.lanes}, auto) 1fr`, minHeight: mode === "week" ? 460 : 132 }}
    >
      {week.map((iso, c) => {
        const dim = mode === "month" && iso.slice(0, 7) !== month;
        return (
          <div
            key={iso}
            aria-hidden
            className={cn("border-r border-border last:border-r-0", dim && "bg-surface-2/70", iso === today && "bg-[#fdf6f5]")}
            style={{ gridColumn: c + 1, gridRow: "1 / -1" }}
          />
        );
      })}
      {week.map((iso, c) => (
        <div key={`h-${iso}`} style={{ gridColumn: c + 1, gridRow: 1 }} className="relative min-w-0 pb-1">
          <DayHeader iso={iso} today={today} dim={mode === "month" && iso.slice(0, 7) !== month} showHolidays={showHolidays} />
        </div>
      ))}
      {layout.segments.map((s) => (
        <div
          key={s.item.key}
          className="relative min-w-0 pb-1"
          style={{ gridColumn: `${s.startCol + 1} / ${s.endCol + 2}`, gridRow: s.lane + 2, paddingLeft: s.clipLeft ? 0 : 4, paddingRight: s.clipRight ? 0 : 4 }}
        >
          <RenoCalendarCard item={s.item} variant={mode === "week" ? "week" : "month"} today={today} clipLeft={s.clipLeft} clipRight={s.clipRight} onOpen={onOpen} />
        </div>
      ))}
      {week.map((iso, c) =>
        layout.hidden[c]! > 0 ? (
          <div key={`m-${iso}`} style={{ gridColumn: c + 1, gridRow: moreRow }} className="relative self-start px-1.5 pb-1">
            <button
              type="button"
              onClick={() => onMore(iso)}
              className="w-full rounded px-1 py-0.5 text-left text-[11.5px] font-semibold text-ink-secondary hover:bg-surface-2 hover:text-ink"
              title={`Show all ${(byDate.get(iso) ?? []).length} items on ${dayLabel(iso)}`}
            >
              +{layout.hidden[c]} more
            </button>
          </div>
        ) : null,
      )}
    </div>
  );
}

/** Phone: the period as a list of days, each with its cards; empty days left out of a month. */
function AgendaList({ win, byDate, today, showHolidays, loading, onOpen }: {
  win: ReturnType<typeof renoWindow>;
  byDate: Map<string, RenoCalendarItem[]>;
  today: string;
  showHolidays: boolean;
  loading: boolean;
  onOpen: (i: RenoCalendarItem) => void;
}) {
  const days = win.weeks.flat().filter((d) => win.mode === "week" || d.slice(0, 7) === win.month);
  const shown = win.mode === "week" ? days : days.filter((d) => (byDate.get(d)?.length ?? 0) > 0 || d === today);
  const total = days.reduce((n, d) => n + (byDate.get(d)?.length ?? 0), 0);
  return (
    <div className="space-y-3" data-testid="reno-calendar-agenda">
      {shown.map((iso) => {
        const list = byDate.get(iso) ?? [];
        const holidays = showHolidays ? getHolidaysOn(iso) : [];
        return (
          <section key={iso} aria-label={dayLabel(iso)}>
            <div className="sticky top-0 z-10 -mx-1 mb-1.5 flex items-center gap-2 bg-bg/95 px-1 py-1 backdrop-blur">
              <span className={cn("text-[13px] font-bold", iso === today ? "text-[#c0392b]" : "text-ink")}>
                {dayLabel(iso)}{iso === today && " · Today"}
              </span>
              {holidays.length > 0 && <span className="truncate rounded bg-[#e3e4f3] px-1.5 py-px text-[10px] font-semibold text-[#2b3063]">{holidays[0]!.name}</span>}
              <span className="ml-auto font-mono text-[11px] text-ink-muted">{list.length || ""}</span>
            </div>
            <div className="space-y-1.5">
              {list.map((i) => <RenoCalendarCard key={i.key} item={i} variant="list" today={today} onOpen={onOpen} />)}
              {list.length === 0 && <p className="px-1 text-[12px] text-ink-muted">Nothing planned.</p>}
            </div>
          </section>
        );
      })}
      {!loading && total === 0 && win.mode === "month" && <p className="py-6 text-center text-[12.5px] text-ink-muted">Nothing planned this month.</p>}
    </div>
  );
}
