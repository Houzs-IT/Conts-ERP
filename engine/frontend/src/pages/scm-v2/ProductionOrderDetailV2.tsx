// ProductionOrderDetailV2 — Theme C redesign of the Production Order detail
// page. Twin of the sales-side detail V2 template, pivoted for procurement:
// money moves OUT to a supplier, receipt progresses through DRAFT → SUBMITTED
// → PARTIALLY_RECEIVED → RECEIVED. No customer, no delivery address; the
// relationship IS with the supplier.
//
// Route: /scm/production-orders/:id (App.tsx flips ScmProductionOrderDetailV2 here).
// Data: useProductionOrderDetail / useCancelProductionOrder /
//       useConfirmProductionOrder / useReopenProductionOrder
//       (vendored suppliers-queries slice).

import { lazy, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LazySlot } from "../../components/LazySlot";
import { useStaffLookup } from "../../hooks/useStaffLookup";
import { RenovationSoOrderInfo } from "./RenovationSoOrderInfo";
import { AssignDialog, ChangeNotice, ProductionTimeDialog, ProgressPhotos, ProgressSummary, useAddPhotos, useProductionPress } from "./renovationProductionParts";
import { useHoldAction } from "./use-hold-action";
import { ProductionMaterialsSection } from "./ProductionMaterialsSection";
import { ActivityRow, SoAddressFields, SoCustomerFields, SoDetailHeader, SoOrderInfoFields } from "./soDetailParts";
import { scmListReturnTo } from "../../lib/scmListReturn";
import { buildVariantSummary, fmtDate, fmtMoneySen, orderLineIdentity, fmtQty } from "@2990s/shared";
import { formatPhone } from "@2990s/shared/phone";
import {
  ArrowLeft,
  History,
  Printer,
  Mail,
  XCircle,
  Edit3,
  MoreHorizontal,
  PauseCircle,
  Play,
  CheckCircle2,
  RotateCcw,
  Package,
  FilePenLine,
  Share2,
  Split,
  Plus,
  Undo2,
} from "lucide-react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import {
  poConfirmBlockReason,
} from "../../vendor/scm/lib/po-next-step";
import { DataTable, type Column } from "../../components/DataTable";
import { DATA_TABLE_LAYOUT_FAMILIES } from "../../components/dataTableLayoutFamilies";
import {
  DetailGrid,
  DetailMain,
  DetailAside,
  Section,
} from "../../components/DetailLayout";
import {
  type PoHeaderRow,
  type PoItemRow,
} from "../../vendor/scm/lib/production-order-queries";
import {
  useProductionOrderDetail,
  useReopenProductionOrder,
  useConfirmProductionOrder,
  type ProductionDetail,
} from "../../vendor/scm/lib/production-order-queries";
import {
  useSupplierDetail,
} from "../../vendor/scm/lib/suppliers-queries";
import {
  deleteProductionItemPhoto,
  isProductionOwnedPhotoKey,
  uploadProductionItemPhoto,
} from "../../vendor/scm/lib/sales-order-queries";
import { canOperateProductionOrders } from "../../auth/salesAccess";
import { skuMapFromBindings, supplierCodeFor } from "../../vendor/scm/lib/supplier-doc-data";
import { useWarehouses } from "../../vendor/scm/lib/inventory-queries";
import { useMaintenanceConfig } from "../../vendor/scm/lib/mfg-products-queries";
import { poDisplayNumber } from "../../vendor/scm/lib/po-status";
import { useSetBreadcrumbs } from "../../hooks/useBreadcrumbs";
import { useNotify } from "../../vendor/scm/components/NotifyDialog";
import { useConfirm } from "../../vendor/scm/components/ConfirmDialog";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";
import { useAuth as useHouzsAuth } from "../../auth/AuthContext";
import { usePoCancelAction } from "./use-production-cancel-action";
import { PrintPreviewModal, useOpenPrintPreviewFromUrl, usePrintPreview } from "../../components/scm-v2/PrintPreviewModal";
// Carried line photos (mig 0274) — the shared read-only strip, Production Order-sourced.
import { SoLinePhotoStrip } from "../../components/scm-v2/SoLinePhotoStrip";
import type { PdfAction } from "../../vendor/scm/lib/pdf-common";
import { cn } from "../../lib/utils";
import { HEIC_ACCEPT } from "../../lib/heicToJpeg";
import { HoldChip } from "../../vendor/scm/components/HoldChip";

import { DocumentHistoryDrawer } from "./DocumentHistoryDrawer";
import { FocAmount } from "../../vendor/scm/components/FocAmount";
import { ADD_LINE_LABEL, addLineHref } from "../../vendor/scm/lib/add-line-handoff";
import { RenovationDocBlock, renoLineColumns, useRenoDocInfo } from "./RenovationDocInfo";
import { DocAttachments, LineFilesButton } from "../../components/doc-attachments/DocAttachments";
// ─── Helpers ────────────────────────────────────────────────────────────────

const fmtMoney = (centi: number, currency = "MYR"): string => fmtMoneySen(centi, currency);

/** The sales order behind the order, as the SO page's parts read it (backend loadLinkedSo). */
type LinkedSo = {
  doc_no: string; so_kind?: string | null; debtor_name?: string | null; phone?: string | null; email?: string | null; customer_type?: string | null;
  agent?: string | null; salesperson_id?: string | null; ref?: string | null; po_doc_no?: string | null; customer_so_no?: string | null;
  address1?: string | null; address2?: string | null; city?: string | null; postcode?: string | null; customer_state?: string | null;
  customer_country?: string | null; sales_location?: string | null; building_type?: string | null; venue?: string | null; processing_date?: string | null;
  customer_delivery_date?: string | null; branding?: string | null; payment_method?: string | null; payment_methods_summary?: string;
};

const supplierNameOf = (h: PoHeaderRow): string =>
  h.supplier?.name || h.supplier_id || "—";
const supplierCodeOf = (h: PoHeaderRow): string => h.supplier?.code || "—";

const totalOf = (h: PoHeaderRow): number =>
  h.total_sen ?? h.subtotal_sen ?? 0;

// Production Order effective lifecycle for hero + tone.
type Effective =
  | "on_hold"
  | "draft"
  | "submitted"
  | "partial"
  | "received"
  | "cancelled";
/* THE LAST LINE USED TO BE `return "cancelled"`, and that is why ON_HOLD had to
   be added here and not only to the label maps: a status this chain does not
   name reads as CANCELLED, so a HELD production order would have told the buyer
   his order was cancelled. A hold is the opposite of a cancel — it is the
   reversible one — so the wrong word here is not a cosmetic slip.

   The fall-through is now CANCELLED only for CANCELLED. Anything genuinely
   unrecognised falls to "on_hold"'s neighbour rather than to a terminal claim:
   an unknown status is not evidence that an order is dead. */
const effectiveOf = (h: PoHeaderRow): Effective => {
  const s = (h.status || "").toUpperCase();
  if (s === "DRAFT") return "draft";
  if (s === "SUBMITTED") return "submitted";
  if (s === "PARTIALLY_RECEIVED") return "partial";
  if (s === "RECEIVED") return "received";
  if (s === "ON_HOLD") return "on_hold";
  return "cancelled";
};

const EFFECTIVE_TONE: Record<
  Effective,
  { tone: "success" | "warning" | "error" | "neutral"; label: string; blurb: string }
> = {
  draft: { tone: "warning", label: "Draft", blurb: "Draft · not started" },
  submitted: { tone: "warning", label: "Submitted", blurb: "Submitted · in production" },
  partial: { tone: "warning", label: "Partially received", blurb: "Partially received · balance still due" },
  received: { tone: "success", label: "Complete", blurb: "Complete" },
  cancelled: { tone: "error", label: "Cancelled", blurb: "Cancelled · no further action" },
  /* ON_HOLD (mig 0318). A held Production Order is not receivable — grns.ts filters
     receivable Production Orders through an allow-list — and it is REVERSIBLE, which is
     the whole reason it exists beside CANCELLED. */
  on_hold: { tone: "warning", label: "On Hold", blurb: "On hold · reversible" },
};

const STAGE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Complete",
  CANCELLED: "Cancelled",
  /* A status with no label here renders as nothing, or as its raw slug. ASSR
     paid for that when `voided` reached the customer portal as the word
     "voided", so every value the column can hold gets a word. */
  ON_HOLD: "On Hold",
};

const initialsOf = (name: string | null | undefined): string => {
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

function Field({
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
      <div className={cn("mt-1 text-[14px] font-semibold leading-snug", muted ? "text-ink-muted" : "text-ink", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}

// ─── Aside primitives ───────────────────────────────────────────────────────

function AsideCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-stone">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-brand text-ink-muted">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function BigDate({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-ink-secondary">{k}</div>
      <div className={cn("mt-0.5 text-[15px] font-bold", muted && "text-ink-muted")}>{v}</div>
    </div>
  );
}

function KeyDateRow({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-2 last:border-b-0">
      <span className="text-[12.5px] text-ink-muted">{k}</span>
      <span className={cn("text-[13px] font-semibold", muted ? "text-ink-muted" : "text-ink")}>
        {v}
      </span>
    </div>
  );
}

function PersonRow({
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
          tone === "accent" ? "bg-accent-soft text-accent-ink" : "bg-border-subtle text-ink-secondary"
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

// ─── Production Order total hero — money-out slab ────────────────────────────────────────
//
// Production Order is a money-out doc. The hero shows the committed total; while pending
// it renders in accent-bright (warning), once fully received it flips to
// success (green). Ordered + received qty ride as sub-lines so ops can see
// how far the Production Order is through its receipt lifecycle without opening any line.

function PoTotalHeroCard({ header }: { header: PoHeaderRow }) {
  const eff = effectiveOf(header);
  const t = EFFECTIVE_TONE[eff];
  const total = totalOf(header);
  return (
    <div className="rounded-lg bg-sidebar px-5 py-5 text-sidebar-ink shadow-stone">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-brand text-sidebar-ink-muted">
        {total > 0 ? "Production order value" : "Production status"}
      </div>
      <div className="mt-1.5 font-money text-[28px] font-bold leading-none tracking-tight text-white">
        {total > 0 ? fmtMoney(total, header.currency) : t.label}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            t.tone === "success" ? "bg-synced"
              : t.tone === "warning" ? "bg-accent-bright"
                : t.tone === "error" ? "bg-err"
                  : "bg-sidebar-ink-muted"
          )}
        />
        <span className="text-[12.5px] text-sidebar-ink-muted">{t.blurb}</span>
      </div>

      {total > 0 && (
        <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
          <HeroLine k="Subtotal" v={fmtMoney(header.subtotal_sen, header.currency)} />
          <HeroLine k="Tax" v={fmtMoney(header.tax_sen ?? 0, header.currency)} />
          <HeroLine k="Total" v={fmtMoney(total, header.currency)} strong />
        </div>
      )}

    </div>
  );
}

function HeroLine({
  k,
  v,
  strong,
}: {
  k: string;
  v: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-[12.5px] text-sidebar-ink-muted", strong && "font-semibold text-white")}>
        {k}
      </span>
      <span className={cn("font-money text-[13px] font-semibold text-sidebar-ink", strong && "text-[16px] font-bold text-accent-bright")}>
        {v}
      </span>
    </div>
  );
}

// ─── Legacy inline editor (lazy) ───────────────────────────────────────────
// V2 is READ-ONLY by design. The full inline editor — which also hosts the
// SO-amendment "Revision ready" banner (Approve Production Order + Send) + Revisions tab —
// lives in ./ProductionOrderDetail. We forward to it whenever ?edit=1 lands on
// this route so the Edit button (and the Amendments queue's Production Order rows) actually
// open editable fields + the amendment banner. Mirrors SalesOrderDetailV2's
// forward. Lazy-loaded so the editor bundle only ships when someone edits.
const ProductionOrderDetailInlineEditor = lazy(() =>
  import("./ProductionOrderDetail").then((m) => ({ default: m.ProductionOrderDetail })),
);

// ─── Main page ─────────────────────────────────────────────────────────────

/* Thin router — only calls useSearchParams and useLocation (both unconditional,
   at the top) so Rules of Hooks are respected when
   the ?edit=1 flip swaps between the read-only body and the lazy inline editor
   (the two children have different hook counts). */
export function ProductionOrderDetailV2() {
  const [params] = useSearchParams();
  const location = useLocation();
  if (params.get("edit") === "1") {
    /* Scoped, not bare: a boundary keyed on the document this slot is editing,
       so a failed editor chunk shows the panel in place of the editor and
       clears when the operator moves to another document, instead of leaning
       on a boundary in a file this one cannot see. */
    return (
      <LazySlot
        resetKey={`po-editor:${location.pathname}`}
        fallback={<div className="p-8 text-[13px] text-ink-muted">Loading editor…</div>}
      >
        <ProductionOrderDetailInlineEditor />
      </LazySlot>
    );
  }
  return <ProductionOrderDetailV2ReadOnly />;
}

function ProductionOrderDetailV2ReadOnly() {
  const { id } = useParams<{ id: string }>();
  /* Renovation mode (mig 0116): the project and each line's room / category copied from the SO. */
  const reno = useRenoDocInfo("pro", id);
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const detail = useProductionOrderDetail(id ?? null);
  const confirmPo = useConfirmProductionOrder();
  const { cancelPo, isPending: cancelling } = usePoCancelAction();
  const reopenPo = useReopenProductionOrder();
  const notify = useNotify();
  const confirm = useConfirm();
  const { can, pageAccess } = useHouzsAuth();
  /* Line-photo ADD-ONS (owner 2026-08-28): a purchaser may attach photos
     directly on a Production Order line. Carried SO keys stay read-only here (server refuses
     their deletion); only `po-items/...` keys grow a delete control. UI gate =
     the same cohort that may operate Production Orders; the server's area guard is the
     boundary either way. */
  const mayEditPoPhotos = canOperateProductionOrders(can, pageAccess);
  const uploadLinePhoto = async (itemId: string, file: File) => {
    if (!purchaseOrder?.id) return;
    try {
      await uploadProductionItemPhoto(purchaseOrder.id, itemId, file);
      await detail.refetch();
    } catch (e) {
      void notify({ title: "Photo not added", body: e instanceof Error ? e.message : "Upload failed.", tone: "error" });
    }
  };
  const deleteLinePhoto = async (itemId: string, photoKey: string) => {
    if (!purchaseOrder?.id) return;
    const ok = await confirm({
      title: "Delete this photo?",
      body: "Only photos added on this Production Order can be deleted here. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProductionItemPhoto(purchaseOrder.id, itemId, photoKey);
      await detail.refetch();
    } catch (e) {
      void notify({ title: "Photo not deleted", body: e instanceof Error ? e.message : "Delete failed.", tone: "error" });
    }
  };
  // In-flight guard for the supplier send — see doSendToSupplier.
  const [sendingToSupplier, setSendingToSupplier] = useState(false);
  // Production Order amendment create modal (feat/amendment-ui) — localized state.
  const [showAmendModal, setShowAmendModal] = useState(false);
  // Relationship map modal — open state only; the chain itself comes from
  // usePoRelationshipMap below (after the header row resolves).
  const [relMapOpen, setRelMapOpen] = useState(false);
  /* History drawer. The button used to navigate to `?tab=history`, a param
     nothing in this file reads, so it changed the URL and nothing else — while
     the backend had been recording this Production Order's every change all along. */
  const [historyOpen, setHistoryOpen] = useState(false);
  // Allocation editor (mig 0235) — which line's split is open. Deliberately
  // available at every status except CANCELLED (backend rule): the historical
  // consolidated lines the owner wants to attribute live on RECEIVED Production Orders.
  const [allocLineId, setAllocLineId] = useState<string | null>(null);

  /* Nick 2026-07-09 — Ship-to warehouse cell was rendering the raw
     `purchase_location_id` UUID because the field only carries the id;
     the backend join for the name/code hasn't been surfaced on this
     header shape. Look it up client-side via the same useWarehouses
     hook every other Production Order screen uses. includeInactive so a warehouse
     that was toggled off after the Production Order was raised still resolves. */
  const warehousesQ = useWarehouses({ includeInactive: true });
  // Sofa-compartment hero photos for the Production Order's sofa-layout schematic (drawn from
  // real photos when uploaded, else the drawn fallback). Same master-scope config
  // POS Custom Builder reads.
  const maintenanceQ = useMaintenanceConfig();
  const warehouseNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehousesQ.data ?? []) {
      m.set(w.id, w.code);
    }
    return m;
  }, [warehousesQ.data]);

  const purchaseOrder =
    (detail.data as { purchaseOrder?: PoHeaderRow } | undefined)?.purchaseOrder ??
    null;
  const items: PoItemRow[] = useMemo(
    () => ((detail.data as { items?: PoItemRow[] } | undefined)?.items ?? []),
    [detail.data]
  );
  const linkedSo = (detail.data as { linkedSo?: LinkedSo | null } | undefined)?.linkedSo ?? null;
  const completion = (detail.data as {
    completion?: { grn: { id: string; grn_number: string } | null; deliveryOrder: { id: string; do_number: string } | null };
  } | undefined)?.completion;
  const page = detail.data as unknown as ProductionDetail | undefined;
  const orderExtra = purchaseOrder as unknown as { production_time_hours?: number | string | null; plan_start?: string | null; actual_start_at?: string | null; actual_start_by_name?: string | null } | null;
  const productionHours = orderExtra?.production_time_hours == null ? null : Number(orderExtra.production_time_hours);
  const started = Boolean(orderExtra?.actual_start_at);
  const title = (page?.project?.building || page?.project?.unit_no)
    ? [page.project.building, page.project.unit_no].filter(Boolean).join(" ")
    : linkedSo?.debtor_name || purchaseOrder?.po_number || "";
  const press = useProductionPress({ id: id ?? "", po_number: purchaseOrder?.po_number ?? "", title }, () => void detail.refetch());
  const photos = useAddPhotos(id ?? "");
  const holdAction = useHoldAction("pro");
  const [dialog, setDialog] = useState<"time" | "assign" | null>(null);
  const { nameOf: salespersonNameOf } = useStaffLookup();

  useSetBreadcrumbs([
    { label: "Production Orders", to: "/scm/production-orders" },
    { label: purchaseOrder?.po_number ?? id ?? "Production Order" },
  ]);

  /* Supplier SKU — the code the SUPPLIER acts on, and the one the purchaser
     quotes on the phone. Lines SNAPSHOT it at Production Order creation (`supplier_sku`);
     lines raised before that column existed didn't, so fall back to the live
     supplier↔material binding — the same two-step the PRINTED Production Order already runs
     (supplierCodeFor). The screen must not say "—" where the PDF prints a code.

     The binding fetch is skipped entirely when every line carries a snapshot,
     which is the normal case; `useSupplierDetail(null)` is disabled, so this
     costs nothing on a modern Production Order. */
  const needsSkuLookup = useMemo(
    () => items.some((l) => !(l.supplier_sku ?? "").trim()),
    [items]
  );
  const supplierForSku = useSupplierDetail(
    needsSkuLookup ? purchaseOrder?.supplier_id ?? null : null
  );
  const skuByMaterialCode = useMemo(
    () => skuMapFromBindings(supplierForSku.data?.bindings),
    [supplierForSku.data]
  );

  const eff = purchaseOrder ? effectiveOf(purchaseOrder) : null;
  const stageLabel = purchaseOrder
    ? STAGE_LABEL[(purchaseOrder.status || "").toUpperCase()] ??
      purchaseOrder.status
    : "";
  const badgeTone = eff ? EFFECTIVE_TONE[eff].tone : "neutral";

  // Back always returns to the Production Orders list (owner 2026-07-24: every
  // details page's back button goes to its relevant list, not wherever
  // browser history happens to point). The list restores its own sticky
  // filters, so the prior filtered view comes back — no context lost.
  const goBack = () => navigate(scmListReturnTo("/scm/production-orders"));
  const goEdit = () => id && navigate(`/scm/production-orders/${id}?edit=1`);
  /* "Add line" from the page you START on — the affordance lived only
     inside the editor, under a different name per document, so it read as
     missing (docs/bugs/0853). */
  const goAddLine = () => id && navigate(addLineHref(`/scm/production-orders/${id}`));
  // Render + download the Production Order PDF via the shared jspdf generator (client-side),
  // mirroring the V1 ProductionOrderDetail handler. The old `?print=1` navigation
  // was dead — nothing consumed that param — so the button did nothing.
  const deliverPrintPdf = (action: PdfAction) => {
    if (!purchaseOrder) return;
    // PR #102 — pre-resolve purchase_location name + deliver-to address (the
    // PDF can't hit the API), same as the V1 detail page.
    const wh = (warehousesQ.data ?? []).find(
      (w) => w.id === purchaseOrder.purchase_location_id
    );
    const headerForPdf = {
      ...purchaseOrder,
      // Owner 2026-07-24: DELIVER TO shows the warehouse CODE only (was the
      // dual "code · name", which read as a duplicated warehouse name).
      purchase_location_name: wh ? wh.code : null,
      delivery_address: wh?.location ?? null,
      your_ref_no:
        (purchaseOrder as unknown as { your_ref_no?: string | null })
          .your_ref_no ?? null,
      source_so_doc_no:
        (purchaseOrder as unknown as { source_so_doc_no?: string | null })
          .source_so_doc_no ?? null,
    };
    return import("../../vendor/scm/lib/production-order-pdf")
      .then(async ({ generateProductionOrderPdf }) => {
        const { loadSofaCompartmentPhotos } = await import("../../vendor/scm/lib/sales-order-queries");
        const sofaPhotos = await loadSofaCompartmentPhotos(maintenanceQ.data?.data?.sofaCompartmentMeta);
        return generateProductionOrderPdf(headerForPdf as never, items as never, { action, sofaPhotos, renovation: reno });
      })
      .catch((e) =>
        notify({
          title: "PDF generation failed",
          body: e instanceof Error ? e.message : "Something went wrong.",
          tone: "error",
        })
      );
  };
  const print = usePrintPreview(deliverPrintPdf);
  useOpenPrintPreviewFromUrl(print.openPreview, !!purchaseOrder);

  /* Raise Return — the Production Order-sourced purchase return. The button existed only on
     the legacy detail page, which no route renders any more, so a received Production Order
     had NO way into a return at all (owner 2026-09-28, HC-Production Order-010114). The link
     goes through convertToLink so the scope params stay the ones
     lib/convertScope owns. */

  /* ONE control commits a draft Production Order, and it calls the endpoint that writes.
     `doSubmit` (PATCH /submit) is gone — see po-next-step.ts for the handler
     that never had an update in it. The confirm dialog is kept because
     confirming is what makes the Production Order live supply and drops its SO lines out of
     the From-SO picker; the wording now matches what the button does. */
  const doConfirm = async () => {
    if (!id) return;
    if (await confirm({
      title: "Confirm this Production Order?",
      body: "It becomes confirmed.",
      confirmLabel: "Confirm Production Order",
    })) {
      confirmPo.mutate(id);
    }
  };
  /* Owner 2026-09-09 — no approval, but the reason is compulsory: the prompt
     and the words are in ./use-production-cancel-action.ts, shared with the editor, the
     list menu and mobile, and the server refuses a cancel that carries none. */
  const doCancel = async () => {
    if (!purchaseOrder) return;
    void cancelPo(purchaseOrder.id, purchaseOrder.po_number);
  };
  const doReopen = async () => {
    if (!purchaseOrder) return;
    if (await confirm({
      title: `Reopen Production Order ${purchaseOrder.po_number}?`,
      ...((purchaseOrder.status || "").toUpperCase() === "RECEIVED" ? { body: "Its goods receipt and delivery order must be cancelled first." } : {}),
      confirmLabel: "Reopen",
    })) {
      reopenPo.mutate(purchaseOrder.id, { onError: (e) => notify({ title: "Not reopened", body: e instanceof Error ? e.message : "Something went wrong.", tone: "error" }) });
    }
  };

  /* SO→Production Order drift + pending amendment (owner 2026-07-27, "为什么没有 SO Request
     的相关信息?"). The View surface showed neither the pending SO revision nor
     what it now requests — both only lived in the ?edit=1 editor. so_drift is
     per-line (set by the detail endpoint when a line's source SO changed after
     this Production Order was raised); open_amendment is the best-effort pending-amendment
     stamp. Drift is only actionable pre-receipt (a received/cancelled Production Order can't
     be re-sent), mirroring the editor's gate. */
  const showDrift =
    purchaseOrder?.status === "SUBMITTED" || purchaseOrder?.status === "PARTIALLY_RECEIVED";
  const driftCount = showDrift ? items.filter((l) => l.so_drift).length : 0;
  const openAmendment =
    (purchaseOrder as unknown as {
      open_amendment?: { id: string; status: string; amendment_no: string } | null;
    })?.open_amendment ?? null;

  // Line item columns — carries a Received and a Balance column so ops can see
  // per-line where the Production Order stands vs the supplier's shipments. Any of these can
  // be hidden from the Columns drawer; only Item is alwaysVisible.
  const lineColumns: Column<PoItemRow>[] = [
    {
      key: "item",
      label: "Item",
      alwaysVisible: true,
      getValue: (l) => l.item_code,
      /* Item CODE first, then the variant subtitle; description dropped (owner 2026-07-24) — the shared order-line rule
         (vendor/shared/line-identity.ts). JUDGEMENT CALL, stated rather than
         silently taken: this is PURCHASE vocabulary (item_code), and every
         owner precedent for the rule is sales-side, so it is not covered by the
         letter of any report. It is swept because the SHAPE is identical, not
         the vocabulary — this render was byte-for-byte the pre-#647
         SalesOrderDetailV2 line-item cell (bold description, then the code and
         `· description2` sharing one muted line), i.e. the exact thing the owner
         reported. The operator already reads the description on the bold line;
         the code beneath it is the same identity twice. The V1 purchase detail
         tables are deliberately NOT swept — there the code is the BOLD PRIMARY
         line and dropping it would leave the row identified only by a variant
         summary. The code still BINDS: getValue above keeps it the sort /
         search / export value. */
      render: (l) => {
        const { primary, secondary } = orderLineIdentity({
          code: l.item_code,
          description: l.description || l.material_name,
          variant: buildVariantSummary(l.item_group ?? "others", l.variants) || (l.description2 ?? ""),
        });
        const remark = (l.notes ?? "").trim();
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
            {/* The line's REMARK (purchase_order_items.notes) — the SO line's
                twin, rendered the same way (SalesOrderDetailV2's Item cell).
                Owner 2026-09-04: 「SO line 和 Production Order line 的 remarks」. This is not
                a duplicate of the identity above: it is free text that appears
                nowhere else on the row, and on the 923 of 1,117 migrated
                company-1 Production Order lines that carry it (measured 2026-09-04), it is
                AutoCount's own Description 2 — the customer's spec text in the
                salesperson's own words. Nothing on
                this page rendered it before, so the migration's copy was
                invisible. It WRAPS rather than truncating: half an instruction
                is worse than none. */}
            {remark && (
              <div className="mt-1 whitespace-pre-wrap break-words text-[11.5px] italic leading-snug text-ink-secondary">
                {remark}
              </div>
            )}
            {/* SO-drift redline — what the source SO now requests vs what this
                Production Order still holds. The same note the editor shows, so the reader
                sees the pending change without opening the SO. */}
            {showDrift && l.so_drift && (
              <div className="mt-1 grid gap-0.5 rounded border border-err/30 bg-err/5 px-2 py-1 text-[11px] font-semibold text-err">
                {l.so_drift.itemChanged && (
                  <span>⚠ SO now orders {l.so_drift.itemSo} (this Production Order still has {l.so_drift.itemPo}) — cancel &amp; re-raise is safer.</span>
                )}
                {!l.so_drift.itemChanged && l.so_drift.specSo !== l.so_drift.specPo && (
                  <span>⚠ SO spec now: {l.so_drift.specSo || "—"} (this Production Order still: {l.so_drift.specPo || "—"})</span>
                )}
                {l.so_drift.warehouseChanged && (
                  <span>⚠ SO warehouse moved — this Production Order still points at the old one.</span>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    /* Remark as its OWN column — hidden by default because the text already
       renders under the item above, where it is read. This column exists so the
       remark is SEARCHABLE, filterable and lands in the CSV export: a `render`
       has no getValue, so without it the text is invisible to every one of
       those. Exact twin of SalesOrderDetailV2's Remark column. */
    {
      key: "remark",
      label: "Remark",
      width: "220px",
      defaultHidden: true,
      getValue: (l) => (l.notes ?? "").trim(),
      render: (l) => {
        const remark = (l.notes ?? "").trim();
        return remark ? (
          <span className="whitespace-pre-wrap break-words text-[12px] text-ink-secondary">{remark}</span>
        ) : (
          <span className="text-ink-muted">—</span>
        );
      },
    },
    /* Photos — the reference shots the SO line brought along (mig 0274 carry,
       plus the AutoCount importer's keys), through the SAME strip + state
       machine the SO detail renders (components/scm-v2/SoLinePhotoStrip with
       source="po"). Since owner 2026-08-28 the Production Order also AUTHORS its own
       add-ons (`po-items/...` keys): operate-cohort users get an add tile and
       a delete control on Production Order-owned keys only — carried SO keys stay read-only
       here and are managed on the Sales Order.
       getValue is the COUNT so the column sorts/filters/exports as a number. */
    {
      key: "photos",
      label: "Photos",
      width: "110px",
      defaultHidden: true,
      getValue: (l) => (l.photo_urls ?? []).length,
      render: (l) => (
        <div className="flex items-center gap-1.5">
          <SoLinePhotoStrip
            source="pro"
            docId={purchaseOrder?.id ?? ""}
            itemId={l.id}
            photoKeys={l.photo_urls ?? []}
            edit={null}
          />
          <LineFilesButton
            docType="production_order"
            docId={purchaseOrder?.id}
            lineId={l.id}
            canEdit={purchaseOrder?.status !== "CANCELLED"}
          />
        </div>
      ),
    },
    {
      key: "qty",
      label: "Qty",
      width: "84px",
      align: "right",
      getValue: (l) => l.qty,
      render: (l) => (
        <span className="font-money text-[13px] text-ink-secondary">
          {fmtQty(l.qty)} <span className="text-[10.5px] text-ink-muted">{l.uom || ""}</span>
        </span>
      ),
    },
    {
      key: "unit",
      label: "Unit price",
      width: "108px",
      defaultHidden: true,
      align: "right",
      getValue: (l) => l.unit_price_sen,
      render: (l) => (
        <span className="font-money text-[13px] text-ink-secondary">
          {fmtMoney(l.unit_price_sen, purchaseOrder?.currency)}
        </span>
      ),
    },
    {
      key: "total",
      label: "Amount",
      width: "132px",
      defaultHidden: true,
      align: "right",
      getValue: (l) => l.line_total_sen,
      render: (l) => (
        <FocAmount line={l} amount={fmtMoney(l.line_total_sen ?? 0, purchaseOrder?.currency)} />
      ),
    },
  ];

  // ── Loading / error states ───────────────────────────────────────────
  if (!id) {
    return <div className="p-8 text-center text-ink-muted">No production order specified.</div>;
  }
  if (detail.isPending) {
    return (
      <div className="animate-fade-in p-8 text-center text-ink-muted">
        Loading production order…
      </div>
    );
  }
  if (detail.error || !purchaseOrder) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mb-2 font-display text-[18px] font-extrabold text-err">
          Couldn't load production order
        </div>
        <p className="text-[13px] text-ink-muted">
          {(detail.error as Error | undefined)?.message ?? "The Production Order was not found."}
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={goBack} icon={<ArrowLeft size={14} />}>
            Back to Production Orders
          </Button>
        </div>
      </div>
    );
  }

  const rawStatus = (purchaseOrder.status || "").toUpperCase();
  /* Both status questions now come from vendor/scm/lib/po-next-step.ts, which
     also records why the old pair was wrong: `canSubmit` gated a DRAFT onto
     PATCH /submit, a handler with no write path that 409s every draft, while
     `canConfirm` gated /confirm — the endpoint that actually performs the
     DRAFT → SUBMITTED write — onto SUBMITTED, where it is an explicit no-op.
     The predicates were inverted relative to their endpoints. */
  const canConfirm = poConfirmBlockReason(purchaseOrder.status) === null;
  const canCancel = rawStatus !== "CANCELLED" && rawStatus !== "RECEIVED";
  const canReopen = rawStatus === "CANCELLED" || rawStatus === "RECEIVED";
  const canComplete = rawStatus === "SUBMITTED" && !purchaseOrder.on_hold && (started || Boolean((purchaseOrder as unknown as { completion_step?: string | null }).completion_step));
  const shipToName = purchaseOrder.purchase_location_id ? warehouseNameById.get(purchaseOrder.purchase_location_id) : undefined;
  const orderMeta = purchaseOrder as unknown as {
    source_po?: { id: string; po_number: string } | null; completion_step?: string | null; completion_error?: string | null;
  };
  const completionStopped = rawStatus === "SUBMITTED" && Boolean(orderMeta.completion_step || orderMeta.completion_error);
  const soLineCount = new Set(items.map((l) => l.so_item_id).filter(Boolean)).size;
  const { completing } = press;
  const canStart = rawStatus === "SUBMITTED" && !purchaseOrder.on_hold && !started;
  const doComplete = () => void press.complete();
  const progress = page?.progress;
  const canAct = mayEditPoPhotos && (rawStatus === "SUBMITTED" || rawStatus === "RECEIVED");
  const isCancelled = rawStatus === "CANCELLED";

  return (
    <div className="pb-56 md:pb-0">
      <SoDetailHeader
        title={title}
        docNo={purchaseOrder.po_number}
        status={{ tone: badgeTone, label: progress?.statusLabel ?? stageLabel }}
        meta={[
          `Document date ${fmtDate(purchaseOrder.po_date)}`,
          `${items.length} line${items.length === 1 ? "" : "s"}`,
        ]}
        onBack={goBack}
        chips={<HoldChip onHold={purchaseOrder.on_hold} reason={purchaseOrder.hold_reason} />}
        actions={
          <>
            <Button variant="ghost" icon={<History size={14} />} onClick={() => setHistoryOpen(true)}>History</Button>
            <Button variant="secondary" icon={<Printer size={14} />} onClick={print.openPreview}>Print PDF</Button>
            {(rawStatus === "SUBMITTED" || rawStatus === "DRAFT") && (
              <Button variant="secondary" icon={<PauseCircle size={14} />} onClick={() => void holdAction(purchaseOrder.id, purchaseOrder.po_number, !purchaseOrder.on_hold)}>{purchaseOrder.on_hold ? "Take off hold" : "Put on hold"}</Button>
            )}
            {canCancel && (
              <Button variant="danger" icon={<XCircle size={14} />} onClick={doCancel} disabled={cancelling}>Cancel Production Order</Button>
            )}
            {canStart && (
              <Button variant="primary" icon={<Play size={14} />} onClick={press.pressStart} disabled={press.starting}>{press.starting ? "Starting…" : "Start"}</Button>
            )}
            {canComplete && (
              <Button variant="primary" icon={<CheckCircle2 size={14} />} onClick={doComplete} disabled={completing !== null}>
                {completing ?? (completionStopped ? "Retry Complete" : "Complete")}
              </Button>
            )}
            {canReopen && <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={doReopen}>Reopen</Button>}
            {canConfirm && (
              <Button variant="secondary" icon={<CheckCircle2 size={14} />} onClick={doConfirm}>Confirm Production Order</Button>
            )}
            <Button variant="secondary" icon={<Plus size={14} />} onClick={goAddLine}>{ADD_LINE_LABEL}</Button>
            <Button variant="secondary" icon={<Edit3 size={14} />} onClick={goEdit}>Edit</Button>
          </>
        }
      />

      {/* Detail body */}
      <div className="py-5">
        {/* Mobile-only Production Order total hero */}
        <div className="mb-3 rounded-lg border border-border bg-surface p-4 shadow-stone md:hidden">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-ink-muted">
            Production Order total
          </div>
          <div className="mt-1 font-money text-[26px] font-bold leading-none tracking-tight text-ink">
            {fmtMoney(totalOf(purchaseOrder), purchaseOrder.currency)}
          </div>
          <div className="mt-1.5 text-[12px] text-ink-muted">
            {items.length} line{items.length === 1 ? "" : "s"} · {EFFECTIVE_TONE[effectiveOf(purchaseOrder)].blurb}
          </div>
        </div>

        <DetailGrid>
          <DetailMain>
            {page && <ChangeNotice changes={page.changes} />}
            <section className={cn("rounded-lg border border-l-4 border-border bg-surface shadow-stone", press.tally.ready ? "border-l-synced" : "border-l-warning-text")}>
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border-subtle px-3.5 py-2.5">
                <div className="text-[15px] font-bold">{press.tally.ready ? "Ready" : "Not ready"}</div>
                <div className="text-[13px] text-ink-secondary">{press.tally.total === 0 ? "No raw materials on this order" : `Raw materials ${press.tally.tally}`}</div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 p-3.5 sm:grid-cols-5">
                <Field label="Unit number" value={page?.project?.unit_no || "—"} muted={!page?.project?.unit_no} />
                <Field label="Building" value={page?.project?.building || "—"} muted={!page?.project?.building} />
                <Field label="Project ID" muted={!page?.project} value={page?.project ? <Link className="text-primary hover:underline" to={`/projects/${page.project.id}`}>{page.project.code ?? page.project.id}</Link> : "—"} />
                <Field label="Sales order" muted={!linkedSo} value={linkedSo ? <Link className="text-primary hover:underline" to={`/scm/sales-orders/${encodeURIComponent(linkedSo.doc_no)}`}>{linkedSo.doc_no}</Link> : "—"} />
                <Field label="Purchase order" muted={!orderMeta.source_po} value={orderMeta.source_po ? <Link className="text-primary hover:underline" to={`/scm/purchase-orders/${orderMeta.source_po.id}`}>{orderMeta.source_po.po_number}</Link> : "—"} />
              </div>
              {(completionStopped || rawStatus === "RECEIVED" || purchaseOrder.notes) && (
                <div className="space-y-3 border-t border-border-subtle p-3.5">
                  {completionStopped && (
                    <div role="alert" className="rounded-lg border border-err/30 bg-surface px-4 py-3 text-[13px] text-ink">
                      <strong>Complete stopped partway.</strong> {orderMeta.completion_error ?? "Press Retry Complete to carry on."}
                    </div>
                  )}
                  {rawStatus === "RECEIVED" && (
                    <p className="text-[12.5px] text-ink-muted">To reopen this order, cancel its goods receipt and delivery order first.</p>
                  )}
                  {purchaseOrder.notes && (
                    <div className="rounded-lg border border-warning-text/25 bg-warning-bg px-4 py-3">
                      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-warning-text">Note</div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-warning-text">{purchaseOrder.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Line items */}
            <Section
              title={`Works · ${items.length}`}
              actions={orderMeta.source_po ? <span className="text-[12px] text-ink-muted">Follows <Link className="text-primary hover:underline" to={`/scm/purchase-orders/${orderMeta.source_po.id}`}>{orderMeta.source_po.po_number}</Link></span> : undefined}
            >
              {/* Revision-pending / SO-drift banner (owner 2026-07-27). A pending
                  SO amendment means this Production Order must be re-approved before the
                  new spec is built; surface it here (the editor
                  already did) with a jump to the amendment. Shows when the Production Order
                  carries a pending amendment OR any line has drifted from its SO. */}
              {(openAmendment || driftCount > 0) && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent-bright/40 bg-accent-bright/10 px-3.5 py-2.5 text-[12.5px] text-ink">
                  <span className="min-w-0">
                    ⚠{" "}
                    {driftCount > 0 ? (
                      <>
                        <strong>{driftCount}</strong> line{driftCount === 1 ? "'s" : "s"} source SO changed after this
                        Production Order was raised — check the red notes below, then <strong>update the works</strong>.
                      </>
                    ) : (
                      <>
                        The source Sales Order has a pending revision — <strong>approve this Production Order</strong> to apply the
                        changes before the work goes ahead.
                      </>
                    )}
                  </span>
                  {openAmendment && (
                    <button
                      type="button"
                      onClick={() => navigate(`/scm/amendments/${openAmendment.id}`)}
                      className="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-primary/50 hover:text-primary"
                    >
                      View amendment {openAmendment.amendment_no}
                    </button>
                  )}
                </div>
              )}
              <DataTable<PoItemRow>
                tableId={`po-lines-${id}`}
                layoutFamily={DATA_TABLE_LAYOUT_FAMILIES.purchaseOrderLines} persistSort={false} persistFilters={false}
                rows={items}
                loading={false}
                columns={reno ? [...renoLineColumns<PoItemRow>(reno, true), ...lineColumns] : lineColumns}
                getRowKey={(l) => l.id}
                emptyLabel="No line items"
              />
            </Section>
            <ProductionMaterialsSection orderId={purchaseOrder.id} canEdit={mayEditPoPhotos && !isCancelled && !started && rawStatus !== "RECEIVED"} started={started} canAct={canAct}
              works={items.map((l) => ({ qty: Number(l.qty), uom: l.uom }))} />
            {progress && (
              <Section
                dense
                title={`Progress${progress.label ? ` · ${progress.label}` : ""}`}
                actions={canAct ? (
                  <label className={cn("inline-flex min-h-[32px] cursor-pointer items-center rounded-md bg-sidebar px-3 text-[12px] font-semibold text-white", photos.busy && "opacity-50")}>
                    {photos.busy ? "Adding…" : "Add photos"}
                    <input type="file" accept={`image/*,${HEIC_ACCEPT}`} multiple className="sr-only" aria-label="Add photos" disabled={photos.busy} onChange={(e) => { void photos.add(e.target.files); e.target.value = ""; }} />
                  </label>
                ) : undefined}
              >
                <div>
                  {started && rawStatus === "SUBMITTED" && <ProgressSummary progress={progress} hours={productionHours} />}
                  <ProgressPhotos orderId={purchaseOrder.id} progress={progress} holidays={page?.holidays ?? []} canAdd={canAct} finishedOn={purchaseOrder.received_at?.slice(0, 10) ?? null} />
                </div>
              </Section>
            )}
            {linkedSo ? (
              <>
                {linkedSo.so_kind === "RENOVATION" ? (
                  <Section title="Order information">
                    <RenovationSoOrderInfo splitProject docNo={linkedSo.doc_no} payment={linkedSo.payment_methods_summary || linkedSo.payment_method || null} />
                  </Section>
                ) : (
                  <Section title="Order info"><SoOrderInfoFields header={linkedSo} /></Section>
                )}
                <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 [&>section]:h-full">
                  <Section title="Customer">
                    <SoCustomerFields
                      header={linkedSo}
                      renoMode={linkedSo.so_kind === "RENOVATION"}
                      salesperson={salespersonNameOf(linkedSo.agent ?? null, linkedSo.salesperson_id ?? null, "Unassigned")}
                      sharedWith={null}
                    />
                  </Section>
                  <Section title="Delivery address"><SoAddressFields header={{ ...linkedSo, sales_location: shipToName ?? linkedSo.sales_location }} /></Section>
                </div>
              </>
            ) : (
              <Section title="Customer">
                <p className="text-[13px] text-ink-muted">No sales order is linked to this production order.</p>
              </Section>
            )}

            <DocAttachments docType="production_order" docId={purchaseOrder.id} canEdit={!isCancelled} />
          </DetailMain>

          <DetailAside>
            <div className="hidden lg:sticky lg:top-[124px] space-y-3 md:block">
              <PoTotalHeroCard header={purchaseOrder} />

              <AsideCard title="Key dates" action={<button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setDialog("time")}>Set production time</button>}>
                <div className="grid grid-cols-2 gap-2.5 border-b border-border-subtle pb-2.5 text-[13px]">
                  <BigDate k="Plan start" v={orderExtra?.plan_start ? fmtDate(orderExtra.plan_start) : "Not set"} muted={!orderExtra?.plan_start} />
                  <BigDate k="Plan finish" v={purchaseOrder.expected_at ? fmtDate(purchaseOrder.expected_at) : "Not set"} muted={!purchaseOrder.expected_at} />
                  <BigDate k="Actual start" v={orderExtra?.actual_start_at ? fmtDate(orderExtra.actual_start_at) : "Not yet"} muted={!orderExtra?.actual_start_at} />
                  <BigDate k="Actual finish" v={purchaseOrder.received_at ? fmtDate(purchaseOrder.received_at) : "Not yet"} muted={!purchaseOrder.received_at} />
                </div>
                <div className="grid grid-cols-2 gap-2.5 border-b border-border-subtle py-2.5 text-[13px]">
                  <div>
                    <div className="text-ink-secondary">Schedule</div>
                    <div className="mt-0.5 text-[18px] font-bold">{progress?.planDays.length ? `${progress.planDays.length} day${progress.planDays.length === 1 ? "" : "s"}` : "Not set"}</div>
                    <div className="text-[12px] text-ink-muted">No Sundays, holidays</div>
                  </div>
                  <div>
                    <div className="text-ink-secondary">Production time</div>
                    <div className={cn("mt-0.5 text-[18px] font-bold", productionHours == null && "text-ink-muted")}>{productionHours == null ? "Not set" : `${fmtQty(productionHours)} hours`}</div>
                  </div>
                </div>
                <KeyDateRow k="Document date" v={fmtDate(purchaseOrder.po_date)} />
                {purchaseOrder.submitted_at && <KeyDateRow k="Issued" v={fmtDate(purchaseOrder.submitted_at)} />}
                {purchaseOrder.cancelled_at && <KeyDateRow k="Cancelled" v={fmtDate(purchaseOrder.cancelled_at)} />}
              </AsideCard>

              <AsideCard title="People" action={canAct && rawStatus === "SUBMITTED" ? <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setDialog("assign")}>Assign</button> : undefined}>
                {(page?.workers ?? []).map((w) => (
                  <PersonRow key={w.id} initials={initialsOf(w.name)} name={w.name} role={`Worker · ${w.how === "STARTED" ? "Pressed Start" : "Assigned"}`} tone="accent" />
                ))}
                <PersonRow
                  initials={initialsOf(supplierNameOf(purchaseOrder))}
                  name={supplierNameOf(purchaseOrder)}
                  role="Done by"
                  tone="accent"
                />
                {linkedSo && (
                  <PersonRow
                    initials={initialsOf(salespersonNameOf(linkedSo.agent ?? null, linkedSo.salesperson_id ?? null, "Unassigned"))}
                    name={salespersonNameOf(linkedSo.agent ?? null, linkedSo.salesperson_id ?? null, "Unassigned")}
                    role="Salesperson"
                    tone="neutral"
                  />
                )}
              </AsideCard>

              <AsideCard title="Recent activity">
                <ActivityRow
                  title={`Production Order ${EFFECTIVE_TONE[effectiveOf(purchaseOrder)].label.toLowerCase()}`}
                  meta={fmtDate(purchaseOrder.po_date)}
                  dot={EFFECTIVE_TONE[effectiveOf(purchaseOrder)].tone === "success" ? "success" : "primary"}
                />
                {orderExtra?.actual_start_at && (
                  <ActivityRow title="Started" meta={[fmtDate(orderExtra.actual_start_at), orderExtra.actual_start_by_name].filter(Boolean).join(" · ")} dot="primary" />
                )}
                {purchaseOrder.submitted_at && (
                  <ActivityRow
                    title="Issued"
                    meta={fmtDate(purchaseOrder.submitted_at)}
                    dot="primary"
                  />
                )}
                <ActivityRow
                  title="Created"
                  meta={fmtDate(purchaseOrder.created_at)}
                  dot="muted"
                  isLast
                />
              </AsideCard>
            </div>
          </DetailAside>
        </DetailGrid>
      </div>

      {/* Fixed bottom action bar (phone).

          ONE SLOT USED TO HOLD THREE DIFFERENT ACTIONS — Submit, then Transfer
          to GRN, then Edit — chosen by status, in the same green full-width
          button, same pixels. Whichever one a purchaser pressed yesterday, the
          same tap does something else today, and nothing on the bar says which.
          That is the owner's complaint in its phone-shaped form.

          Now: the commit slot and the transfer slot each keep one meaning and
          are disabled with their reason when the state forbids them, and Edit
          stops impersonating them. The reasons render as TEXT because a `title`
          tooltip cannot be summoned on a touch screen. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-3 pb-6 pt-2.5 shadow-slab backdrop-blur-sm md:hidden">
        {(canConfirm || canStart || canComplete || canReopen) && (
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={canConfirm ? doConfirm : canStart ? press.pressStart : canComplete ? doComplete : doReopen}
              disabled={completing !== null}
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-[13.5px] font-bold text-ink hover:bg-surface-dim disabled:opacity-40"
            >
              {canReopen ? <RotateCcw size={16} /> : <CheckCircle2 size={16} />}
              {canConfirm ? "Confirm Production Order" : canStart ? "Start" : canComplete ? (completing ?? (completionStopped ? "Retry Complete" : "Complete")) : "Reopen"}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goEdit}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-[13.5px] font-bold text-ink hover:bg-surface-dim"
          >
            <Edit3 size={16} /> Edit
          </button>
          <button
            type="button"
            onClick={print.openPreview}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2 text-primary-ink hover:bg-primary-soft"
            aria-label="Print PDF"
          >
            <Printer size={17} />
          </button>
        </div>
      </div>

      {press.dialog}
      <ProductionTimeDialog orderId={purchaseOrder.id} hours={productionHours} open={dialog === "time"} onClose={() => setDialog(null)} />
      <AssignDialog orderId={purchaseOrder.id} workers={page?.workers ?? []} open={dialog === "assign"} onClose={() => setDialog(null)} />
      {historyOpen && (
        <DocumentHistoryDrawer doc="PRODUCTION_ORDER" id={String(purchaseOrder.id)}
          label={purchaseOrder.po_number} onClose={() => setHistoryOpen(false)} />
      )}
      <PrintPreviewModal
        open={print.open}
        onClose={print.close}
        docTitle="Production Order"
        docNo={poDisplayNumber(
          purchaseOrder.po_number,
          (purchaseOrder as unknown as { revision?: number | null }).revision
        )}
        rows={[
          { label: "Done by", value: supplierNameOf(purchaseOrder) },
          { label: "Production Order date", value: fmtDate(purchaseOrder.po_date) },
          {
            label: "Completion date",
            value: purchaseOrder.expected_at ? fmtDate(purchaseOrder.expected_at) : "Not set",
          },
          { label: "Items", value: `${items.length} line${items.length === 1 ? "" : "s"}` },
          {
            label: "Order total",
            value: fmtMoney(totalOf(purchaseOrder), purchaseOrder.currency),
          },
        ]}
        {...print.handlers}
      />
    </div>
  );
}

export default ProductionOrderDetailV2;
