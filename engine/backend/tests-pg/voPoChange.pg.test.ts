import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { changeVoPoLine, poLineTargets } from '../src/scm/lib/renovation-vo';

/* A contract VO's change to a PO line, on a real database: a draft moves at once, an issued PO waits on an amendment naming
   each line's own quantity, its price untouched. TEST_DATABASE_URL must be a throwaway database. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [PO, LINE_A, LINE_B, VO] = [1, 2, 3, 4].map(id) as [string, string, string, string];
let sql: Sql;

const db = { q: async (text: string, params: readonly unknown[] = []) => sql.unsafe(text, params as never[]) } as never;
const base = (over: Record<string, unknown> = {}) => ({
  companyId: 1, poLineId: LINE_A, oldQty: 6, target: { action: 'AMEND' as const, newQty: 2 }, po: { id: PO, number: 'TC-PO-1', status: 'SUBMITTED' },
  source: { id: VO, no: 'VO-TC-SO-1-01', requestedBy: null }, ...over,
});
const lines = async () => (await sql`select l.purchase_order_item_id as line, l.change_type, l.new_qty, l.new_unit_price_sen from scm.po_amendment_lines l order by l.new_qty nulls first`);

describePg('a VO changing a PO line', () => {
  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => {} });
    await sql.unsafe(`
      drop schema if exists scm cascade; create schema scm;
      create table scm.purchase_orders (id uuid primary key, subtotal_sen bigint, total_sen bigint, updated_at timestamptz);
      create table scm.purchase_order_items (id uuid primary key, purchase_order_id uuid, qty int, unit_price_sen int, discount_sen int, line_total_sen int);
      create table scm.po_amendments (id uuid primary key default gen_random_uuid(), po_id uuid, po_number text, amendment_no text, status text, reason text, requested_by uuid, company_id bigint,
        source_so_amendment_id uuid, source_so_amendment_no text);
      create table scm.po_amendment_lines (id uuid primary key default gen_random_uuid(), amendment_id uuid, purchase_order_item_id uuid, change_type text, new_qty int, new_unit_price_sen int, old_snapshot jsonb, company_id bigint);
    `);
  });
  afterAll(async () => { await sql?.end(); });
  beforeEach(async () => {
    await sql.unsafe('truncate scm.purchase_orders, scm.purchase_order_items, scm.po_amendments, scm.po_amendment_lines');
    await sql`insert into scm.purchase_orders (id, subtotal_sen, total_sen) values (${PO}, 8000, 8000)`;
    await sql`insert into scm.purchase_order_items values (${LINE_A}, ${PO}, 6, 700, 0, 4200), (${LINE_B}, ${PO}, 4, 950, 0, 3800)`;
  });

  test('an issued PO waits on an amendment and keeps its price', async () => {
    expect(await changeVoPoLine(db, base())).toBe('amendment');
    const [a] = await sql`select status, amendment_no, source_so_amendment_no from scm.po_amendments`;
    expect(a).toMatchObject({ status: 'REQUESTED', amendment_no: 'TC-PO-1/A1', source_so_amendment_no: 'VO-TC-SO-1-01' });
    expect(await lines()).toMatchObject([{ change_type: 'QTY', new_qty: 2, new_unit_price_sen: null }]);
    const [po] = await sql`select qty, unit_price_sen from scm.purchase_order_items where id = ${LINE_A}`;
    expect(po).toMatchObject({ qty: 6, unit_price_sen: 700 });
  });
  test('split lines each carry their own quantity, on one amendment', async () => {
    const targets = poLineTargets([{ id: LINE_A, qty: 6, received_qty: 0 }, { id: LINE_B, qty: 4, received_qty: 0 }], 7);
    expect(targets).toEqual([{ id: LINE_B, action: 'AMEND', newQty: 1 }]);
    await changeVoPoLine(db, base({ poLineId: LINE_B, oldQty: 4, target: targets[0] }));
    await changeVoPoLine(db, base({ target: { action: 'CANCEL', newQty: 0 } }));
    expect(await sql`select id from scm.po_amendments`).toHaveLength(1);
    expect(await lines()).toMatchObject([{ line: LINE_A, change_type: 'REMOVE', new_qty: null }, { line: LINE_B, change_type: 'QTY', new_qty: 1 }]);
  });
  test('a later VO on the same line replaces what the first asked', async () => {
    await changeVoPoLine(db, base());
    await changeVoPoLine(db, base({ target: { action: 'AMEND', newQty: 1 } }));
    expect(await lines()).toMatchObject([{ line: LINE_A, new_qty: 1 }]);
  });
  test('a draft PO changes at once, at its own price, with no amendment', async () => {
    expect(await changeVoPoLine(db, base({ po: { id: PO, number: 'TC-PO-1', status: 'DRAFT' } }))).toBe('direct');
    const [l] = await sql`select qty, unit_price_sen, line_total_sen from scm.purchase_order_items where id = ${LINE_A}`;
    expect(l).toMatchObject({ qty: 2, unit_price_sen: 700, line_total_sen: 1400 });
    expect(await sql`select total_sen::int as t from scm.purchase_orders`).toMatchObject([{ t: 5200 }]);
    expect(await sql`select id from scm.po_amendments`).toHaveLength(0);
  });
  test('a draft cancels the line outright', async () => {
    await changeVoPoLine(db, base({ po: { id: PO, number: 'TC-PO-1', status: 'DRAFT' }, target: { action: 'CANCEL', newQty: 0 } }));
    expect(await sql`select id from scm.purchase_order_items`).toHaveLength(1);
  });
  test('an open hand-raised amendment is left alone', async () => {
    await sql`insert into scm.po_amendments (po_id, status) values (${PO}, 'REQUESTED')`;
    expect(await changeVoPoLine(db, base())).toBe('flag');
    expect(await lines()).toHaveLength(0);
  });
});
