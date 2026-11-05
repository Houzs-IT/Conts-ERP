/* Sales order detail, the renovation payment schedule (owner, 1 Nov 2026: "payment 不是应该会直接有 4 个了吗？这样才会
   对标到 project 那边"). The contract's instalments (GET /renovation/sales-orders/:docNo/billing) with what has been
   received against each, filled the way the project's payments strip fills them (services/renovation/beta.ts
   paymentsOf): money on a bill counts for that instalment, money recorded on the order fills the rest in order.
   Conts only: an order with no instalment schedule shows nothing and Add Payment keeps the balance default. */
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/Button";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";

interface BillingInstalment {
  id: string; seq: number; label: string; pctBp: number; amountSen: number; isNext?: boolean;
  bill: { kind: "INVOICE" | "CREDIT_NOTE" | "ZERO"; amountSen: number; paidSen: number; salesInvoiceId?: string | null; invoiceNumber?: string | null; noteNumber?: string | null } | null;
}
interface BillingView { receivedSen: number; revisedContractSen: number; instalments: BillingInstalment[] }

export interface SoInstalmentRow {
  seq: number; label: string; pctBp: number; amountSen: number; paidSen: number; slot?: boolean;
  id?: string; billable?: boolean; document?: { number: string; invoiceId: string | null };
}

export function useSoInstalments(docNo: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["renovation-so-billing", docNo],
    queryFn: () => authedFetch<BillingView>(`/renovation/sales-orders/${encodeURIComponent(docNo ?? "")}/billing`),
    enabled: enabled && !!docNo,
    staleTime: 60_000,
    /* One failed read left the payment cards and Bill missing until the page was reopened. */
    retry: 2,
  });
}

/** Each instalment's amount and what is paid against it, given the money recorded on the order. */
export function instalmentRows(view: BillingView | undefined, recordedSen: number): SoInstalmentRow[] {
  if (!view || view.instalments.length === 0) return [];
  let pool = Math.max(0, recordedSen - view.receivedSen);
  return [...view.instalments].sort((a, b) => a.seq - b.seq).map((i) => {
    const amountSen = i.bill ? i.bill.amountSen : i.amountSen;
    let paidSen = i.bill?.kind === "INVOICE" ? i.bill.paidSen : 0;
    if (paidSen < amountSen && pool > 0) {
      const take = Math.min(pool, amountSen - paidSen);
      pool -= take;
      paidSen += take;
    }
    const number = i.bill?.invoiceNumber ?? i.bill?.noteNumber ?? null;
    return {
      seq: i.seq, label: i.label || `Instalment ${i.seq}`, pctBp: i.pctBp, amountSen, paidSen, id: i.id, billable: Boolean(i.isNext && !i.bill),
      ...(number ? { document: { number, invoiceId: i.bill?.salesInvoiceId ?? null } } : {}),
    };
  });
}

const ORD = ["1st", "2nd", "3rd", "4th"];

/** An order with no instalment schedule: four payments, each filled by one recorded payment, oldest first, more when
    more are recorded. The same strip the project's payments card shows (services/renovation/beta.ts paymentsOf). */
export function paymentSlots(payments: readonly { amount_sen: number; paid_at?: string | null; created_at?: string }[]): SoInstalmentRow[] {
  const paid = payments.filter((p) => (p.amount_sen || 0) > 0)
    .sort((a, b) => String(a.paid_at ?? a.created_at ?? "").localeCompare(String(b.paid_at ?? b.created_at ?? "")));
  return Array.from({ length: Math.max(4, paid.length) }, (_, i) => ({
    seq: i + 1, label: `${ORD[i] ?? `${i + 1}th`} payment`, pctBp: 0, amountSen: paid[i]?.amount_sen ?? 0, paidSen: paid[i]?.amount_sen ?? 0, slot: true,
  }));
}

/** What the next payment should collect once `paidSen` is on the order: the first instalment's unpaid remainder. */
export function nextInstalmentSen(rows: readonly SoInstalmentRow[], paidSen: number): number {
  let left = paidSen;
  for (const r of rows) {
    const covered = Math.min(left, r.amountSen);
    left -= covered;
    if (covered < r.amountSen) return r.amountSen - covered;
  }
  return 0;
}

/** What is left to collect on an instalment: money over on an earlier one has already come off (owner, 4 Nov 2026). */
export const toCollectSen = (r: Pick<SoInstalmentRow, "amountSen" | "paidSen">): number => Math.max(0, r.amountSen - r.paidSen);

export function SoInstalments({ rows, money, onBill }: { rows: readonly SoInstalmentRow[]; money: (sen: number) => string; onBill?: (id: string) => void }): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
      {rows.map((r) => {
        const paid = r.amountSen > 0 && r.paidSen >= r.amountSen;
        const part = !paid && r.paidSen > 0;
        const due = !paid && Boolean(r.billable);
        return (
          <div key={r.seq} className={`flex min-w-0 flex-col gap-1 rounded-lg border p-3 ${paid ? "border-synced/30 bg-synced-bg/40" : due || part ? "border-warning-text/40" : "border-border-subtle"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">{r.label}</span>
              {!r.slot && <span className="text-[11px] text-ink-muted">{(r.pctBp / 100).toFixed(r.pctBp % 100 ? 1 : 0)}%</span>}
            </div>
            <div className="text-[17px] font-bold tabular-nums text-ink">{r.slot && r.amountSen === 0 ? "-" : money(part ? toCollectSen(r) : r.amountSen)}</div>
            <div className={`text-[12px] font-semibold ${paid ? "text-synced" : part || due ? "text-warning-text" : "text-ink-muted"}`}>
              {paid ? (r.slot ? "Received" : "Paid") : part ? `To collect, ${money(r.paidSen)} of ${money(r.amountSen)} paid` : r.slot ? "Not received" : "Not paid"}
            </div>
            {(r.document || (r.billable && r.id && onBill)) && (
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                {r.document ? (r.document.invoiceId
                  ? <Link className="truncate text-[11.5px] font-semibold text-primary" to={`/scm/sales-invoices/${r.document.invoiceId}`}>{r.document.number}</Link>
                  : <span className="truncate text-[11.5px] text-ink-secondary">{r.document.number}</span>) : <span />}
                {r.billable && r.id && onBill && <Button variant="secondary" className="h-7" onClick={() => onBill(r.id!)}>Bill</Button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
