/* The display half of the one Sales Order page (SalesOrderDetail.tsx): the status words, the small read-only cells,
   the line table's columns and the aside cards. Nothing here writes. */

import type { ReactNode } from "react";
import { ArrowLeft, CircleDot, Warehouse } from "lucide-react";
import { Badge } from "../../components/Badge";
import { SoSourceChips, SoStockPill } from "../../components/SoSourceChips";
import type { Column } from "../../components/DataTable";
import type { coverageStateOf } from "../../components/coverage-state";
import { SoLinePhotoStrip } from "../../components/scm-v2/SoLinePhotoStrip";
import { LineFilesButton } from "../../components/doc-attachments/DocAttachments";
import { OrderSlipPhoto } from "../../vendor/scm/components/OrderSlipPhoto";
import { isFocLine } from "../../vendor/scm/lib/foc-line";
import { soStatusDisplay } from "../../vendor/scm/lib/so-status";
import { brandingLabel } from "../../vendor/shared/so-branding-label";
import { fmtDateTime } from "../../vendor/shared/format";
import { fairLabel } from "../../vendor/scm/lib/fair-options-queries";
import { linkedEvent, type LinkedFair } from "../../components/fairPick";
import { formatPhone } from "@2990s/shared/phone";
import { buildVariantSummary, fmtDate, fmtMoneySen, fmtQty, orderLineIdentity } from "@2990s/shared";
import { CONTS_LINES_BY_NAME, contsLineIdentity } from "../../conts/flowRules";
import { getBrandingCompanyCode } from "../../lib/branding";
import { customerRefOf } from "../../lib/customer-ref";
import { cn } from "../../lib/utils";
import { SO_AUDIT_LABELS } from "./so-audit-labels";
import { soRowStatus } from "./so-list-status";

// ─── The header and line fields these pieces read ───────────────────────────

type SoStatusHeader = { status: string; delivery_state?: unknown; lifecycle_state?: unknown };
type SoRefHeader = Parameters<typeof customerRefOf>[0];
type SoBrandHeader = { branding?: string | null; first_item_category?: string | null; first_item_branding?: string | null };
type SoTotalHeader = SoStatusHeader & { currency: string };
type SoAsideHeader = SoTotalHeader & SoRefHeader & {
  so_date: string;
  processing_date?: string | null;
  customer_delivery_date?: string | null;
  agent?: string | null;
  salesperson_id?: string | null;
  debtor_name?: string | null;
  customer_type?: string | null;
};

/** A saved line as the read-only table shows it. */
export type SoDisplayLine = {
  id: string;
  item_code: string;
  description: string | null;
  description2: string | null;
  uom: string;
  qty: number;
  unit_price_sen: number;
  discount_sen: number;
  total_sen: number;
  item_group?: string;
  variants?: Record<string, unknown> | null;
  /* The operator's free-text instruction for whoever executes this line — the
     "Type remarks…" box on the line card, served by GET /:docNo all along. Owner 2026-08-11 (2990-SO-2608-016): a
     SVC-ADDON line added purely to say "Please take back Cody Bedframe (King Size) 2 units" showed as an RM0 line
     reading only its SKU code. */
  remark?: string | null;
  /* Per-line stock + source-PO trace (owner 2026-08-01: a READY/SHIPPED/DELIVERED line must name the PO its goods
     came from). All stamped by GET /mfg-sales-orders/:docNo. */
  stock_status?: string | null;
  stock_state?: "stock" | "po" | "shortage" | null;
  /* R2 object keys for this line's reference photos — the AutoCount Further-Description shots the cutover imported,
     plus anything uploaded on the edit card (owner 2026-08-10: photos must be openable from the read view). */
  photo_urls?: string[] | null;
  coverage_po?: string | null;
  coverage_eta?: string | null;
  bound_source_pos?: string[];
  shipped_source_pos?: string[];
  shipped_source_adj?: boolean;
  ready_source_pos?: Array<{ po: string | null; qty: number; kind: "po" | "adjustment" }>;
  delivered_qty?: number | null;
  remaining_qty?: number | null;
  /* The DOs this line went out on, and its own delivery date. */
  deliveries?: Array<{ doNumber: string; qty: number; status: string }>;
  line_delivery_date?: string | null;
  line_delivery_date_overridden?: boolean;
};

/* Money display delegates to the ONE shared centi formatter (vendor/shared/
   format.ts). The page-local copy this replaces had no finite guard, so an
   absent / non-numeric cost rendered the literal "MYR NaN" at the user; the
   shared helper renders "—" for a number the ERP does not have. */
export const fmtMoney = fmtMoneySen;

export const refOf = (h: SoRefHeader): string => customerRefOf(h) || "—";

/* HEADER FIRST, then the SAME shared rule the SO list falls back to — byte-for-
   byte the list's brandOf. Owner 2026-08-18: "我要表头啊", so a filled header
   still wins on both companies; what changes here is the FALLBACK. This page
   used to end `|| "—"` over the raw brand TEXT, so an order with no header and a
   rep line carrying no brand text — every sofa — printed a dash while the list
   beside it printed a brand. */
export const brandOf = (h: SoBrandHeader): string =>
  (h.branding ?? "").trim() ||
  brandingLabel(h.first_item_category, h.first_item_branding, getBrandingCompanyCode());

const STATUS_TONE: Record<
  string,
  { tone: "success" | "warning" | "error" | "neutral"; label: string; blurb: string }
> = {
  draft: {
    tone: "warning",
    label: "Draft",
    blurb: "Draft · not yet confirmed",
  },
  confirmed: {
    tone: "success",
    label: "Submitted",
    blurb: "Submitted · awaiting payment",
  },
  cancelled: {
    tone: "error",
    label: "Cancelled",
    blurb: "Cancelled · no further action",
  },
  cancel: {
    tone: "error",
    label: "Cancelled",
    blurb: "Cancelled · no further action",
  },
  delivered: {
    tone: "success",
    label: "Delivered",
    blurb: "Delivered · goods handed over",
  },
  invoiced: {
    tone: "success",
    label: "Invoiced",
    blurb: "Invoiced · payment logged",
  },
  completed: {
    tone: "success",
    label: "Completed",
    blurb: "Completed",
  },
};
export const statusFor = (
  s: string
): { tone: "success" | "warning" | "error" | "neutral"; label: string; blurb: string } =>
  STATUS_TONE[(s || "").toLowerCase()] ?? {
    tone: "neutral",
    label: s || "—",
    blurb: s || "—",
  };

/* The order's status as every other SO surface reads it (list cell, quick view, editor): the stored status, moved on
   by its delivery orders and invoices (soStatusDisplay). Reading the stored column alone said Submitted here while the
   editor said Partially Delivered for the same order (owner, 24 Oct 2026). */
export const displayStatusFor = (h: { status: string; delivery_state?: unknown; lifecycle_state?: unknown }) => {
  const base = statusFor(h.status);
  const d = soRowStatus({
    status: h.status,
    delivery_state: h.delivery_state as "none" | "partial" | "full" | null | undefined,
    lifecycle_state: h.lifecycle_state as "none" | "delivered" | "invoiced" | "returned" | null | undefined,
  }, soStatusDisplay);
  return d.label === base.label ? base : { tone: d.tone, label: d.label, blurb: d.label };
};

export const initialsOf = (name: string | null | undefined): string => {
  if (!name) return "—";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "—"
  );
};

// ─── Field cell ────────────────────────────────────────────────────────────

export function Field({
  label,
  value,
  span = 1,
  muted,
  mono,
}: {
  label: string;
  value: ReactNode;
  span?: 1 | 2 | 3 | 4;
  muted?: boolean;
  mono?: boolean;
}) {
  const spanCls = span === 1 ? "" : span === 2 ? "sm:col-span-2" : span === 3 ? "sm:col-span-3" : "sm:col-span-4";
  return (
    <div className={spanCls}>
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-[14px] font-semibold leading-snug",
          muted ? "text-ink-muted" : "text-ink",
          mono && "font-mono"
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Sub-primitives for the aside cards ────────────────────────────────────

export function AsideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-stone">
      <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">
        {title}
      </div>
      {children}
    </div>
  );
}

export function KeyDateRow({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-2 last:border-b-0">
      <span className="text-[12.5px] text-ink-muted">{k}</span>
      <span
        className={cn(
          "text-[13px] font-semibold",
          muted ? "text-ink-muted" : "text-ink"
        )}
      >
        {v}
      </span>
    </div>
  );
}

export function PersonRow({
  initials,
  name,
  role,
  tone = "accent",
}: {
  initials: string;
  name: string;
  role: string;
  tone?: "accent" | "neutral";
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle py-3 last:border-b-0">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
          tone === "accent"
            ? "bg-accent-soft text-accent-ink"
            : "bg-border-subtle text-ink-secondary"
        )}
      >
        {initials}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-ink">{name}</div>
        <div className="truncate text-[11.5px] text-ink-muted">{role}</div>
      </div>
    </div>
  );
}

// ─── Recent activity timeline ─────────────────────────────────────────────
type ActivityDot = "success" | "primary" | "muted";
const DOT_CLS: Record<ActivityDot, string> = {
  success: "bg-synced",
  primary: "bg-primary",
  muted: "bg-border-strong",
};
export function ActivityRow({
  title,
  meta,
  dot,
  isLast,
}: {
  title: string;
  meta: string;
  dot: ActivityDot;
  isLast?: boolean;
}) {
  return (
    <div className="flex gap-3 pb-3.5">
      <div className="flex flex-col items-center">
        <span className={cn("mt-1 h-2 w-2 rounded-full", DOT_CLS[dot])} />
        {!isLast && <span className="mt-1 w-[2px] flex-1 bg-border-subtle" />}
      </div>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink">{title}</div>
        <div className="mt-0.5 text-[11px] text-ink-muted">{meta}</div>
      </div>
    </div>
  );
}

// ─── Order total card (dark aside hero) ────────────────────────────────────

export function OrderTotalCard({
  header,
  subtotalSen,
  discountSen,
  totalSen,
}: {
  header: SoTotalHeader;
  subtotalSen: number;
  discountSen: number;
  totalSen: number;
}) {
  /* The auto-derived delivery fee is inside `totalSen` but was not itemised,
     so an all-FOC order read "Subtotal 0 → Total 250" with nothing explaining
     the 250 (owner, 2026-08-07: "为什么会有 rm250?"). Derived as the remainder
     rather than read from a header field so the row is exactly the gap the
     reader is staring at, whatever fee components the server folds in. */
  const feeSen = totalSen - (subtotalSen - discountSen);
  const st = displayStatusFor(header);
  return (
    <div className="rounded-lg bg-sidebar px-5 py-5 text-sidebar-ink shadow-stone">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-brand text-sidebar-ink-muted">
        Order total
      </div>
      <div className="mt-1.5 font-money text-[30px] font-bold leading-none tracking-tight text-white">
        {fmtMoney(totalSen, header.currency)}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            st.tone === "success"
              ? "bg-synced"
              : st.tone === "warning"
                ? "bg-accent-bright"
                : st.tone === "error"
                  ? "bg-err"
                  : "bg-sidebar-ink-muted"
          )}
        />
        <span className="text-[12.5px] text-sidebar-ink-muted">{st.blurb}</span>
      </div>

      <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
        <TotalLine k="Subtotal" v={fmtMoney(subtotalSen, header.currency)} />
        <TotalLine k="Discount" v={fmtMoney(discountSen, header.currency)} />
        {feeSen > 0 && (
          <TotalLine k="Delivery fee" v={fmtMoney(feeSen, header.currency)} />
        )}
        <TotalLine k="SST" v="Inclusive" muted />
        <TotalLine
          k="Total"
          v={fmtMoney(totalSen, header.currency)}
          strong
        />
      </div>
    </div>
  );
}

function TotalLine({
  k,
  v,
  muted,
  strong,
}: {
  k: string;
  v: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={cn(
          "text-[12.5px] text-sidebar-ink-muted",
          strong && "text-white font-semibold"
        )}
      >
        {k}
      </span>
      <span
        className={cn(
          "font-money text-[13px] font-semibold text-sidebar-ink",
          muted && "text-sidebar-ink-muted",
          strong && "text-[16px] font-bold text-accent-bright"
        )}
      >
        {v}
      </span>
    </div>
  );
}

// ─── Line item columns ─────────────────────────────────────────────────────

/** The read-only line table's columns; the same set for By item and (narrowed) By area / By category. */
export function soLineColumns<T extends SoDisplayLine>({ docNo, docId, currency, status, coverage }: {
  docNo: string;
  docId: string | undefined;
  currency: string | undefined;
  status: string | undefined;
  coverage: ReturnType<typeof coverageStateOf>;
}): Column<T>[] {
  const columns: Column<SoDisplayLine>[] = [
    {
      key: "item",
      label: "Item",
      alwaysVisible: true,
      getValue: (l) => l.item_code,
      render: (l) => {
        /* Item CODE first, then the variant subtitle; description dropped (owner 2026-07-24) — the shared order-line rule
           (vendor/shared/line-identity.ts, which carries the four-report history
           this table was the fourth of). The item CODE still BINDS: getValue
           above keeps it the sort / search / export value. Live variant summary
           wins over the stored description2, which can be stale on older rows
           that carry no variants blob. */
        /* Conts reads a line by its product name, the code under it (conts/flowRules.ts). */
        const { primary, secondary } = (CONTS_LINES_BY_NAME ? contsLineIdentity : orderLineIdentity)({
          code: l.item_code,
          description: l.description,
          variant:
            buildVariantSummary(l.item_group ?? "", l.variants ?? null) ||
            (l.description2 ?? ""),
        });
        const remark = (l.remark ?? "").trim();
        return (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">
              {primary}
            </div>
            {secondary && (
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-ink-muted">
                <span className="truncate text-ink-secondary">{secondary}</span>
              </div>
            )}
            {/* The line's REMARK — the operator's instruction for whoever
                executes this line. Owner 2026-08-11: a SVC-ADDON line whose whole
                purpose was "Please take back Cody Bedframe (King Size) 2 units"
                rendered as an RM0 row showing only its SKU code, so the job was
                invisible to everyone downstream. It is NOT a duplicate of the
                identity above (line-identity's rule governs the code / description
                / variant trio; this is free text that appears nowhere else on the
                row), and it WRAPS rather than truncating — a half-shown
                instruction is worse than none. */}
            {remark && (
              <div className="mt-1 whitespace-pre-wrap break-words text-[11.5px] italic leading-snug text-ink-secondary">
                {remark}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "qty",
      label: "Qty",
      width: "72px",
      align: "right",
      getValue: (l) => l.qty,
      render: (l) => (
        <span className="font-money text-[13px] text-ink-secondary">
          {fmtQty(l.qty)} <span className="text-[10.5px] text-ink-muted">{l.uom}</span>
        </span>
      ),
    },
    {
      key: "unit",
      label: "Unit price",
      width: "108px",
      align: "right",
      getValue: (l) => l.unit_price_sen,
      render: (l) => (
        <span className="font-money text-[13px] text-ink-secondary">
          {fmtMoney(l.unit_price_sen, currency)}
        </span>
      ),
    },
    {
      key: "disc",
      label: "Disc",
      width: "88px",
      align: "right",
      getValue: (l) => l.discount_sen,
      render: (l) => {
        const isFoc = isFocLine(l);
        if (isFoc) {
          return (
            <Badge tone="warning" size="xs">
              FOC
            </Badge>
          );
        }
        if (l.discount_sen > 0) {
          return (
            <span className="font-money text-[13px] text-ink-secondary">
              {fmtMoney(l.discount_sen, currency)}
            </span>
          );
        }
        return <span className="text-ink-muted">—</span>;
      },
    },
    {
      key: "total",
      label: "Amount",
      width: "132px",
      align: "right",
      getValue: (l) => l.total_sen,
      render: (l) => (
        <span className="font-money text-[13px] font-semibold text-ink">
          {fmtMoney(l.total_sen, currency)}
        </span>
      ),
    },
    /* Remark as its OWN column — hidden by default because the text already
       renders under the item above, where it is read. This column exists so the
       remark is SEARCHABLE, filterable and lands in the CSV export: a `render`
       has no getValue, so without it the instruction is invisible to every one
       of those (the same reason the Stock / Incoming PO pair below carry one). */
    {
      key: "remark",
      label: "Remark",
      width: "220px",
      defaultHidden: true,
      getValue: (l) => (l.remark ?? "").trim(),
      render: (l) => {
        const remark = (l.remark ?? "").trim();
        return remark ? (
          <span className="whitespace-pre-wrap break-words text-[12px] text-ink-secondary">{remark}</span>
        ) : (
          <span className="text-ink-muted">—</span>
        );
      },
    },
    /* Photos (owner 2026-08-10) — the line's reference shots, openable. Same
       resolver as the edit card's tiles (vendor/scm/lib/so-line-photo), so the
       read page cannot drift into a second, differently-broken loading path.
       getValue is the COUNT so the column sorts/filters/exports as a number;
       a `render` with no getValue is invisible to all three. */
    {
      key: "photos",
      label: "Photos",
      width: "130px",
      getValue: (l) => (l.photo_urls ?? []).length,
      /* One clean strip (owner, 3 Nov 2026): a few thumbs and "+N" that opens the line's gallery, never a wrapped block. */
      render: (l) => (
        <div className="flex flex-nowrap items-center gap-1.5 overflow-hidden">
          {(l.photo_urls ?? []).length > 0 && (
            <SoLinePhotoStrip
              source="so"
              docId={docNo}
              itemId={l.id}
              photoKeys={l.photo_urls ?? []}
            />
          )}
          <LineFilesButton docType="sales_order" docId={docId} lineId={l.id} canEdit={status?.toLowerCase() !== "cancelled"}
            thumbs={(l.photo_urls ?? []).length > 0 ? 0 : 2} />
        </div>
      ),
    },
    /* Stock + Incoming PO (owner 2026-08-01) — the SAME per-line readiness +
       source-PO trace the SO list drill-down shows, through the ONE shared
       renderer (components/SoSourceChips.tsx). The detail payload has carried
       these fields all along; this page just never rendered them, so an
       operator opening the full page lost the trace the drill-down had. */
    {
      key: "stock",
      label: "Stock",
      width: "96px",
      getValue: (l) => l.stock_state ?? l.stock_status ?? "",
      render: (l) => <SoStockPill line={l} />,
    },
    {
      key: "source",
      label: "Incoming PO",
      width: "200px",
      getValue: (l) =>
        (l.bound_source_pos && l.bound_source_pos.length > 0
          ? l.bound_source_pos
          : [
              ...(l.shipped_source_pos ?? []),
              ...(l.ready_source_pos ?? []).map((r) => r.po ?? "STOCK ADJ"),
              ...(l.coverage_po ? [l.coverage_po] : []),
            ]
        ).join(", "),
      render: (l) => <SoSourceChips line={l} coverage={coverage} />,
    },
  ];
  return columns as unknown as Column<T>[];
}

// ─── Aside ─────────────────────────────────────────────────────────────────

/** The right-hand cards, the same in view and in edit. */
export function SoDetailAsideCards({ header, subtotalSen, discountSen, totalSen, slipImageKey, auditEntries, renoMode, lineCount, nameOf }: {
  header: SoAsideHeader;
  subtotalSen: number;
  discountSen: number;
  totalSen: number;
  slipImageKey: string | null;
  auditEntries: ReadonlyArray<{ id: string | number; action: string; created_at: string; actor_name_snapshot?: string | null }>;
  renoMode: boolean;
  lineCount: number;
  nameOf: (agent: string | null | undefined, salespersonId: string | null | undefined, fallback: string) => string;
}) {
  return (
        <div className="hidden lg:sticky lg:top-[124px] space-y-3 md:block">
          <OrderTotalCard
            header={header}
            subtotalSen={subtotalSen}
            discountSen={discountSen}
            totalSen={totalSen}
          />

          {/* Owner 2026-07-17: the Totals·Margin (Revenue/Cost/Margin) card
              is removed from the SO document view for EVERYONE — costing
              moves to the separate Finance "Fulfillment Costing" module.
              The customer-facing OrderTotalCard above (Subtotal / Discount /
              Total) stays; only cost/margin is gone. */}

          {/* The customer's handwritten slip, photographed on the phone.
              It lives on the order (slip_image_key, mig 0033) and until
              2026-09-13 this page never rendered it — so a slip taken on
              the phone was invisible on the computer unless somebody
              pressed Edit (docs/bugs/0854). */}
          {slipImageKey && (
            <AsideCard title="Order slip">
              <OrderSlipPhoto imageKey={slipImageKey} maxWidth={320} />
            </AsideCard>
          )}

          <AsideCard title="Key dates">
            <KeyDateRow k="SO date" v={fmtDate(header.so_date)} />
            {/* A renovation order has no whole-order processing or delivery date: each line carries its own (owner 24 Oct 2026). */}
            {!renoMode && (
              <>
                <KeyDateRow
                  k="Processing"
                  v={fmtDate(header.processing_date)}
                  muted={!header.processing_date}
                />
                <KeyDateRow
                  k="Delivery"
                  v={
                    header.customer_delivery_date
                      ? fmtDate(header.customer_delivery_date)
                      : "Not set"
                  }
                  muted={!header.customer_delivery_date}
                />
              </>
            )}
          </AsideCard>

          <AsideCard title="People">
            <PersonRow
              initials={
                header.agent || header.salesperson_id
                  ? initialsOf(
                      nameOf(
                        header.agent,
                        header.salesperson_id,
                        ""
                      )
                    )
                  : "?"
              }
              name={nameOf(
                header.agent,
                header.salesperson_id,
                "Salesperson"
              )}
              role={
                header.agent || header.salesperson_id
                  ? "Salesperson"
                  : "Not yet assigned"
              }
              tone={
                header.agent || header.salesperson_id
                  ? "accent"
                  : "neutral"
              }
            />
            <PersonRow
              initials={initialsOf(header.debtor_name)}
              name={header.debtor_name || "—"}
              role={`Customer${
                refOf(header) !== "—"
                  ? ` · ${refOf(header)}`
                  : ""
              }`}
              tone="accent"
            />
          </AsideCard>

          {/* Owner 2026-08-13: "recent activity 加上时间".
              It could not show one. All three rows read `so_date`, which is
              a DATE column with no time in it — so every entry restated the
              same day, and two of the three ("Lines added", the status row)
              were guesses at events nobody had recorded here anyway.

              The audit log has what the card was pretending to have: real
              events, real actors, real timestamps. Same source as the
              History drawer this header now opens, so the summary and the
              full trail cannot tell different stories. The synthesized rows
              remain as the fallback for an order with no audit entries yet
              (pre-audit history, or the log still loading) — losing the
              card entirely would be a worse answer than a dateless one. */}
          <AsideCard title="Recent activity">
            {auditEntries.length > 0 ? (
              auditEntries.slice(0, 4).map((e, i, shown) => (
                <ActivityRow
                  key={e.id}
                  title={SO_AUDIT_LABELS.actions[e.action] ?? e.action.replace(/_/g, " ")}
                  meta={`${fmtDateTime(e.created_at)}${
                    e.actor_name_snapshot ? ` · ${e.actor_name_snapshot}` : ""
                  }`}
                  dot={i === 0 ? "success" : i === shown.length - 1 ? "muted" : "primary"}
                  isLast={i === shown.length - 1}
                />
              ))
            ) : (
              <>
                <ActivityRow
                  title={`Order ${statusFor(header.status).label.toLowerCase()}`}
                  meta={fmtDate(header.so_date)}
                  dot={
                    statusFor(header.status).tone === "success"
                      ? "success"
                      : "primary"
                  }
                />
                <ActivityRow
                  title={`Lines added (${lineCount})`}
                  meta={fmtDate(header.so_date)}
                  dot="primary"
                />
                <ActivityRow
                  title="Created"
                  meta={`${fmtDate(header.so_date)}${
                    header.customer_type
                      ? ` · ${header.customer_type}`
                      : ""
                  }`}
                  dot="muted"
                  isLast
                />
              </>
            )}
          </AsideCard>
        </div>
  );
}

export function Divider() {
  return (
    <span className="inline-flex items-center text-border-strong">
      <CircleDot size={4} className="mx-0.5 opacity-40" />
    </span>
  );
}

// ─── The header sections, read-only ────────────────────────────────────────
/* Each is the view half of one section of the page; SalesOrderDetail's CustomerCard holds the edit half, inside the
   same Section. */

type SoCustomerHeader = SoRefHeader & {
  debtor_name?: string | null;
  phone?: string | null;
  email?: string | null;
  customer_type?: string | null;
  agent?: string | null;
  salesperson_id?: string | null;
};

export function SoCustomerFields({ header, renoMode, salesperson, sharedWith }: {
  header: SoCustomerHeader;
  renoMode: boolean;
  salesperson: string;
  sharedWith: ReactNode;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-5 gap-y-4", renoMode ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
      <Field label="Customer name" value={header.debtor_name || "—"} />
      <Field label="Phone" value={formatPhone(header.phone ?? null) || "Not provided"} muted={!header.phone} mono={!!header.phone} />
      <Field label="Email" value={header.email || "Not provided"} muted={!header.email} />
      {!renoMode && <Field label="Customer type" value={header.customer_type || "—"} muted={!header.customer_type} />}
      {!renoMode && <Field label="Ref No." value={refOf(header)} mono={refOf(header) !== "—"} muted={refOf(header) === "—"} />}
      <Field label="Salesperson" value={salesperson} muted={!header.agent && !header.salesperson_id} />
      {/* Who else may see and edit this order. Hidden from viewers when it is shared with nobody; editable in place
          for scm.so.attribute_other. */}
      {sharedWith}
    </div>
  );
}

export function SoOrderInfoFields({ header }: {
  header: SoBrandHeader & {
    building_type?: string | null;
    venue?: string | null;
    fair?: LinkedFair | null;
    fair_date?: string | null;
    processing_date?: string | null;
    customer_delivery_date?: string | null;
    payment_methods_summary?: string;
    payment_method?: string | null;
    note?: string | null;
  };
}) {
  const payment = header.payment_methods_summary || header.payment_method;
  return (
    <>
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-4">
        <Field label="Building type" value={header.building_type || "—"} muted={!header.building_type} />
        {/* A recorded pick reads back as its event — venue, organizer and dates (owner 2026-09-24); shown only under
            the order's own venue. */}
        <Field
          label="Fair"
          value={header.fair && linkedEvent(header.venue ?? null, header.fair, null) ? fairLabel(header.fair) : header.venue || "—"}
          muted={!header.venue}
        />
        {/* Which day of the fair (owner 2026-09-24) — only once one is recorded. */}
        {header.fair_date && <Field label="Fair day" value={fmtDate(header.fair_date)} />}
        <Field label="Processing Date" value={fmtDate(header.processing_date)} muted={!header.processing_date} />
        <Field
          label="Delivery Date"
          value={header.customer_delivery_date ? fmtDate(header.customer_delivery_date) : "Not scheduled"}
          muted={!header.customer_delivery_date}
        />
        <Field label="Branding" value={brandOf(header)} muted={brandOf(header) === "—"} />
        <Field label="Payment" value={payment || "—"} muted={!payment} />
      </div>
      {header.note && (
        <div className="mt-4 rounded-lg border border-warning-text/25 bg-warning-bg px-4 py-3">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-warning-text">Note</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-warning-text">{header.note}</p>
        </div>
      )}
    </>
  );
}

export function SoAddressFields({ header }: {
  header: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    postcode?: string | null;
    customer_state?: string | null;
    customer_country?: string | null;
    sales_location?: string | null;
  };
}) {
  const lines = [
    header.address1,
    header.address2,
    [header.city, header.postcode].filter(Boolean).join(" "),
    [header.customer_state, header.customer_country].filter(Boolean).join(", "),
  ].filter(Boolean);
  return (
    <>
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">Ship to</div>
      <div className="mt-1.5 text-[14px] font-semibold leading-relaxed text-ink">
        {lines.map((line, i) => <div key={i}>{line}</div>)}
        {!header.address1 && !header.city && <span className="text-ink-muted">Not provided</span>}
      </div>
      {header.sales_location && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary-soft px-2.5 py-1 text-[11.5px] font-semibold text-primary-ink">
          <Warehouse size={12} />
          {header.sales_location}
        </div>
      )}
    </>
  );
}

export function SoEmergencyFields({ header }: {
  header: {
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    emergency_contact_relationship?: string | null;
  };
}) {
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
      <Field label="Contact name" value={header.emergency_contact_name || "Not provided"} muted={!header.emergency_contact_name} />
      <Field label="Relationship" value={header.emergency_contact_relationship || "—"} muted={!header.emergency_contact_relationship} />
      <Field
        label="Phone"
        value={formatPhone(header.emergency_contact_phone ?? null) || "Not provided"}
        muted={!header.emergency_contact_phone}
        mono={!!header.emergency_contact_phone}
      />
    </div>
  );
}

// ─── Page header ───────────────────────────────────────────────────────────

/** The two sticky headers: the phone's dark one and the desktop's with the action bar. Both modes use them. */
export function SoDetailHeader({ title, docNo, status, meta, onBack, actions, chips }: {
  title: string;
  docNo: string;
  status: { tone: "success" | "warning" | "error" | "neutral"; label: string };
  /** The line under the title, after the doc no. */
  meta: ReactNode[];
  onBack: () => void;
  actions: ReactNode;
  /** Beside the status, e.g. the On hold marker. */
  chips?: ReactNode;
}) {
  return (
    <>
      <div className="sticky top-0 z-20 -mx-4 -mt-4 bg-sidebar text-sidebar-ink shadow-slab md:hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-[14px] font-semibold text-accent-bright"
            aria-label="Back to Sales Orders"
          >
            <ArrowLeft size={16} /> Orders
          </button>
          <span className="font-mono text-[12.5px] font-semibold text-sidebar-ink">{docNo}</span>
          <span className="w-[18px]" />
        </div>
        <div className="px-4 pb-4 pt-3">
          <h1 className="font-display text-[19px] font-bold leading-tight text-white">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} variant="solid" size="xs">{status.label}</Badge>
            {chips}
          </div>
        </div>
      </div>

      {/* Nick 2026-07-09 — pinned. TopNavbar sits sticky top-0 z-30 h-12 inside the SAME scrolling <main>, so a naive
          top-0 here parks the title BEHIND it; z-20 stacks above the section cards and below the nav. At lg the chrome
          is the single 52px bar. */}
      <div className="sticky top-12 lg:top-[52px] z-20 -mx-4 hidden border-b border-border bg-bg/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 md:block">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to Sales Orders"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-ink-secondary hover:border-primary/50 hover:text-primary"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
                <Badge tone={status.tone} size="sm">{status.label}</Badge>
                {chips}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-secondary">
                <span className="font-mono font-semibold text-primary-ink">{docNo}</span>
                {meta.map((m, i) => <span key={i} className="inline-flex items-center gap-x-2"><Divider />{m}</span>)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      </div>
    </>
  );
}
