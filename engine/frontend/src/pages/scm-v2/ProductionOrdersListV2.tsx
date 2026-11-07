// ProductionOrdersListV2 — Theme C redesign of the Production Orders listing.
// Twin of the SO/DO/SI/DR listing V2 template, but flipped for the procurement
// side of the ERP: money moves OUT to suppliers, and the star of the show is
// what's still on order + committed but not yet received.
//
// Route: /scm/production-orders (App.tsx flips ScmProductionOrdersV2 here).
// Data: useProductionOrders (vendored suppliers-queries slice).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { productionOrderRowMenu } from "./row-menus";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildVariantSummary, fmtSen, fmtDate, orderLineIdentity } from "@2990s/shared";
import {
  Plus,
  ChevronDown,
  Users,
  Truck,
  LayoutGrid,
  Table as TableIcon,
  X as XIcon,
  ExternalLink,
  Edit3,
  Printer,
  CheckCircle2,
  Package,
  ArrowRightLeft,
  CalendarClock,
} from "lucide-react";
import { PO_LINE_LABELS, poStatusWord, senToRinggit, type PoListLine } from "../../vendor/scm/lib/po-line-export-columns";
import { poLineColumns, type PoColumn, type PoGridRow } from "./po-list-line-columns";
import {
  ProductionBulkSupplierDateModal,
  type BulkSupplierDateResult,
} from "../../components/scm-v2/ProductionBulkSupplierDateModal";
import { ProductionLineImportModal } from "../../components/scm-v2/ProductionLineImportModal";
import { useAuth as useHouzsAuth } from "../../auth/AuthContext";
import { canOperateProductionOrders } from "../../auth/salesAccess";
import { PageHeader } from "../../components/Layout";
import { StatCard } from "../../components/StatCard";
import { FilterPills } from "../../components/FilterPills";
import { DataTable, type Column } from "../../components/DataTable";
import { poDisplayNumber } from "../../vendor/scm/lib/po-status";
import { warehouseLabel } from "../../vendor/scm/lib/warehouse-label";
import {
  DocumentLinesExpansion,
  AssignedSoCell,
  DeliveredCell,
  type DocumentDrillLine,
  type DrillItemFields,
} from "../../components/DocumentLinesExpansion";
import { coverageStateOf } from "../../components/coverage-state";
import { ListPager } from "../../components/ListPager";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useVisibleRows } from "../../hooks/useVisibleRows";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { PullToRefresh } from "../../components/PullToRefresh";
import { ListErrorPanel, SearchPendingPanel, SearchProgress } from "../../components/SearchProgress";
import { SearchScopeHint } from "../../components/SearchScopeHint";
import { useDebouncedSearchTerm, useSearchResultTransition } from "../../hooks/useServerSearch";
import {
  usePoListFacets,
  useEnrichedPoListRows,
  fetchProductionExportRows,
  useMaterialStatus,
  useProductionMaterials,
  type PoHeaderRow,
  type PoItemRow,
  type ProductionProgress,
} from "../../vendor/scm/lib/production-order-queries";
import {
  useProductionOrdersPaged,
  useProductionOrderDetail,
  fetchProductionOrderDetail,
} from "../../vendor/scm/lib/production-order-queries";
import { useWarehouses } from "../../vendor/scm/lib/inventory-queries";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import { useChoice } from "../../vendor/scm/components/ChoiceDialog";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "../../lib/utils";
import { convertToLink, transferToLabel, transferFromLabel } from "../../lib/convertScope";
import { isCancelledDocStatus } from "../../lib/scm";
import { OVERDUE_CLASS, isPastDue } from "../../lib/tableHighlight";
import { ResizableDetailDrawer } from "../../components/ResizableDetailDrawer";
import { useHoldAction } from "./use-hold-action";
import { usePoCancelAction } from "./use-production-cancel-action";
import { StatusWithHold, rowIsHeld } from "../../vendor/scm/components/HoldChip";
import { PrintPreviewBatchModal, usePrintPreview } from "../../components/scm-v2/PrintPreviewModal";
import { ProgressBar } from "./renovationProductionParts";
import type { PdfAction } from "../../vendor/scm/lib/pdf-common";

// ─── Types ──────────────────────────────────────────────────────────────────

// Filter-pill buckets. Five map 1:1 onto a raw purchase_orders.status;
// "outstanding" is a ROLL-UP over open + partial (raised, not yet fully
// received) — the pill twin of the Outstanding stat card. Because it overlaps,
// the pill counts no longer sum to All; that is intended.
type StatusTab =
  | "all"
  | "draft"
  | "pending"
  | "in_progress"
  | "overdue"
  | "on_hold"
  | "completed"
  | "cancelled"
  | "open"
  | "partial"
  | "received";

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmtRm = (centi: number): string => fmtSen(centi);

const supplierNameOf = (r: PoHeaderRow): string =>
  r.supplier?.name || r.supplier_id || "—";

const supplierCodeOf = (r: PoHeaderRow): string => r.supplier?.code || "—";

/* Items summary for the list column + Excel export (owner 2026-08-05) — the
   list embed already carries (item_code, qty) per line; render the same
   compact "CODE×qty · CODE×qty" the expansion details. */
const itemsSummaryOf = (r: PoHeaderRow): string =>
  (r.items ?? []).map((it) => `${it.item_code}×${it.qty}`).join(" · ");

/* Purchase Location display — the ONE warehouse rule, code first then name
   (vendor/scm/lib/warehouse-label.ts). This column printed the NAME first and
   the grid truncated it to "BALAKONG WAREHO…", while the same page's PDF
   export already printed the CODE — one page, two answers for one warehouse. */
const locationOf = (r: PoHeaderRow): string =>
  warehouseLabel(r.purchase_location) ?? "";

/* Supplier-SKU summary (owner 2026-08-05) — the SUPPLIER's own codes, aligned
   with the Items column line-for-line ("—" holds the slot for an unbound
   line so the two columns stay readable side by side). */
const supplierSkusOf = (r: PoHeaderRow): string =>
  (r.items ?? []).map((it) => it.supplier_sku?.trim() || "—").join(" · ");

// Committed value = total_sen (subtotal + tax); the Production Order's face value.
const totalOf = (r: PoHeaderRow): number =>
  r.total_sen ?? r.subtotal_sen ?? 0;

// The line export prints these same words (PO_STATUS_WORDS in
// po-line-export-columns.ts, refereed against this map by its canonical test).
// Production Order lifecycle: DRAFT → SUBMITTED → PARTIALLY_RECEIVED → RECEIVED, plus
// CANCELLED. Bucket them for the pills; the raw status still surfaces in
// the row Badge.
const STATUS_TONE: Record<
  string,
  { tone: "success" | "warning" | "error" | "neutral"; label: string; bucket: StatusTab }
> = {
  DRAFT:              { tone: "warning", label: "Draft",              bucket: "draft" },
  SUBMITTED:          { tone: "warning", label: "Submitted",              bucket: "open" },
  PARTIALLY_RECEIVED: { tone: "warning", label: "Partially received", bucket: "partial" },
  RECEIVED:           { tone: "success", label: "Complete",           bucket: "received" },
  CANCELLED:          { tone: "error",   label: "Cancelled",          bucket: "cancelled" },
  /* ON_HOLD (mig 0318, owner 2026-08-21) — the REVERSIBLE stop the purchase
     side never had. A held Production Order is not receivable: grns.ts filters receivable
     Production Orders through an allow-list, so the block needs no code here. */
  ON_HOLD:            { tone: "warning", label: "On Hold",            bucket: "on_hold" },
};

const statusFor = (
  s: string
): { tone: "success" | "warning" | "error" | "neutral"; label: string; bucket: StatusTab } =>
  STATUS_TONE[(s || "").toUpperCase()] ?? {
    tone: "neutral",
    label: s || "—",
    bucket: "open",
  };

/* Status and Progress are worked out on the server from Start and the plan dates (lib/renovation-production.ts). */
type ProductionRowExtra = { plan_start?: string | null; progress?: ProductionProgress; assigned_to?: string[]; production_time_hours?: number | string | null };
const extraOf = (r: PoHeaderRow): ProductionRowExtra => r as unknown as ProductionRowExtra;
const PROGRESS_TONE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  Draft: "neutral", Pending: "warning", "In Progress": "neutral", Overdue: "error", "On Hold": "neutral", Completed: "success", Cancelled: "error",
};

// ─── GRN No cell ────────────────────────────────────────────────────────────

/* A worker predating 2026-07-31 sends bare doc-number strings; the current one
   sends { id, grnNumber }. Normalise both, and let `id` stay null for the old
   shape — a chip with nowhere to go should not pretend to be a link. */
const grnRefsOf = (
  raw: PoHeaderRow["transfer_to_grns"]
): Array<{ id: string | null; grnNumber: string }> =>
  (raw ?? []).map((g) =>
    typeof g === "string" ? { id: null, grnNumber: g } : { id: g.id, grnNumber: g.grnNumber }
  );

/* The Goods Received doc(s) this Production Order was received into. Styled as the sibling of
   AssignedSoCell one column over — same chip, same one-per-line stacking — so
   the two "where did this Production Order go" columns read as one pair. A Production Order with nothing
   received yet is the normal case, not a gap: it shows a dash.

   Every GRN is listed. A partially-received Production Order having more than one GRN is the
   whole point of the column — 2990-Production Order-2606-024 has two, and showing one of them
   plus a "+1" is exactly the view that let its second receipt go unnoticed. */
function GrnNoCell({
  grns,
  onOpenGrn,
}: {
  grns: PoHeaderRow["transfer_to_grns"];
  onOpenGrn: (grnId: string) => void;
}) {
  const list = grnRefsOf(grns);
  if (list.length === 0) return <span className="text-[12px] text-ink-muted">—</span>;
  /* font-docno — IBM Plex Sans, the brand face #1445 gave the primary doc-number
     columns. Owner 2026-08-01 ruled it applies to the CHIPS too, so every
     doc-number chip in DocumentLinesExpansion (Assigned SO, Delivered, Source Production Order)
     moved with this one. Dates and eyebrow labels stay on font-mono. */
  const chip =
    "w-fit rounded border border-border-subtle bg-surface-2 px-1.5 py-0.5 font-docno text-[11px] font-semibold text-accent-ink";
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {list.map((g) =>
        g.id ? (
          <button
            key={g.grnNumber}
            type="button"
            title={`Open ${g.grnNumber}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenGrn(g.id as string);
            }}
            className={cn(chip, "hover:border-accent hover:text-accent")}
          >
            {g.grnNumber}
          </button>
        ) : (
          <span key={g.grnNumber} className={chip}>
            {g.grnNumber}
          </span>
        ),
      )}
    </span>
  );
}

// ─── Split-menu dropdown ───────────────────────────────────────────────────

function SplitDropdown({
  onFromSo,
  onImport,
  onDuplicate,
}: {
  onFromSo: () => void;
  /** Absent when the user may not edit production orders — the item is not offered. */
  onImport: (() => void) | null;
  onDuplicate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center rounded-md border border-primary/60 bg-primary/10 px-2.5 text-primary hover:bg-primary/20"
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[80]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-[81] mt-1.5 min-w-[220px] rounded-md border border-border bg-surface py-1 shadow-slab"
          >
            <button
              type="button"
              className="block w-full px-3.5 py-2 text-left text-[12.5px] text-ink hover:bg-primary-soft"
              onClick={() => { setOpen(false); onFromSo(); }}
            >
              New from Sales Order
            </button>
            {onImport && (
              <button
                type="button"
                className="block w-full px-3.5 py-2 text-left text-[12.5px] text-ink hover:bg-primary-soft"
                onClick={() => { setOpen(false); onImport(); }}
              >
                Import lines
              </button>
            )}
            <button
              type="button"
              className="block w-full px-3.5 py-2 text-left text-[12.5px] text-ink hover:bg-primary-soft"
              onClick={() => { setOpen(false); onDuplicate(); }}
            >
              Duplicate last Production Order
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: "table" | "cards";
  onChange: (v: "table" | "cards") => void;
}) {
  const btn = (which: "table" | "cards", label: string, Icon: typeof TableIcon) => {
    const active = value === which;
    return (
      <button
        type="button"
        onClick={() => onChange(which)}
        aria-pressed={active}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
          active
            ? "bg-primary text-white shadow-sm"
            : "text-ink-secondary hover:bg-primary-soft hover:text-primary"
        )}
      >
        <Icon size={13} />
        {label}
      </button>
    );
  };
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-1 shadow-stone">
      {btn("table", "Table", TableIcon)}
      {btn("cards", "Cards", LayoutGrid)}
    </div>
  );
}

// ─── Cards grid ────────────────────────────────────────────────────────────

function CardsGrid({ rows, onOpen }: { rows: PoHeaderRow[]; onOpen: (r: PoHeaderRow) => void }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center shadow-stone">
        <div className="text-[13px] font-semibold text-ink">No production orders</div>
        <div className="mt-1 text-[12px] text-ink-muted">
          No Production Orders match the current filters. Try Reset layout to clear the search
          and status tabs.
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => {
        const st = statusFor(r.status);
        const supplier = supplierNameOf(r);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r)}
            className="group relative overflow-hidden rounded-lg border border-border bg-surface px-4 py-4 text-left shadow-stone transition-all duration-200 hover:-translate-y-px hover:border-primary/40 hover:shadow-slab focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-docno text-[12.5px] font-semibold text-ink">
                {r.po_number}
              </span>
              <StatusWithHold tone={st.tone} label={st.label} row={r} />
            </div>
            <div className="mt-2 truncate text-[15px] font-semibold text-ink">
              {supplier}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[11.5px] text-ink-muted">{fmtDate(r.po_date)}</span>
              {r.expected_at && (
                <span className="text-[11.5px] text-ink-muted">
                  · Expected {fmtDate(r.expected_at)}
                </span>
              )}
            </div>
            <div className="mt-3.5 flex items-end justify-between border-t border-border-subtle pt-3">
              <div className="min-w-0">
                <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">
                  Supplier
                </div>
                <div className="mt-0.5 truncate font-mono text-[12px] font-semibold text-ink-secondary">
                  {supplierCodeOf(r)}
                </div>
              </div>
              <span className="font-money text-[15px] font-bold text-ink">
                {fmtRm(totalOf(r))}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Detail drawer ─────────────────────────────────────────────────────────

function DetailDrawer({
  row,
  onClose,
  onOpenFull,
  onEdit,
  onPrint,
  onCancel,
}: {
  row: PoHeaderRow | null;
  onClose: () => void;
  onOpenFull: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onCancel: () => void;
}) {
  const detailQ = useProductionOrderDetail(row?.id ?? null);
  const items: PoItemRow[] =
    ((detailQ.data as { items?: PoItemRow[] } | undefined)?.items ?? []);

  const open = !!row;
  /* The same words as the list's Status column. */
  const word = row ? extraOf(row).progress?.statusLabel ?? statusFor(row.status).label : null;
  /* SO→Production Order drift (owner 2026-07-27) — surface the pending SO change in the peek
     drawer too, not only the full page. Actionable pre-receipt only. */
  const showDrift =
    row?.status === "SUBMITTED" || row?.status === "PARTIALLY_RECEIVED";
  const driftCount = showDrift ? items.filter((l) => l.so_drift).length : 0;

  return (
    <ResizableDetailDrawer
      open={open}
      onClose={onClose}
      ariaLabel={row ? `Production order ${row.po_number}` : "Production order details"}
    >
        {row && word && (
          <>
            <div className="flex h-[60px] shrink-0 items-center gap-3 bg-sidebar px-5 text-sidebar-ink">
              <button
                type="button"
                onClick={onClose}
                className="text-sidebar-ink-muted hover:text-sidebar-ink"
                aria-label="Close details"
              >
                <XIcon size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[14px] font-bold tracking-wide">
                  {row.po_number}
                </div>
                <div className="mt-0.5 text-[11px] text-sidebar-ink-muted">Production Order</div>
              </div>
              <button
                type="button"
                onClick={onOpenFull}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent-bright/40 px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-bright hover:bg-accent-bright/10"
              >
                Open full page <ExternalLink size={12} />
              </button>
              <Badge tone={PROGRESS_TONE[word] ?? "neutral"} variant="solid" size="xs">
                {word}
              </Badge>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              <div className="text-[19px] font-bold text-ink">{(row as { project_label?: string | null }).project_label || "No project"}</div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-2 px-4 py-4">
                <MetaItem k="SO Doc No." v={[...new Set((row.lines ?? []).map((l) => l.so_doc_no).filter(Boolean))].join(", ") || "—"} />
                <MetaItem k="Assigned to" v={(extraOf(row).assigned_to ?? []).join(", ") || "Nobody yet"} />
                <MetaItem k="Plan start" v={fmtDate(extraOf(row).plan_start ?? null)} />
                <MetaItem k="Plan finish" v={fmtDate(row.expected_at)} />
                <MetaItem k="Progress" v={extraOf(row).progress?.label || "—"} />
                <MetaItem k="Warehouse" v={locationOf(row) || "—"} />
              </dl>

              <SectionHeading>Line items</SectionHeading>
              {driftCount > 0 && (
                <div className="mb-2 rounded-lg border border-accent-bright/40 bg-accent-bright/10 px-3 py-2 text-[11.5px] text-ink">
                  ⚠ <strong>{driftCount}</strong> line{driftCount === 1 ? "'s" : "s"} source SO changed after this Production Order
                  was raised — see the red notes below and re-send the corrected Production Order.
                </div>
              )}
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[1fr_96px] gap-2 border-b border-border-subtle bg-surface-2 px-4 py-2 font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">
                  <span>Item</span>
                  <span className="text-right">Qty</span>
                </div>
                {detailQ.isLoading && (
                  <div className="px-4 py-8 text-center text-[12px] text-ink-muted">
                    Loading lines…
                  </div>
                )}
                {!detailQ.isLoading && items.length === 0 && (
                  <div className="px-4 py-8 text-center text-[12px] text-ink-muted">
                    No lines
                  </div>
                )}
                {items.map((l) => {
                  // #1110 (variant summary in the item cell) + #1108 (Ord/Rcv/Bal
                  // fulfillment cols) merged: a Production Order drawer needs both the fabric/
                  // colour line AND the received-vs-ordered progress.
                  const { primary, secondary } = orderLineIdentity({
                    code: l.item_code,
                    description: l.description || l.material_name,
                    variant:
                      buildVariantSummary(l.item_group ?? "others", l.variants ?? null) ||
                      (l.description2 ?? ""),
                  });
                  return (
                    <div
                      key={l.id}
                      className="grid grid-cols-[1fr_96px] items-start gap-2 border-b border-border-subtle px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium leading-snug text-ink">
                          {primary}
                        </div>
                        {secondary && (
                          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-secondary">
                            {secondary}
                          </div>
                        )}
                        {showDrift && l.so_drift && (
                          <div className="mt-1 grid gap-0.5 rounded border border-err/30 bg-err/5 px-1.5 py-1 text-[10.5px] font-semibold text-err">
                            {l.so_drift.itemChanged && (
                              <span>⚠ SO now: {l.so_drift.itemSo} (Production Order still: {l.so_drift.itemPo})</span>
                            )}
                            {!l.so_drift.itemChanged && l.so_drift.specSo !== l.so_drift.specPo && (
                              <span>⚠ SO spec now: {l.so_drift.specSo || "—"} (Production Order still: {l.so_drift.specPo || "—"})</span>
                            )}
                            {l.so_drift.warehouseChanged && <span>⚠ SO warehouse moved.</span>}
                          </div>
                        )}
                      </div>
                      <span className="text-right font-money text-[12.5px] font-semibold text-ink-secondary">
                        {Number(l.qty ?? 0)} {l.uom ?? ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-5 py-3">
              <Button variant="ghost" icon={<Edit3 size={14} />} onClick={onEdit}>
                Edit
              </Button>
              <Button variant="ghost" icon={<Printer size={14} />} onClick={onPrint}>
                Print
              </Button>
              <div className="flex-1" />
              {(() => {
                const s = (row.status || "").toUpperCase();
                const canCancel =
                  s === "DRAFT" || s === "SUBMITTED" || s === "PARTIALLY_RECEIVED";
                const canConvert =
                  s === "SUBMITTED" || s === "PARTIALLY_RECEIVED";
                return (
                  <>
                    {canCancel && (
                      <Button
                        variant="danger"
                        icon={<XIcon size={14} />}
                        onClick={onCancel}
                      >
                        Cancel Production Order
                      </Button>
                    )}
                  </>
                );
              })()}
            </div>
          </>
        )}
    </ResizableDetailDrawer>
  );
}

function MetaItem({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">
        {k}
      </dt>
      <dd className={cn("mt-0.5 text-[13px] font-semibold text-ink", mono && "font-mono")}>
        {v}
      </dd>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 mt-6 font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">
      {children}
    </div>
  );
}

// Table column key → backend sort-whitelist column. Production Order backend whitelist is
// { po_date, po_number, status, total_sen }; only `total` differs from its
// backend name. Non-whitelisted columns (supplier / expected) carry `disableSort`.
const SORT_COL_MAP: Record<string, string> = {
  total: "total_sen",
};

// ─── Row drill-down (DataTable `expandable`) ──────────────────────────────────
// Inline per-line breakdown for one Production Order, rendered under its parent row when the
// chevron is toggled. Lazy-fetches via the SAME useProductionOrderDetail hook the
// drawer uses — TanStack caches it, so expanding a row the drawer already opened
// (or re-expanding) is instant. Group + item code/variant + Qty (ordered) +
// Amount, via the shared DocumentLinesExpansion. A Production Order is a purchase-side doc
// with no MRP coverage on its lines, so the SO/DO-only Stock + Incoming Production Order
// columns are correctly absent.
/* The row dropdown keeps its line table and adds the order's raw materials (owner, 6 Nov 2026). */
function RawMaterialsDrop({ id }: { id: string }) {
  const materials = useProductionMaterials(id);
  const statuses = useMaterialStatus(id);
  const rows = materials.data ?? [];
  if (rows.length === 0) return null;
  const TH = "whitespace-nowrap px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted";
  const TD = "whitespace-nowrap px-3 py-2";
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead><tr className="bg-surface-2"><th className={TH}>Raw material</th><th className={TH}>Needed</th><th className={TH}>Stock</th><th className={TH}>Warehouse</th><th className={TH}>PO</th><th className={TH}>Arrives</th></tr></thead>
        <tbody>
          {rows.map((m) => {
            const st = statuses.data?.[m.id];
            const word = !st ? "Checking…" : st.state === "received" || st.state === "stock" ? "Ready" : st.state === "po" ? "On order" : st.issued > 0 ? "Short" : "No PO yet";
            return (
              <tr key={m.id} className="border-t border-border-subtle">
                <td className="px-3 py-2"><b className="font-semibold">{m.description || m.item_code}</b> <span className="text-[12px] text-ink-muted">{m.item_code}</span></td>
                <td className={cn(TD, "font-semibold")}>{Number(m.qty_needed)} {m.uom ?? ""}</td>
                <td className={TD}><Badge tone={word === "Ready" ? "success" : word === "On order" ? "warning" : word === "Checking…" ? "neutral" : "error"} size="xs">{word}</Badge></td>
                <td className={TD}>{st?.warehouse ?? "—"}</td>
                <td className={TD}>{st?.poNumber ?? "—"}</td>
                <td className={TD}>{st?.state === "po" && st.eta ? fmtDate(st.eta) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* The dropdown sits in a row as wide as every column. It holds to the width on screen and stays there as the table
   scrolls sideways, so nothing in it is cut off. */
function VisibleWidth({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    let scroller = el?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
    if (!el || !scroller) return;
    const box = scroller;
    const measure = () => {
      const left = el.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
      const inset = Math.min(left, 20);
      setFit({ left: inset, width: Math.max(0, box.clientWidth - inset * 2) });
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(box);
    return () => seen.disconnect();
  }, []);
  return <div ref={ref} className="flex flex-col gap-2" style={fit ? { position: "sticky", left: fit.left, width: fit.width } : undefined}>{children}</div>;
}

function PoLinesExpansion({ id }: { id: string }) {
  const navigate = useNavigate();
  const detailQ = useProductionOrderDetail(id);
  const items =
    ((detailQ.data as { items?: DrillItemFields[] } | undefined)?.items ?? []);
  const lines: DocumentDrillLine[] = items.map((l) => ({
    itemGroup: l.item_group ?? null,
    code: l.item_code ?? null,
    description: l.description || l.material_name || null,
    description2: l.description2 ?? null,
    variants: l.variants ?? null,
    qty: Number(l.qty ?? 0),
    amountSen: l.line_total_sen ?? 0,
    assignedSos: [],
    sourceLinked: false,
    provenance: [],
    deliveredDos: [],
  }));
  return (
    <VisibleWidth>
      <DocumentLinesExpansion
        isLoading={detailQ.isLoading}
        coverage="ready"
        isError={Boolean(detailQ.error)}
        errorMessage={detailQ.error instanceof Error ? detailQ.error.message : null}
        lines={lines}
        emptyLabel="No lines on this production order."
        showAssignment
        showDelivered
        onOpenSo={(soDocNo) => navigate(`/scm/sales-orders/${encodeURIComponent(soDocNo)}`)}
        onOpenDo={(doNo) => navigate(`/scm/delivery-orders?q=${encodeURIComponent(doNo)}`)}
      />
      <RawMaterialsDrop id={id} />
    </VisibleWidth>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export function ProductionOrdersListV2() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const askChoice = useChoice();
  const warehousesQ = useWarehouses({ includeInactive: true });

  const status = (params.get("status") ?? "all") as StatusTab;
  const view = (params.get("view") ?? "table") as "table" | "cards";
  const search = params.get("q") ?? "";
  const page = Math.max(0, parseInt(params.get("page") ?? "0", 10) || 0);
  const [pageSize, setPageSize] = useLocalStorage<number>("scm:perpage:production-orders", 50);

  const [selected, setSelected] = useState<PoHeaderRow | null>(null);
  const [sort, setSort] = useState<string | undefined>(undefined);
  // Multi-select → batch-convert N Production Orders into one GRN. State is owned here (the
  // DataTable `selection` prop only renders the checkboxes + reports toggles).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printingDocs, setPrintingDocs] = useState(false);
  /* The SERVER-FILTERABLE column funnels, reported by DataTable's
     onColFiltersChange and pushed into the list query so pagination runs over
     the filtered set (owner 2026-09-16): Creditor Name (the "supplier" column),
     Creditor Code, Currency, Doc Date. Every other funnel (line-level: Item Code,
     Description, Location, Item Group, Delivery Date, Remaining/Qty/…, SO Doc No;
     and the MRP-derived Assigned SO / Delivered) stays
     client-side on the loaded page — those columns are line- or MRP-level and
     the list query cannot express them cheaply. */
  const [serverFunnels, setServerFunnels] = useState<{ creditorNames?: string[]; creditorCodes?: string[]; currencies?: string[]; docDates?: string[] }>({});
  const { requestTerm: debouncedSearch } = useDebouncedSearchTerm(search);

  // Send the active tab's BUCKET NAME as `status`; the backend resolves each
  // bucket to the raw status it covers (open→SUBMITTED, partial→PARTIALLY_RECEIVED,
  // received→RECEIVED, draft/cancelled 1:1, outstanding→SUBMITTED +
  // PARTIALLY_RECEIVED). `all` omits the filter.
  const apiStatus = status === "all" ? undefined : status;

  const { data, isLoading, isFetching, isPlaceholderData, error, refetch } = useProductionOrdersPaged({
    page,
    pageSize,
    status: apiStatus,
    q: debouncedSearch,
    sort,
    ...serverFunnels,
  });
  /* The server-filtered funnels list and count EVERY matching order, so an
     option's count before the click equals the rows after it (DEV-13). */
  const facets = usePoListFacets({ status: apiStatus, q: debouncedSearch, ...serverFunnels }).data?.facets;
  const searchTransition = useSearchResultTransition({
    inputTerm: search,
    requestTerm: debouncedSearch,
    isFetching,
    isPlaceholderData,
    hasData: data !== undefined,
    hasError: Boolean(error),
  });
  const listLoading = isLoading || searchTransition.isSearching;
  // The list below is replaced by a pending panel while a search is in flight,
  // and these tiles summarise the SAME payload - so a settled-looking "RM 0.00"
  // (or the PREVIOUS term's money under a placeholder page) would outlive the
  // rows it describes. Same flag SearchScopeHint already uses for its count.
  const statsPending =
    isLoading || isPlaceholderData || Boolean(error) || searchTransition.resultsAreStale;
  // Conts: a failed load says so on the cards, with Retry, instead of "Loading…" for ever.
  const statsFail = { failed: Boolean(error), onRetry: () => void refetch() };
  const { cancelPo } = usePoCancelAction();
  const holdAction = useHoldAction("pro");

  // Server already filtered + sorted this page — render verbatim. The MRP-derived
  // columns (Assigned SO / Delivered) arrive from the deferred enrichment endpoint
  // a beat later and are merged in here, so opening the list no longer waits on a
  // company-wide computeMrp (perf/po-grn-list-mrp-off-load).
  const serverRows = (data?.purchaseOrders ?? []) as PoHeaderRow[];
  const rows = useEnrichedPoListRows(serverRows, !listLoading);
  const total = data?.total ?? 0;
  const counts = {
    all: 0, draft: 0, pending: 0, in_progress: 0, overdue: 0, on_hold: 0, completed: 0, cancelled: 0,
    ...data?.statusCounts,
  };

  /* The rows the TABLE is actually showing — the page rows minus whatever the
     per-column funnels are hiding. This page is where the problem was found
     (owner 2026-08-12); the rationale, and why the "is a funnel active" test
     compares LENGTH rather than array identity, now live once in the hook. */
  const visible = useVisibleRows(rows);

  // Money-out KPIs sum the rows ON SCREEN (the paginated contract has no
  // full-set money sums), so the cards and the table can never disagree.
  const money = useMemo(() => {
    let committed = 0;
    let outstanding = 0;
    let received = 0;
    for (const r of visible.rows) {
      const t = totalOf(r);
      committed += t;
      const b = statusFor(r.status).bucket;
      if (b === "open" || b === "partial") outstanding += t;
      if (b === "received") received += t;
    }
    return { committed, outstanding, received };
  }, [visible.rows]);

  const setPageParam = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 0) next.delete("page");
    else next.set("page", String(p));
    setParams(next, { replace: true });
  };
  /* DataTable reports its funnel state here; we lift the SERVER-FILTERABLE ones
     into the list query. A changed server funnel restarts at page 1 (mirrors
     setSortAndReset), but the FIRST report — the funnel DataTable restored from
     storage on mount — must not clobber a deep-linked ?page=. */
  const funnelSyncedRef = useRef(false);
  const serverFunnelSigRef = useRef("");
  const onColFiltersChange = (colFilters: Record<string, string[] | undefined>) => {
    const pick = (key: string): string[] | undefined => {
      const v = colFilters[key];
      return v && v.length > 0 ? v : undefined;
    };
    const next = {
      creditorNames: pick("supplier"),
      creditorCodes: pick("creditor_code"),
      currencies: pick("currency"),
      docDates: pick("po_date"),
    };
    const sig = JSON.stringify(next);
    if (sig === serverFunnelSigRef.current) return;
    serverFunnelSigRef.current = sig;
    setServerFunnels(next);
    if (!funnelSyncedRef.current) { funnelSyncedRef.current = true; return; }
    setPageParam(0);
  };
  const setStatusChip = (s: StatusTab) => {
    const next = new URLSearchParams(params);
    if (s === "all") next.delete("status");
    else next.set("status", s);
    next.delete("page");
    setParams(next, { replace: true });
  };
  const setView = (v: "table" | "cards") => {
    const next = new URLSearchParams(params);
    if (v === "table") next.delete("view");
    else next.set("view", v);
    setParams(next, { replace: true });
  };
  const setSearch = (q: string) => {
    const next = new URLSearchParams(params);
    if (!q.trim()) next.delete("q");
    else next.set("q", q);
    next.delete("page");
    setParams(next, { replace: true });
  };
  const sortSyncedRef = useRef(false);
  const setSortAndReset = (s: { key: string; dir: "asc" | "desc" } | null) => {
    setSort(s ? `${SORT_COL_MAP[s.key] ?? s.key}:${s.dir}` : undefined);
    if (!sortSyncedRef.current) {
      sortSyncedRef.current = true;
      return;
    }
    setPageParam(0);
  };
  const resetLayout = () => {
    setSort(undefined);
    setParams(new URLSearchParams(), { replace: true });
  };
  const filtersActive =
    status !== "all" || view !== "table" || search.trim().length > 0;

  const onPullToRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["production-orders"] });
  };

  /* The ONE Export (owner 2026-09-15): every order the list's tab + search +
     sort (and server-filterable funnels) match — not the page on screen — one
     row per line, with the grid's visible columns, funnels and sort (DataTable
     `exportLines`). The filter is the one the list request is built from. */
  const exportFilters = { status: apiStatus, q: debouncedSearch, sort, ...serverFunnels };
  const exportLines = {
    fetchRows: (need: { exportKeys: string[]; filterKeys: string[] }) => fetchProductionExportRows<PoGridRow>(exportFilters, need),
    linesOf: (r: PoGridRow): readonly PoListLine[] => r.lines ?? [],
    sheetName: "Production Orders",
    onError: (e: Error) => {
      void notify({ title: "Export failed", body: e.message || "The export could not be completed.", tone: "error" });
    },
  };

  const goNewPo = () => navigate("/scm/production-orders/new");
  const goFromSo = () => navigate("/scm/production-orders/from-so");
  /* `?import=1` opens the Production Order line import (owner 2026-09-15). The menu item used to
     navigate here with nothing reading the param
     (docs/bugs/0921-the-purchase-order-list-s-import-from-file-opened-nothing.md). URL is state, so a reload keeps the dialog open. */
  const { can, pageAccess } = useHouzsAuth();
  const mayImportLines = canOperateProductionOrders(can, pageAccess);
  const importOpen = mayImportLines && params.get("import") === "1";
  const goImport = () => {
    const next = new URLSearchParams(params);
    next.set("import", "1");
    setParams(next);
  };
  const closeImport = () => {
    const next = new URLSearchParams(params);
    next.delete("import");
    setParams(next, { replace: true });
  };
  const goDuplicate = () => navigate("/scm/production-orders?duplicate=1");
  const goSuppliers = () => navigate("/scm/suppliers");
  const goEdit = (r: PoHeaderRow) => navigate(`/scm/production-orders/${r.id}?edit=1`);
  const printRow = (r: PoHeaderRow) => navigate(`/scm/production-orders/${r.id}?print=1`);
  const goFullPage = (r: PoHeaderRow) => navigate(`/scm/production-orders/${r.id}`);
  // ── Multi-select bulk convert ──────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSelectAll = (keys: string[], allSelected: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) for (const k of keys) next.delete(k);
      else for (const k of keys) next.add(k);
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());
  /* Batch supplier-revised date (owner 2026-08-03) — a supplier who pushes a
     date pushes it for every order in flight, so the operator picks the Production Orders
     here and sets the slot + date once. The server skips locked / other-company
     Production Orders per-Production Order, and the report below names them rather than claiming a clean
     sweep. */
  const [bulkDateOpen, setBulkDateOpen] = useState(false);
  const onBulkDateDone = async (res: BulkSupplierDateResult) => {
    await queryClient.invalidateQueries({ queryKey: ["production-orders"] });
    clearSelection();
    const n = res.updated.length;
    const scope = res.applyToLines ? "and every line" : "(header only)";
    const skippedNote = res.skipped.length
      ? ` ${res.skipped.length} skipped — ${res.skipped
          .map((s) => `${s.poNumber ?? s.id}: ${s.reason}`)
          .join('; ')}`
      : "";
    notify({
      title: n > 0
        ? `Supplier Date ${res.slot} set on ${n} ${n === 1 ? "Production Order" : "Production Orders"}`
        : "No production orders were updated",
      body: `${n > 0 ? `Header ${scope} now reads ${res.date}.` : ""}${skippedNote}`.trim()
        || "Nothing matched — check the picked production orders.",
      tone: res.skipped.length > 0 ? "error" : "info",
    });
  };

  // Batch "Print all" — fetch each selected Production Order's full detail, resolve its bound
  // warehouse name (the PDF can't hit the API), then render into one combined
  // file or one file per Production Order. Reached through the same Print preview as the
  // GRN / DO / SI lists (owner 2026-09-14: 「PO打印没有这个」), so View / Print /
  // Download are the exits and only Download still asks combined-vs-separate.
  const deliverSelectedPos = async (action: PdfAction) => {
    if (printingDocs) return;
    const chosen = rows.filter((r) => selectedIds.has(r.id));
    if (chosen.length === 0) return;
    const warehouses = warehousesQ.data ?? [];
    const toPo = (d: { purchaseOrder: PoHeaderRow; items: PoItemRow[] }) => {
      const wh = warehouses.find(
        (w) => w.id === d.purchaseOrder.purchase_location_id
      );
      return {
        header: {
          ...d.purchaseOrder,
          // Owner 2026-07-24: DELIVER TO shows the warehouse CODE only (was the
          // dual "code · name", which read as a duplicated warehouse name).
          purchase_location_name: wh ? wh.code : null,
          delivery_address: wh?.location ?? null,
          your_ref_no:
            (d.purchaseOrder as { your_ref_no?: string | null }).your_ref_no ??
            null,
          source_so_doc_no:
            (d.purchaseOrder as { source_so_doc_no?: string | null })
              .source_so_doc_no ?? null,
        },
        items: d.items,
      };
    };
    try {
      const pdf = await import("../../vendor/scm/lib/production-order-pdf");
      if (chosen.length === 1) {
        setPrintingDocs(true);
        const d = await queryClient.fetchQuery({
          queryKey: ["production-order-detail", chosen[0]!.id],
          queryFn: () => fetchProductionOrderDetail(chosen[0]!.id),
          staleTime: 30_000,
        });
        const po = toPo(d);
        await pdf.generateProductionOrderPdf(po.header as never, po.items as never, { action });
        clearSelection();
        return;
      }
      const how = action !== "save" ? "one" : await askChoice({
        title: `Print ${chosen.length} production orders`,
        options: [
          { value: "one", label: "One combined PDF" },
          { value: "many", label: "Separate files", detail: "One PDF per document" },
        ],
      });
      if (how == null) return;
      setPrintingDocs(true);
      const pos: Array<{ header: unknown; items: unknown[] }> = [];
      for (const r of chosen) {
        const d = await queryClient.fetchQuery({
          queryKey: ["production-order-detail", r.id],
          queryFn: () => fetchProductionOrderDetail(r.id),
          staleTime: 30_000,
        });
        pos.push(toPo(d));
      }
      if (how === "one") {
        await pdf.generateCombinedProductionOrderPdf(pos as never, {
          fileName: `production-orders-${new Date().toISOString().slice(0, 10)}.pdf`,
          action,
        });
      } else {
        for (const po of pos)
          await pdf.generateProductionOrderPdf(po.header as never, po.items as never, { action });
      }
      clearSelection();
    } catch (e) {
      notify({
        title: "PDF generation failed",
        body: e instanceof Error ? e.message : "Something went wrong.",
        tone: "error",
      });
    } finally {
      setPrintingDocs(false);
    }
  };
  const batchPrint = usePrintPreview(deliverSelectedPos);

  /* Put On Hold / Take Off Hold — the mig-0324 MARKER, never the status.
     The prompt wording and the write live in ./use-hold-action.ts. */
  const setPoHold = (r: PoHeaderRow, onHold: boolean) => holdAction(r.id, r.po_number, onHold);
  const poContextMenu = productionOrderRowMenu<PoHeaderRow>({
    open: goFullPage, edit: goEdit, print: printRow, cancel: (r) => doCancel(r), setHold: setPoHold,
    canCancel: (r) => !["CANCELLED", "RECEIVED"].includes(r.status.toUpperCase()),
  });
  /* Owner 2026-09-09 — a Production Order cancel needs no approval, only its reason
     (./use-production-cancel-action.ts holds the prompt and the words; the server
     refuses a cancel without one). DRAFT and live take the same path. */
  const doCancel = async (r: PoHeaderRow) => {
    if (await cancelPo(r.id, r.po_number)) setSelected(null);
  };

  /* Default view = AutoCount's Production Order listing columns, in AutoCount's order (owner
     2026-09-15: a default export equals the AutoCount file). Every other column
     stays in the chooser, hidden until picked; the export follows whatever the
     operator shows. */
  const lineCols = poLineColumns();
  // _R suffix applies to whichever number is shown (owner report 2026-09-18:
  // an AC-linked Production Order's revision was invisible because the AC doc no bypassed
  // poDisplayNumber entirely) — the AC book keeps one document per Production Order (edited
  // in place, never a new doc no), so its number needs the same revision
  // marker the ERP number gets.
  const docNoOf = (r: PoGridRow): string => poDisplayNumber(r.linked_ac_docno?.trim() || r.po_number, r.revision);
  const columns: PoColumn[] = [
    {
      key: "po_number",
      /* Owner 2026-09-15: AutoCount's own Doc No when the Production Order is linked to the book,
         else the ERP number — the ERP number stays on ERP Doc No. */
      label: PO_LINE_LABELS.docNo,
      // 180 + font-docno (owner 2026-07-31): 132 clipped a full doc no (see
      // the measured DO No. note in MfgDeliveryOrdersListV2). Wider than the
      // 156 used elsewhere because this cell also carries the "_R1" revision
      // suffix — "2990-Production Order-2607-001_R12" measures 145px, i.e. 169 with the
      // px-3 padding.
      width: "180px",
      alwaysVisible: true,
      // _R suffix (owner 2026-07-27) — a revised Production Order reads Production Order-xxx_R1 everywhere.
      getValue: (r) => docNoOf(r),
      render: (r) => (
        <span
          className={cn(
            "font-docno text-[12.5px] font-semibold text-ink",
            isCancelledDocStatus(r.status) && "dt-cancel-strike",
          )}
        >
          {docNoOf(r)}
        </span>
      ),
    },
    lineCols.so_doc_no!,
    /* Straight after the order numbers, so the job's state shows without scrolling (owner, 7 Nov 2026). */
    {
      key: "progress_status",
      label: "Status",
      width: "116px",
      className: "dt-cancel-keep",
      disableSort: true,
      getValue: (r) => extraOf(r).progress?.statusLabel ?? statusFor(r.status).label,
      render: (r) => {
        const word = extraOf(r).progress?.statusLabel ?? statusFor(r.status).label;
        return <Badge tone={PROGRESS_TONE[word] ?? "neutral"} size="xs">{word}</Badge>;
      },
    },    {
      key: "progress",
      label: "Progress",
      width: "124px",
      disableSort: true,
      getValue: (r) => extraOf(r).progress?.label ?? "",
      render: (r) => {
        const p = extraOf(r).progress;
        if (!p?.label) return <span className="text-[12.5px] text-ink-muted">—</span>;
        return <div className="min-w-[96px]"><div className="mb-1 whitespace-nowrap text-[12px] font-semibold text-ink">{p.label}</div><ProgressBar pct={p.pct} overdue={p.overdue} /></div>;
      },
    },    {
      key: "plan_start",
      label: "Plan Start",
      width: "108px",
      disableSort: true,
      exportFormat: "date",
      getValue: (r) => extraOf(r).plan_start ?? "",
      render: (r) => <span className="text-[12.5px] text-ink-secondary">{fmtDate(extraOf(r).plan_start ?? null)}</span>,
    },    {
      key: "plan_finish",
      label: "Plan Finish",
      width: "108px",
      disableSort: true,
      exportFormat: "date",
      getValue: (r) => r.expected_at ?? "",
      render: (r) => <span className="text-[12.5px] text-ink-secondary">{fmtDate(r.expected_at)}</span>,
    },    {
      key: "assigned_to",
      label: "Assigned To",
      width: "132px",
      disableSort: true,
      getValue: (r) => (extraOf(r).assigned_to ?? []).join(", "),
      render: (r) => <span className="text-[12.5px] text-ink-secondary">{(extraOf(r).assigned_to ?? []).join(", ") || "Nobody yet"}</span>,
    },    lineCols.item_code!,
    lineCols.item_description!,
    lineCols.item_description_2!,
    lineCols.location!,
    lineCols.item_group!,
    {
      key: "po_date",
      label: PO_LINE_LABELS.docDate,
      width: "108px",
      getValue: (r) => r.po_date,
      filterCounts: facets?.po_date,
      filterLabel: (v) => (v === "—" ? v : fmtDate(v)),
      exportFormat: "date",
      render: (r) => <span className="text-[12.5px] text-ink-secondary">{fmtDate(r.po_date)}</span>,
    },
    lineCols.remaining_qty!,
    lineCols.delivery_date!,
    lineCols.estimate_delivery_date_1!,
    lineCols.estimate_delivery_date_2!,
    lineCols.estimate_delivery_date_3!,
    lineCols.erp_item_code!,
    lineCols.remarks!,
    lineCols.qty!,
    lineCols.received_qty!,
    lineCols.unit_price!,
    lineCols.line_total!,
    {
      key: "project",
      label: "Project",
      width: "200px",
      getValue: (r) => (r as { project_label?: string | null }).project_label ?? "",
      render: (r) => <span className="text-[12.5px] text-ink-secondary">{(r as { project_label?: string | null }).project_label ?? "—"}</span>,
    },
    {
      /* As an SO line's Stock (owner, 6 Nov 2026): are this order's raw materials here? */
      key: "material_stock_status",
      label: "Stock Status",
      width: "116px",
      getValue: (r) => (r as { material_stock_status?: string | null }).material_stock_status ?? "",
      render: (r) => {
        const v = (r as { material_stock_status?: string | null }).material_stock_status;
        if (!v) return <span className="text-[12.5px] text-ink-muted">—</span>;
        return <Badge tone={v === "READY" ? "success" : "warning"} size="xs">{v}</Badge>;
      },
    },
    {
      key: "production_time",
      label: "Production Time",
      width: "120px",
      getValue: (r) => Number(extraOf(r).production_time_hours ?? 0),
      render: (r) => {
        const h = extraOf(r).production_time_hours;
        return <span className="text-[12.5px] text-ink-secondary">{h == null ? "—" : `${Number(h)} hour${Number(h) === 1 ? "" : "s"}`}</span>;
      },
    },





    {
      key: "expected",
      label: "Completion date",
      width: "128px",
      disableSort: true,
      getValue: (r) => r.expected_at ?? "",
      /* Owner 2026-09-15: in the file, each line's own delivery date. */
      lineValue: (_r, l) => l.delivery_date,
      exportFormat: "date",
      render: (r) => {
        // Sent to the supplier and not fully received: a draft or a held Production Order is not late.
        const bucket = statusFor(r.status).bucket;
        const late = isPastDue(r.expected_at, bucket === "open" || bucket === "partial");
        return (
          <span className={cn("text-[12.5px]", late ? OVERDUE_CLASS : "text-ink-secondary")} title={late ? "Expected date passed, goods not all received" : undefined}>
            {fmtDate(r.expected_at)}
          </span>
        );
      },
    },
    {
      /* Owner 2026-08-05 — ship-to warehouse (list embed purchase_location). */
      key: "purchase_location",
      label: "Ship-to warehouse",
      width: "160px",
      defaultHidden: true,
      disableSort: true,
      getValue: (r) => locationOf(r),
      render: (r) => (
        <span className="min-w-0 truncate text-[12.5px] text-ink-secondary">
          {locationOf(r) || "—"}
        </span>
      ),
    },
    {
      /* Owner 2026-08-05 — currency unit for the Total column (export reads
         both, so a foreign-currency Production Order totals correctly in Excel). */
      key: "currency",
      label: "Currency",
      width: "96px",
      defaultHidden: true,
      disableSort: true,
      getValue: (r) => r.currency ?? "MYR",
      filterCounts: facets?.currency,
      render: (r) => (
        <span className="text-[12.5px] text-ink-secondary">{r.currency ?? "MYR"}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "144px",
      defaultHidden: true,
      // Exempt from the cancelled-row fade — the pill is WHY the row is grey.
      className: "dt-cancel-keep",
      // The export writes the word on screen, hold included (owner 2026-09-15).
      getValue: (r) => poStatusWord(r.status, rowIsHeld(r)) ?? "",
      render: (r) => {
        const st = statusFor(r.status);
        /* mig 0324 — the Hold marker sits BESIDE the real status pill. */
        return <StatusWithHold tone={st.tone} label={st.label} row={r} />;
      },
    },
    {
      key: "total",
      label: "Total",
      width: "128px",
      defaultHidden: true,
      align: "right",
      getValue: (r) => totalOf(r),
      /* Stored in sen; the file is in ringgit (docs/bugs — Total exported 1500000 for RM15,000.00). */
      exportValue: (r) => senToRinggit(totalOf(r), 2),
      exportFormat: "money",
      render: (r) => (
        <span className="font-money text-[13px] font-semibold text-ink">
          {fmtRm(totalOf(r))}
        </span>
      ),
    },
    lineCols.line_id!,
  ];

  const statusPillOptions: Array<{ value: StatusTab; label: string }> = [
    { value: "all", label: `All · ${counts.all}` },
    { value: "draft", label: `Draft · ${counts.draft}` },
    { value: "pending", label: `Pending · ${counts.pending}` },
    { value: "in_progress", label: `In Progress · ${counts.in_progress}` },
    { value: "overdue", label: `Overdue · ${counts.overdue}` },
    { value: "on_hold", label: `On Hold · ${counts.on_hold ?? 0}` },
    { value: "completed", label: `Completed · ${counts.completed}` },
    { value: "cancelled", label: `Cancelled · ${counts.cancelled}` },
  ];

  return (
    <PullToRefresh onRefresh={onPullToRefresh}>
      <div
        className={cn(
          "transition-[padding] duration-200",
          selected ? "md:pr-[540px]" : ""
        )}
      >
        {/* Mobile-only compact header */}
        <div className="mb-3 flex items-start justify-between gap-3 md:hidden">
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-ink">
              Production Orders
            </h1>
            <div className="mt-0.5 text-[12.5px] text-ink-muted">
              {total} Production Order{total === 1 ? "" : "s"} · {fmtRm(money.committed)} committed
            </div>
          </div>
        </div>

        {/* Desktop chrome */}
        <div className="hidden md:block">
          <PageHeader
            eyebrow="Production"
            title="Production Orders"
            description="Works done by our own team. Click any row for the quick view; open the full page to edit."
            primaryAction={
              <div className="flex items-stretch gap-2">
                <Button
                  variant="secondary"
                  icon={<ArrowRightLeft size={14} />}
                  onClick={goFromSo}
                >
                  {transferFromLabel('so')}
                </Button>
                <div className="flex items-stretch">
                  <Button
                    variant="primary"
                    icon={<Plus size={14} />}
                    onClick={goNewPo}
                    className="rounded-r-none"
                  >
                    New Production Order
                  </Button>
                  <SplitDropdown onFromSo={goFromSo} onImport={mayImportLines ? goImport : null} onDuplicate={goDuplicate} />
                </div>
              </div>
            }
            secondaryActions={[
            ]}
          />
        </div>

        {/* Stat strip */}
        <div className="mb-5 hidden grid-cols-2 gap-3 md:grid lg:grid-cols-5">
          <StatCard pending={statsPending} {...statsFail} label="Pending" value={counts.pending.toLocaleString("en-MY")} subtitle="Not started yet" tone="warning" rail="bg-accent-bright" />
          <StatCard pending={statsPending} {...statsFail} label="In Progress" value={counts.in_progress.toLocaleString("en-MY")} subtitle="Started, not finished" rail="bg-accent" />
          <StatCard pending={statsPending} {...statsFail} label="Overdue" value={counts.overdue.toLocaleString("en-MY")} subtitle="Past plan finish" tone={counts.overdue > 0 ? "error" : undefined} rail="bg-err" />
          <StatCard pending={statsPending} {...statsFail} label="On Hold" value={(counts.on_hold ?? 0).toLocaleString("en-MY")} subtitle="Stopped for now" rail="bg-ink-muted" />
          <StatCard pending={statsPending} {...statsFail} label="Completed" value={counts.completed.toLocaleString("en-MY")} subtitle="Sent for GR and DO" tone="success" rail="bg-synced" />
        </div>

        {/* Mobile sticky search */}
        <div className="sticky top-0 z-10 -mx-4 mb-3 bg-bg/95 px-4 py-2 backdrop-blur-sm md:hidden">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Production Order no or notes…"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3.5 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <SearchProgress active={searchTransition.isSearching} label={searchTransition.statusText} className="mt-1.5" />
          <SearchScopeHint scope="server" searching={searchTransition.isSearching} countPending={isLoading || isPlaceholderData || Boolean(error) || searchTransition.resultsAreStale} resultCount={total} term={search} className="mt-1" />
        </div>

        {/* Filter row */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <FilterPills
            options={statusPillOptions}
            value={status}
            onChange={(v) => setStatusChip(v)}
          />
          <div className="flex-1" />
          <div className="hidden md:block">
            <ViewToggle value={view} onChange={setView} />
          </div>
        </div>

        {/* Phone → Cards */}
        <div className="md:hidden">
          {error ? <ListErrorPanel message={(error as Error).message} /> : searchTransition.resultsAreStale ? <SearchPendingPanel label={searchTransition.statusText} /> : <CardsGrid rows={rows} onOpen={(r) => setSelected(r)} />}
          {!searchTransition.resultsAreStale && <div className="pb-24">
            <ListPager
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPageParam}
              onPageSizeChange={(n) => { setPageSize(n); setPageParam(0); }}
            />
          </div>}
        </div>

        {/* Desktop → Table / Cards */}
        <div className="hidden md:block">
          {view === "table" ? (
            <>
              {selectedIds.size > 0 && !searchTransition.resultsAreStale && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5">
                  <span className="text-[13px] font-semibold text-primary">
                    {selectedIds.size} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={clearSelection}>
                      Clear
                    </Button>
                    <Button
                      variant="secondary"
                      icon={<CalendarClock size={14} />}
                      onClick={() => setBulkDateOpen(true)}
                    >
                      Supplier date ({selectedIds.size})
                    </Button>
                    <Button
                      variant="secondary"
                      icon={<Printer size={14} />}
                      disabled={printingDocs}
                      onClick={batchPrint.openPreview}
                    >
                      {printingDocs
                        ? "Printing…"
                        : `Print all (${selectedIds.size})`}
                    </Button>
                    <PrintPreviewBatchModal
                      open={batchPrint.open}
                      onClose={batchPrint.close}
                      docTitle="Production Orders"
                      docNos={rows.filter((r) => selectedIds.has(r.id)).map((r) => poDisplayNumber(r.po_number, r.revision))}
                      {...batchPrint.handlers}
                    />
                  </div>
                </div>
              )}
              <DataTable<PoGridRow, PoListLine>
                tableId="production-orders-v2"
                rows={rows}
                /* Feeds the stat strip so the tiles describe what is on screen
                   rather than what the server matched (owner 2026-08-12). */
                onFilteredRowsChange={visible.onFilteredRowsChange}
                onColFiltersChange={onColFiltersChange}
                loading={listLoading}
                error={error ? (error as Error).message ?? "Failed to load" : null}
                columns={columns}
                getRowKey={(r) => r.id}
                getRowClassName={(r) =>
                  isCancelledDocStatus(r.status) ? "dt-row-cancelled" : undefined
                }
                onRowClick={(r) => setSelected(r)}
                expandable={{
                  render: (r) => <PoLinesExpansion id={r.id} />,
                  rowKey: (r) => r.id,
                }}
                selection={{
                  selectedIds,
                  onToggle: toggleSelect,
                  onToggleAll: toggleSelectAll,
                }}
                contextMenu={poContextMenu}
                exportName="production-orders"
                exportLines={exportLines}
                serverSort
                onSortChange={setSortAndReset}
                emptyLabel={
                  filtersActive
                    ? "No production orders match — try Reset layout to clear filters."
                    : "No production orders yet."
                }
                search={{
                  value: search,
                  onChange: setSearch,
                  placeholder: "Search Production Order no or notes…",
                  debounceMs: 0,
                  searching: searchTransition.isSearching,
                  countPending: isLoading || isPlaceholderData || Boolean(error) || searchTransition.resultsAreStale,
                  scope: "server",
                  totalRecords: total,
                }}
                resetFilters={{
                  active: filtersActive,
                  onReset: resetLayout,
                  label: "Reset layout",
                }}
              />
              {!searchTransition.resultsAreStale && <ListPager
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPageParam}
                onPageSizeChange={(n) => { setPageSize(n); setPageParam(0); }}
              />}
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search Production Order no or notes…"
                    className="h-9 max-w-[320px] flex-1 rounded-md border border-border bg-surface px-3.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <SearchProgress active={searchTransition.isSearching} />
                  <SearchScopeHint scope="server" searching={searchTransition.isSearching} countPending={isLoading || isPlaceholderData || Boolean(error) || searchTransition.resultsAreStale} resultCount={total} term={search} />
                  {filtersActive && (
                    <button
                      type="button"
                      onClick={resetLayout}
                      className="text-[12px] font-semibold text-primary hover:underline"
                    >
                      Reset layout
                    </button>
                  )}
                </div>
              </div>
              {error ? <ListErrorPanel message={(error as Error).message} /> : searchTransition.resultsAreStale ? <SearchPendingPanel label={searchTransition.statusText} /> : <><CardsGrid rows={rows} onOpen={(r) => setSelected(r)} />
              <ListPager
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPageParam}
                onPageSizeChange={(n) => { setPageSize(n); setPageParam(0); }}
              /></>}
            </>
          )}
        </div>
      </div>

      <DetailDrawer
        row={selected}
        onClose={() => setSelected(null)}
        onOpenFull={() => selected && goFullPage(selected)}
        onEdit={() => selected && goEdit(selected)}
        onPrint={() => selected && printRow(selected)}
        onCancel={() => selected && doCancel(selected)}
      />

      <ProductionBulkSupplierDateModal
        open={bulkDateOpen}
        poIds={[...selectedIds]}
        onClose={() => setBulkDateOpen(false)}
        onDone={(res) => void onBulkDateDone(res)}
      />

      <ProductionLineImportModal open={importOpen} onClose={closeImport} />
    </PullToRefresh>
  );
}

export default ProductionOrdersListV2;
