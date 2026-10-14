/* Renovation mode (Conts, 14 Oct 2026, "batch 4"; mig 0116): the "Project" block and the Room (and, on a PO or
   GR, Category) column of a delivery order, sales invoice, purchase order or goods receipt page. Everything here
   is copied from the sales order when the document is made (the 0116 triggers) and read back from
   GET <document>/:id/renovation-info. Outside renovation mode the read answers ready: false and nothing shows. */

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";
import type { Column } from "../../components/dataTableTypes";
import { cn } from "../../lib/utils";
import { renoCategoryLabel, renoHasInfo, renoProjectLabel, type RenoDocInfo, type RenoDocLine } from "../../vendor/scm/lib/renovation-doc-print";

export type RenoDocKind = "do" | "si" | "po" | "gr";
const PREFIX: Record<RenoDocKind, string> = {
  do: "/delivery-orders-mfg",
  si: "/sales-invoices",
  po: "/mfg-purchase-orders",
  gr: "/grns",
};

/** The document's renovation information; null until read, or when the install is not in renovation mode. */
/* A plain effect, not a query: these Houzs pages (and their tests) do not all sit under a QueryClientProvider, and a
   failed read must only mean "nothing extra to show". */
export function useRenoDocInfo(kind: RenoDocKind, id: string | null | undefined): RenoDocInfo | null {
  const [d, setD] = useState<RenoDocInfo | null>(null);
  useEffect(() => {
    setD(null);
    if (!id) return;
    let live = true;
    authedFetch<RenoDocInfo>(`${PREFIX[kind]}/${encodeURIComponent(id)}/renovation-info`)
      .then((r) => { if (live) setD(r); })
      .catch(() => { /* not renovation mode, or the read failed: show the page as it was */ });
    return () => { live = false; };
  }, [kind, id]);
  return d && renoHasInfo(d) ? d : null;
}

function Cell({ label, value, muted, span }: { label: string; value: ReactNode; muted?: boolean; span?: boolean }) {
  return (
    <div className={cn("min-w-0", span && "col-span-2")}>
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">{label}</div>
      <div className={cn("mt-1 break-words text-[14px] font-semibold leading-snug", muted ? "text-ink-muted" : "text-ink")}>{value}</div>
    </div>
  );
}

function DocLinks({ nos, to }: { nos: string[]; to: (no: string) => string }) {
  if (nos.length === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {nos.map((n) => <Link key={n} to={to(n)} className="font-mono text-primary hover:underline">{n}</Link>)}
    </span>
  );
}

/** Project, building, unit and the sales orders (and, on a GR, purchase orders) this document came from. */
export function RenovationDocBlock({ data, kind }: { data: RenoDocInfo; kind: RenoDocKind }) {
  const i = data.info!;
  const project = renoProjectLabel(data);
  const showUnit = kind === "do" || kind === "si";
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
      <Cell
        label="Project"
        span
        muted={!project}
        value={project && i.projectId != null
          ? <Link to={`/projects/${i.projectId}`} className="text-primary hover:underline">{project}</Link>
          : "No project"}
      />
      {showUnit && <Cell label="Building" value={i.building || "—"} muted={!i.building} />}
      {showUnit && <Cell label="Unit" value={i.unitNo || "—"} muted={!i.unitNo} />}
      <Cell
        label={i.soDocNos.length > 1 ? "Sales orders" : "Sales order"}
        span={!showUnit}
        value={<DocLinks nos={i.soDocNos} to={(n) => `/scm/sales-orders/${encodeURIComponent(n)}`} />}
        muted={i.soDocNos.length === 0}
      />
      {kind === "po" && i.categoryGroup && (
        <Cell label="Category" value={renoCategoryLabel({ room: "", categoryGroup: i.categoryGroup, subCategory: i.subCategory ?? "" })} />
      )}
      {kind === "gr" && (
        <Cell label={i.poNumbers.length > 1 ? "Purchase orders" : "Purchase order"} value={i.poNumbers.join(", ") || "—"} muted={i.poNumbers.length === 0} />
      )}
    </div>
  );
}

/** Room (and Category) columns for the document's lines table, put in front of its own columns. */
export function renoLineColumns<T extends { id: string }>(data: RenoDocInfo | null, withCategory: boolean): Column<T>[] {
  if (!data) return [];
  const lines = data.lines;
  const at = (id: string): RenoDocLine | undefined => lines[id];
  const cols: Column<T>[] = [];
  if (Object.values(lines).some((l) => l.room)) {
    cols.push({
      key: "reno_room",
      label: "Room",
      alwaysVisible: true,
      getValue: (r) => at(r.id)?.room ?? "",
      render: (r) => <span className="text-[12.5px] font-semibold text-ink">{at(r.id)?.room || "—"}</span>,
    });
  }
  if (withCategory && Object.values(lines).some((l) => l.categoryGroup)) {
    cols.push({
      key: "reno_category",
      label: "Category",
      getValue: (r) => renoCategoryLabel(at(r.id)),
      render: (r) => <span className="text-[12px] text-ink-secondary">{renoCategoryLabel(at(r.id)) || "—"}</span>,
    });
  }
  return cols;
}
