/* Set ONE supplier-revised delivery date slot on a purchase order and cascade it
 * down to every line — the write behind the bulk supplier-date action
 * (POST /mfg-purchase-orders/bulk-supplier-date, owner 2026-08-03) and behind the
 * PO line import's Estimate Delivery Date 1/2/3 (owner 2026-09-15). One writer,
 * so the two doors cannot disagree about what "move the estimate date" does.
 *
 * The line write is UNCONDITIONAL (no `.is(col, null)`), because the point is the
 * SECOND revision, when every line already carries the first one.
 *
 * NOT here, on purpose: the downstream-lock check and the AutoCount enqueue. The
 * caller checks the lock before it calls, and enqueues once per purchase order
 * after ALL of that order's writes — an import that moves a date and edits three
 * lines of the same PO must queue one edit, not two. */
import { diffFields, recordEntityAudit, type AuditActor } from './entity-audit';
import { scopeToCompanyId } from './companyScope';

export const SUPPLIER_DATE_SLOT_COL = {
  2: 'supplier_delivery_date_2',
  3: 'supplier_delivery_date_3',
  4: 'supplier_delivery_date_4',
} as const;
export type SupplierDateSlot = keyof typeof SUPPLIER_DATE_SLOT_COL;

/* A postgres.js transaction hands a date column back as a JS Date; the audit's
   from-value must still read as the day, not "Tue Sep 15 2026 ...". */
const dayOrRaw = (v: unknown): unknown => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
const dayOf = (v: unknown): string => (v == null || v === '' ? '' : String(dayOrRaw(v)).slice(0, 10));

/* A recorded supplier date is history (Houzs 2e66d226b, #5035): the bulk action
   asks this before it writes and never overwrites a filled slot. The line import
   and the delivery-sheet sync are not gated (they pass requireEmpty: false). */
export function recordedSupplierDate(header: Record<string, unknown>, slot: SupplierDateSlot): string | null {
  return dayOf(header[SUPPLIER_DATE_SLOT_COL[slot]]) || null;
}

/* The header PATCH may fill an empty Date 2/3/4 but not change or clear a filled
   one (the same value sent again is not a change). `fill` = the slots this PATCH
   newly fills; the write is made conditional on them still being NULL, so two
   people filling the same slot cannot overwrite each other. */
export function supplierDatePatchGate(before: Record<string, unknown>, updates: Record<string, unknown>) {
  const slots = ([2, 3, 4] as const).filter((s) => SUPPLIER_DATE_SLOT_COL[s] in updates);
  const was = (s: SupplierDateSlot) => dayOf(before[SUPPLIER_DATE_SLOT_COL[s]]);
  const now = (s: SupplierDateSlot) => dayOf(updates[SUPPLIER_DATE_SLOT_COL[s]]);
  const changed = slots.filter((s) => was(s) !== '' && now(s) !== was(s));
  const fill = slots.filter((s) => was(s) === '' && now(s) !== '').map((s) => SUPPLIER_DATE_SLOT_COL[s]);
  return {
    refusal: changed.length === 0 ? null : {
      error: 'supplier_date_recorded', slots: changed,
      reason: `Supplier Date ${changed.join(', ')} already recorded; it cannot be changed. Record the next empty date instead.`,
    },
    fill,
    raced: { error: 'supplier_date_recorded', slots: fill, reason: 'Someone else recorded that Supplier Date just now. Reload and try again.' },
    onlyIfEmpty: <T extends { is: (c: string, v: null) => T }>(q: T): T => fill.reduce((acc, col) => acc.is(col, null), q),
  };
}

export async function cascadePoSupplierDate(
  sb: any,
  args: {
    companyId: number;
    poId: string;
    /** The header row read BEFORE the write: po_number, status, company_id and the slot column. */
    before: Record<string, unknown>;
    slot: SupplierDateSlot;
    /** null clears the slot, as the PO editor's own blank does. */
    date: string | null;
    applyToLines: boolean;
    actor: AuditActor | null;
    note: string | null;
    /** true = write only while the slot is still empty (bulk action: a double
     *  click or a second person must not overwrite a just-recorded date). */
    requireEmpty: boolean;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { companyId, poId, before, slot, date, applyToLines, actor, note, requireEmpty } = args;
  const col = SUPPLIER_DATE_SLOT_COL[slot];

  let q = sb.from('purchase_orders').update({ [col]: date, updated_at: new Date().toISOString() }).eq('id', poId);
  if (requireEmpty) q = q.is(col, null);
  const { data: hit, error } = await scopeToCompanyId(q, companyId).select('id').maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (requireEmpty && !hit) return { ok: false, reason: `Supplier Date ${slot} was recorded by someone else just now.` };

  if (applyToLines) {
    const { error: lineErr } = await scopeToCompanyId(
      sb.from('purchase_order_items').update({ [col]: date }).eq('purchase_order_id', poId),
      companyId,
    );
    /* The header already moved, so a line failure is reported rather than
       swallowed: the operator has to know this PO is half-applied. */
    if (lineErr) return { ok: false, reason: `Header updated but lines failed: ${lineErr.message}` };
  }

  const camel = `supplierDeliveryDate${slot}`;
  await recordEntityAudit(sb, {
    entityType: 'PURCHASE_ORDER',
    entityId: poId,
    entityDocNo: (before.po_number as string | null) ?? null,
    action: 'UPDATE',
    actor,
    companyId: (before.company_id as number | null) ?? companyId,
    statusSnapshot: (before.status as string | null) ?? null,
    ...(note ? { note } : {}),
    fieldChanges: diffFields({ [col]: dayOrRaw(before[col]) }, { [camel]: date }, [[camel, col]]),
  });
  return { ok: true };
}
