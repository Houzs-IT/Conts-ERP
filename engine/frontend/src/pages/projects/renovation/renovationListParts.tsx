/* The renovation Project List (owner, 15 Oct 2026): step tiles in place of the event KPI tiles, a card per project
   (name, customer, PIC, the 6-step track, planned handover, late / at-risk flags) and the matching table columns.
   The list rows still come from GET /api/projects (filters, paging, export); the renovation facts per project
   come from GET /api/renovation/board-rows and are joined here by id. */

import type { KeyboardEvent, ReactNode } from "react";
import { AlertTriangle, CalendarClock, Clock, Timer } from "lucide-react";
import type { Column } from "../../../components/DataTable";
import { useQuery } from "../../../hooks/useQuery";
import { cn, formatDate } from "../../../lib/utils";
import type { FlowStepKey } from "../../../vendor/shared/renovation-stages";
import type { ProjectRow } from "../types";
import { simpleApi, type BoardRowV2 } from "./simpleApi";
import { activeSteps, listFlags, projectHref, stepCounts, type StepDef } from "./renovationListModel";

/** Board rows (renovation facts per project) and the company's steps; fetches nothing when `enabled` is false. */
export function useRenovationBoard(includeArchived: boolean, enabled: boolean) {
  const board = useQuery(["renovation", "board-rows", includeArchived ? "archived" : "live"], () => simpleApi.boardRows(includeArchived), [includeArchived], { keepPreviousData: true, enabled });
  const flow = useQuery(["renovation", "flow-steps"], () => simpleApi.flowSteps(), [], { staleTime: 5 * 60_000, enabled });
  const rows = board.data?.data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  return { rows, byId, steps: activeSteps(flow.data?.data), counts: stepCounts(rows), loading: board.loading && !board.data, error: board.error, reload: board.reload };
}

/** One tile per step with how many projects are in it; a tile filters the list to that step (several can be on). */
export function RenovationStepTiles({ steps, counts, selected, onToggle, loading }: {
  steps: StepDef[];
  counts: Record<FlowStepKey, number>;
  selected: readonly string[];
  onToggle: (key: FlowStepKey) => void;
  loading: boolean;
}) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6" role="group" aria-label="Projects per step">
      {steps.map((s) => {
        const on = selected.includes(s.key);
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(s.key)}
            title={on ? `Showing ${s.label} only. Click to show every step again.` : `Show only projects in ${s.label}`}
            className={cn(
              "rounded-lg border px-3 py-2 text-left shadow-stone transition-colors",
              on ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink hover:border-primary/50",
            )}
          >
            <div className={cn("truncate text-[11px] font-semibold uppercase tracking-wider", on ? "text-white/85" : "text-ink-secondary")}>{s.label}</div>
            <div className="mt-0.5 font-display text-[22px] font-extrabold leading-none">{loading ? "—" : counts[s.key]}</div>
          </button>
        );
      })}
    </div>
  );
}

/** The six steps in a row, the current one filled; a step opens the project at that step's section. */
export function RenovationStepTrack({ steps, current, onPick, size = "card" }: {
  steps: StepDef[];
  current: string | null;
  onPick: (key: FlowStepKey) => void;
  size?: "card" | "table";
}) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    // On a phone the card's track wraps to two rows of three so every label is readable and easy to tap.
    <ol className={cn("w-full gap-0.5", size === "table" ? "flex min-w-[300px]" : "grid grid-cols-3 sm:flex")} aria-label="Project steps">
      {steps.map((s, i) => {
        const state = idx < 0 ? "todo" : i < idx ? "done" : i === idx ? "current" : "todo";
        return (
          <li key={s.key} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPick(s.key); }}
              aria-current={state === "current" ? "step" : undefined}
              title={`${s.label}${state === "current" ? " (current step)" : ""}: open this part of the project`}
              className={cn(
                "block w-full truncate rounded-[3px] px-1 text-center font-semibold transition-colors",
                size === "table" ? "py-0.5 text-[10px]" : "py-1 text-[10.5px]",
                state === "current" && "bg-primary text-white",
                state === "done" && "bg-primary-soft text-primary-ink hover:bg-primary/20",
                state === "todo" && "bg-surface-dim text-ink-muted hover:bg-border",
              )}
            >
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function RenovationFlagPills({ board, today }: { board: BoardRowV2 | undefined; today: string }) {
  if (!board) return null;
  const f = listFlags(board, today);
  const pill = (cls: string, icon: ReactNode, text: string, title: string) => (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", cls)}>
      {icon}{text}
    </span>
  );
  return (
    <>
      {board.hold && pill("border-err/30 bg-err-bg text-err", null, board.hold.label, board.hold.note ?? board.hold.label)}
      {board.sla?.overdueBy != null && pill("border-err/30 bg-err-bg text-err", <Timer size={10} />, "Overdue",
        `${board.step.label}: ${board.sla.daysIn} days in step, ${board.sla.days} allowed (over by ${board.sla.overdueBy} day${board.sla.overdueBy === 1 ? "" : "s"})`)}
      {f.late.length > 0 && pill("border-err/30 bg-err-bg text-err", <AlertTriangle size={10} />, "Late", f.late.join("\n"))}
      {f.atRisk.length > 0 && pill("border-warning-text/30 bg-warning-bg text-warning-text", <Clock size={10} />, "At risk", f.atRisk.join("\n"))}
    </>
  );
}

function handoverText(board: BoardRowV2 | undefined): { label: string; value: string } {
  if (board?.handoverDate) return { label: "Handed over", value: formatDate(board.handoverDate) };
  /* A Closed project without a recorded handover: "Planned handover: Not set" says nothing useful there. */
  if (board?.step.key === "closed") return { label: "Closed", value: board.endDate ? formatDate(board.endDate) : "Closed" };
  if (board?.plannedHandoverDate) return { label: "Planned handover", value: formatDate(board.plannedHandoverDate) };
  return { label: "Planned handover", value: "Not set" };
}

export function RenovationProjectCard({ row, board, steps, today, onOpen }: {
  row: ProjectRow;
  board: BoardRowV2 | undefined;
  steps: StepDef[];
  today: string;
  onOpen: (href: string) => void;
}) {
  const flags = board ? listFlags(board, today) : { late: [], atRisk: [] };
  const rail = board?.hold || flags.late.length || board?.sla?.overdueBy != null ? "bg-err" : flags.atRisk.length ? "bg-warning-text" : board?.step.key === "closed" ? "bg-synced" : "bg-primary";
  const ho = handoverText(board);
  const open = () => onOpen(projectHref(row.id));
  const onKey = (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } };
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
      data-testid="reno-card"
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-surface p-3.5 pl-[18px] shadow-stone transition-all hover:-translate-y-px hover:border-primary hover:shadow-slab focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:p-4 sm:pl-5",
        row.archived_at && "opacity-60",
      )}
    >
      <span className={cn("absolute left-0 top-0 h-full w-[3px]", rail)} />
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate font-display text-[15px] font-bold text-ink group-hover:text-primary">{row.name}</span>
            {row.archived_at && <span className="rounded-full border border-ink-muted/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">Archived</span>}
            <RenovationFlagPills board={board} today={today} />
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-secondary">
            <span>{board?.customerName || "No customer yet"}</span>
            <span className="text-ink-muted"> · PIC </span>
            <span>{board?.renoPic.name || "not set"}</span>
          </div>
          {board?.startDate && (
            <div className="mt-0.5 truncate text-[11.5px] text-ink-muted" data-testid="reno-card-dates">
              Started {formatDate(board.startDate)}{board.endDate ? ` · Closed ${formatDate(board.endDate)}` : ""}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right" title={ho.label}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{ho.label}</div>
          <div className={cn("inline-flex items-center gap-1 text-[12.5px] font-semibold", flags.late.length ? "text-err" : ho.value === "Not set" ? "text-ink-muted" : "text-ink")}>
            <CalendarClock size={12} />{ho.value}
          </div>
        </div>
      </div>
      <div className="mt-2.5">
        {board ? (
          <RenovationStepTrack steps={steps} current={board.step.key} onPick={(k) => onOpen(projectHref(row.id, k))} />
        ) : (
          <div className="text-[11px] text-ink-muted">Step not available</div>
        )}
      </div>
    </div>
  );
}

/** The Table view in renovation mode: the same facts as the cards, one column each. Only Code and Project sort on
    the server; the rest sort the loaded page. */
export function renovationColumns({ byId, steps, today, onOpen }: {
  byId: Map<number, BoardRowV2>;
  steps: StepDef[];
  today: string;
  onOpen: (href: string) => void;
}): Column<ProjectRow>[] {
  const b = (r: ProjectRow) => byId.get(r.id);
  const stepIndex = (r: ProjectRow) => steps.findIndex((s) => s.key === b(r)?.step.key);
  return [
    { key: "code", label: "Code", defaultHidden: true, render: (r) => <span className="font-mono text-xs">{r.code}</span>, getValue: (r) => r.code },
    {
      key: "name",
      label: "Project",
      alwaysVisible: true,
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
          {r.name}
          {r.archived_at && <span className="rounded-full border border-ink-muted/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted">Archived</span>}
        </span>
      ),
      getValue: (r) => r.name,
    },
    { key: "reno_customer", label: "Customer", disableSort: true, render: (r) => <span className="text-[12px]">{b(r)?.customerName || "—"}</span>, getValue: (r) => b(r)?.customerName ?? "" },
    { key: "reno_pic", label: "PIC", disableSort: true, render: (r) => <span className="text-[12px]">{b(r)?.renoPic.name || "—"}</span>, getValue: (r) => b(r)?.renoPic.name ?? "" },
    {
      key: "reno_step",
      label: "Step",
      disableSort: true,
      render: (r) => {
        const row = b(r);
        /* Dense table (owner, 16 Oct 2026): the current step as a pill with its place, not the six-step track, which
           was squeezed to "Design Si" in a table column. */
        if (!row) return <span className="text-ink-muted">—</span>;
        const i = steps.findIndex((s) => s.key === row.step.key);
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", row.step.key === "closed" ? "bg-synced-bg text-synced" : "bg-primary-soft text-primary-ink")}>{row.step.label}</span>
            {i >= 0 && <span className="text-[10.5px] text-ink-muted">{i + 1}/{steps.length}</span>}
            {row.sla?.daysIn != null && <span className={cn("text-[10.5px]", row.sla.overdueBy != null ? "font-semibold text-err" : "text-ink-muted")}>{row.sla.daysIn}d{row.sla.days != null ? `/${row.sla.days}d` : ""}</span>}
          </span>
        );
      },
      getValue: (r) => b(r)?.step.label ?? "",
      sortCompare: (x, y) => stepIndex(x) - stepIndex(y),
    },
    /* Filled by the system (migration 0117): the created day, and the day the project reached Closed. */
    {
      key: "reno_start",
      label: "Start date",
      disableSort: true,
      render: (r) => <span className="text-[12px]">{b(r)?.startDate ? formatDate(b(r)!.startDate!) : "—"}</span>,
      getValue: (r) => b(r)?.startDate ?? "",
    },
    {
      key: "reno_end",
      label: "End date",
      disableSort: true,
      render: (r) => <span className="text-[12px]">{b(r)?.endDate ? formatDate(b(r)!.endDate!) : <span className="text-ink-muted">—</span>}</span>,
      getValue: (r) => b(r)?.endDate ?? "",
    },
    {
      key: "reno_handover",
      label: "Planned handover",
      disableSort: true,
      render: (r) => {
        const row = b(r);
        if (row?.handoverDate) return <span className="text-[12px]" title="Handed over">{formatDate(row.handoverDate)} <span className="text-ink-muted">(handed over)</span></span>;
        if (!row?.plannedHandoverDate) return <span className="text-[12px] text-ink-muted">—</span>;
        return <span className={cn("text-[12px]", listFlags(row, today).late.length ? "font-semibold text-err" : "")}>{formatDate(row.plannedHandoverDate)}</span>;
      },
      getValue: (r) => b(r)?.handoverDate ?? b(r)?.plannedHandoverDate ?? "",
    },
    {
      key: "reno_flags",
      label: "Flags",
      disableSort: true,
      render: (r) => <span className="flex min-w-[9rem] flex-wrap gap-1"><RenovationFlagPills board={b(r)} today={today} /></span>,
      getValue: (r) => {
        const row = b(r);
        if (!row) return "";
        const f = listFlags(row, today);
        return [row.hold?.label, row.sla?.overdueBy != null ? "Overdue" : null, f.late.length ? "Late" : null, f.atRisk.length ? "At risk" : null].filter(Boolean).join(", ");
      },
    },
    { key: "created_by_name", label: "Created By", defaultHidden: true, render: (r) => <span className="text-[11px]">{r.created_by_name || "—"}</span>, getValue: (r) => r.created_by_name ?? "" },
  ];
}

/** Right rail of the card view: the filtered total and the next planned handovers (not yet handed over). */
export function RenovationListAside({ total, board, today, onOpen }: { total: number | null; board: readonly BoardRowV2[]; today: string; onOpen: (href: string) => void }) {
  const next = board
    .filter((r) => !r.handoverDate && r.plannedHandoverDate && r.step.key !== "closed" && !r.archived)
    .sort((a, b) => String(a.plannedHandoverDate).localeCompare(String(b.plannedHandoverDate)))
    .slice(0, 6);
  return (
    <aside className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-primary-soft p-4 shadow-stone">
        <div className="font-mono text-[10px] font-bold uppercase tracking-brand text-primary-ink">Total</div>
        <div className="mt-1.5 font-display text-[28px] font-extrabold leading-none text-primary-ink">{total ?? "—"}</div>
        <div className="mt-1 text-[11px] text-primary-ink/70">projects (filtered)</div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 shadow-stone">
        <div className="mb-2.5 text-[13px] font-bold text-ink">Next handovers</div>
        {next.length === 0 ? (
          <div className="py-3 text-center text-[11px] text-ink-muted">No planned handovers</div>
        ) : (
          <ul className="space-y-2">
            {next.map((r) => {
              const late = String(r.plannedHandoverDate) < today;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => onOpen(projectHref(r.id))} className="group flex w-full items-center justify-between gap-2 text-left">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink group-hover:text-primary">{r.name}</span>
                    <span className={cn("shrink-0 font-mono text-[10.5px]", late ? "font-bold text-err" : "text-ink-muted")}>{formatDate(r.plannedHandoverDate)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
