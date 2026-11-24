import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types; the SAME splitter pg-migrate.mjs uses.
import { splitSqlStatements } from '../scripts/lib/split-sql.mjs';

/* Migration 0355 on real PostgreSQL (PR #1126 deferred D1, D2, D12):
 *   - settle_pv_allocation settles once: a second call moves nothing;
 *   - unsettle_pv_allocation takes back exactly what was applied, once;
 *   - apply_supplier_advance: two applies racing for the same advance cannot both spend it.
 * The settle functions it builds on are taken verbatim from 0044. SKIPPED without TEST_DATABASE_URL. */

const url = process.env.TEST_DATABASE_URL ?? '';
const describePg = url ? describe : describe.skip;
const migrationsDir = fileURLToPath(new URL('../../../migrations-pg/', import.meta.url));

const PV = '00000000-0000-0000-0000-0000000000a1';
const PI = '00000000-0000-0000-0000-0000000000b1';
const PI2 = '00000000-0000-0000-0000-0000000000b2';
const AL = '00000000-0000-0000-0000-0000000000c1';

const FIXTURE = `
  DROP SCHEMA IF EXISTS scm CASCADE;
  CREATE SCHEMA scm;
  CREATE TYPE scm.purchase_invoice_status AS ENUM ('DRAFT','POSTED','PARTIALLY_PAID','PAID','CANCELLED','VOID');
  CREATE TABLE scm.purchase_invoices (id uuid PRIMARY KEY, status scm.purchase_invoice_status NOT NULL DEFAULT 'POSTED',
    total_sen bigint NOT NULL, paid_sen bigint NOT NULL DEFAULT 0, updated_at timestamptz);
  CREATE TABLE scm.ap_invoices (id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'POSTED',
    total_sen bigint NOT NULL, paid_sen bigint NOT NULL DEFAULT 0, updated_at timestamptz);
  CREATE TABLE scm.payment_vouchers (id uuid PRIMARY KEY, status text NOT NULL, posted_at timestamptz);
  CREATE TABLE scm.pv_allocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pv_id uuid NOT NULL, pi_id uuid,
    amount_sen bigint NOT NULL DEFAULT 0, applied_sen bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
    company_id bigint DEFAULT 1, from_advance boolean NOT NULL DEFAULT false, ap_invoice_id uuid);
  CREATE TABLE scm.acc_supplier_advances (id bigserial PRIMARY KEY, company_id integer NOT NULL, supplier_id text NOT NULL,
    pv_id text NOT NULL UNIQUE, pv_number text NOT NULL, amount_sen bigint NOT NULL, applied_sen bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
`;

async function settleFunctionsFrom0044(): Promise<string[]> {
  const text = await readFile(join(migrationsDir, '0044_scm_schema.sql'), 'utf8');
  return ['settle_api_paid_sen', 'settle_pi_paid_sen'].map((name) => {
    const start = text.indexOf(`CREATE OR REPLACE FUNCTION scm.${name}(`);
    const bodyEnd = text.indexOf('$function$;', text.indexOf('AS $function$', start) + 13);
    if (start < 0 || bodyEnd < 0) throw new Error(`${name} not found in 0044`);
    return text.slice(start, bodyEnd + '$function$;'.length);
  });
}

let sql: Sql;

describePg('migration 0355: a voucher settles and unwinds each invoice exactly once', () => {
  beforeAll(async () => {
    sql = postgres(url, { max: 4, onnotice: () => {} });
  });
  afterAll(async () => { await sql?.end(); });

  beforeEach(async () => {
    await sql.unsafe(FIXTURE);
    for (const fn of await settleFunctionsFrom0044()) await sql.unsafe(fn);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('_scm_pv_allocation_settle_once.sql'));
    if (files.length !== 1) throw new Error(`expected one *_scm_pv_allocation_settle_once.sql, found ${files.length}`);
    const stmts = splitSqlStatements(await readFile(join(migrationsDir, files[0]!), 'utf8')) as string[];
    for (const s of stmts) await sql.unsafe(s);
    await sql.unsafe(`
      INSERT INTO scm.payment_vouchers VALUES ('${PV}', 'POSTED', now());
      INSERT INTO scm.purchase_invoices (id, total_sen) VALUES ('${PI}', 200000), ('${PI2}', 150000);
      INSERT INTO scm.pv_allocations (id, pv_id, pi_id, amount_sen) VALUES ('${AL}', '${PV}', '${PI}', 250000);
      UPDATE scm.pv_allocations SET settled_at = NULL;
    `);
  });

  const paid = async (id: string) => Number((await sql.unsafe<Array<{ paid_sen: string }>>(
    'SELECT paid_sen FROM scm.purchase_invoices WHERE id = $1', [id]))[0]!.paid_sen);

  test('settle once: the clamp is recorded, and a second call moves nothing', async () => {
    const [first] = await sql.unsafe(`SELECT * FROM scm.settle_pv_allocation('${AL}')`);
    expect(first).toMatchObject({ applied: '200000', asked: '250000', already_settled: false });
    expect(await paid(PI)).toBe(200000);
    const [second] = await sql.unsafe(`SELECT * FROM scm.settle_pv_allocation('${AL}')`);
    expect(second).toMatchObject({ applied: '200000', already_settled: true });
    expect(await paid(PI)).toBe(200000);
  });

  test('unsettle once: exactly what was applied comes off, and a second call takes nothing', async () => {
    await sql.unsafe(`SELECT * FROM scm.settle_pv_allocation('${AL}')`);
    const [r1] = await sql.unsafe(`SELECT * FROM scm.unsettle_pv_allocation('${AL}')`);
    expect(r1).toMatchObject({ reversed: '200000', recorded: '200000' });
    expect(await paid(PI)).toBe(0);
    await sql.unsafe(`SELECT * FROM scm.unsettle_pv_allocation('${AL}')`);
    expect(await paid(PI)).toBe(0);
    const [a] = await sql.unsafe(`SELECT applied_sen, settled_at FROM scm.pv_allocations WHERE id = '${AL}'`);
    expect(a).toMatchObject({ applied_sen: '0', settled_at: null });
  });

  test('two applies racing for one advance: the second is refused, the advance is spent once', async () => {
    await sql.unsafe(`INSERT INTO scm.acc_supplier_advances (company_id, supplier_id, pv_id, pv_number, amount_sen)
                      VALUES (1, 'sup-1', '${PV}', 'PV-1', 100000)`);
    const want = (pi: string) => sql.unsafe(
      'SELECT * FROM scm.apply_supplier_advance($1::uuid, 1, $2::jsonb)',
      [PV, sql.json([{ pi_id: pi, amount_sen: 100000 }])] as never[],
    ).then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');
    const outcomes = await Promise.all([want(PI), want(PI2)]);
    expect(outcomes.sort()).toEqual(['P0415', 'ok']);
    const [adv] = await sql.unsafe('SELECT applied_sen FROM scm.acc_supplier_advances');
    expect(adv!.applied_sen).toBe('100000');
    expect((await paid(PI)) + (await paid(PI2))).toBe(100000);
    const rows = await sql.unsafe('SELECT * FROM scm.pv_allocations WHERE from_advance');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.settled_at).not.toBeNull();
  });

  test("a cancelled voucher's advance cannot be applied", async () => {
    await sql.unsafe(`INSERT INTO scm.acc_supplier_advances (company_id, supplier_id, pv_id, pv_number, amount_sen)
                      VALUES (1, 'sup-1', '${PV}', 'PV-1', 100000)`);
    await sql.unsafe(`UPDATE scm.payment_vouchers SET status = 'CANCELLED'`);
    await expect(sql.unsafe(`SELECT * FROM scm.apply_supplier_advance('${PV}', 1, '[{"pi_id":"${PI}","amount_sen":1000}]'::jsonb)`))
      .rejects.toMatchObject({ code: 'P0415' });
    expect(await paid(PI)).toBe(0);
  });
});
