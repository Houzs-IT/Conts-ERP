import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types; the SAME splitter pg-migrate.mjs uses.
import { splitSqlStatements } from '../scripts/lib/split-sql.mjs';

/* Review of #856, run for real against migrations 0270-0275:
 *   1. a DO / GRN cancelled before the invoice line goes in bills nothing (committed, and in flight);
 *   2. the SECURITY DEFINER functions cannot be called by an ordinary role, yet still fire as triggers;
 *   4. a multi-line insert locks its parent lines sorted by id, not in insert order.
 * SKIPPED without TEST_DATABASE_URL (a throwaway local database: this creates and drops its own). */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const DB = 'conts_qty_caps_review';
const migrationsDir = fileURLToPath(new URL('../../../migrations-pg/', import.meta.url));
const FILES = [
  '0270_scm_so_line_over_delivery_guard.sql', '0271_scm_do_cancel_invoiced_lock.sql', '0272_scm_po_line_over_receipt_guard.sql',
  '0273_scm_billing_over_invoice_guard.sql', '0274_scm_so_line_qty_floor.sql', '0275_scm_po_line_qty_floor.sql',
];

const FIXTURE = `
  DROP SCHEMA IF EXISTS scm CASCADE;
  CREATE SCHEMA scm;
  CREATE TABLE scm.mfg_sales_order_items (id uuid PRIMARY KEY, qty integer NOT NULL DEFAULT 1);
  CREATE TABLE scm.delivery_orders (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'DELIVERED');
  CREATE TABLE scm.delivery_order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_order_id uuid NOT NULL REFERENCES scm.delivery_orders(id),
    so_item_id uuid REFERENCES scm.mfg_sales_order_items(id), qty integer NOT NULL);
  CREATE TABLE scm.delivery_returns (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'RECEIVED');
  CREATE TABLE scm.delivery_return_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_return_id uuid NOT NULL, do_item_id uuid, qty_returned integer NOT NULL);
  CREATE TABLE scm.purchase_order_items (id uuid PRIMARY KEY, qty integer NOT NULL);
  CREATE TABLE scm.grns (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'POSTED');
  CREATE TABLE scm.grn_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grn_id uuid NOT NULL REFERENCES scm.grns(id),
    purchase_order_item_id uuid REFERENCES scm.purchase_order_items(id), qty_accepted integer NOT NULL, returned_qty integer NOT NULL DEFAULT 0);
  CREATE TABLE scm.purchase_invoices (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'POSTED');
  CREATE TABLE scm.purchase_invoice_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_invoice_id uuid NOT NULL,
    grn_item_id uuid REFERENCES scm.grn_items(id), qty integer NOT NULL);
  CREATE TABLE scm.sales_invoices (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'SENT', delivery_order_id uuid);
  CREATE TABLE scm.sales_invoice_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sales_invoice_id uuid NOT NULL,
    do_item_id uuid REFERENCES scm.delivery_order_items(id), qty integer NOT NULL);
`;

const SO_A = '00000000-0000-0000-0000-0000000000a1';
const SO_B = '00000000-0000-0000-0000-0000000000a2';
const PO = '00000000-0000-0000-0000-0000000000a3';
const DO1 = '00000000-0000-0000-0000-0000000000d1';
const DO2 = '00000000-0000-0000-0000-0000000000d2';
const G1 = '00000000-0000-0000-0000-0000000000b1';
const SI = '00000000-0000-0000-0000-0000000000c1';
const PI = '00000000-0000-0000-0000-0000000000c2';

let admin: Sql;
let a: Sql;
let b: Sql;

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return (e as { code?: string }).code ?? 'unknown'; }
}

async function waitForLockWait(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [r] = await admin<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = ${DB} AND wait_event_type = 'Lock'`;
    if (r!.n > 0) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('the second connection never waited on a lock');
}

describePg('quantity caps: review fixes', () => {
  beforeAll(async () => {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') throw new Error('refusing a non-local TEST_DATABASE_URL');
    admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'cap_review_app') then create role cap_review_app nologin; end if; end $$`);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB}`);
    const u = new URL(url);
    u.pathname = `/${DB}`;
    a = postgres(u.toString(), { max: 1, prepare: false, onnotice: () => {} });
    b = postgres(u.toString(), { max: 1, prepare: false, onnotice: () => {} });
  });

  afterAll(async () => {
    await a?.end();
    await b?.end();
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
    await a`INSERT INTO scm.mfg_sales_order_items (id, qty) VALUES (${SO_A}, 5), (${SO_B}, 5)`;
    await a`INSERT INTO scm.purchase_order_items (id, qty) VALUES (${PO}, 5)`;
  });

  test('1. an SI line on a DO cancelled just before bills nothing', async () => {
    await a`INSERT INTO scm.delivery_orders (id) VALUES (${DO1})`;
    const [l] = await a<Array<{ id: string }>>`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO1}, ${SO_A}, 2) RETURNING id`;
    await a`INSERT INTO scm.sales_invoices (id) VALUES (${SI})`;
    // The SI screen read the DO live; it is cancelled (0271 sees no SI yet) before the line goes in.
    expect(await codeOf(a`UPDATE scm.delivery_orders SET status = 'CANCELLED' WHERE id = ${DO1}`)).toBeNull();
    expect(await codeOf(a`INSERT INTO scm.sales_invoice_items (sales_invoice_id, do_item_id, qty) VALUES (${SI}, ${l!.id}, 2)`)).toBe('P0413');
  });

  test('1. a DO cancel in flight: the SI line waits for it, then bills nothing', async () => {
    await a`INSERT INTO scm.delivery_orders (id) VALUES (${DO1})`;
    const [l] = await a<Array<{ id: string }>>`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO1}, ${SO_A}, 2) RETURNING id`;
    await a`INSERT INTO scm.sales_invoices (id) VALUES (${SI})`;
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let cancelled!: () => void;
    const didCancel = new Promise<void>((r) => { cancelled = r; });
    const pA = a.begin(async (tx) => { await tx`UPDATE scm.delivery_orders SET status = 'CANCELLED' WHERE id = ${DO1}`; cancelled(); await held; });
    await didCancel;
    const pB = codeOf(b`INSERT INTO scm.sales_invoice_items (sales_invoice_id, do_item_id, qty) VALUES (${SI}, ${l!.id}, 2)`);
    await waitForLockWait();
    release();
    await pA;
    expect(await pB).toBe('P0413');
  });

  test('1. a PI line on a cancelled GRN bills nothing, committed or in flight', async () => {
    await a`INSERT INTO scm.grns (id) VALUES (${G1})`;
    const [g] = await a<Array<{ id: string }>>`INSERT INTO scm.grn_items (grn_id, purchase_order_item_id, qty_accepted) VALUES (${G1}, ${PO}, 3) RETURNING id`;
    await a`INSERT INTO scm.purchase_invoices (id) VALUES (${PI})`;

    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let cancelled!: () => void;
    const didCancel = new Promise<void>((r) => { cancelled = r; });
    const pA = a.begin(async (tx) => { await tx`UPDATE scm.grns SET status = 'CANCELLED' WHERE id = ${G1}`; cancelled(); await held; });
    await didCancel;
    const pB = codeOf(b`INSERT INTO scm.purchase_invoice_items (purchase_invoice_id, grn_item_id, qty) VALUES (${PI}, ${g!.id}, 3)`);
    await waitForLockWait();
    release();
    await pA;
    expect(await pB).toBe('P0412');
    expect(await codeOf(a`INSERT INTO scm.purchase_invoice_items (purchase_invoice_id, grn_item_id, qty) VALUES (${PI}, ${g!.id}, 1)`)).toBe('P0412');
  });

  test('1. a live DO and GRN still bill up to their cap', async () => {
    await a`INSERT INTO scm.delivery_orders (id) VALUES (${DO1})`;
    const [l] = await a<Array<{ id: string }>>`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO1}, ${SO_A}, 2) RETURNING id`;
    await a`INSERT INTO scm.sales_invoices (id) VALUES (${SI})`;
    expect(await codeOf(a`INSERT INTO scm.sales_invoice_items (sales_invoice_id, do_item_id, qty) VALUES (${SI}, ${l!.id}, 2)`)).toBeNull();
    await a`INSERT INTO scm.grns (id) VALUES (${G1})`;
    const [g] = await a<Array<{ id: string }>>`INSERT INTO scm.grn_items (grn_id, purchase_order_item_id, qty_accepted) VALUES (${G1}, ${PO}, 3) RETURNING id`;
    await a`INSERT INTO scm.purchase_invoices (id) VALUES (${PI})`;
    expect(await codeOf(a`INSERT INTO scm.purchase_invoice_items (purchase_invoice_id, grn_item_id, qty) VALUES (${PI}, ${g!.id}, 3)`)).toBeNull();
  });

  test('2. no ordinary role can call the functions, and the triggers still fire for it', async () => {
    await a.unsafe(`GRANT USAGE ON SCHEMA scm TO cap_review_app; GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA scm TO cap_review_app`);
    await a`INSERT INTO scm.delivery_orders (id) VALUES (${DO1})`;
    const asApp = (q: string) => a.begin(async (tx) => { await tx.unsafe('SET LOCAL ROLE cap_review_app'); await tx.unsafe(q); });
    for (const fn of ['assert_so_line_not_over_delivered', 'assert_po_line_not_over_received', 'assert_grn_line_not_over_invoiced', 'assert_do_line_not_over_invoiced']) {
      expect(await codeOf(asApp(`SELECT scm.${fn}('${SO_A}'::uuid)`))).toBe('42501');
    }
    expect(await codeOf(asApp(`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES ('${DO1}', '${SO_A}', 5)`))).toBeNull();
    expect(await codeOf(asApp(`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES ('${DO1}', '${SO_A}', 1)`))).toBe('P0409');
  });

  test('4. a multi-line insert locks its SO lines sorted by id, not in insert order', async () => {
    await a`INSERT INTO scm.delivery_orders (id) VALUES (${DO1}), (${DO2})`;
    // A holds SO line B (the higher id). B's insert names B first, then A.
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const didLock = new Promise<void>((r) => { locked = r; });
    const pA = a.begin(async (tx) => { await tx`SELECT 1 FROM scm.mfg_sales_order_items WHERE id = ${SO_B} FOR NO KEY UPDATE`; locked(); await held; });
    await didLock;
    const pB = codeOf(b`INSERT INTO scm.delivery_order_items (delivery_order_id, so_item_id, qty) VALUES (${DO2}, ${SO_B}, 1), (${DO2}, ${SO_A}, 1)`);
    await waitForLockWait();
    // Sorted: B's insert already holds SO line A while it waits for B. In insert order it would hold nothing yet.
    const u = new URL(url);
    u.pathname = `/${DB}`;
    const c = postgres(u.toString(), { max: 1, prepare: false, onnotice: () => {} });
    try {
      expect(await codeOf(c.begin(async (tx) => { await tx`SELECT 1 FROM scm.mfg_sales_order_items WHERE id = ${SO_A} FOR NO KEY UPDATE NOWAIT`; }))).toBe('55P03');
    } finally { await c.end(); }
    release();
    await pA;
    expect(await pB).toBeNull();
  });
});
