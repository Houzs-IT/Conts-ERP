/* Cross-project task calendar (replaces the owner's Notion task calendar):
   every trade and template task by planned date range, filterable by contractor
   and project. Desktop: rows per contractor, drag a bar to move its planned dates
   (length kept). Phone: a list by day. */

import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "../../../components/Layout";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { renovationApi, type CalendarTask } from "./renovationApi";
import { TASK_STATUS_LABEL, activeOn, addDays, barPlacement, dateRange, daysBetween, errorText, shiftRange, taskTone, weekStart, TONE_CLASS } from "./renovationModel";
import { inputClass } from "./renovationUi";

const DAYS = 21;

function todayMyt(): string {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

/** Who does the task: the subcontractor, or the in-house crew picked from the people list. */
export function doerText(t: Pick<CalendarTask, "fulfilment_kind" | "supplier_name" | "assignees">): string {
  const crew = (t.assignees ?? []).map((a) => a.name).join(", ");
  if (t.fulfilment_kind === "internal") return crew ? `In-house: ${crew}` : "In-house (no crew yet)";
  return (t.supplier_name ?? "No subcontractor yet") + (crew ? ` · ${crew}` : "");
}

export function groupByContractor(tasks: readonly CalendarTask[]): Array<{ key: string; name: string; tasks: CalendarTask[] }> {
  const m = new Map<string, { key: string; name: string; tasks: CalendarTask[] }>();
  for (const t of tasks) {
    const crewKey = (t.assignees ?? []).map((a) => a.id).sort((a, b) => a - b).join(",");
    const key = t.fulfilment_kind === "internal" ? `__internal:${crewKey}` : (t.supplier_id ?? "__none");
    const name = t.fulfilment_kind === "internal" ? doerText({ ...t, supplier_name: null }) : (t.supplier_name ?? "No subcontractor yet");
    const g = m.get(key) ?? { key, name, tasks: [] };
    g.tasks.push(t);
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function RenovationCalendar({ canWrite }: { canWrite: boolean }) {
  const [from, setFrom] = useState(() => weekStart(todayMyt()));
  const to = addDays(from, DAYS - 1);
  const [supplierId, setSupplierId] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  /* one filter for both: "s:<supplier uuid>" or "p:<person id>" (in-house crew) */
  const q = useQuery(["renovation", "calendar", from, supplierId], () => renovationApi.calendar({
    from, to,
    supplierId: supplierId.startsWith("s:") ? supplierId.slice(2) : undefined,
    personId: supplierId.startsWith("p:") ? Number(supplierId.slice(2)) : undefined,
  }), [from, supplierId]);
  const days = useMemo(() => dateRange(from, to), [from, to]);
  const tasks = useMemo(() => {
    const f = projectFilter.trim().toLowerCase();
    return (q.data?.data ?? []).filter((t) => !f || [t.project_code, t.project_name, t.building, t.unit_no].filter(Boolean).join(" ").toLowerCase().includes(f));
  }, [q.data, projectFilter]);
  const groups = useMemo(() => groupByContractor(tasks), [tasks]);
  const drag = useRef<{ task: CalendarTask; grab: string } | null>(null);
  const today = todayMyt();

  async function move(task: CalendarTask, delta: number) {
    if (!delta) return;
    const r = shiftRange(task.planned_start, task.planned_end, delta);
    setError(null);
    try {
      await renovationApi.planTask(task.id, r.start, r.end);
      q.reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Operations · Projects" title="Task calendar" description="Every site task across projects by planned dates. Drag a bar to move it; the order of trades is only a suggestion." />
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <div className="flex items-center gap-1">
          <Button variant="secondary" aria-label="Previous weeks" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft size={16} /></Button>
          <Button variant="secondary" onClick={() => setFrom(weekStart(today))}>Today</Button>
          <Button variant="secondary" aria-label="Next weeks" onClick={() => setFrom(addDays(from, 7))}><ChevronRight size={16} /></Button>
          <span className="ml-2 text-sm text-ink-secondary whitespace-nowrap">{from} to {to}</span>
        </div>
        <select className={inputClass + " sm:max-w-[14rem]"} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Contractor">
          <option value="">All contractors and crew</option>
          {(q.data?.contractors ?? []).map((c) => <option key={c.id} value={`s:${c.id}`}>{c.name}</option>)}
          {(q.data?.crew ?? []).map((c) => <option key={`p${c.id}`} value={`p:${c.id}`}>In-house: {c.name}</option>)}
        </select>
        <input className={inputClass + " sm:max-w-[14rem]"} placeholder="Project or building" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Project filter" />
      </div>
      {error && <p role="alert" className="mb-2 text-sm text-err">{error}</p>}
      {q.loading && <p className="py-8 text-center text-sm text-ink-secondary">Loading tasks...</p>}
      {q.error && <p role="alert" className="text-sm text-err">Tasks could not be loaded: {q.error}</p>}
      {!q.loading && !q.error && tasks.length === 0 && <p className="py-8 text-center text-sm text-ink-secondary">No task has planned dates in these weeks.</p>}

      {tasks.length > 0 && (
        <>
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border bg-surface">
            <div className="min-w-[1100px]">
              <div className="grid border-b border-border text-[11px] text-ink-secondary" style={{ gridTemplateColumns: `12rem repeat(${DAYS}, minmax(0, 1fr))` }}>
                <div className="px-2 py-1">Contractor</div>
                {days.map((d) => (
                  <div key={d} className={cn("px-1 py-1 text-center border-l border-border", d === today && "bg-primary/10 font-semibold text-primary")}>
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" }).slice(0, 2)} {d.slice(8)}
                  </div>
                ))}
              </div>
              {groups.map((g) => (
                <div key={g.key} className="border-b border-border">
                  <div className="px-2 pt-2 text-xs font-semibold text-ink">{g.name}</div>
                  {g.tasks.map((t) => {
                    const pl = barPlacement(t.planned_start, t.planned_end, from, to);
                    return (
                      <div key={t.id} className="grid relative h-9" style={{ gridTemplateColumns: `12rem repeat(${DAYS}, minmax(0, 1fr))` }}>
                        <div className="px-2 text-[11px] text-ink-secondary truncate self-center">{t.project_code ?? t.project_name}</div>
                        {days.map((d) => (
                          <div
                            key={d}
                            className={cn("border-l border-border", d === today && "bg-primary/5")}
                            onDragOver={(e) => { if (canWrite) e.preventDefault(); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const g0 = drag.current;
                              drag.current = null;
                              if (g0 && g0.task.id === t.id) void move(t, daysBetween(g0.grab, d));
                            }}
                          />
                        ))}
                        {pl && (
                          <div
                            draggable={canWrite}
                            onDragStart={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const dayWidth = rect.width / pl.span;
                              const offset = Math.max(0, Math.min(pl.span - 1, Math.floor((e.clientX - rect.left) / dayWidth)));
                              drag.current = { task: t, grab: addDays(from, pl.col + offset) };
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            title={`${t.label} · ${t.project_code ?? ""} ${t.building ?? ""} ${t.unit_no ?? ""} · ${t.planned_start ?? ""} to ${t.planned_end ?? ""} · ${TASK_STATUS_LABEL[t.status]}`}
                            className={cn("absolute top-1 bottom-1 rounded border px-1 text-[11px] leading-7 truncate", canWrite && "cursor-grab", TONE_CLASS[taskTone(t.status)])}
                            style={{ left: `calc(12rem + (100% - 12rem) * ${pl.col} / ${DAYS})`, width: `calc((100% - 12rem) * ${pl.span} / ${DAYS} - 2px)` }}
                          >
                            <Link to={`/projects/${t.project_id}`} className="hover:underline" draggable={false}>{t.label}</Link>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="md:hidden space-y-3">
            {days.map((d) => {
              const list = activeOn(tasks, d);
              if (list.length === 0) return null;
              return (
                <section key={d}>
                  <h3 className={cn("text-xs font-semibold uppercase tracking-wide", d === today ? "text-primary" : "text-ink-secondary")}>
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}
                  </h3>
                  <ul className="mt-1 space-y-1">
                    {list.map((t) => (
                      <li key={t.id}>
                        <Link to={`/projects/${t.project_id}`} className="block rounded-md border border-border bg-surface px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-ink truncate">{t.label}</span>
                            <span className={cn("rounded-full border px-2 text-[11px]", TONE_CLASS[taskTone(t.status)])}>{TASK_STATUS_LABEL[t.status]}</span>
                          </div>
                          <div className="text-xs text-ink-secondary truncate">{[t.project_code, t.building, t.unit_no].filter(Boolean).join(" ")} · {doerText(t)}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
