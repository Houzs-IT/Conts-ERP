// Supplier price list from the price actually paid (TODO port item 11, after
// Hookka 5957bdd87 + 6801df6fb): the latest accepted purchase invoice line sets
// the price, from the invoice's own date; a jump that looks like a box vs piece
// mix-up is refused and listed for a person to check.
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { OUTLIER_MULTIPLE, planPriceRefresh, type BindingForRefresh, type PaidLine } from '../src/scm/lib/supplier-price-refresh';
import { applySupplierPriceRefreshHandler, getSupplierPriceRefreshHandler } from '../src/scm/routes/suppliers';

const binding = (code: string, listSen: number, extra: Partial<BindingForRefresh> = {}): BindingForRefresh => ({
  id: `b-${code}`, item_code: code, material_name: code, unit_price_sen: listSen,
  price_matrix: null, price_valid_from: '2026-05-05', currency: 'MYR', ...extra,
});
const paid = (code: string, sen: number, date: string, extra: Partial<PaidLine> = {}): PaidLine => ({
  itemCode: code, invoiceDate: date, invoiceNumber: `PI-${date}`, unitPriceSen: sen, uom: null, currency: 'MYR', ...extra,
});

describe('planPriceRefresh', () => {
  test('the latest invoice price, from its own date; up and down both move', () => {
    const plan = planPriceRefresh(
      [binding('NL-58', 1000), binding('SCREW', 200)],
      [paid('NL-58', 900, '2026-06-01'), paid('NL-58', 1100, '2026-08-10'), paid('SCREW', 180, '2026-08-12')],
    );
    expect(plan.map((p) => [p.itemCode, p.eligible, p.paidSen, p.paidOn, p.invoiceNumber])).toEqual([
      ['NL-58', true, 1100, '2026-08-10', 'PI-2026-08-10'],
      ['SCREW', true, 180, '2026-08-12', 'PI-2026-08-12'],
    ]);
  });

  test('the real box vs piece cases are refused as unit mix-ups; ordinary moves survive', () => {
    const cases: Array<[number, number, boolean]> = [
      [77, 23100, false], // NON WOVEN WHITE RM 0.77 -> RM 231 (a roll against a per-metre list)
      [2, 1800, false], // M4X30MM RM 0.02 -> RM 18 (a box against per piece)
      [82, 2100, false], // CS 7MM x25.6
      [12720, 500, false], // GALAXY-04-VIOLET the other way
      [5022, 900, false], // SD Y x0.18
      [1000, 1100, true], // +10%
      [200, 180, true],
      [10000, 12500, true],
    ];
    for (const [list, paidSen, ok] of cases) {
      const [r] = planPriceRefresh([binding('X', list)], [paid('X', paidSen, '2026-08-20')]);
      expect(r!.eligible, `${list} -> ${paidSen}`).toBe(ok);
      if (!ok) expect(r!.reason).toBe('unit_mismatch');
    }
    expect(OUTLIER_MULTIPLE).toBe(3);
  });

  test('an invoice unit other than the SKU unit is a unit mix-up too', () => {
    const [r] = planPriceRefresh([binding('TILE', 500)], [paid('TILE', 550, '2026-08-20', { uom: 'BOX' })], new Map([['TILE', 'SQFT']]));
    expect(r!.reason).toBe('unit_mismatch');
    expect(r!.whyNot).toMatch(/BOX.*SQFT/);
  });

  test('refusals: two prices on one day, list dated later, other currency, size-priced, already current', () => {
    const plan = planPriceRefresh(
      [
        binding('TWO', 1000),
        binding('NEWER', 1000, { price_valid_from: '2026-09-01' }),
        binding('USD', 1000),
        binding('SOFA', 1000, { price_matrix: { '30': { P1: 1000 } } }),
        binding('SAME', 1000),
      ],
      [
        paid('TWO', 1100, '2026-08-20'), paid('TWO', 1200, '2026-08-20'),
        paid('NEWER', 1100, '2026-08-20'),
        paid('USD', 1100, '2026-08-20', { currency: 'USD' }),
        paid('SOFA', 1100, '2026-08-20'),
        paid('SAME', 1000, '2026-08-20'),
      ],
    );
    expect(plan.map((p) => [p.itemCode, p.reason])).toEqual([
      ['TWO', 'two_prices'], ['NEWER', 'list_newer'], ['USD', 'currency'], ['SOFA', 'size_priced'], ['SAME', 'current'],
    ]);
    expect(plan.every((p) => !p.eligible)).toBe(true);
  });

  test('a zero-priced line is not a price, and an item never invoiced is left alone', () => {
    expect(planPriceRefresh([binding('FREE', 1000), binding('NEVER', 1000)], [paid('FREE', 0, '2026-08-20')])).toEqual([]);
  });
});

/* ── The routes, on a small in-memory database ─────────────────────────── */
type Row = Record<string, unknown>;
class FakeQuery {
  private preds: Array<(r: Row) => boolean> = [];
  private patch: Row | null = null;
  constructor(private rows: Row[]) {}
  select() { return this; }
  update(p: Row) { this.patch = p; return this; }
  eq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) === String(val)); return this; }
  gt(col: string, val: number) { this.preds.push((r) => Number(r[col]) > val); return this; }
  in(col: string, vals: unknown[]) { const s = new Set(vals.map(String)); this.preds.push((r) => s.has(String(r[col]))); return this; }
  neq(col: string, val: unknown) { this.preds.push((r) => String(r[col]) !== String(val)); return this; }
  private run() {
    const hit = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.patch) for (const r of hit) Object.assign(r, this.patch);
    return hit;
  }
  maybeSingle() { return Promise.resolve({ data: this.run()[0] ?? null, error: null }); }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve({ data: this.run(), error: null }).then(res, rej); }
}

function harness() {
  const tables: Record<string, Row[]> = {
    supplier_material_bindings: [
      { id: 'b1', company_id: 1, supplier_id: 's1', material_kind: 'mfg_product', item_code: 'HK-1', material_name: 'Hacking', unit_price_sen: 1000, price_matrix: null, price_valid_from: '2026-05-05', currency: 'MYR', is_main_supplier: true, is_cost_anchor: false },
      { id: 'b2', company_id: 1, supplier_id: 's1', material_kind: 'mfg_product', item_code: 'SCREW', material_name: 'Screw', unit_price_sen: 2, price_matrix: null, price_valid_from: null, currency: 'MYR', is_main_supplier: true, is_cost_anchor: false },
      { id: 'b9', company_id: 2, supplier_id: 's1', material_kind: 'mfg_product', item_code: 'HK-1', material_name: 'Other company', unit_price_sen: 1000, price_matrix: null, price_valid_from: null, currency: 'MYR' },
    ],
    purchase_invoices: [
      { id: 'pi1', company_id: 1, supplier_id: 's1', status: 'POSTED', invoice_number: 'PI-001', invoice_date: '2026-08-10', currency: 'MYR' },
      { id: 'pi2', company_id: 1, supplier_id: 's1', status: 'DRAFT', invoice_number: 'PI-002', invoice_date: '2026-09-01', currency: 'MYR' },
      { id: 'pi3', company_id: 1, supplier_id: 's1', status: 'CANCELLED', invoice_number: 'PI-003', invoice_date: '2026-09-02', currency: 'MYR' },
    ],
    purchase_invoice_items: [
      { purchase_invoice_id: 'pi1', item_code: 'HK-1', unit_price_sen: 1150, uom: 'LOT' },
      { purchase_invoice_id: 'pi1', item_code: 'SCREW', unit_price_sen: 1800, uom: 'UNIT' },
      { purchase_invoice_id: 'pi2', item_code: 'HK-1', unit_price_sen: 5000, uom: 'LOT' },
      { purchase_invoice_id: 'pi3', item_code: 'HK-1', unit_price_sen: 6000, uom: 'LOT' },
    ],
    mfg_products: [
      { company_id: 1, code: 'HK-1', uom: 'LOT' },
      { company_id: 1, code: 'SCREW', uom: 'UNIT' },
    ],
    company_settings: [],
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, { from: (t: string) => new FakeQuery((tables[t] ||= [])) } as never);
    c.set('companyId' as never, 1 as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { id: 9, name: 'T', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.get('/suppliers/:id/price-refresh', getSupplierPriceRefreshHandler as never);
  app.post('/suppliers/:id/price-refresh', applySupplierPriceRefreshHandler as never);
  return { app, tables };
}

describe('GET / POST /suppliers/:id/price-refresh', () => {
  test('the preview lists the change and the box vs piece refusal, and writes nothing', async () => {
    const { app, tables } = harness();
    const out = await (await app.request('/suppliers/s1/price-refresh')).json() as {
      changes: Array<{ bindingId: string; paidSen: number; paidOn: string; invoiceNumber: string }>;
      unitMismatches: Array<{ itemCode: string }>;
    };
    expect(out.changes).toEqual([expect.objectContaining({ bindingId: 'b1', paidSen: 1150, paidOn: '2026-08-10', invoiceNumber: 'PI-001' })]);
    expect(out.unitMismatches.map((u) => u.itemCode)).toEqual(['SCREW']);
    expect(tables.supplier_material_bindings[0]!.unit_price_sen).toBe(1000);
  });

  test('apply writes the paid price from the invoice date, never a refused row or another company', async () => {
    const { app, tables } = harness();
    const res = await app.request('/suppliers/s1/price-refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bindingIds: ['b1', 'b2', 'b9'] }),
    });
    const out = await res.json() as { updated: number; failed: Array<{ bindingId: string }> };
    expect(out.updated).toBe(1);
    expect(out.failed.map((f) => f.bindingId).sort()).toEqual(['b2', 'b9']);
    const [b1, b2, b9] = tables.supplier_material_bindings;
    expect(b1).toMatchObject({ unit_price_sen: 1150, price_valid_from: '2026-08-10' });
    expect(b2!.unit_price_sen).toBe(2);
    expect(b9!.unit_price_sen).toBe(1000);
  });
});
