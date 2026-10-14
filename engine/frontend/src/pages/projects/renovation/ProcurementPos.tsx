/* The documents inside Procurement details (owner, 14 Oct 2026, "batch 4"; mig 0116). Procurement details is the
   project's documents hub: the quotation and sales orders on top (each SO with its delivery orders, their proof of
   delivery, and its invoices), then under each category / sub-category row its POs, and under each PO its goods
   receipts with the site photos taken when they were received. Every number opens its document. Compact: one line
   per document; photos only as a count until opened. */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Camera, Printer } from "lucide-react";
import { api } from "../../../api/client";
import { cn } from "../../../lib/utils";
import { renovationApi, type PodPhoto } from "./renovationApi";
import { money, shortDate } from "./renovationModel";
import { AuthImage, Dialog } from "./renovationUi";
import { countLabel, grsForPo, soChildren, type ProjectDocuments, type ProjectGr, type ProjectPo, type RowSummary } from "./projectDocsModel";

const RECEIPT: Record<ProjectPo["receipt"], { text: string; cls: string }> = {
  none: { text: "not received", cls: "text-ink-secondary" },
  partial: { text: "partly received", cls: "text-warning-text" },
  full: { text: "received", cls: "text-synced" },
};
const word = (s: string) => s.toLowerCase().replace(/_/g, " ");
const docLink = "font-mono font-semibold text-primary hover:underline";

/** "2 PO · 1 received" and a Late pill, beside the row name. */
export function RowBadges({ s }: { s: RowSummary }) {
  return (
    <>
      {s.count > 0 && <span className="shrink-0 rounded bg-surface-dim px-1 text-[10px] font-semibold text-ink-secondary">{countLabel(s)}</span>}
      {s.late && <span className="shrink-0 rounded bg-err-bg px-1 text-[10px] font-semibold uppercase text-err">late</span>}
    </>
  );
}

/** "Actual: PO 12 Oct · delivery 20 Oct" under the planned dates, when the row has POs. */
export function ActualLine({ s, indent }: { s: RowSummary; indent?: boolean }) {
  if (s.count === 0) return null;
  return (
    <p className={cn("text-[10.5px] text-ink-secondary sm:text-right", indent && "pl-4 sm:pl-0")}>
      Actual: PO {s.actualPoDate ? shortDate(s.actualPoDate) : "-"} · delivery {s.actualDelivery ? shortDate(s.actualDelivery) : "not set"}
    </p>
  );
}

/** Site photos of one goods receipt: a count that opens them, and the printable delivery note. */
function GrPhotos({ projectId, grnId, photos }: { projectId: number; grnId: string; photos: PodPhoto[] }) {
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState<string | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
        <Camera size={11} />{photos.length} photo{photos.length === 1 ? "" : "s"}
      </button>
      {open && (
        <Dialog title="Proof of delivery" onClose={() => { setOpen(false); setBig(null); }}>
          {big ? (
            <AuthImage path={renovationApi.fileUrl(projectId, big)} alt="Proof of delivery" className="w-full rounded" onClick={() => setBig(null)} />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((ph) => (
                <figure key={ph.id} className="min-w-0">
                  <AuthImage path={renovationApi.fileUrl(projectId, ph.r2_key)} alt={`${ph.location ?? "Site"} ${ph.kind}`} className="h-20 w-full rounded" onClick={() => setBig(ph.r2_key)} />
                  <figcaption className="truncate text-[10px] text-ink-secondary">{ph.location ?? "No room"}</figcaption>
                </figure>
              ))}
            </div>
          )}
          <button type="button" onClick={() => void api.openHtml(`/api/renovation/${projectId}/pod/print?grnId=${encodeURIComponent(grnId)}`)}
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
            <Printer size={12} />Print the delivery note
          </button>
        </Dialog>
      )}
    </>
  );
}

export function PoList({ projectId, pos, grs, photosByGrn, indent }: {
  projectId: number; pos: readonly ProjectPo[]; grs: readonly ProjectGr[]; photosByGrn: ReadonlyMap<string, PodPhoto[]>; indent?: boolean;
}) {
  if (pos.length === 0) return null;
  return (
    <ul className={cn("space-y-0.5", indent ? "pl-6" : "pl-4")}>
      {pos.map((p) => {
        const r = RECEIPT[p.receipt];
        const gr = grsForPo(grs, p.id);
        return (
          <li key={p.id} className="text-[11px] leading-snug text-ink">
            <Link to={`/scm/purchase-orders/${p.id}`} className={docLink}>{p.poNumber}</Link>
            <span className="text-ink-secondary"> · {p.supplierName ?? "-"} · PO {p.poDate ? shortDate(p.poDate) : "-"} · due {p.expectedAt ? shortDate(p.expectedAt) : "-"}{/receiv/i.test(p.status) ? "" : ` · ${word(p.status)}`} · </span>
            <span className={r.cls}>{r.text}</span>
            {gr.map((g) => (
              <div key={g.id} className="pl-4 text-ink-secondary">
                GR <Link to={`/scm/grns/${g.id}`} className={docLink}>{g.grnNumber}</Link>
                {g.receivedAt ? ` · ${shortDate(g.receivedAt)}` : ""}{g.atSite ? " · at site" : ""}
                <GrPhotos projectId={projectId} grnId={g.id} photos={photosByGrn.get(g.id) ?? []} />
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/** The quotation and the sales orders, each SO with its delivery orders (and their proof of delivery) and invoices. */
export function SalesDocs({ d, showMoney }: { d: ProjectDocuments; showMoney: boolean }) {
  const quotes = d.quotations ?? [];
  const sos = d.salesOrders ?? [];
  if (quotes.length === 0 && sos.length === 0) {
    return <p className="mt-2 text-[11px] text-ink-secondary">No quotation or sales order yet.</p>;
  }
  const amount = (sen: number | null) => (showMoney && sen != null ? ` · ${money(sen)}` : "");
  const returnsOf = (doId: string) => (d.deliveryReturns ?? []).filter((r) => r.parentId === doId);
  return (
    <ul className="mt-2 space-y-1 rounded-md border border-border px-2 py-1.5 text-[11.5px]">
      {quotes.map((q) => (
        <li key={q.id}>
          <span className="text-ink-secondary">Quotation </span>
          <Link to={`/scm/renovation/quotations/${q.id}`} className={docLink}>{q.no}</Link>
          <span className="text-ink-secondary"> · {q.date ? shortDate(q.date) : "-"} · {word(q.status)}</span>
        </li>
      ))}
      {sos.map((so) => {
        const { dos, sis } = soChildren(d, so.no);
        const to = so.kind === "RENOVATION" ? `/scm/renovation/contracts/${encodeURIComponent(so.no)}` : `/scm/sales-orders/${encodeURIComponent(so.no)}`;
        return (
          <li key={so.id}>
            <span className="text-ink-secondary">Sales order </span>
            <Link to={to} className={docLink}>{so.no}</Link>
            <span className="text-ink-secondary"> · {so.date ? shortDate(so.date) : "-"} · {word(so.status)}{amount(so.amountSen)}</span>
            {dos.map((x) => (
              <div key={x.id} className="pl-4 text-ink-secondary">
                DO <Link to={`/scm/delivery-orders/${x.id}`} className={docLink}>{x.no}</Link>
                {` · ${x.date ? shortDate(x.date) : "-"} · `}
                {x.deliveredAt ? `delivered ${shortDate(x.deliveredAt)}` : word(x.status)}
                {x.signed || x.podR2Key
                  ? <> · <Link to={`/scm/delivery-orders/${x.id}`} className="text-primary hover:underline">proof of delivery{x.signed ? " (signed)" : ""}</Link></>
                  : " · no proof of delivery yet"}
                {returnsOf(x.id).map((r) => (
                  <span key={r.id}> · return <Link to={`/scm/delivery-returns/${r.id}`} className={docLink}>{r.no}</Link></span>
                ))}
              </div>
            ))}
            {sis.length > 0 && (
              <div className="pl-4 text-ink-secondary">
                Invoice{sis.length === 1 ? "" : "s"} {sis.map((x, i) => (
                  <span key={x.id}>{i > 0 && ", "}<Link to={`/scm/sales-invoices/${x.id}`} className={docLink}>{x.no}</Link>{amount(x.amountSen)}</span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
