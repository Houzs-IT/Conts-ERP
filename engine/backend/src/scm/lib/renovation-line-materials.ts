/* Raw material quantities changed on the sales order line (owner, 7 Nov 2026) reach the line's open production orders in
   the same transaction, by the difference, so a figure typed by hand on the order stays. Stock that already left stays out:
   going below it is refused and Return stock does that job. */

import { refuse, type RenoDb } from './renovation-db';

export type LineOrder = { order_id: string; po_number: string; status: string; started: boolean };
export type Share = { order_id: string; material_code: string; qty: number | string };
export type MaterialDelta = { orderId: string; code: string; delta: number };

/** What each order gains or loses per material, nothing where it did not change. */
export function materialDeltas(before: readonly Share[], after: readonly Share[]): MaterialDelta[] {
  const sum = new Map<string, MaterialDelta>();
  const add = (s: Share, sign: 1 | -1): void => {
    const k = `${s.order_id}|${s.material_code}`;
    const cur = sum.get(k) ?? { orderId: s.order_id, code: s.material_code, delta: 0 };
    sum.set(k, { ...cur, delta: Math.round((cur.delta + sign * Number(s.qty)) * 1000) / 1000 });
  };
  for (const s of before) add(s, -1);
  for (const s of after) add(s, 1);
  return [...sum.values()].filter((d) => d.delta !== 0);
}

const OPEN = new Set(['DRAFT', 'SUBMITTED']);

async function lineOrders(tx: RenoDb, soItemId: string, companyId: number): Promise<LineOrder[]> {
  return tx.q<LineOrder>(
    `SELECT DISTINCT o.id::text AS order_id, o.po_number, o.status::text AS status, o.actual_start_at IS NOT NULL AS started
       FROM scm.production_order_items i JOIN scm.production_orders o ON o.id = i.production_order_id
      WHERE i.so_item_id = $1::uuid AND o.company_id = $2 AND o.status::text <> 'CANCELLED'`, [soItemId, companyId]);
}

const shares = (tx: RenoDb, soItemId: string, companyId: number): Promise<Share[]> => tx.q<Share>(
  `SELECT i.production_order_id::text AS order_id, s.material_code, s.qty
     FROM scm.production_order_items i
     JOIN scm.production_orders o ON o.id = i.production_order_id AND o.status::text IN ('DRAFT', 'SUBMITTED')
     CROSS JOIN LATERAL scm.production_line_shares(i.company_id, i.item_code, i.so_item_id, i.qty) s
    WHERE i.so_item_id = $1::uuid AND i.company_id = $2`, [soItemId, companyId]);

/** Saves the list and moves the open orders. Returns the started orders whose extra must now leave stock. */
export async function saveMaterialsAndFollow(
  tx: RenoDb,
  x: { soItemId: string; companyId: number; userId: number; materials: ReadonlyArray<{ code: string; qty: number }> },
): Promise<Array<{ orderId: string; poNumber: string; codes: string[] }>> {
  const orders = await lineOrders(tx, x.soItemId, x.companyId);
  if (orders.length > 0 && !orders.some((o) => OPEN.has(o.status))) {
    throw refuse(409, 'production_finished', `${orders[0].po_number} is already completed, so its raw materials can no longer change.`);
  }
  const before = await shares(tx, x.soItemId, x.companyId);
  await tx.q(
    `WITH picked AS (SELECT code, qty FROM jsonb_to_recordset($1::text::jsonb) AS t(code text, qty numeric)),
     gone AS (DELETE FROM scm.so_line_materials m WHERE m.so_item_id = $2::uuid AND m.material_code NOT IN (SELECT code FROM picked)),
     kept AS (INSERT INTO scm.so_line_materials (so_item_id, company_id, material_code, qty, updated_by)
              SELECT $2::uuid, $3, code, qty, $4 FROM picked
              ON CONFLICT (so_item_id, material_code) DO UPDATE SET qty = excluded.qty, updated_by = excluded.updated_by, updated_at = now())
     INSERT INTO scm.reno_beta_line_plans (so_item_id, company_id, materials_saved, updated_by, updated_at)
     VALUES ($2::uuid, $3, true, $4, now())
     ON CONFLICT (so_item_id) DO UPDATE SET materials_saved = true, updated_by = excluded.updated_by, updated_at = now()`,
    [JSON.stringify(x.materials), x.soItemId, x.companyId, x.userId],
  );
  const deltas = materialDeltas(before, await shares(tx, x.soItemId, x.companyId));
  const started = new Map<string, { orderId: string; poNumber: string; codes: string[] }>();
  for (const d of deltas) {
    const order = orders.find((o) => o.order_id === d.orderId);
    if (order?.started && d.delta < 0) {
      const [m] = await tx.q<{ needed: number | string; used: number | string }>(
        `SELECT qty_needed AS needed, qty_issued - qty_returned AS used FROM scm.production_order_materials
          WHERE production_order_id = $1::uuid AND item_code = $2 AND from_composition LIMIT 1`, [d.orderId, d.code]);
      if (m && Number(m.needed) + d.delta < Number(m.used)) {
        throw refuse(409, 'material_issued', `${m.used} of ${d.code} has left stock for ${order.po_number}. Send the extra back with Return stock on the production order first.`);
      }
    }
    await tx.q(`SELECT scm.production_bump_material($1::uuid, $2, $3, $4)`, [d.orderId, x.companyId, d.code, d.delta]);
    if (order?.started && d.delta > 0) {
      const s = started.get(d.orderId) ?? { orderId: d.orderId, poNumber: order.po_number, codes: [] };
      started.set(d.orderId, { ...s, codes: [...s.codes, d.code] });
    }
  }
  return [...started.values()];
}
