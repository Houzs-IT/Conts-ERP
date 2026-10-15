/* What a Procurement details row shows (owner, 15 Oct 2026): the three steps Ordered -> Received -> Delivered as
   counts of the row's item lines, Ready / LATE, and the goods receipts and delivery orders behind them (each opens
   its document; a DO links its proof of delivery). No item, PO or SO rows. */

import { Link } from "react-router-dom";
import { cn } from "../../../lib/utils";
import { shortDate } from "./renovationModel";
import type { Stage } from "./procurementStatusModel";

const docLink = "font-mono font-semibold text-primary hover:underline";

function Step({ label, n, of, done }: { label: string; n: number; of: number; done: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold",
      done ? "bg-synced-bg text-synced" : n > 0 ? "bg-warning-bg text-warning-text" : "bg-surface-dim text-ink-secondary")}>
      {label} {n}/{of}
    </span>
  );
}

/** "Ordered 3/5 > Received 2/3 > Delivered 1/5", then Ready or LATE. Received counts only the lines that went through
    a PO, and is left out when none did; Ordered and Delivered count every item line, stock lines included. */
export function StagePills({ s, late }: { s: Stage; late: boolean }) {
  if (s.items === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1"
      aria-label={`${s.ordered} of ${s.items} ordered, ${s.received} of ${s.toReceive} received, ${s.delivered} of ${s.items} delivered`}>
      <Step label="Ordered" n={s.ordered} of={s.items} done={s.ordered === s.items} />
      {s.toReceive > 0 && (
        <>
          <span aria-hidden className="text-[10px] text-ink-secondary">&rsaquo;</span>
          <Step label="Received" n={s.received} of={s.toReceive} done={s.received === s.toReceive} />
        </>
      )}
      <span aria-hidden className="text-[10px] text-ink-secondary">&rsaquo;</span>
      <Step label="Delivered" n={s.delivered} of={s.items} done={s.delivered === s.items} />
      {s.ready && <span className="rounded bg-synced px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Ready</span>}
      {late && <span className="rounded bg-err-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-err">Late</span>}
    </span>
  );
}

/** The goods receipts and delivery orders of a row, one line each kind, each number opening its document. */
export function DocLinks({ s, indent }: { s: Stage; indent?: boolean }) {
  if (s.grs.length === 0 && s.dos.length === 0) return null;
  return (
    <div className={cn("space-y-0.5 text-[11px] leading-snug text-ink-secondary", indent ? "pl-4" : "pl-[17px]")}>
      {s.grs.length > 0 && (
        <div>
          <span className="font-semibold text-ink">GR </span>
          {s.grs.map((g, i) => (
            <span key={g.id}>
              {i > 0 && ", "}
              <Link to={`/scm/grns/${g.id}`} className={docLink}>{g.no}</Link>
              {g.date ? ` ${shortDate(g.date)}` : ""}
              {g.atSite ? " at site" : ""}
              {g.photos > 0 && <> (<Link to={`/scm/grns/${g.id}`} className="text-primary hover:underline">{g.photos} photo{g.photos === 1 ? "" : "s"}</Link>)</>}
            </span>
          ))}
        </div>
      )}
      {s.dos.length > 0 && (
        <div>
          <span className="font-semibold text-ink">DO </span>
          {s.dos.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <Link to={`/scm/delivery-orders/${d.id}`} className={docLink}>{d.no}</Link>
              {d.date ? ` ${shortDate(d.date)}` : ""}
              {d.delivered ? "" : ` (${d.status.toLowerCase().replace(/_/g, " ")})`}
              {(d.signed || d.hasPod) && <> · <Link to={`/scm/delivery-orders/${d.id}`} className="text-primary hover:underline">proof of delivery{d.signed ? " (signed)" : ""}</Link></>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
