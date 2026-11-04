// The Purchase Order hooks of suppliers-queries.ts, cloned for /production-orders (owner, 4 Nov 2026). Own query keys,
// so nothing here refreshes or reads a real PO's cache.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';
import { poListParams, type PoListFilterParams } from './po-list-export';
import { writeFailed, writeFailedAs } from './mutation-error';
import { idempotentInit } from '../../../lib/idempotency';
import { retryUnlessClientError } from '../../../lib/retryPolicy';
import type { Currency, MaterialKind, PoHeaderRow, PoItemRow, PoStatus } from './suppliers-queries';
export type { PoHeaderRow, PoItemRow } from './suppliers-queries';

export function useProductionOrders(opts?: { status?: PoStatus; supplierId?: string }) {
  return useQuery({
    queryKey: ['production-orders', opts?.status ?? 'all', opts?.supplierId ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.status) params.set('status', opts.status);
      if (opts?.supplierId) params.set('supplierId', opts.supplierId);
      const res = await authedFetch<{ purchaseOrders: PoHeaderRow[] }>(
        `/production-orders${params.toString() ? `?${params.toString()}` : ''}`,
      );
      return res.purchaseOrders;
    },
    staleTime: 30_000,
    retry: retryUnlessClientError,
    retryDelay: 800,
  });
}

// Opt-in server-side pagination + search + sort + status-counts (mirrors
// useMfgSalesOrdersPaged). Sending `page` switches /production-orders into
// its paginated contract ({ purchaseOrders, total, page, pageSize,
// statusCounts }); the legacy useProductionOrders above (no page) still returns
// the historical unpaginated array. `status` is the filter-pill BUCKET NAME
// (draft/outstanding/open/partial/received/cancelled) — the backend resolves it
// to the raw purchase_orders.status values it covers, so `outstanding` spans
// SUBMITTED + PARTIALLY_RECEIVED. A raw DB status still works. Unlike the legacy hook this
// returns the FULL object so the page can read .purchaseOrders + .statusCounts.
//
// `outstanding` is OPTIONAL on the wire: a worker deployed before the roll-up
// bucket landed omits it, and Pages/Worker deploy independently. Callers derive
// open + partial when it's absent (exact, not a guess) — see ProductionOrdersListV2.
export type PoStatusCounts = {
  all: number;
  draft: number;
  outstanding?: number;
  open: number;
  partial: number;
  received: number;
  cancelled: number;
  /* ON_HOLD (mig 0318, owner 2026-08-21). Optional for the same reason
     `outstanding` is: an older deployment answers without it. */
  on_hold?: number;
};
export function useProductionOrdersPaged(params: { page: number; pageSize: number; status?: string; supplierId?: string; q?: string; sort?: string; creditorNames?: string[]; creditorCodes?: string[]; currencies?: string[]; docDates?: string[] }) {
  const { page, pageSize, status, supplierId, q, sort, creditorNames, creditorCodes, currencies, docDates } = params;
  // The filter half is shared with the two exports (po-list-export.ts), so an
  // export can never be sent a different filter than the list it was pressed on.
  const usp = poListParams({ status, supplierId, q, sort, creditorNames, creditorCodes, currencies, docDates });
  usp.set('page', String(page));
  usp.set('pageSize', String(pageSize));
  return useQuery({
    queryKey: ['production-orders-paged', page, pageSize, status ?? '', supplierId ?? '', q ?? '', sort ?? '', JSON.stringify(creditorNames ?? []), JSON.stringify(creditorCodes ?? []), JSON.stringify(currencies ?? []), JSON.stringify(docDates ?? [])],
    queryFn: ({ signal }) => authedFetch<{ purchaseOrders: PoHeaderRow[]; total: number; page: number; pageSize: number; statusCounts: PoStatusCounts }>(`/production-orders?${usp.toString()}`, { signal }),
    placeholderData: (prev: any) => prev,
    staleTime: 30_000,
    retry: retryUnlessClientError,
    retryDelay: 800,
  });
}

/* The Production Order list's funnel option counts over EVERY matching order, not just the
   loaded page (GET /production-orders/facets). Same filter params as the list. */
export type PoListFacets = Record<'supplier' | 'creditor_code' | 'currency' | 'po_date', Array<[string, number]>>;
export function usePoListFacets(f: PoListFilterParams) {
  const usp = poListParams({ ...f, sort: undefined });
  return useQuery({
    queryKey: ['production-orders-facets', usp.toString()],
    queryFn: ({ signal }) => authedFetch<{ facets: PoListFacets }>(`/production-orders/facets?${usp.toString()}`, { signal }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: retryUnlessClientError,
  });
}

/* Deferred Production Order-list enrichment — the MRP-derived columns (Assigned SO /
   Delivered) the list no longer computes on its critical path (see
   listMrpEnrichment.ts). Fired AFTER the list renders, for the Production Orders it just
   showed, merged in by applyListMrpEnrichment. The ids are chunked at 100 so the
   request stays bounded; each chunk is cached independently. The backend runs
   ONE company-wide computeMrp per request regardless of chunk size. */
const PO_ENRICH_CHUNK = 100;


/* The overlay the Production Order list applies: take the rows the list endpoint returned
   (without the MRP-derived columns), fetch the deferred enrichment for their
   ids, and return the healed rows. */
/* A production order has no MRP-derived columns to fill in. */
export function useEnrichedPoListRows<T>(rows: T[], _enabled: boolean): T[] {
  return rows;
}

export function useProductionOrderDetail(id: string | null) {
  return useQuery({
    queryKey: ['production-order-detail', id],
    queryFn: () => authedFetch<{ purchaseOrder: PoHeaderRow; items: PoItemRow[] }>(`/production-orders/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: retryUnlessClientError,
    retryDelay: 800,
  });
}

/* Plain (non-hook) fetch of a Production Order's full detail, for loops like batch print —
   same shape + cache key as useProductionOrderDetail. */
export const fetchProductionOrderDetail = (id: string) =>
  authedFetch<{ purchaseOrder: PoHeaderRow; items: PoItemRow[] }>(`/production-orders/${id}`);

export type NewPoItem = {
  materialKind: MaterialKind;
  itemCode: string;
  materialName: string;
  supplierSku?: string;
  qty: number;
  unitPriceSen: number;
  bindingId?: string;
  notes?: string;
  /* PR #41 — variant fields */
  itemGroup?: string;
  description?: string;
  description2?: string;
  uom?: string;
  discountSen?: number;
  unitCostSen?: number;
  gapInches?: number | null;
  divanHeightInches?: number | null;
  divanPriceSen?: number;
  legHeightInches?: number | null;
  legPriceSen?: number;
  customSpecials?: unknown;
  lineSuffix?: string;
  specialOrderPriceSen?: number;
  variants?: Record<string, unknown>;
  /* PR #77 — per-line ship-to overrides; both null = inherit from Production Order header */
  deliveryDate?: string | null;
  warehouseId?: string | null;
  /* Mig 0026 — supplier-revised per-line delivery dates (optional). */
  supplierDeliveryDate2?: string | null;
  supplierDeliveryDate3?: string | null;
  supplierDeliveryDate4?: string | null;
  /* Commander 2026-05-29 (BUG 1) — source SO line id for lines added via the
     "From SO" picker. The generic create handler increments this SO line's
     po_qty_picked so it drops from the picker. NULL for manual Production Order lines. */
  soItemId?: string | null;
};

/** PR — Phase 1: outstanding SO items for the "From SO" picker.
    Returns SO lines where qty - po_qty_picked > 0 (i.e. still convertible). */
export type OutstandingSoItem = {
  soItemId:       string;
  soDocNo:        string;
  debtorName:     string | null;
  branding:       string | null;
  soStatus:       string;
  soDate:         string;
  deliveryDate:   string | null;
  itemCode:       string;
  description:    string | null;
  itemGroup:      string;
  qty:            number;
  poQtyPicked:    number;
  remainingQty:   number;
  unitPriceSen: number;
  variants:       unknown;
  lineSuffix:     string | null;
  /* Commander 2026-05-28 — Production Order-from-SO redesign extras. processingDate +
     salesLocation come off the SO header; lineDeliveryDate is the SO LINE's
     own delivery date (used to derive the Production Order line's warehouse + date). */
  processingDate:   string | null;
  salesLocation:    string | null;
  lineDeliveryDate: string | null;
  /* Commander 2026-05-28 — the SKU's MAIN supplier (null when unbound, i.e.
     the line can't be converted to a Production Order until it's assigned a supplier). */
  mainSupplierCode: string | null;
  mainSupplierName: string | null;
  /** The order's raw reference pair (resolve with soRefOfCamelStamp). */
  soRef?: string | null;
  soCustomerSoNo?: string | null;
};

export function useOutstandingSoItems() {
  return useQuery({
    queryKey: ['production-orders', 'outstanding-so-items'],
    queryFn: () => authedFetch<{ items: OutstandingSoItem[] }>(
      `/mfg-purchase-orders/outstanding-so-items`,
    ).then((r) => r.items),
    staleTime: 30_000,
  });
}

/** PR — Multi-select GRN-from-Production Order picker (task #52, Commander 2026-05-27).
    Lists Production Order LINES with remaining qty (qty - received_qty > 0) on outstanding
    Production Orders (SUBMITTED ∪ PARTIALLY_RECEIVED). Used by /grns/from-po. */
export type OutstandingPoItem = {
  poItemId:       string;
  poId:           string;
  poDocNo:        string;
  itemCode:       string;
  /* Owner 2026-07-27 — the Production Order line's supplier-SKU snapshot (#1189), carried so
     the New-GRN line shows (and saves) the code the supplier's delivery note
     uses. Null on lines raised before the snapshot column existed. */
  supplierSku:    string | null;
  description:    string | null;
  itemGroup:      string;
  qty:            number;
  receivedQty:    number;
  remainingQty:   number;
  unitPriceSen: number;
  warehouseId:    string | null;
  variants:       unknown;
  /* Delivery-carry — the Production Order line's delivery date, carried into the GRN line. */
  deliveryDate:   string | null;
  supplierId:     string;
  supplierCode:   string;
  supplierName:   string;
  poDate:         string;
  expectedAt:     string | null;
  /* The Production Order's purchase_location (header warehouse) — the GRN's receive-into
     warehouse. One warehouse per GRN: the from-Production Order picker locks to it. */
  warehouseLocationId:   string | null;
  warehouseLocationCode: string | null;
  warehouseLocationName: string | null;
};

/**
 * `poIds` is REQUIRED, not optional, per CLAUDE.md's rule about a parameter that
 * decides something — it decides whether the server reads ONE Production Order or
 * every one in the company. An optional one defaults every forgetful caller to
 * the unscoped read, which is the LOOSER direction and is exactly the shape that
 * produced the owner's 2026-08-17 zero-row screen: the scope existed in the URL,
 * was never sent to the server, and was applied in the browser to an
 * already-truncated list. Pass `[]` for the open "From Production Order" picker.
 *
 * Returns the whole payload, `scope` included. That block is the WHY behind an
 * empty `items` and dropping it is how "your Production Order is a draft" became "every line
 * has been received" — see `lib/outstandingEmptyReason.ts`.
 */

/** PR — Multi-select GRN-from-Production Order creator (task #52). One GRN per Production Order
    (grns.purchase_order_id is a single FK), auto-posted (writes inventory
    IN + rolls received_qty onto Production Order items + flips Production Order status). */

/** PR — Multi-select PI-from-GRN picker (task #52). Lists the GRN LINES still to
    bill (accepted - invoiced - returned > 0) on POSTED, not-held notes. The
    server reads the notes that still have something to bill, not a window of
    the newest posted notes (backend/src/scm/lib/outstanding-grn-lines.ts). */
export type OutstandingGrnItem = {
  grnItemId:       string;
  grnId:           string;
  grnDocNo:        string;
  receivedAt:      string;
  supplierId:      string;
  supplierCode:    string;
  supplierName:    string;
  purchaseOrderId: string | null;
  poDocNo:         string | null;
  itemCode:        string;
  description:     string | null;
  itemGroup:       string;
  qtyAccepted:     number;
  remaining:       number;
  unitPriceSen:  number;
  variants:        unknown;
  /* Source note's currency + FX rate (owner 2026-08-06) — one invoice may bill
     several of a supplier's notes, but a PI header carries ONE currency + rate,
     so the picker locks the selection on these as well as the supplier. */
  currency?:       string | null;
  exchangeRate?:   number | null;
};

/** `truncated` is the server saying its note read stopped at its ceiling, so
    `items` is NOT every line still to bill and the screen must say so. A
    response without the field (a Worker older than the field) reads as false. */
export type OutstandingGrnItems = { items: OutstandingGrnItem[]; truncated: boolean };


/** PR — Multi-select PI-from-GRN creator (task #52). One PI per GRN (since
    purchase_invoices.grn_id is a single FK). Auto-posted (matches Commander
    preference: documents land in POSTED, not DRAFT). PI does NOT touch
    inventory (PI is AP-only — inventory landed at GRN time). */

/** PR — Phase 1: create Production Orders (one per supplier) from multi-selected SO
    items with partial qty. Increments po_qty_picked on success.
    PR #157 — expectedAt + purchaseLocationId now required (applied to every
    Production Order created from the batch).

    `idempotencyKey` is OPTIONAL and destructured OUT of the body — the
    rest-spread would otherwise post it as a Production Order field. fix/doc-idempotency
    (2026-07-17) left this hook bare on the reasoning that its only live caller
    was Mrp.tsx, a long-lived page with no bindable intent. That reasoning had a
    factual error under it and one real half:

    THE ERROR — this hook has TWO live callers, not one. ProductionOrderFromSo.tsx
    (routed at /scm/production-orders/from-so) is the "Transfer from Sales Order" / "Add Line
    Item" picker, and it is an ordinary route-level form: ONE post per mount, and
    it navigates to the Production Order on success. Its mount IS one intent, so a per-mount
    useIdempotencyKey() is correct there — the same shape as the other 17. That
    caller is the one that most needs a key: it does NOT send fromMrp, so its
    lines are capped by remaining, and a double-fire appends the SAME picked
    lines to the SAME Production Order twice whenever remaining >= 2x the pick. Missing it is
    the "a hook is not a call site" lesson repeating in the very PR that wrote it
    down.

    THE REAL HALF — Mrp.tsx genuinely has no per-MOUNT intent, and a per-mount
    key there really would make runs 2..N replay run 1 and silently raise NOTHING
    while reporting Production Orders created. But "no per-mount intent" is not "no intent":
    the MRP run (the committed pick selection, from first submit until the run
    LANDS) is a real, bindable object, and Mrp.tsx now binds to it. The key is
    minted per run and retired the moment ANY 2xx arrives — see the ref there for
    why retiring on landing is mandatory rather than the module's usual sin.

    fromMrp does NOT make a key unsafe, and it is why the MRP caller is the more
    dangerous of the two: reference-only converts bypass qty_exceeds_remaining,
    so a double-fire has NO server-side backstop and duplicate-orders the whole
    shortage from the supplier. `fromMrp` makes a PAYLOAD-derived key unsafe
    (identical picks twice are two legitimate Production Orders) — which is an argument against
    hashing the body, not against binding to the run. */
export function useCreatePosFromSoItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...body }: {
      idempotencyKey?: string;
      /* Commander 2026-05-31 — each pick now carries its own chosen supplier
         (MRP picks supplier per shortage SO line). NULL = let the server fall
         back to the SKU's main supplier. The backend groups by
         (warehouse, supplier). */
      picks: Array<{ soItemId: string; qty: number; supplierId?: string | null }>;
      /* Commander 2026-05-28 — Expected Delivery + Purchase Location are no
         longer asked: the server derives them per-line from the source SO.
         Kept optional for any legacy caller that still wants to force them. */
      expectedAt?: string;
      purchaseLocationId?: string;
      /* Commander 2026-05-28 — Production Order generation mode:
         'combined' = one Production Order per supplier (mattresses: many SOs → 1 Production Order);
         'per-so'   = one Production Order per (supplier × SO) (sofa/bedframe: 1 SO → 1 Production Order). */
      mode?: 'combined' | 'per-so';
      /* Commander 2026-05-29 — per-SKU supplier override picked in the MRP
         ({ itemCode: supplierId }); wins over the main-supplier binding. */
      supplierByCode?: Record<string, string>;
      /* Commander 2026-05-29 — when set, APPEND the picked lines to this existing
         Production Order (the "Transfer from Sales Order" / "Add Line Item" picker scoped to a Production Order)
         instead of creating new Production Orders. */
      targetPoId?: string;
      /* Commander 2026-05-31 — converts raised from the MRP page are
         reference-only: bypass the qty_exceeds_remaining cap + tag Production Order lines
         from_mrp so they don't lock the source SO line (infinite-convert). */
      fromMrp?: boolean;
    }) =>
      authedFetch<{
        // Create-new-Production Orders shape:
        created?: Array<{ id: string; poNumber: string; supplierId: string; lineCount: number }>;
        total?: number;
        // Append-to-existing-Production Order shape (targetPoId):
        targetPoId?: string;
        poNumber?: string;
        added?: number;
      }>(
        `/production-orders/from-sos`,
        idempotentInit(idempotencyKey, { method: 'POST', body: JSON.stringify(body) }),
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      /* Force picker refetch — refetchType:'all' kicks the query even when
         not currently mounted, so the next view sees only outstanding lines. */
      qc.invalidateQueries({ queryKey: ['production-orders', 'outstanding-so-items'], refetchType: 'all' });
      if (vars.targetPoId) qc.invalidateQueries({ queryKey: ['production-order-detail', vars.targetPoId] });
    },
  });
}

/** PR #78 — Convert a Sales Order's items into the current Production Order. Returns the
    server's { copied, skipped } counts so the UI can toast. */
export function useConvertPoFromSo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, soDocNo, itemIds }: { poId: string; soDocNo: string; itemIds?: string[] }) =>
      authedFetch<{ copied: number; skipped: number; sourceDocNo: string }>(
        `/production-orders/${poId}/convert-from-so`,
        { method: 'POST', body: JSON.stringify({ soDocNo, itemIds }) },
      ),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['production-order-detail', vars.poId] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
    },
    onError: writeFailedAs('Sales order lines not copied into this Production Order'),
  });
}

/* `idempotencyKey` is OPTIONAL and is destructured OUT of the body — the
   rest-spread would otherwise post it as a Production Order field. Pass one per Production Order intent (see
   lib/idempotency.ts): the middleware replays the first response — the SAME
   poNumber — instead of committing the company to buy the goods twice. Omitting
   it is exactly today's behaviour (the middleware no-ops).

   This file had NO idempotency at all before 2026-07-17 (fix/doc-idempotency):
   unlike the DO/SI files there was not even a payment call site here to make the
   omission visible. A duplicate Production Order is an order placed with a real supplier. */
export function useCreateProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...body }: {
      idempotencyKey?: string;
      supplierId: string;
      currency?: Currency;
      poDate?: string;
      expectedAt?: string;
      /** Mig 0026 — supplier-revised header delivery dates; fan down to lines
          that don't carry their own revised date. */
      supplierDeliveryDate2?: string;
      supplierDeliveryDate3?: string;
      supplierDeliveryDate4?: string;
      notes?: string;
      items?: NewPoItem[];                     // PR #41 — optional, allow blank-draft
      /** PR #97 — AutoCount Purchase Location at create time. NULL → can be
          set on the detail page after creation. */
      purchaseLocationId?: string | null;
      /** Draft/Confirmed — opt-in DRAFT save (status DRAFT, no SO-quota advance,
          invisible to MRP supply). Omitted/false → SUBMITTED, as before. */
      asDraft?: boolean;
      productionTimeDays?: string;
      /** Over-convert override (owner 2026-07-24). SO-sourced lines are capped at
          the source SO line's remaining qty (409 qty_exceeds_remaining); set this
          after the operator confirms to raise a Production Order beyond what the SO still needs.
          Mirrors confirmShortStock. Only the New-Production Order-from-SO flow sends it. */
      confirmOverConvert?: boolean;
    }) =>
      authedFetch<{ id: string; poNumber: string }>(`/production-orders`,
        idempotentInit(idempotencyKey, {
          method: 'POST',
          body: JSON.stringify(body),
        })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-orders'] }),
  });
}

/* PR #41 — header PATCH + item CRUD endpoints for the new Production Order detail page */
export function useUpdateProductionOrderHeader() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; poDate?: string; expectedAt?: string;
      currency?: Currency; notes?: string; supplierId?: string;
      /** Mig 0026 — supplier-revised header delivery dates. */
      supplierDeliveryDate2?: string | null;
      supplierDeliveryDate3?: string | null;
      supplierDeliveryDate4?: string | null;
      /** PR #77 — default ship-to warehouse for every line on this Production Order. */
      purchaseLocationId?: string | null;
      productionTimeDays?: string | number | null;
    }) => authedFetch<{ purchaseOrder: PoHeaderRow }>(`/production-orders/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['production-order-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['production-orders'] });
    },
  });
}

export function useAddProductionOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, ...body }: NewPoItem & { poId: string }) =>
      authedFetch<{ item: PoItemRow }>(`/production-orders/${poId}/items`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['production-order-detail', vars.poId] });
      /* #2/#3 — adding a line can change the header expected_at; refresh list. */
      qc.invalidateQueries({ queryKey: ['production-orders'] });
    },
  });
}

export function useUpdateProductionOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, itemId, ...body }: Partial<NewPoItem> & { poId: string; itemId: string }) =>
      authedFetch<{ ok: true }>(`/production-orders/${poId}/items/${itemId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['production-order-detail', vars.poId] });
      /* #2/#3 — a per-line delivery-date edit now recomputes the header
         expected_at server-side, so refresh the list (it reads expected_at). */
      qc.invalidateQueries({ queryKey: ['production-orders'] });
    },
  });
}

export function useDeleteProductionOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, itemId }: { poId: string; itemId: string }) =>
      authedFetch<void>(`/production-orders/${poId}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['production-order-detail', vars.poId] });
      /* Commander 2026-05-29 (BUG 1) — deleting a Production Order line releases the source
         SO line's po_qty_picked back. Refresh the Production Order list (new total) AND the
         From-SO picker (the released line should reappear). The prefix key
         ['production-orders'] also matches ['production-orders',
         'outstanding-so-items']. */
      qc.invalidateQueries({ queryKey: ['production-orders'] });
    },
    onError: writeFailed,
  });
}

/* ── Per-line SO allocations (mig 0235) — the consolidated-Production Order split ─────────
   One Production Order line serving several customers plus stock, as sub-numbered slices.
   All three writes invalidate the detail (chips), the coverage read (the
   Assigned SO cell now lists each allocated SO) and the Production Order list (its collapsed
   Assigned SO column reads the same coverage rollup). Deliberately NOT
   invalidating the From-SO picker: allocations never move po_qty_picked. */

/** SO-line candidates for the allocation editor: every company SO line carrying
    this item code — including picked/delivered ones (historical consolidated
    Production Orders are the point). Excludes cancelled lines + cancelled/draft SOs. */
export type SoLineCandidate = {
  soItemId: string;
  soDocNo: string;
  debtorName: string | null;
  soStatus: string | null;
  qty: number;
  deliveryDate: string | null;
};
// poId+itemId narrow the candidates to the Production Order line's SPEC (fabric + SEAT/LEG/
// SPECIAL), not just its item code (owner 2026-08-08). Omitting them falls back
// to code-only. Keyed on all three so switching lines refetches.
export function useSoLineCandidates(
  code: string | null,
  poId?: string | null,
  itemId?: string | null,
) {
  return useQuery({
    queryKey: ['po-so-line-candidates', code ?? '', poId ?? '', itemId ?? ''],
    queryFn: () => {
      const qs = new URLSearchParams({ code: code ?? '' });
      if (poId) qs.set('poId', poId);
      if (itemId) qs.set('itemId', itemId);
      return authedFetch<{ items: SoLineCandidate[] }>(
        `/mfg-purchase-orders/so-line-candidates?${qs.toString()}`,
      ).then((r) => r.items);
    },
    enabled: Boolean(code),
    staleTime: 30_000,
    retry: retryUnlessClientError,
  });
}

const invalidateAllocationReads = (qc: ReturnType<typeof useQueryClient>, poId: string) => {
  qc.invalidateQueries({ queryKey: ['production-order-detail', poId] });
  qc.invalidateQueries({ queryKey: ['po-so-coverage'] });
  qc.invalidateQueries({ queryKey: ['production-orders'] });
};




/* useSubmitProductionOrder (PATCH /production-orders/:id/submit) was REMOVED
   2026-08-18. Its endpoint had no write path — it read the row, echoed an
   already-SUBMITTED Production Order and then returned 409 cannot_submit unconditionally — so
   the only caller left, the read-only Production Order detail page, failed on every DRAFT it
   was offered on. /confirm is the one verb that commits a draft; see
   vendor/scm/lib/po-next-step.ts for the full account. */

/** Confirm a DRAFT Production Order → SUBMITTED (Draft/Confirmed two-state). This is where a
    draft commits: it stamps submitted_at server-side and advances the source
    SO lines' po_qty_picked (they leave the From-SO picker) + the Production Order becomes
    live MRP supply / GRN-receivable. Invalidates the Production Order list (incl. the
    outstanding-so-items picker via the shared prefix) + this Production Order's detail. */
export function useConfirmProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ purchaseOrder: { id: string; status: PoStatus; submitted_at: string } }>(
        `/production-orders/${id}/confirm`,
        { method: 'PATCH' },
      ),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['production-order-detail', id] });
    },
    /* Added 2026-08-18 with the retirement of useSubmitProductionOrder. This is
       now the ONLY way to commit a draft Production Order, and /confirm has a refusal an
       operator can act on: PO_WAREHOUSE_REQUIRED 409s a Production Order with no ship-to
       warehouse and names the offending lines. Without an onError that refusal
       reached nobody — the button would simply appear to do nothing, which is
       the failure mode the retired endpoint already had. */
    onError: writeFailed,
  });
}

/** Cancel a Production Order. The REASON is mandatory (owner 2026-09-09: 「Production Order cancelled 不需要
 *  审批，只需要 remark 原因取消」) — the server's cancel guard refuses a body
 *  without one (400 reason_required) and records it in the cancellation ledger,
 *  so every surface has to ask for it. Use usePoCancelAction (pages/scm-v2/
 *  use-po-cancel-action.ts) rather than calling this with words of your own. */
export function useCancelProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      authedFetch<{ purchaseOrder: { id: string; status: PoStatus; cancelled_at: string } }>(
        `/production-orders/${id}/cancel`,
        { method: 'PATCH', body: JSON.stringify({ reason }) },
      ),
    onSuccess: (_, { id }) => {
      // Prefix key also matches ['production-orders','outstanding-so-items'],
      // so the released SO lines reappear in the From-SO picker.
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['production-order-detail', id] });
    },
  });
}

/** Reopen a cancelled Production Order → SUBMITTED (inverse of cancel; re-claims SO quota). */
export function useReopenProductionOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ purchaseOrder: { id: string; status: PoStatus; cancelled_at: string | null } }>(
        `/production-orders/${id}/reopen`,
        { method: 'PATCH' },
      ),
    onSuccess: (_, id) => {
      // Re-claims SO quota, so the From-SO picker (prefix
      // ['production-orders','outstanding-so-items']) must refetch — those
      // lines leave the picker again — plus this Production Order's detail.
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['production-order-detail', id] });
    },
  });
}

/* useDeleteProductionOrder was REMOVED with its endpoint (owner rule 2026-08-11:
   不可以删只可以 cancel). A Production Order is cancelled, never purged — see the note where
   DELETE /:id used to live in backend/src/scm/routes/production-orders.ts. */

/* A production order has no amendment workflow, so its Revisions tab reads an empty list. */
export function useProductionRevisions(id: string) {
  return useQuery({
    queryKey: ['production-order-revisions', id],
    queryFn: () => authedFetch<{ revisions: never[] }>(`/production-orders/${id}/revisions`),
  });
}

/** Every production order the list's filters match, each with its lines: the list's export. */
export async function fetchProductionExportRows<T extends { id: string }>(
  f: PoListFilterParams,
  _need: { exportKeys: string[]; filterKeys: string[] },
): Promise<T[]> {
  const body = await authedFetch<{ purchaseOrders?: T[]; truncated: boolean }>(`/production-orders/export/rows?${poListParams(f).toString()}`);
  if (body.truncated) throw new Error('Too many production orders to export at once. Narrow the list first.');
  return body.purchaseOrders ?? [];
}

/* Raw materials (owner, 4 Nov 2026). */
export type MaterialRow = {
  id: string; item_code: string; description: string | null; uom: string | null; qty_needed: number | string;
  processing_date: string | null; delivery_date: string | null; notes: string | null;
};
export type MaterialStatus = {
  state: 'received' | 'stock' | 'po' | 'short'; received: number; onOrder: number; shortQty: number | null;
  poNumber: string | null; poId: string | null; eta: string | null;
};
const materialKeys = (id: string) => [['production-order-materials', id], ['production-order-material-status', id]];
export function useProductionMaterials(id: string) {
  return useQuery({
    queryKey: ['production-order-materials', id],
    queryFn: () => authedFetch<{ materials: MaterialRow[] }>(`/production-orders/${id}/materials`).then((r) => r.materials),
    retry: retryUnlessClientError,
  });
}
export function useMaterialStatus(id: string) {
  return useQuery({
    queryKey: ['production-order-material-status', id],
    queryFn: () => authedFetch<{ statuses: Record<string, MaterialStatus> }>(`/production-orders/${id}/material-status`).then((r) => r.statuses),
    retry: retryUnlessClientError,
  });
}
export function useRawSkus(enabled: boolean) {
  return useQuery({
    queryKey: ['production-raw-skus'],
    enabled,
    queryFn: () => authedFetch<{ skus: Array<{ code: string; name: string | null; uom: string | null }> }>(`/production-orders/raw-skus`).then((r) => r.skus),
    staleTime: 60_000,
    retry: retryUnlessClientError,
  });
}
export function useAddProductionMaterial(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { itemCode: string; qtyNeeded: number; processingDate: string | null; deliveryDate: string | null }) =>
      authedFetch<{ id: string }>(`/production-orders/${id}/materials`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { for (const k of materialKeys(id)) void qc.invalidateQueries({ queryKey: k }); },
  });
}
export function useUpdateProductionMaterial(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id: materialId, ...body }: { id: string; qtyNeeded?: number; processingDate?: string | null; deliveryDate?: string | null }) =>
      authedFetch(`/production-orders/${id}/materials/${materialId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { for (const k of materialKeys(id)) void qc.invalidateQueries({ queryKey: k }); },
  });
}
export function useDeleteProductionMaterial(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (materialId: string) => authedFetch(`/production-orders/${id}/materials/${materialId}`, { method: 'DELETE' }),
    onSuccess: () => { for (const k of materialKeys(id)) void qc.invalidateQueries({ queryKey: k }); },
  });
}
/** MRP's Proceed PO for raw materials. A repeat press finds nothing left to order and answers total 0. */
export const createMaterialPos = ({ idempotencyKey, ...body }: {
  idempotencyKey?: string; picks: Array<{ materialId: string; qty: number; supplierId: string | null }>; mode: 'combined' | 'per-so'; expectedAt?: string;
}) => authedFetch<{ total: number; created: Array<{ id: string; poNumber: string }>; alreadyOrdered?: boolean }>(
  `/production-orders/material-pos`, idempotentInit(idempotencyKey, { method: 'POST', body: JSON.stringify(body) }));
