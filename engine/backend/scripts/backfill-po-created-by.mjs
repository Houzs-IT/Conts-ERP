#!/usr/bin/env node
// backfill-po-created-by.mjs: give old purchase orders their real creator.
//
// Every PO was saved with created_by = the SCM bridge's system staff uuid ("The Conts ERP").
// The person who created it is in the PO's CREATE row in scm.entity_audit_log (actor_id),
// so copy that across. POs with no CREATE row, or one with no actor, are left alone.
// Production orders have no CREATE audit row, so they are not touched.
//
// Dry run by default. --apply writes, and first saves an undo file (po id -> old created_by).
//   DATABASE_URL=<url> node scripts/backfill-po-created-by.mjs [--apply]
// Undo: DATABASE_URL=<url> node scripts/backfill-po-created-by.mjs --undo=<undo file>

import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'node:fs';

const SYSTEM_STAFF_ID = '00000000-0000-4000-8000-000000000001';
const DSN = process.env.DATABASE_URL;
if (!DSN) { console.error('need DATABASE_URL'); process.exit(2); }
const shouldApply = process.argv.includes('--apply');
const undoArg = process.argv.find((arg) => arg.startsWith('--undo='));

const sql = postgres(DSN, { ssl: 'require', prepare: false, max: 1 });

try {
  if (undoArg) {
    const undoRows = JSON.parse(readFileSync(undoArg.slice('--undo='.length), 'utf8'));
    await sql.begin(async (tx) => {
      for (const { id, created_by: oldCreatedBy } of undoRows) {
        await tx`update scm.purchase_orders set created_by = ${oldCreatedBy} where id = ${id}`;
      }
    });
    console.log(`undo: restored ${undoRows.length} purchase orders`);
  } else {
    const fixableOrders = await sql`
      select distinct on (po.id) po.id, po.po_number, po.created_by, audit.actor_id, audit.actor_name_snapshot
      from scm.purchase_orders po
      join scm.entity_audit_log audit
        on audit.entity_type = 'PURCHASE_ORDER' and audit.action = 'CREATE' and audit.entity_id = po.id::text
      join scm.staff staff on staff.id = audit.actor_id
      where po.created_by = ${SYSTEM_STAFF_ID} and audit.actor_id <> ${SYSTEM_STAFF_ID}
      order by po.id, audit.created_at`;
    const [{ total }] = await sql`select count(*)::int as total from scm.purchase_orders where created_by = ${SYSTEM_STAFF_ID}`;
    console.log(`system-stamped POs: ${total}; fixable from history: ${fixableOrders.length}`);
    for (const order of fixableOrders.slice(0, 10)) console.log(`  ${order.po_number} -> ${order.actor_name_snapshot}`);

    if (shouldApply && fixableOrders.length > 0) {
      const undoFile = `backfill-po-created-by.undo.${Date.now()}.json`;
      writeFileSync(undoFile, JSON.stringify(fixableOrders.map(({ id, created_by }) => ({ id, created_by }))));
      console.log(`undo file: ${undoFile}`);
      await sql.begin(async (tx) => {
        for (const { id, actor_id: actorId } of fixableOrders) {
          await tx`update scm.purchase_orders set created_by = ${actorId} where id = ${id} and created_by = ${SYSTEM_STAFF_ID}`;
        }
      });
      console.log(`applied: ${fixableOrders.length} purchase orders`);
    } else if (!shouldApply) {
      console.log('dry run: nothing written (pass --apply to write)');
    }
  }
} finally {
  await sql.end();
}
