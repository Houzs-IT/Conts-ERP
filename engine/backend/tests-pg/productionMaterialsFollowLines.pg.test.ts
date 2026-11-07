import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

/* Migration 0239 run for real: triggers are the behaviour, so only a database can show it. The tables are reduced to the
   columns the triggers read; the SQL under test is the migration file itself, minus the demo views and owner lines a bare
   database does not have. SKIPPED, not failed, without TEST_DATABASE_URL. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const ORDER = '00000000-0000-0000-0000-00000000000a';
const SO_ITEM = '00000000-0000-0000-0000-00000000000b';
let sql: Sql;

const needs = async () => {
  const rows = await sql`select item_code, qty_needed::float8 as qty from scm.production_order_materials order by item_code`;
  return Object.fromEntries(rows.map((r) => [r.item_code, r.qty]));
};
const addLine = (qty: number, soItem: string | null = SO_ITEM) =>
  sql`insert into scm.production_order_items (production_order_id, company_id, item_code, so_item_id, qty) values (${ORDER}, 1, 'SKU', ${soItem}, ${qty}) returning id`;

describePg('a production order follows its lines', () => {
  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => {} });
    await sql.unsafe(`
      drop schema if exists scm cascade; create schema scm;
      create table scm.production_orders (id uuid primary key, status text, expected_at date);
      create table scm.production_order_items (id uuid primary key default gen_random_uuid(), production_order_id uuid references scm.production_orders(id) on delete cascade,
        company_id bigint, item_code text, so_item_id uuid, qty numeric);
      create table scm.production_order_materials (id uuid primary key default gen_random_uuid(), production_order_id uuid references scm.production_orders(id) on delete cascade,
        company_id bigint, item_code text, description text, uom text, qty_needed numeric check (qty_needed > 0), processing_date date, delivery_date date,
        from_composition boolean default false, updated_at timestamptz);
      create table scm.purchase_order_items (id uuid primary key default gen_random_uuid(), production_material_id uuid);
      create table scm.sku_compositions (id uuid primary key default gen_random_uuid(), company_id bigint, sku_code text, material_code text, qty numeric);
      create table scm.so_line_materials (so_item_id uuid, company_id bigint, material_code text, qty numeric);
      create table scm.reno_beta_line_plans (so_item_id uuid primary key, materials_saved boolean);
      create table scm.reno_doc_lines (so_item_id uuid, measure numeric);
      create table scm.mfg_sales_order_items (id uuid primary key, qty int);
      create table scm.mfg_products (code text, company_id bigint, name text, uom text);
      create function scm.production_item_materials() returns trigger language plpgsql as $$ begin return null; end $$;
      create trigger trg_production_item_materials after insert on scm.production_order_items for each row execute function scm.production_item_materials();
    `);
    const file = readFileSync(resolve(__dirname, '../../../migrations-pg/0239_production_materials_follow_lines.sql'), 'utf8');
    await sql.unsafe(file.split('\n').filter((l) => !/^select demo\.|^alter function .* owner to/.test(l)).join('\n'));
  });
  afterAll(async () => { await sql?.end(); });
  beforeEach(async () => {
    await sql.unsafe(`truncate scm.production_orders, scm.production_order_items, scm.production_order_materials, scm.purchase_order_items, scm.sku_compositions,
      scm.so_line_materials, scm.reno_beta_line_plans, scm.reno_doc_lines, scm.mfg_sales_order_items cascade`);
    await sql`insert into scm.production_orders (id, status, expected_at) values (${ORDER}, 'SUBMITTED', '2026-12-01')`;
    await sql`insert into scm.mfg_sales_order_items (id, qty) values (${SO_ITEM}, 10)`;
    await sql`insert into scm.sku_compositions (company_id, sku_code, material_code, qty) values (1, 'SKU', 'BOARD', 2)`;
  });

  test('a new line brings the composition times its qty', async () => {
    await addLine(3);
    expect(await needs()).toEqual({ BOARD: 6 });
  });
  test('a qty change moves the material, keeping a hand edit', async () => {
    const [line] = await addLine(3);
    await sql`update scm.production_order_materials set qty_needed = 7`;
    await sql`update scm.production_order_items set qty = 4 where id = ${line!.id}`;
    expect(await needs()).toEqual({ BOARD: 9 });
  });
  test('a deleted line takes its materials with it', async () => {
    const [line] = await addLine(3);
    await sql`delete from scm.production_order_items where id = ${line!.id}`;
    expect(await needs()).toEqual({});
  });
  test('a material on a PO stays when its line goes', async () => {
    const [line] = await addLine(3);
    await sql`insert into scm.purchase_order_items (production_material_id) select id from scm.production_order_materials`;
    await sql`delete from scm.production_order_items where id = ${line!.id}`;
    expect(await needs()).toEqual({ BOARD: 6 });
  });
  test('a saved list is shared across partial POs, not repeated', async () => {
    await sql`insert into scm.reno_beta_line_plans (so_item_id, materials_saved) values (${SO_ITEM}, true)`;
    await sql`insert into scm.so_line_materials (so_item_id, company_id, material_code, qty) values (${SO_ITEM}, 1, 'GLUE', 20)`;
    await addLine(4);
    expect(await needs()).toEqual({ GLUE: 8 });
    await addLine(6);
    expect(await needs()).toEqual({ GLUE: 20 });
  });
  test('a measured line counts its measure, not one unit', async () => {
    await sql`insert into scm.reno_doc_lines (so_item_id, measure) values (${SO_ITEM}, 42.6)`;
    await addLine(1);
    expect(await needs()).toEqual({ BOARD: 85.2 });
  });
  test('a composition edit reaches an open order', async () => {
    await addLine(3);
    await sql`update scm.sku_compositions set qty = 5`;
    expect(await needs()).toEqual({ BOARD: 15 });
    await sql`insert into scm.sku_compositions (company_id, sku_code, material_code, qty) values (1, 'SKU', 'SCREW', 1)`;
    expect(await needs()).toEqual({ BOARD: 15, SCREW: 3 });
    await sql`delete from scm.sku_compositions where material_code = 'BOARD'`;
    expect(await needs()).toEqual({ SCREW: 3 });
  });
  test('a composition edit leaves a closed order alone', async () => {
    await addLine(3);
    await sql`update scm.production_orders set status = 'RECEIVED'`;
    await sql`update scm.sku_compositions set qty = 5`;
    expect(await needs()).toEqual({ BOARD: 6 });
  });
  test('a composition edit leaves a started order alone', async () => {
    await addLine(3);
    await sql.unsafe('alter table scm.production_orders add column if not exists actual_start_at timestamptz');
    await sql`update scm.production_orders set actual_start_at = now()`;
    await sql`update scm.sku_compositions set qty = 5`;
    await sql.unsafe('alter table scm.production_orders drop column actual_start_at');
    expect(await needs()).toEqual({ BOARD: 6 });
  });
  test('deleting the order leaves nothing behind', async () => {
    await addLine(3);
    await sql`delete from scm.production_orders where id = ${ORDER}`;
    expect(await needs()).toEqual({});
  });
});
