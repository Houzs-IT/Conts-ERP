import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readPoSchedule, takeBackPoPayment } from '../src/scm/lib/renovation-po-schedule';
import type { RenoDb } from '../src/scm/lib/renovation-db';

/* D13 (save-integrity, 22 Nov 2026): a PO instalment payment whose voucher was cancelled paid nothing. On the real
   schema (every file in migrations-pg; scripts/pg-tests-on-pglite.mjs or a throwaway cluster), never staging or
   production. SKIPPED without TEST_DATABASE_URL. */

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

const db: RenoDb = { q: (text: string, params: unknown[] = []) => sql.unsafe(text, params as never[]) } as unknown as RenoDb;

describePg('PO instalment payments and their vouchers', () => {
  let poId = '';
  let instId = '';
  let noVoucherPayment = '';
  let livePayment = '';
  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => {} });
    staffId = await insertRow('staff', {});
    await insertRow('accounts', { company_id: 1, account_code: `310-${run}`, account_name: 'Bank', account_type: 'ASSET' });
    const supplierId = await insertRow('suppliers', { company_id: 1, name: `Sup ${run}`, code: `S-${run}` });
    poId = await insertRow('purchase_orders', { company_id: 1, po_number: `PO-${run}`, supplier_id: supplierId, status: 'SUBMITTED', total_sen: 100_000 });
    instId = await insertRow('reno_po_instalments', { company_id: 1, purchase_order_id: poId, seq: 1, label: 'Deposit', pct_bp: 10000, amount_sen: 100_000, payable_on: 'MANUAL' });
    const livePv = await insertRow('payment_vouchers', { company_id: 1, pv_number: `PV-L-${run}`, supplier_id: supplierId, status: 'POSTED', credit_account_code: `310-${run}` });
    const deadPv = await insertRow('payment_vouchers', { company_id: 1, pv_number: `PV-C-${run}`, supplier_id: supplierId, status: 'CANCELLED', credit_account_code: `310-${run}` });
    await insertRow('reno_po_instalment_payments', { company_id: 1, po_instalment_id: instId, payment_voucher_id: livePv, amount_sen: 30_000 });
    await insertRow('reno_po_instalment_payments', { company_id: 1, po_instalment_id: instId, payment_voucher_id: deadPv, amount_sen: 50_000 });
    noVoucherPayment = await insertRow('reno_po_instalment_payments', { company_id: 1, po_instalment_id: instId, payment_voucher_id: null, amount_sen: 5_000 });
    livePayment = livePv;
  });
  afterAll(async () => { await sql?.end(); });

  test('a payment whose voucher was cancelled neither counts nor shows; one with no voucher still counts', async () => {
    const v = await readPoSchedule(db, poId, 1);
    const inst = v.instalments.find((i) => i.id === instId)!;
    expect(inst.paidSen).toBe(35_000);
    expect(inst.outstandingSen).toBe(65_000);
    expect(inst.payments.map((p) => p.amountSen).sort((a, b) => a - b)).toEqual([5_000, 30_000]);
  });

  test('a payment whose voucher could not be made is taken back and audited; one with a voucher is never touched', async () => {
    const actor = { companyId: 1, name: 'Chew' } as never;
    await takeBackPoPayment(db, actor, noVoucherPayment, 'Ledger not open');
    const [gone] = await sql<{ n: number }[]>`select count(*)::int as n from scm.reno_po_instalment_payments where id = ${noVoucherPayment}`;
    expect(gone!.n).toBe(0);
    const [audit] = await sql<{ note: string }[]>`select note from scm.entity_audit_log where entity_id = ${poId} and action = 'INSTALMENT_PAYMENT_UNDONE'`;
    expect(audit?.note).toContain('Ledger not open');
    const [withPv] = await sql<{ id: string }[]>`select id::text from scm.reno_po_instalment_payments where payment_voucher_id = ${livePayment}`;
    await takeBackPoPayment(db, actor, withPv!.id, 'should not happen');
    const [kept] = await sql<{ n: number }[]>`select count(*)::int as n from scm.reno_po_instalment_payments where id = ${withPv!.id}`;
    expect(kept!.n).toBe(1);
    const v = await readPoSchedule(db, poId, 1);
    expect(v.instalments.find((i) => i.id === instId)!.paidSen).toBe(30_000);
  });
});
