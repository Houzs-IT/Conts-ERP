/* Reads that used to stop at PostgREST's 1,000-row response cap (21 Nov 2026 sweep, after PR #1118). Each test feeds
   more than 1,000 rows through the shared fake with its server ceiling switched on (maxRows = 1000), so a read that
   is not paged gets 1,000 rows and no error, exactly as production does. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb } from './fake-postgrest';
import { loadSupplierBindings } from './grn-scan-load';
import { readFabricTrackings } from '../routes/fabric-tracking';
import { journalEntriesList } from '../routes/accounting';
import { ledgerReport } from '../routes/accounting-ledger';

const CAP = 1000;
const CO = 1;
const pad = (n: number) => String(n).padStart(4, '0');
const capped = (tables: Record<string, Array<Record<string, unknown>>>) => fakeSb(tables, {}, [], [], CAP);

describe('scanned delivery note: supplier code lookup', () => {
  test('every binding is read, not the first 1,000', async () => {
    const bindings = Array.from({ length: 2247 }, (_, i) => ({
      id: `b-${pad(i)}`, company_id: CO, supplier_sku: `SUP-${pad(i)}`, ac_item_code: null, item_code: `ITEM-${pad(i)}`,
    }));
    const out = await loadSupplierBindings(capped({ supplier_material_bindings: bindings }) as never, CO);
    expect(out).toHaveLength(2247);
    expect(out.some((b) => b.supplierSku === 'SUP-2246')).toBe(true);
  });
});

describe('fabric register and fabric pickers', () => {
  test('1,200 fabrics come back whole, in code order, with a duplicated code read once per row', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `f-${pad(i)}`, company_id: CO, fabric_code: `FAB-${pad(i)}`, is_active: true }));
    rows.push({ id: 'f-dup', company_id: CO, fabric_code: 'FAB-0500', is_active: false });
    const c = { get: (k: string) => (k === 'companyId' ? CO : undefined) };
    const { data, error } = await readFabricTrackings(capped({ fabric_trackings: rows }), c as never, 'id, fabric_code, is_active', undefined, undefined);
    expect(error).toBeNull();
    expect(data).toHaveLength(1201);
    expect(data!.at(-1)).toMatchObject({ fabric_code: 'FAB-1199' });
    expect(new Set(data!.map((r) => r.id)).size).toBe(1201);
  });
});

describe('Journal page', () => {
  test('500 entries of 3 lines each: every entry keeps all its lines', async () => {
    const jes = Array.from({ length: 500 }, (_, i) => ({
      id: `je-${pad(i)}`, company_id: CO, je_no: `JV-${pad(i)}`, entry_date: '2026-11-01', source_type: 'MANUAL',
      source_doc_no: null, narration: null, total_debit_sen: 100, total_credit_sen: 100, posted: true, reversed: false,
    }));
    const lines = jes.flatMap((j, i) => [1, 2, 3].map((n) => ({
      id: `l-${pad(i)}-${n}`, company_id: CO, journal_entry_id: j.id, line_no: n, account_code: n === 1 ? '500-0000' : '310-0000',
      debit_sen: n === 1 ? 100 : 0, credit_sen: n === 1 ? 0 : 50, party_name: null, notes: null,
    })));
    const sb = capped({ journal_entries: jes, journal_entry_lines: lines });
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('supabase' as never, sb as never); c.set('companyId' as never, CO as never); await next(); });
    app.get('/journal-entries', journalEntriesList as never);
    const res = await app.request('/journal-entries?withLines=1');
    expect(res.status).toBe(200);
    const body = await res.json() as { journalEntries: Array<{ je_no: string; lines: unknown[] }> };
    expect(body.journalEntries).toHaveLength(500);
    expect(body.journalEntries.every((e) => e.lines.length === 3)).toBe(true);
  });
});

describe('General ledger, one account picked', () => {
  test('the other side of every entry is found when the entries hold more than 1,000 lines', async () => {
    /* 150 entries (one CHUNK) of 8 lines: one line on the picked bank account, seven on the expense side. */
    const gl: Array<Record<string, unknown>> = [];
    for (let e = 0; e < 150; e++) {
      for (let n = 0; n < 8; n++) {
        gl.push({
          line_id: e * 8 + n + 1, company_id: CO, je_no: `JV-${pad(e)}`, entry_date: '2026-11-02', source_type: 'MANUAL', source_doc_no: null,
          line_no: n + 1, account_code: n === 0 ? '310-0000' : '600-0000', account_name: n === 0 ? 'BANK' : 'EXPENSE',
          account_type: n === 0 ? 'ASSET' : 'EXPENSE', debit_sen: n === 0 ? 0 : 10, credit_sen: n === 0 ? 70 : 0,
          party_name: null, notes: null, reversed: false, reversed_by_je: null, department: null,
        });
      }
    }
    const sb = capped({
      accounts: [
        { company_id: CO, account_code: '310-0000', account_name: 'BANK', account_type: 'ASSET', is_active: true },
        { company_id: CO, account_code: '600-0000', account_name: 'EXPENSE', account_type: 'EXPENSE', is_active: true },
      ],
      v_gl_entries: gl,
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('supabase' as never, sb as never);
      c.set('companyId' as never, CO as never);
      c.set('houzsUser' as never, { id: 1, name: 'Finance', permissions_set: new Set(['scm.payment_voucher.post']) } as never);
      await next();
    });
    app.get('/ledger', ledgerReport as never);
    const res = await app.request('/ledger?from=2026-11-01&to=2026-11-30&accounts=310-0000');
    expect(res.status).toBe(200);
    const body = await res.json() as { blocks: Array<{ code: string; lines: Array<{ counter: { code: string } | null }> }> };
    const bank = body.blocks.find((b) => b.code === '310-0000')!;
    expect(bank.lines).toHaveLength(150);
    expect(bank.lines.every((l) => l.counter?.code === '600-0000')).toBe(true);
  });
});
