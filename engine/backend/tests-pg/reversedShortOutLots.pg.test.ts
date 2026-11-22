import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

/* D15 (save-integrity, 22 Nov 2026; migration 0361): reversing a short stock-out that is not a DO puts back only
   what it took, so the lots and the movement balance agree again. On the real schema (every file in migrations-pg,
   a throwaway database on a local cluster), never staging or production. SKIPPED without TEST_DATABASE_URL. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
let sql: Sql;
let staffId = '';
const run = Math.random().toString(36).slice(2, 8);

/* Fill every NOT NULL column that has no default, so the fixture survives columns added later. */
async function insertRow(table: string, values: Record<string, unknown>): Promise<string> {
  const cols = await sql<{ column_name: string; data_type: string; udt_name: string }[]>`
    select column_name, data_type, udt_name from information_schema.columns
     where table_schema = 'scm' and table_name = ${table} and is_nullable = 'NO' and column_default is null`;
  const row: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.column_name in row) continue;
    if (c.data_type === 'USER-DEFINED') {
      const [e] = await sql<{ v: string }[]>`select enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = ${c.udt_name} order by e.enumsortorder limit 1`;
      row[c.column_name] = e?.v;
    } else if (/int|numeric|double|real/.test(c.data_type)) row[c.column_name] = 0;
    else if (c.data_type === 'boolean') row[c.column_name] = false;
    else if (c.data_type === 'uuid') row[c.column_name] = staffId && /_by$|staff/.test(c.column_name) ? staffId : crypto.randomUUID();
    else if (/timestamp|date/.test(c.data_type)) row[c.column_name] = '2026-11-22';
    else if (/json/.test(c.data_type)) row[c.column_name] = sql.json({});
    else row[c.column_name] = `${table}-${run}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const [r] = await sql<{ id: string }[]>`insert into ${sql(`scm.${table}`)} ${sql(row)} returning id::text as id`;
  return r!.id;
}

describePg('reversing a short stock-out', () => {
  let wh = '';
  const item = `SKU-${run}`;
  const move = (v: Record<string, unknown>) => insertRow('inventory_movements', { company_id: 1, warehouse_id: wh, item_code: item, variant_key: '', ...v });
  const state = async () => {
    const [b] = await sql<{ q: number }[]>`select coalesce(sum(case when movement_type = 'IN' then qty when movement_type = 'OUT' then -qty else qty end), 0)::int as q from scm.inventory_movements where warehouse_id = ${wh} and item_code = ${item}`;
    const [l] = await sql<{ q: number }[]>`select coalesce(sum(qty_remaining), 0)::int as q from scm.inventory_lots where warehouse_id = ${wh} and item_code = ${item}`;
    return { balance: b!.q, lots: l!.q };
  };

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => {} });
    staffId = await insertRow('staff', {});
    wh = await insertRow('warehouses', { company_id: 1, code: `WH-${run}`, name: `WH ${run}` });
    await insertRow('mfg_products', { company_id: 1, code: item, name: item }).catch(() => undefined);
  });
  afterAll(async () => { await sql?.end(); });

  test('a purchase return of 5 with 2 in stock, cancelled: 2 go back into a lot, and lots equal the balance', async () => {
    await move({ movement_type: 'IN', qty: 2, unit_cost_sen: 1000, source_doc_type: 'GRN', source_doc_id: crypto.randomUUID() });
    const prId = crypto.randomUUID();
    const outId = await move({ movement_type: 'OUT', qty: 5, source_doc_type: 'PURCHASE_RETURN', source_doc_id: prId });
    expect(await state()).toEqual({ balance: -3, lots: 0 });
    const inId = await move({ movement_type: 'IN', qty: 5, unit_cost_sen: 400, source_doc_type: 'PURCHASE_RETURN', source_doc_id: prId, reverses_movement_id: outId });
    expect(await state()).toEqual({ balance: 2, lots: 2 });
    const [lot] = await sql<{ qty_received: number; unit_cost_sen: number }[]>`select qty_received, unit_cost_sen from scm.inventory_lots where movement_id = ${inId}`;
    expect(lot).toEqual({ qty_received: 2, unit_cost_sen: 1000 });
  });

  test('a stock-out that took nothing opens no lot when reversed', async () => {
    const before = await state();
    const docId = crypto.randomUUID();
    await sql`update scm.inventory_lots set qty_remaining = 0 where warehouse_id = ${wh} and item_code = ${item}`;
    const outId = await move({ movement_type: 'OUT', qty: 3, source_doc_type: 'STOCK_TRANSFER', source_doc_id: docId });
    const inId = await move({ movement_type: 'IN', qty: 3, unit_cost_sen: 0, source_doc_type: 'STOCK_TRANSFER', source_doc_id: docId, reverses_movement_id: outId });
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from scm.inventory_lots where movement_id = ${inId}`;
    expect(n!.n).toBe(0);
    expect((await state()).balance).toBe(before.balance);
  });

  test('an ordinary IN still opens a lot for its whole qty', async () => {
    const inId = await move({ movement_type: 'IN', qty: 4, unit_cost_sen: 700, source_doc_type: 'GRN', source_doc_id: crypto.randomUUID() });
    const [lot] = await sql<{ qty_received: number; unit_cost_sen: number }[]>`select qty_received, unit_cost_sen from scm.inventory_lots where movement_id = ${inId}`;
    expect(lot).toEqual({ qty_received: 4, unit_cost_sen: 700 });
  });
});
