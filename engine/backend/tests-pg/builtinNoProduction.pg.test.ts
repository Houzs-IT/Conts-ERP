import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

/* Migration 0243 run for real: the sync is a trigger, so only a database can show it. Tables are reduced to the columns it
   reads. SKIPPED without TEST_DATABASE_URL, which must be a throwaway database: this drops schema scm. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const INHOUSE = '00000000-0000-0000-0000-00000000000a';
const OUTSIDE = '00000000-0000-0000-0000-00000000000b';
let sql: Sql;

const newPo = async (supplier: string, status = 'SUBMITTED', no = 'TC-PO-2611-001') =>
  (await sql`insert into scm.purchase_orders (po_number, supplier_id, status, company_id) values (${no}, ${supplier}, ${status}, 1) returning id`)[0]!.id as string;
const addLine = (po: string, code: string) =>
  sql`insert into scm.purchase_order_items (purchase_order_id, company_id, item_code) values (${po}, 1, ${code})`;
const orders = async (po: string) => (await sql`
  select o.id, (select count(*)::int from scm.production_order_items i where i.production_order_id = o.id) as lines
    from scm.production_orders o where o.source_po_id = ${po}`).map((r) => r.lines as number);

describePg('Built-in never becomes a production order', () => {
  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => {} });
    await sql.unsafe(`
      drop schema if exists scm cascade; create schema scm;
      create table scm.suppliers (id uuid primary key, code text);
      create table scm.mfg_products (code text, company_id bigint, category text, category_group text);
      create table scm.purchase_orders (id uuid primary key default gen_random_uuid(), po_number text, supplier_id uuid, status text, company_id bigint, po_date date, expected_at date,
        purchase_location_id uuid, currency text, notes text, created_by uuid, project_id bigint, category_group text, sub_category text, attention text, display_term text);
      create table scm.purchase_order_items (id uuid primary key default gen_random_uuid(), purchase_order_id uuid, company_id bigint, binding_id uuid, material_kind text, item_code text,
        material_name text, supplier_sku text, qty numeric, unit_price_sen int, line_total_sen int, notes text, variants jsonb, item_group text, description text, description2 text,
        uom text, discount_sen int, delivery_date date, warehouse_id uuid, so_item_id uuid, photo_urls text[], line_no int, room text, category_group text, sub_category text);
      create table scm.production_orders (id uuid primary key default gen_random_uuid(), po_number text, source_po_id uuid unique, company_id bigint, supplier_id uuid, status text, po_date date,
        expected_at date, purchase_location_id uuid, currency text, notes text, submitted_at timestamptz, created_by uuid, project_id bigint, category_group text, sub_category text,
        attention text, display_term text, actual_start_at timestamptz, cancelled_at timestamptz, updated_at timestamptz);
      create table scm.production_order_items (id uuid primary key default gen_random_uuid(), production_order_id uuid, source_po_item_id uuid unique, company_id bigint, binding_id uuid,
        material_kind text, item_code text, material_name text, supplier_sku text, qty numeric, unit_price_sen int, line_total_sen int, notes text, variants jsonb, item_group text,
        description text, description2 text, uom text, discount_sen int, delivery_date date, warehouse_id uuid, so_item_id uuid, photo_urls text[], line_no int, room text,
        category_group text, sub_category text);
      create function scm.next_doc_no_n(s text, used integer) returns integer language sql as 'select used + 1';
      create function scm.production_totals(p uuid) returns void language sql as 'select 1';
      create function scm.production_sync_po(p_po uuid) returns void language plpgsql as $$ begin null; end $$;
      create function scm.production_po_changed() returns trigger language plpgsql as $$ begin perform scm.production_sync_po(new.id); return null; end $$;
      create function scm.production_po_item_changed() returns trigger language plpgsql as $$ begin perform scm.production_sync_po(new.purchase_order_id); return null; end $$;
      create trigger trg_production_po after insert or update of status on scm.purchase_orders for each row execute function scm.production_po_changed();
      create trigger trg_production_po_item after insert on scm.purchase_order_items for each row execute function scm.production_po_item_changed();
    `);
    const file = readFileSync(resolve(__dirname, '../../../migrations-pg/0243_builtin_no_production.sql'), 'utf8');
    await sql.unsafe(file.split('\n').filter((l) => !/^select demo\./.test(l)).join('\n'));
  });
  afterAll(async () => { await sql?.end(); });
  beforeEach(async () => {
    await sql.unsafe('truncate scm.suppliers, scm.mfg_products, scm.purchase_orders, scm.purchase_order_items, scm.production_orders, scm.production_order_items');
    await sql`insert into scm.suppliers values (${INHOUSE}, 'INHOUSE'), (${OUTSIDE}, 'ACME')`;
    await sql`insert into scm.mfg_products values ('CAB', 1, 'BUILTIN', 'BUILTIN'), ('HACK', 1, 'WORKS', 'WORKS')`;
  });

  test('a Built-in line bound to In-house makes no order', async () => {
    const po = await newPo(INHOUSE);
    await addLine(po, 'CAB');
    expect(await orders(po)).toEqual([]);
  });
  test('a Works line still makes its order, with the line, and a header alone makes none yet', async () => {
    const po = await newPo(INHOUSE);
    expect(await orders(po)).toEqual([]);
    await addLine(po, 'HACK');
    expect(await orders(po)).toEqual([1]);
  });
  test('a draft Works PO makes its order on going live', async () => {
    const po = await newPo(INHOUSE, 'DRAFT');
    await addLine(po, 'HACK');
    expect(await orders(po)).toEqual([]);
    await sql`update scm.purchase_orders set status = 'SUBMITTED' where id = ${po}`;
    expect(await orders(po)).toEqual([1]);
  });
  test('a Built-in line beside a Works line stays on the PO', async () => {
    const po = await newPo(INHOUSE);
    await addLine(po, 'HACK');
    await addLine(po, 'CAB');
    expect(await orders(po)).toEqual([1]);
  });
  test('no path can put a Built-in line on an order', async () => {
    const po = await newPo(INHOUSE);
    await addLine(po, 'HACK');
    const [o] = await sql`select id from scm.production_orders where source_po_id = ${po}`;
    await expect(sql`insert into scm.production_order_items (production_order_id, company_id, item_code) values (${o!.id}, 1, 'CAB')`).rejects.toThrow(/Built-in/);
  });
  test('an outside supplier makes no order', async () => {
    const po = await newPo(OUTSIDE);
    await addLine(po, 'HACK');
    expect(await orders(po)).toEqual([]);
  });
});
