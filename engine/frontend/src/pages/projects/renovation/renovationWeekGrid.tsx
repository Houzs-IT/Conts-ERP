/* The Calendar's Week view in renovation mode (owner, 15 Oct 2026): seven days, each with the dated items of the
   renovation projects as chips ("<project short name> · <what>", coloured by kind), a chip opens its project.
   Seven columns from tablet width up; a list of days on a phone. Month view keeps the project bars. */

import { cn } from "../../../lib/utils";
import { getHolidaysOn } from "../../../lib/holidays";
import { RENO_ITEM_CLASS, RENO_ITEM_KINDS, itemLabel, type RenoCalendarItem } from "./renovationCalendarItems";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function RenovationItemLegend() {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Item colours">
      {RENO_ITEM_KINDS.map((k) => (
        <span key={k.kind} className={cn("rounded border px-1.5 py-0.5 font-semibold", RENO_ITEM_CLASS[k.kind])}>{k.label}</span>
      ))}
    </div>
  );
}

function Chip({ item, onOpen }: { item: RenoCalendarItem; onOpen: (projectId: number) => void }) {
  const label = itemLabel(item);
  const dim = item.done && (item.kind === "task" || item.kind === "handover");
  return (
    <button
      type="button"
      onClick={() => onOpen(item.projectId)}
      title={`${item.projectName} · ${item.what}${dim ? " (done)" : ""}`}
      data-kind={item.kind}
      className={cn(
        "block w-full break-words rounded border px-1.5 py-1 text-left text-[11px] font-semibold leading-tight transition-transform hover:-translate-y-px",
        RENO_ITEM_CLASS[item.kind],
        dim && "opacity-55 line-through",
      )}
    >
      {label}
    </button>
  );
}

export function RenovationWeekGrid({ days, byDate, today, showHolidays, loading, onOpen }: {
  days: string[];
  byDate: Map<string, RenoCalendarItem[]>;
  today: string;
  showHolidays: boolean;
  loading: boolean;
  onOpen: (projectId: number) => void;
}) {
  const total = days.reduce((n, d) => n + (byDate.get(d)?.length ?? 0), 0);
  return (
    <div className="rounded-md border border-border bg-surface" data-testid="reno-week">
      <div className="grid grid-cols-1 md:grid-cols-7">
        {days.map((iso) => {
          const items = byDate.get(iso) ?? [];
          const holidays = showHolidays ? getHolidaysOn(iso) : [];
          const isToday = iso === today;
          return (
            <section
              key={iso}
              aria-label={dayLabel(iso)}
              className={cn(
                "min-w-0 border-b border-border px-2 py-2 md:min-h-[320px] md:border-r",
                holidays.length > 0 && "bg-[#e7e8f5]",
              )}
            >
              <div className="mb-1.5 flex items-center justify-between gap-1 md:justify-center">
                <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-[12px] font-semibold", isToday ? "bg-primary text-white" : "text-ink-secondary")}>
                  {dayLabel(iso)}
                </span>
                {items.length > 0 && <span className="font-mono text-[10.5px] text-ink-muted md:ml-1">{items.length}</span>}
              </div>
              {holidays.length > 0 && (
                <div className="mb-1 truncate rounded bg-[#bcc0e6] px-1.5 py-0.5 text-[10px] font-semibold text-[#2b3063]" title={holidays.map((h) => h.name).join(", ")}>
                  {holidays[0]!.name}
                </div>
              )}
              <div className="space-y-1">
                {items.map((i) => <Chip key={i.key} item={i} onOpen={onOpen} />)}
                {items.length === 0 && <div className="py-1 text-center text-[11px] text-ink-muted md:hidden">Nothing dated</div>}
              </div>
            </section>
          );
        })}
      </div>
      {!loading && total === 0 && (
        <p className="px-3 py-3 text-center text-[12px] text-ink-muted">
          Nothing dated this week: no onsite visits, 3D / 2D submissions, PO or delivery dates, site tasks or planned handovers.
        </p>
      )}
    </div>
  );
}
