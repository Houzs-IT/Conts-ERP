import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { linkedDocFiles, linkedFilesFor } from '../src/scm/lib/doc-attachments';

/* The chain's SQL run for real: a production order's photos reach the GR through its PO and the DO through its sales order
   line, with no completion link, and an on-site pair shares both ways. TEST_DATABASE_URL must be a throwaway database. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [ORDER, PO, POI, GRN, DO, SO_ITEM, OTHER_DO, OTHER_GRN] = [1, 2, 3, 4, 5, 6, 7, 8].map(id) as [string, string, string, string, string, string, string, string];
let sql: Sql;

const db = () => ({
  prepare: (text: string) => {
    let n = 0;
    const q = text.replace(/\?/g, () => `$${++n}`);
    let args: unknown[] = [];
    const self = {
      bind: (...a: unknown[]) => { args = a; return self; },
      all: async () => ({ results: await sql.unsafe(q, args as never[]) }),
      first: async () => (await sql.unsafe(q, args as never[]))[0] ?? null,
    };
    return self;
  },
}) as never;
const attach = (doc: string, type: string, name: string, key: string) =>
  sql`insert into scm.doc_attachments (id, company_id, doc_type, doc_id, r2_key, file_name, mime, source) values (gen_random_uuid(), 1, ${type}, ${doc}, ${key}, ${name}, 'image/jpeg', 'upload')`;

describePg('files through the chain', () => {
  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => {} });
    await sql.unsafe(`
      drop schema if exists scm cascade; create schema scm;
      create table scm.production_orders (id uuid primary key, po_number text, company_id bigint, source_po_id uuid, completion_grn_id uuid, completion_do_id uuid);
      create table scm.production_order_items (id uuid primary key default gen_random_uuid(), production_order_id uuid, so_item_id uuid, photo_urls text[] default '{}', line_no int, created_at timestamptz default now());
      create table scm.purchase_orders (id uuid primary key, po_number text);
      create table scm.purchase_order_items (id uuid primary key, purchase_order_id uuid, so_item_id uuid);
      create table scm.grns (id uuid primary key, grn_number text, company_id bigint, purchase_order_id uuid);
      create table scm.grn_items (grn_id uuid, purchase_order_item_id uuid);
      create table scm.delivery_orders (id uuid primary key, do_number text, company_id bigint, pod_r2_key text, pod_photo_keys jsonb, delivered_at timestamptz, updated_at timestamptz default now());
      create table scm.delivery_order_items (delivery_order_id uuid, so_item_id uuid);
      create table scm.onsite_twins (grn_id uuid, do_id uuid);
      create table scm.doc_attachments (id uuid primary key, company_id bigint, doc_type text, doc_id text, r2_key text, file_name text, mime text, size_bytes int, caption text, source text,
        uploaded_by_name text, created_at timestamptz default now(), line_id text, deleted_at timestamptz);
    `);
  });
  afterAll(async () => { await sql?.end(); });
  beforeEach(async () => {
    await sql.unsafe(`truncate scm.production_orders, scm.production_order_items, scm.purchase_orders, scm.purchase_order_items, scm.grns, scm.grn_items, scm.delivery_orders,
      scm.delivery_order_items, scm.onsite_twins, scm.doc_attachments`);
    await sql`insert into scm.production_orders (id, po_number, company_id, source_po_id) values (${ORDER}, 'TC-PRO-1', 1, ${PO})`;
    await sql`insert into scm.production_order_items (production_order_id, so_item_id, photo_urls) values (${ORDER}, ${SO_ITEM}, '{line/a.jpg}')`;
    await sql`insert into scm.purchase_orders values (${PO}, 'TC-PO-1')`;
    await sql`insert into scm.purchase_order_items values (${POI}, ${PO}, ${SO_ITEM})`;
    await sql`insert into scm.grns values (${GRN}, 'GR-1', 1, ${PO}), (${OTHER_GRN}, 'GR-2', 1, null)`;
    await sql`insert into scm.delivery_orders (id, do_number, company_id) values (${DO}, 'DO-1', 1), (${OTHER_DO}, 'DO-2', 1)`;
    await sql`insert into scm.delivery_order_items values (${DO}, ${SO_ITEM})`;
    await attach(ORDER, 'production_order', 'day1.jpg', 'k/day1');
  });

  test('a GR shows the order behind its PO, with no completion link', async () => {
    const files = await linkedDocFiles(db(), { type: 'goods_received', id: GRN, no: 'GR-1', companyId: 1 });
    expect(files.map((f) => f.name).sort()).toEqual(['Line photo', 'day1.jpg']);
    expect(files.every((f) => f.source === 'pod' && f.readOnly && f.from === 'Production order TC-PRO-1')).toBe(true);
  });
  test('a DO shows the order behind its sales order line, and the roll-up agrees', async () => {
    const one = await linkedDocFiles(db(), { type: 'delivery_order', id: DO, no: 'DO-1', companyId: 1 });
    const all = await linkedFilesFor(db(), [{ type: 'delivery_order', id: DO }, { type: 'goods_received', id: GRN }], 1);
    expect(all.get(`delivery_order:${DO}`)!.map((f) => f.key).sort()).toEqual(one.map((f) => f.key).sort());
    expect(all.get(`goods_received:${GRN}`)).toHaveLength(2);
  });
  test('a document with no order behind it shows nothing', async () => {
    expect(await linkedDocFiles(db(), { type: 'delivery_order', id: OTHER_DO, no: 'DO-2', companyId: 1 })).toEqual([]);
  });
  test('an on-site pair shares its files both ways', async () => {
    await sql`insert into scm.onsite_twins values (${OTHER_GRN}, ${OTHER_DO})`;
    await attach(OTHER_DO, 'delivery_order', 'pod.jpg', 'k/pod');
    await attach(OTHER_GRN, 'goods_received', 'grn.jpg', 'k/grn');
    const all = await linkedFilesFor(db(), [{ type: 'delivery_order', id: OTHER_DO }, { type: 'goods_received', id: OTHER_GRN }], 1);
    expect(all.get(`goods_received:${OTHER_GRN}`)!.map((f) => f.name)).toEqual(['pod.jpg']);
    expect(all.get(`delivery_order:${OTHER_DO}`)!.map((f) => f.name)).toEqual(['grn.jpg']);
  });
});
