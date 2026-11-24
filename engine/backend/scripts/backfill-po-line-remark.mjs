#!/usr/bin/env node
/* backfill-po-line-remark: copy the sales order line's remark onto the purchase
 * order lines raised from it that carry no remark of their own.
 *
 * WHY. The PO PDF prints a line's `notes` as "Remark:". Until PR 1216 (24 Nov
 * 2026) the SO to PO convert never copied the SO line's `remark`, and the New PO
 * form's pick-from-SO never did either, so a supplier PO printed without the
 * instructions written on the SO (TC-SO-2608-003, owner 24 Nov 2026).
 *
 * WHAT IT TOUCHES. Only lines linked to an SO line (so_item_id), whose own notes
 * are empty and whose SO line has a remark. A PO line someone already wrote a
 * remark on is never overwritten.
 *
 * DEFAULT IS PLAN. MODE=apply needs CONFIRM="COPY SO REMARKS". Apply prints
 * every changed line id first; to undo, set notes back to null for those ids.
 * RE-RUN: idempotent, a second run plans zero lines.
 *
 *   DATABASE_URL     required
 *   MODE             plan (default) | apply
 *   CONFIRM          required on apply
 */
import postgres from 'postgres';

const { DATABASE_URL, MODE = 'plan', CONFIRM } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (MODE !== 'plan' && MODE !== 'apply') throw new Error(`MODE must be plan or apply, got ${MODE}`);
if (MODE === 'apply' && CONFIRM !== 'COPY SO REMARKS') throw new Error('MODE=apply needs CONFIRM="COPY SO REMARKS"');

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

const candidates = (tx) => tx`
  select pi.id, p.po_number, pi.line_no, si.doc_no as so_doc_no, si.remark
  from scm.purchase_order_items pi
  join scm.purchase_orders p on p.id = pi.purchase_order_id
  join scm.mfg_sales_order_items si on si.id = pi.so_item_id
  where nullif(trim(si.remark), '') is not null
    and nullif(trim(pi.notes), '') is null
  order by p.po_number, pi.line_no`;

try {
  if (MODE === 'plan') {
    const rows = await sql.begin('read only', (tx) => candidates(tx));
    const poCount = new Set(rows.map((row) => row.po_number)).size;
    console.log(`plan: ${rows.length} PO lines on ${poCount} purchase orders would get the SO remark`);
    for (const row of rows.slice(0, 20)) console.log(`  ${row.po_number} L${row.line_no ?? '-'} <- ${row.so_doc_no}: ${row.remark.slice(0, 60)}`);
  } else {
    const changed = await sql.begin(async (tx) => {
      const rows = await candidates(tx);
      if (rows.length === 0) return [];
      return tx`
        update scm.purchase_order_items pi
        set notes = si.remark
        from scm.mfg_sales_order_items si
        where si.id = pi.so_item_id
          and pi.id in ${tx(rows.map((row) => row.id))}
          and nullif(trim(pi.notes), '') is null
        returning pi.id`;
    });
    console.log(`apply: ${changed.length} PO lines updated`);
    console.log(JSON.stringify(changed.map((row) => row.id)));
    const left = await sql.begin('read only', (tx) => candidates(tx));
    if (left.length !== 0) throw new Error(`verify: ${left.length} lines still missing the SO remark`);
    console.log('verify: 0 lines left');
  }
} finally {
  await sql.end();
}
