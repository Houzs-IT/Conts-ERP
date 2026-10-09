/* Payment schedule of a purchase order raised for renovation work (supplier or
   subcontractor). Default Mobilise 30 / Completion 65 / Retention 5.

   When an instalment is payable is decided at read time, never stored:
     ON_CONFIRM   the PO is confirmed (not DRAFT / CANCELLED)
     ON_RECEIPT   every PO line is fully received
     ON_HANDOVER  the project is handed over (projectHandoverState; 'unknown'
                  until phase 3 keeps it closed) or someone released it by hand
     MANUAL       someone released it
   A payment links the payment voucher that paid it; the voucher must exist, not
   be cancelled, and be for the PO's supplier. */

import { auditEntity, refuse, todayKl, type RenoDb } from './renovation-db';
import { projectHandoverState, type HandoverState } from './renovation-hooks';
import type { RenoActor } from './renovation-quotation';
import { poInstalmentAmounts } from '../shared/renovation-money';

export type PayableOn = 'ON_CONFIRM' | 'ON_RECEIPT' | 'ON_HANDOVER' | 'MANUAL';

export function isPayable(on: PayableOn, s: { poStatus: string; fullyReceived: boolean; handover: HandoverState; releasedAt: string | null }): boolean {
  if (s.poStatus === 'CANCELLED' || s.poStatus === 'DRAFT') return false;
  if (s.releasedAt) return true;
  if (on === 'ON_CONFIRM') return true;
  if (on === 'ON_RECEIPT') return s.fullyReceived;
  if (on === 'ON_HANDOVER') return s.handover === 'handed_over';
  return false;
}

async function poHead(db: RenoDb, poId: string, companyId: number, forUpdate = false) {
  const [po] = await db.q(
    `select po.id, po.po_number, po.status::text as status, po.total_sen, po.supplier_id, s.name as supplier_name,
            (select count(*) from scm.purchase_order_items pi where pi.purchase_order_id = po.id)::int as line_count,
            (select count(*) from scm.purchase_order_items pi where pi.purchase_order_id = po.id and pi.received_qty < pi.qty)::int as open_lines,
            (select so.project_id from scm.purchase_order_items pi join scm.mfg_sales_order_items si on si.id = pi.so_item_id
               join scm.mfg_sales_orders so on so.doc_no = si.doc_no where pi.purchase_order_id = po.id and so.project_id is not null limit 1) as project_id
       from scm.purchase_orders po left join scm.suppliers s on s.id = po.supplier_id
      where po.id = $1 and po.company_id = $2 ${forUpdate ? 'for update of po' : ''}`,
    [poId, companyId],
  );
  if (!po) throw refuse(404, 'po_not_found', 'That purchase order does not exist.');
  return {
    id: po.id as string, poNumber: po.po_number as string, status: po.status as string, totalSen: Number(po.total_sen),
    supplierId: po.supplier_id as string, supplierName: po.supplier_name as string | null,
    fullyReceived: Number(po.line_count) > 0 && Number(po.open_lines) === 0,
    projectId: po.project_id === null ? null : Number(po.project_id),
  };
}

export async function readPoSchedule(db: RenoDb, poId: string, companyId: number) {
  const po = await poHead(db, poId, companyId);
  const handover = await projectHandoverState(db, po.projectId);
  const rows = await db.q(
    `select i.id, i.seq, i.label, i.pct_bp, i.amount_sen, i.payable_on, i.released_at::text as released_at, i.released_by, i.release_note,
            coalesce((select sum(p.amount_sen) from scm.reno_po_instalment_payments p where p.po_instalment_id = i.id), 0)::int as paid_sen
       from scm.reno_po_instalments i where i.purchase_order_id = $1 order by i.seq`,
    [poId],
  );
  const payments = await db.q(
    `select p.id, p.po_instalment_id, p.amount_sen, p.paid_on::text as paid_on, p.note, p.payment_voucher_id, pv.pv_number
       from scm.reno_po_instalment_payments p join scm.reno_po_instalments i on i.id = p.po_instalment_id
       left join scm.payment_vouchers pv on pv.id = p.payment_voucher_id
      where i.purchase_order_id = $1 order by p.paid_on, p.created_at`,
    [poId],
  );
  const instalments = rows.map((r) => {
    const payable = isPayable(r.payable_on, { poStatus: po.status, fullyReceived: po.fullyReceived, handover, releasedAt: r.released_at });
    return {
      id: r.id as string, seq: Number(r.seq), label: r.label as string, pctBp: Number(r.pct_bp), amountSen: Number(r.amount_sen),
      payableOn: r.payable_on as PayableOn, releasedAt: r.released_at as string | null, releasedBy: r.released_by as string | null,
      releaseNote: r.release_note as string, paidSen: Number(r.paid_sen), outstandingSen: Number(r.amount_sen) - Number(r.paid_sen), payable,
      payments: payments.filter((p) => p.po_instalment_id === r.id).map((p) => ({
        id: p.id as string, amountSen: Number(p.amount_sen), paidOn: p.paid_on as string, note: p.note as string,
        paymentVoucherId: p.payment_voucher_id as string | null, pvNumber: p.pv_number as string | null,
      })),
    };
  });
  return {
    po, handover, instalments,
    totals: {
      scheduledSen: instalments.reduce((s, i) => s + i.amountSen, 0),
      paidSen: instalments.reduce((s, i) => s + i.paidSen, 0),
      payableNowSen: instalments.filter((i) => i.payable).reduce((s, i) => s + Math.max(i.outstandingSen, 0), 0),
    },
  };
}

export async function savePoSchedule(
  db: RenoDb,
  actor: RenoActor,
  poId: string,
  rows: Array<{ seq: number; label: string; pctBp: number; payableOn: PayableOn }>,
): Promise<void> {
  const po = await poHead(db, poId, actor.companyId, true);
  const [paid] = await db.q<{ n: number }>(
    `select count(*)::int as n from scm.reno_po_instalment_payments p join scm.reno_po_instalments i on i.id = p.po_instalment_id where i.purchase_order_id = $1`,
    [poId],
  );
  if (Number(paid.n) > 0) throw refuse(409, 'schedule_has_payments', 'Payments are already recorded against this schedule; it can no longer be re-split.');
  const amounts = poInstalmentAmounts(rows.map((r) => r.pctBp), po.totalSen);
  await db.q(`delete from scm.reno_po_instalments where purchase_order_id = $1`, [poId]);
  await db.q(
    `insert into scm.reno_po_instalments (company_id, purchase_order_id, seq, label, pct_bp, amount_sen, payable_on)
     select $2, $3, x.seq, x.label, x.pct_bp, x.amount_sen, x.payable_on
       from jsonb_to_recordset($1::text::jsonb) as x(seq int, label text, pct_bp int, amount_sen int, payable_on text)`,
    [JSON.stringify(rows.map((r, i) => ({ seq: r.seq, label: r.label, pct_bp: r.pctBp, amount_sen: amounts[i], payable_on: r.payableOn }))), actor.companyId, poId],
  );
  await auditEntity(db, { companyId: actor.companyId, entityType: 'purchase_order', entityId: poId, docNo: po.poNumber, action: 'PAYMENT_SCHEDULE', actorName: actor.name, changes: rows });
}

/** Create the default schedule on a PO that has none (a PO raised outside the renovation split). */
export async function applyDefaultPoSchedule(db: RenoDb, actor: RenoActor, poId: string): Promise<void> {
  const [has] = await db.q<{ n: number }>(`select count(*)::int as n from scm.reno_po_instalments where purchase_order_id = $1`, [poId]);
  if (Number(has.n) > 0) throw refuse(409, 'schedule_exists', 'This purchase order already has a payment schedule.');
  const lines = await db.q<{ seq: number; label: string; pct_bp: number; payable_on: PayableOn }>(
    `select l.seq, l.label, l.pct_bp, l.payable_on from scm.reno_term_template_lines l join scm.reno_term_templates t on t.id = l.template_id
      where t.kind = 'PO' and t.company_id = $1 and t.is_default and t.active order by l.seq`,
    [actor.companyId],
  );
  if (lines.length === 0) throw refuse(409, 'no_default_po_terms', 'There is no default PO payment-term template.');
  await savePoSchedule(db, actor, poId, lines.map((l) => ({ seq: Number(l.seq), label: l.label, pctBp: Number(l.pct_bp), payableOn: l.payable_on ?? 'MANUAL' })));
}

export async function releasePoInstalment(db: RenoDb, actor: RenoActor, instalmentId: string, note: string): Promise<void> {
  if (!note.trim()) throw refuse(400, 'note_required', 'Say why this instalment is released.');
  const [r] = await db.q<{ purchase_order_id: string; released_at: string | null; label: string }>(
    `select purchase_order_id, released_at::text as released_at, label from scm.reno_po_instalments where id = $1 and company_id = $2 for update`,
    [instalmentId, actor.companyId],
  );
  if (!r) throw refuse(404, 'instalment_not_found', 'That instalment does not exist.');
  if (r.released_at) throw refuse(409, 'already_released', 'This instalment is already released.');
  await db.q(`update scm.reno_po_instalments set released_at = now(), released_by = $2, release_note = $3, updated_at = now() where id = $1`, [instalmentId, actor.name, note.trim()]);
  await auditEntity(db, { companyId: actor.companyId, entityType: 'purchase_order', entityId: r.purchase_order_id, action: 'RELEASE_INSTALMENT', actorName: actor.name, note: `${r.label}: ${note.trim()}` });
}

export async function recordPoPayment(
  db: RenoDb,
  actor: RenoActor,
  instalmentId: string,
  body: { amountSen: number; paidOn?: string | null; paymentVoucherId?: string | null; note?: string },
): Promise<{ id: string }> {
  const [inst] = await db.q<{ purchase_order_id: string; label: string }>(
    `select purchase_order_id, label from scm.reno_po_instalments where id = $1 and company_id = $2 for update`,
    [instalmentId, actor.companyId],
  );
  if (!inst) throw refuse(404, 'instalment_not_found', 'That instalment does not exist.');
  const view = await readPoSchedule(db, inst.purchase_order_id, actor.companyId);
  const row = view.instalments.find((i) => i.id === instalmentId)!;
  if (!row.payable) throw refuse(409, 'not_payable', `${row.label} is not payable yet (${row.payableOn.replace('ON_', 'on ').toLowerCase().replace('_', ' ')}).`);
  if (!Number.isInteger(body.amountSen) || body.amountSen <= 0) throw refuse(400, 'bad_amount', 'Enter an amount above zero.');
  if (body.amountSen > row.outstandingSen) throw refuse(409, 'over_payment', `Only RM${(row.outstandingSen / 100).toFixed(2)} is outstanding on ${row.label}.`);
  if (body.paymentVoucherId) {
    const [pv] = await db.q<{ status: string; supplier_id: string | null; pv_number: string }>(
      `select status::text as status, supplier_id, pv_number from scm.payment_vouchers where id = $1 and company_id = $2`,
      [body.paymentVoucherId, actor.companyId],
    );
    if (!pv) throw refuse(404, 'pv_not_found', 'That payment voucher does not exist.');
    if (['CANCELLED', 'VOID', 'REJECTED'].includes(pv.status)) throw refuse(409, 'pv_cancelled', `${pv.pv_number} is ${pv.status.toLowerCase()}.`);
    if (pv.supplier_id && pv.supplier_id !== view.po.supplierId) throw refuse(409, 'pv_other_supplier', `${pv.pv_number} pays a different supplier.`);
  }
  const [p] = await db.q<{ id: string }>(
    `insert into scm.reno_po_instalment_payments (company_id, po_instalment_id, payment_voucher_id, amount_sen, paid_on, note, created_by)
     values ($1, $2, $3, $4, $5::date, $6, $7) returning id`,
    [actor.companyId, instalmentId, body.paymentVoucherId ?? null, body.amountSen, body.paidOn || todayKl(), body.note ?? '', actor.name],
  );
  await auditEntity(db, { companyId: actor.companyId, entityType: 'purchase_order', entityId: inst.purchase_order_id, docNo: view.po.poNumber, action: 'INSTALMENT_PAYMENT', actorName: actor.name, note: `${inst.label}: RM${(body.amountSen / 100).toFixed(2)}` });
  return { id: p.id };
}
