/* The renovation Project List as a board by step (owner, 16 Oct 2026): one column per step (Design, Signed, Ordering,
   Renovation, Handover, Closed) with its count, compact cards (name, customer, PIC, planned handover, days in step
   against the SLA with Overdue, In defect / On hold). Dragging a card to another column is the project page's
   "Move step": the same confirmation, optional reason and server rules (POST /api/renovation/:id/step; a step
   switched off in Project Maintenance is refused there). Closed starts collapsed and, opened, shows the projects
   closed in the last 30 days first, with the rest one click away. The list's filters (brand, dates, status, My
   pending tasks, Hide completed, Show archived) decide which projects are on the board.
   Phone: a step switcher (tabs with counts) above the chosen step's cards; dragging is a desktop gesture, so a
   phone moves a step from the project page. */

import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Timer } from "lucide-react";
import { Button } from "../../../components/Button";
import { cn, formatDate } from "../../../lib/utils";
import type { FlowStepKey } from "../../../vendor/shared/renovation-stages";
import type { ProjectRow } from "../types";
import { simpleApi, type BoardRowV2 } from "./simpleApi";
import { listFlags, projectHref, type StepDef } from "./renovationListModel";
import { errorText } from "./renovationModel";
import { Dialog, Field, inputClass } from "./renovationUi";

export const CLOSED_RECENT_DAYS = 30;

export interface BoardCardData { row: ProjectRow; board: BoardRowV2 }

/** Cards per column, in list order; a project the board rows do not know (no step) is left out. Pure. */
export function boardColumns(rows: readonly ProjectRow[], byId: ReadonlyMap<number, BoardRowV2>, steps: readonly StepDef[]): Map<FlowStepKey, BoardCardData[]> {
  const out = new Map<FlowStepKey, BoardCardData[]>(steps.map((s) => [s.key, []]));
  for (const row of rows) {
    const board = byId.get(row.id);
    if (!board) continue;
    out.get(board.step.key as FlowStepKey)?.push({ row, board });
  }
  return out;
}

/** Closed projects split into those closed in the last 30 days (newest first) and the older rest. Pure. */
export function splitClosed(cards: readonly BoardCardData[], today: string): { recent: BoardCardData[]; older: BoardCardData[] } {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - CLOSED_RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  /* The earlier of the handover and the day it reached Closed: an imported project reached Closed on the import day,
     but it was handed over long before. */
  const day = (c: BoardCardData) => [c.board.handoverDate, c.board.endDate].filter((d): d is string => !!d).sort()[0] ?? "";
  const sorted = [...cards].sort((a, b) => day(b).localeCompare(day(a)));
  return { recent: sorted.filter((c) => day(c) >= cutoff), older: sorted.filter((c) => day(c) < cutoff) };
}

const initials = (name: string | null) => (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function BoardCard({ c, today, draggable, onOpen, onDragStart }: {
  c: BoardCardData; today: string; draggable: boolean; onOpen: (href: string) => void; onDragStart?: (e: DragEvent, c: BoardCardData) => void;
}) {
  const { row, board } = c;
  const flags = listFlags(board, today);
  const overdue = board.sla?.overdueBy != null;
  const open = () => onOpen(projectHref(row.id));
  const onKey = (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } };
  const handover = board.handoverDate
    ? { label: "Handed over", value: formatDate(board.handoverDate) }
    : board.step.key === "closed" ? { label: "Closed", value: board.endDate ? formatDate(board.endDate) : "—" }
    : { label: "Handover", value: board.plannedHandoverDate ? formatDate(board.plannedHandoverDate) : "Not set" };
  return (
    <div
      role="link"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, c)}
      onClick={open}
      onKeyDown={onKey}
      data-testid="reno-board-card"
      title={draggable ? "Open the project, or drag it to another step" : undefined}
      className={cn(
        "group relative cursor-pointer rounded-lg border bg-surface p-2.5 shadow-stone transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        overdue || board.hold || flags.late.length ? "border-err/40" : "border-border",
        row.archived_at && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 break-words text-[12.5px] font-bold leading-snug text-ink group-hover:text-primary">{row.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-ink-secondary">{board.customerName || "No customer yet"}</div>
        </div>
        <span
          title={board.renoPic.name ? `PIC ${board.renoPic.name}` : "No PIC"}
          className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold",
            board.renoPic.name ? "bg-primary-soft text-primary-ink" : "border border-dashed border-border text-ink-muted")}
        >
          {board.renoPic.name ? initials(board.renoPic.name) : "–"}
        </span>
      </div>
      {(board.hold || overdue || flags.late.length > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {board.hold && <Tag title={board.hold.note ?? board.hold.label}>{board.hold.label}</Tag>}
          {overdue && <Tag title={`${board.sla!.daysIn} days in step, ${board.sla!.days} allowed`} icon={<Timer size={9} />}>Overdue {board.sla!.overdueBy}d</Tag>}
          {flags.late.length > 0 && <Tag title={flags.late.join("\n")} icon={<AlertTriangle size={9} />}>Late</Tag>}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10.5px] text-ink-secondary">
        <span className="inline-flex items-center gap-1 whitespace-nowrap" title={handover.label}>
          <CalendarClock size={10} className="shrink-0" />{handover.label}: <span className={cn("font-semibold", handover.value === "Not set" ? "text-ink-muted" : "text-ink")}>{handover.value}</span>
        </span>
        {board.sla && board.sla.daysIn != null && (
          <span className={cn("shrink-0 font-mono", overdue ? "font-bold text-err" : "text-ink-secondary")}
            title={board.sla.days != null ? `${board.sla.daysIn} days in this step of ${board.sla.days} allowed` : `${board.sla.daysIn} days in this step (no SLA)`}>
            {board.sla.daysIn}d{board.sla.days != null ? ` / ${board.sla.days}d` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function Tag({ children, title, icon }: { children: React.ReactNode; title: string; icon?: React.ReactNode }) {
  return (
    <span title={title} className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border border-err/30 bg-err-bg px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-err">
      {icon}{children}
    </span>
  );
}

export function RenovationStepBoard({ rows, byId, steps, today, canWrite, onOpen, onMoved, truncatedAt }: {
  rows: readonly ProjectRow[];
  byId: ReadonlyMap<number, BoardRowV2>;
  steps: readonly StepDef[];
  today: string;
  canWrite: boolean;
  onOpen: (href: string) => void;
  onMoved: (text: string) => void;
  /** set when the filtered list has more projects than the board loaded */
  truncatedAt?: { shown: number; total: number } | null;
}) {
  const cols = useMemo(() => boardColumns(rows, byId, steps), [rows, byId, steps]);
  const [closedOpen, setClosedOpen] = useState(false);
  const [closedAll, setClosedAll] = useState(false);
  const [phoneStep, setPhoneStep] = useState<FlowStepKey | null>(null);
  const [dragging, setDragging] = useState<BoardCardData | null>(null);
  const [over, setOver] = useState<FlowStepKey | null>(null);
  const [moving, setMoving] = useState<{ card: BoardCardData; to: StepDef } | null>(null);

  const firstWithCards = (steps.find((s) => (cols.get(s.key)?.length ?? 0) > 0) ?? steps.at(0))?.key ?? null;
  const phoneKey = phoneStep ?? firstWithCards;

  const cardsOf = (key: FlowStepKey, all: boolean) => {
    const list = cols.get(key) ?? [];
    if (key !== "closed" || all) return { shown: list, hidden: 0 };
    const { recent, older } = splitClosed(list, today);
    return { shown: recent, hidden: older.length };
  };

  const startDrag = (e: DragEvent, c: BoardCardData) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(c.row.id));
    setDragging(c);
  };
  const drop = (to: StepDef) => {
    const c = dragging;
    setDragging(null);
    setOver(null);
    if (c && c.board.step.key !== to.key) setMoving({ card: c, to });
  };

  return (
    <div data-testid="reno-board">
      {truncatedAt && (
        <p className="mb-2 text-[11px] text-ink-secondary">The board shows the first {truncatedAt.shown} of {truncatedAt.total} projects. Narrow the filters, or use the Table view to page through all of them.</p>
      )}

      {/* Phone: a step switcher and the chosen step's cards. */}
      <div className="sm:hidden">
        <div className="no-scrollbar -mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Steps">
          {steps.map((s) => (
            <button key={s.key} type="button" role="tab" aria-selected={phoneKey === s.key} onClick={() => setPhoneStep(s.key)}
              className={cn("shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold",
                phoneKey === s.key ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink-secondary")}>
              {s.label} <span className={phoneKey === s.key ? "text-white/80" : "text-ink-muted"}>{cols.get(s.key)?.length ?? 0}</span>
            </button>
          ))}
        </div>
        {phoneKey && (() => {
          const { shown, hidden } = cardsOf(phoneKey, closedAll);
          return (
            <div className="space-y-2">
              {shown.map((c) => <BoardCard key={c.row.id} c={c} today={today} draggable={false} onOpen={onOpen} />)}
              {shown.length === 0 && hidden === 0 && <p className="py-6 text-center text-[12px] text-ink-muted">No projects in this step.</p>}
              {hidden > 0 && <ShowOlder n={hidden} onClick={() => setClosedAll(true)} />}
            </div>
          );
        })()}
      </div>

      {/* Desktop: one column per step. */}
      <div className="hidden gap-2 overflow-x-auto pb-2 sm:flex">
        {steps.map((s) => {
          const count = cols.get(s.key)?.length ?? 0;
          const collapsed = s.key === "closed" && !closedOpen;
          const { shown, hidden } = cardsOf(s.key, closedAll);
          const canDrop = !!dragging && dragging.board.step.key !== s.key;
          return (
            <section
              key={s.key}
              aria-label={`${s.label}, ${count} project${count === 1 ? "" : "s"}`}
              onDragOver={(e) => { if (canDrop) { e.preventDefault(); setOver(s.key); } }}
              onDragLeave={() => setOver((k) => (k === s.key ? null : k))}
              onDrop={(e) => { e.preventDefault(); drop(s); }}
              className={cn(
                "flex min-w-0 flex-col rounded-xl border bg-surface-dim/60 transition-colors",
                collapsed ? "w-12 shrink-0" : "min-w-[188px] flex-1 basis-0",
                over === s.key ? "border-primary bg-primary-soft/40" : "border-border",
              )}
              data-testid={`reno-board-col-${s.key}`}
            >
              {collapsed ? (
                <button type="button" onClick={() => setClosedOpen(true)} title={`Show ${s.label}`}
                  className="flex h-full min-h-[160px] flex-col items-center gap-2 py-3 text-ink-secondary hover:text-ink">
                  <ChevronLeft size={14} />
                  <span className="font-display text-[15px] font-extrabold text-ink">{count}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">{s.label}</span>
                </button>
              ) : (
                <>
                  <header className="flex items-center justify-between gap-1 px-2.5 pb-1.5 pt-2.5">
                    <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">{s.label}</span>
                    <span className="flex items-center gap-1">
                      <span className="rounded-full bg-surface px-1.5 text-[11px] font-bold text-ink">{count}</span>
                      {s.key === "closed" && (
                        <button type="button" onClick={() => { setClosedOpen(false); setClosedAll(false); }} title="Collapse Closed" className="text-ink-secondary hover:text-ink">
                          <ChevronRight size={14} />
                        </button>
                      )}
                    </span>
                  </header>
                  <div className="flex flex-col gap-2 px-2 pb-2">
                    {shown.map((c) => (
                      <BoardCard key={c.row.id} c={c} today={today} draggable={canWrite} onOpen={onOpen} onDragStart={startDrag} />
                    ))}
                    {s.key === "closed" && !closedAll && shown.length === 0 && hidden > 0 && (
                      <p className="px-1 text-[11px] text-ink-muted">Nothing closed in the last {CLOSED_RECENT_DAYS} days.</p>
                    )}
                    {hidden > 0 && <ShowOlder n={hidden} onClick={() => setClosedAll(true)} />}
                    {count === 0 && <p className="px-1 py-3 text-center text-[11px] text-ink-muted">No projects</p>}
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>

      {moving && (
        <MoveDialog card={moving.card} to={moving.to} steps={steps} onClose={() => setMoving(null)}
          onMoved={(text) => { setMoving(null); onMoved(text); }} />
      )}
    </div>
  );
}

function ShowOlder({ n, onClick }: { n: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full rounded-md border border-dashed border-border py-1.5 text-[11px] font-semibold text-primary hover:bg-surface">
      Show {n} closed earlier
    </button>
  );
}

/* The same move as the project page's "Move step..." (FlowPanel's MoveStepDialog): confirm, optional reason, recorded
   in the step history; the step then holds until the data moves past it. */
function MoveDialog({ card, to, steps, onClose, onMoved }: {
  card: BoardCardData; to: StepDef; steps: readonly StepDef[]; onClose: () => void; onMoved: (text: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = steps.find((s) => s.key === card.board.step.key)?.label ?? card.board.step.label;
  return (
    <Dialog title="Move the project to a step" onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try {
            await simpleApi.setStep(card.row.id, to.key, reason.trim() || null);
            onMoved(`${card.row.name} moved to ${to.label}.`);
          } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
        }}>{busy ? "Saving..." : `Move to ${to.label}`}</Button>
      </>}>
      <p className="mb-3 text-sm text-ink">{card.row.name}: <span className="font-semibold">{from}</span> to <span className="font-semibold">{to.label}</span></p>
      <p className="mb-3 text-sm text-ink-secondary">The step stays where you put it until the data in the sales order, purchase orders, site tasks or handover moves past it. Who moved it and when is recorded.</p>
      <Field label="Reason (optional)"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      {error && <p role="alert" className="mt-2 text-sm text-err">{error}</p>}
    </Dialog>
  );
}
