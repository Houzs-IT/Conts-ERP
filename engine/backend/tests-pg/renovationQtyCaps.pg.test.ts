import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types; the SAME splitter pg-migrate.mjs uses.
import { splitSqlStatements } from '../scripts/lib/split-sql.mjs';

/* The quantity caps (migrations 0270-0275, TODO item 7) against the renovation flows, written the way those flows write:
 *   - a VO that omits a whole line sets cancelled and leaves qty (renovation-vo.ts), even on a delivered line;
 *   - a VO that omits part of a line cuts qty, down to what was delivered but not below (below_delivered in the app);
 *   - a site receipt / on-site twin receives up to qty - received_qty, and its DO delivers up to what is left;
 *   - a VO cut on a PO line keeps what was received (poLineTargets);
 *   - an instalment invoice carries no do_item_id, so a renovation DO can still be cancelled.
 * SKIPPED without TEST_DATABASE_URL (a throwaway local database: this creates and drops its own). */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const DB = 'conts_reno_qty_caps';
const migrationsDir = fileURLToPath(new URL('../../../migrations-pg/', import.meta.url));
const FILES = [
  '0270_scm_so_line_over_delivery_guard.sql', '0271_scm_do_cancel_invoiced_lock.sql', '0272_scm_po_line_over_receipt_guard.sql',
  '0273_scm_billing_over_invoice_guard.sql', '0274_scm_so_line_qty_floor.sql', '0275_scm_po_line_qty_floor.sql',
];

const FIXTURE = `
  DROP SCHEMA IF EXISTS scm CASCADE;
  CREATE SCHEMA scm;
  CREATE TABLE scm.mfg_sales_order_items (id uuid PRIMARY KEY, qty integer NOT NULL DEFAULT 1, cancelled boolean NOT NULL DEFAULT false);
  CREATE TABLE scm.delivery_orders (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'DRAFT', migrated_no_stock boolean DEFAULT false);
  CREATE TABLE scm.delivery_order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_order_id uuid NOT NULL REFERENCES scm.delivery_orders(id),
    so_item_id uuid REFERENCES scm.mfg_sales_order_items(id) ON DELETE SET NULL, qty integer NOT NULL);
  CREATE TABLE scm.delivery_returns (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'RECEIVED');
  CREATE TABLE scm.delivery_return_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_return_id uuid NOT NULL, do_item_id uuid, qty_returned integer NOT NULL);
  CREATE TABLE scm.purchase_order_items (id uuid PRIMARY KEY, qty integer NOT NULL, received_qty integer NOT NULL DEFAULT 0, so_item_id uuid);
  CREATE TABLE scm.grns (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'DRAFT', received_at_site boolean DEFAULT false);
  CREATE TABLE scm.grn_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grn_id uuid NOT NULL REFERENCES scm.grns(id),
    purchase_order_item_id uuid REFERENCES scm.purchase_order_items(id), qty_accepted integer NOT NULL, returned_qty integer NOT NULL DEFAULT 0);
  CREATE TABLE scm.purchase_invoices (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'DRAFT');
  CREATE TABLE scm.purchase_invoice_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_invoice_id uuid NOT NULL, grn_item_id uuid, qty integer NOT NULL);
  CREATE TABLE scm.sales_invoices (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'DRAFT', delivery_order_id uuid);
  CREATE TABLE scm.sales_invoice_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sales_invoice_id uuid NOT NULL, do_item_id uuid, so_item_id uuid, qty integer NOT NULL);
`;

const SO = '00000000-0000-0000-0000-0000000000a1';
const PO = '00000000-0000-0000-0000-0000000000a2';
const DO1 = '00000000-0000-0000-0000-0000000000d1';
const DO2 = '00000000-0000-0000-0000-0000000000d2';
const G1 = '00000000-0000-0000-0000-0000000000b1';
const G2 = '00000000-0000-0000-0000-0000000000b2';
const SI = '00000000-0000-0000-0000-0000000000c1';

let admin: Sql;
let a: Sql;

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return (e as { code?: string }).code ?? 'unknown'; }
}

describePg('quantity caps against the renovation flows', () => {
  beforeAll(async () => {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') throw new Error('refusing a non-local TEST_DATABASE_URL');
    admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB}`);
    const u = new URL(url);
    u.pathname = `/${DB}`;
    a = postgres(u.toString(), { max: 1, prepare: false, onnotice: () => {} });
  });

  afterAll(async () => {
    await a?.end();
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await a.unsafe(FIXTURE);
    for (const f of FILES) {
      const stmts = splitSqlStatements(await readFile(join(migrationsDir, f), 'utf8')) as string[];
      await a.begin(async (tx) => { for (const s of stmts) await tx.unsafe(s); });
    }
    await a`INSERT INTO scm.mfg_sales_order_items (id, qty) VALUES (${SO}, 5)`;
    await a`INSERT INTO scm.purchase_order_items (id, qty, so_item_id) VALUES (${PO}, 5, ${SO})`;
  });

  test('a site receipt takes what is left on the PO line and its drop-ship DO delivers it; one more unit is refused', async () => {
    await a`INSERT INTO scm.grns (id) VALUES (${G1})`;
    await a`INSERT INTO scm.grn_items (grn_id, purchase_order_item_id, qty_accepted) VALUES (${G1}, ${PO}, 5)`;
    expect(await codeOf(a`UPDATE scm.grns SET status = 'POSTED', received_at_site = true WHERE id = ${G1}`)).toBeNull();
    // The twin raises its DO as a draft, marks it drop ship, then Delivered.
    await a`INSERT INTO scm.delivery_orders (id) VALUES (${DO1})`;
    await a`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO1}, ${SO}, 5)`;
    await a`UPDATE scm.delivery_orders SET migrated_no_stock = true WHERE id = ${DO1}`;
    expect(await codeOf(a`UPDATE scm.delivery_orders SET status = 'DELIVERED' WHERE id = ${DO1}`)).toBeNull();

    await a`INSERT INTO scm.grns (id) VALUES (${G2})`;
    await a`INSERT INTO scm.grn_items (grn_id, purchase_order_item_id, qty_accepted) VALUES (${G2}, ${PO}, 1)`;
    expect(await codeOf(a`UPDATE scm.grns SET status = 'POSTED' WHERE id = ${G2}`)).toBe('P0411');
    await a`INSERT INTO scm.delivery_orders (id) VALUES (${DO2})`;
    await a`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO2}, ${SO}, 1)`;
    expect(await codeOf(a`UPDATE scm.delivery_orders SET status = 'DELIVERED' WHERE id = ${DO2}`)).toBe('P0409');
  });

  test('a VO omitting a whole delivered line (cancelled, qty kept) passes; a partial omit stops at what was delivered', async () => {
    await a`INSERT INTO scm.delivery_orders (id, status) VALUES (${DO1}, 'DELIVERED')`;
    await a`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO1}, ${SO}, 3)`;
    expect(await codeOf(a`UPDATE scm.mfg_sales_order_items SET qty = 3 WHERE id = ${SO}`)).toBeNull();
    expect(await codeOf(a`UPDATE scm.mfg_sales_order_items SET qty = 2 WHERE id = ${SO}`)).toBe('P0409');
    expect(await codeOf(a`UPDATE scm.mfg_sales_order_items SET cancelled = true WHERE id = ${SO}`)).toBeNull();
  });

  test('a delivery return lets the VO cut the line further', async () => {
    await a`INSERT INTO scm.delivery_orders (id, status) VALUES (${DO1}, 'DELIVERED')`;
    const [l] = await a<Array<{ id: string }>>`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO1}, ${SO}, 3) RETURNING id`;
    await a`INSERT INTO scm.delivery_returns (id) VALUES (${G2})`;
    await a`INSERT INTO scm.delivery_return_items (delivery_return_id, do_item_id, qty_returned) VALUES (${G2}, ${l!.id}, 2)`;
    expect(await codeOf(a`UPDATE scm.mfg_sales_order_items SET qty = 1 WHERE id = ${SO}`)).toBeNull();
  });

  test('a VO cut on a PO line keeps what was received, never less', async () => {
    await a`INSERT INTO scm.grns (id, status) VALUES (${G1}, 'POSTED')`;
    await a`INSERT INTO scm.grn_items (grn_id, purchase_order_item_id, qty_accepted) VALUES (${G1}, ${PO}, 2)`;
    expect(await codeOf(a`UPDATE scm.purchase_order_items SET qty = 2 WHERE id = ${PO}`)).toBeNull();
    expect(await codeOf(a`UPDATE scm.purchase_order_items SET qty = 1 WHERE id = ${PO}`)).toBe('P0411');
  });

  test('an instalment invoice (no do_item_id) does not lock the DO; a DO-line invoice does', async () => {
    await a`INSERT INTO scm.delivery_orders (id, status) VALUES (${DO1}, 'DELIVERED')`;
    const [l] = await a<Array<{ id: string }>>`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO1}, ${SO}, 2) RETURNING id`;
    await a`INSERT INTO scm.sales_invoices (id, status) VALUES (${SI}, 'SENT')`;
    await a`INSERT INTO scm.sales_invoice_items (sales_invoice_id, so_item_id, qty) VALUES (${SI}, ${SO}, 1)`;
    expect(await codeOf(a`UPDATE scm.delivery_orders SET status = 'CANCELLED' WHERE id = ${DO1}`)).toBeNull();

    await a`UPDATE scm.delivery_orders SET status = 'DELIVERED' WHERE id = ${DO1}`;
    await a`INSERT INTO scm.sales_invoice_items (sales_invoice_id, do_item_id, qty) VALUES (${SI}, ${l!.id}, 2)`;
    expect(await codeOf(a`UPDATE scm.delivery_orders SET status = 'CANCELLED' WHERE id = ${DO1}`)).toBe('P0410');
    expect(await codeOf(a`INSERT INTO scm.sales_invoice_items (sales_invoice_id, do_item_id, qty) VALUES (${SI}, ${l!.id}, 1)`)).toBe('P0413');
  });

  test('a supplier invoice bills a site receipt line up to what was accepted', async () => {
    await a`INSERT INTO scm.grns (id, status, received_at_site) VALUES (${G1}, 'POSTED', true)`;
    const [g] = await a<Array<{ id: string }>>`INSERT INTO scm.grn_items (grn_id, purchase_order_item_id, qty_accepted) VALUES (${G1}, ${PO}, 3) RETURNING id`;
    await a`INSERT INTO scm.purchase_invoices (id, status) VALUES (${SI}, 'POSTED')`;
    expect(await codeOf(a`INSERT INTO scm.purchase_invoice_items (purchase_invoice_id, grn_item_id, qty) VALUES (${SI}, ${g!.id}, 3)`)).toBeNull();
    expect(await codeOf(a`INSERT INTO scm.purchase_invoice_items (purchase_invoice_id, grn_item_id, qty) VALUES (${SI}, ${g!.id}, 1)`)).toBe('P0412');
  });
});
