/* Sales order detail, "By area" (owner, 24 Oct 2026). A renovation SO's lines grouped under their area (room)
   headings with a subtotal per area, beside the existing "By item" table. Conts only: it shows only when the order
   has rooms (renovation mode, mig 0112). The cells are the "By item" table's own column renderers, so the two views
   cannot show a line differently. */
import type { ReactElement, ReactNode } from "react";
import { roomGroups, type SoPrintRooms } from "../../vendor/scm/lib/so-print-rooms";

export type SoLinesView = "item" | "area" | "category";

export function SoLinesViewToggle({ view, onChange }: { view: SoLinesView; onChange: (v: SoLinesView) => void }): ReactElement {
  const btn = (v: SoLinesView, label: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => onChange(v)}
      className={
        "h-7 px-3 text-[12px] font-semibold transition-colors " +
        (view === v ? "bg-primary text-white" : "bg-surface text-ink-secondary hover:bg-surface-dim")
      }
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Show lines" className="inline-flex overflow-hidden rounded-md border border-border">
      {btn("item", "By item")}
      {btn("area", "By area")}
      {btn("category", "By category")}
    </div>
  );
}

interface AreaColumn<T> { key: string; label: string; align?: "left" | "right" | "center"; render?: (row: T) => ReactNode }

/** The lines under area headings, a subtotal under each area. `columns` are the "By item" table's columns. */
export function SoAreaLines<T extends { id: string; total_sen?: number | null }>({
  items, rooms, columns, money,
}: {
  items: readonly T[];
  rooms: SoPrintRooms;
  columns: ReadonlyArray<AreaColumn<T>>;
  money: (sen: number) => string;
}): ReactElement {
  const groups = roomGroups(items, rooms);
  if (groups.length === 0) return <p className="py-6 text-center text-[13px] text-ink-muted">No line items</p>;
  const cols = columns;
  const alignClass = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {cols.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-muted ${alignClass(c.align)}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.area}>
            <tr className="bg-surface-2">
              <th scope="rowgroup" colSpan={cols.length} className="px-3 py-2 text-left text-[12.5px] font-bold text-ink">
                {g.area}
                <span className="ml-2 text-[11.5px] font-medium text-ink-muted">
                  {g.lines.length} line{g.lines.length === 1 ? "" : "s"}
                </span>
              </th>
            </tr>
            {g.lines.map((l) => (
              <tr key={l.id} className="border-b border-border/60 align-top">
                {cols.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${alignClass(c.align)}`}>{c.render ? c.render(l) : null}</td>
                ))}
              </tr>
            ))}
            <tr className="border-b border-border">
              <td colSpan={cols.length - 1} className="px-3 py-2 text-right text-[12px] font-semibold text-ink-secondary">
                Subtotal · {g.area}
              </td>
              <td className="px-3 py-2 text-right font-money text-[13px] font-bold text-ink">{money(g.subtotalSen)}</td>
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}
