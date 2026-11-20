// The Sales Invoice over-quantity refusal must SAY which line, how much was
// delivered, how much is already invoiced and how much was asked. Until 20 Nov
// 2026 the body was { error: 'over_remaining', lines } with no sentence, so the
// browser showed "That clashes with something already in the system".
import { describe, expect, test } from 'vitest';
import { checkSiOverRemaining, siOverRemainingSentence } from './do-line-remaining';

type Row = Record<string, unknown>;

function fakeSb(tables: Record<string, Row[]>) {
  class Q {
    rows: Row[];
    constructor(rows: Row[]) { this.rows = [...rows]; }
    select() { return this; }
    eq(col: string, val: unknown) { this.rows = this.rows.filter((r) => r[col] === val); return this; }
    in(col: string, vals: unknown[]) { this.rows = this.rows.filter((r) => vals.includes(r[col])); return this; }
    not() { return this; }
    order() { return this; }
    range(from: number, to: number) { this.rows = this.rows.slice(from, to + 1); return this; }
    then<T>(ok: (v: { data: Row[]; error: null }) => T) { return Promise.resolve({ data: this.rows, error: null }).then(ok); }
  }
  return { from: (t: string) => new Q(tables[t] ?? []) };
}

// Delivered 5 of SOFA-01 on DO-1; 3 already on another invoice -> 2 left.
const LEDGER = (): Record<string, Row[]> => ({
  delivery_orders: [{ id: 'do-1', company_id: 1, do_number: 'DO-1', status: 'DISPATCHED', debtor_code: 'C1', debtor_name: 'Cust' }],
  delivery_order_items: [
    { id: 'dl-1', delivery_order_id: 'do-1', item_code: 'SOFA-01', qty: 5 },
    { id: 'dl-2', delivery_order_id: 'do-1', item_code: 'BED-02', qty: 2 },
  ],
  sales_invoices: [{ id: 'si-0', status: 'SENT' }],
  sales_invoice_items: [{ do_item_id: 'dl-1', sales_invoice_id: 'si-0', qty: 3 }],
  delivery_returns: [],
  delivery_return_items: [],
});

describe('checkSiOverRemaining says what is wrong', () => {
  test('one line over: names the line, delivered, already invoiced and asked', async () => {
    const r = await checkSiOverRemaining(fakeSb(LEDGER()), [
      { doItemId: 'dl-2', itemCode: 'BED-02', qty: 1 },
      { doItemId: 'dl-1', itemCode: 'SOFA-01', qty: 4 },
    ], undefined, true);
    expect(r?.status).toBe(409);
    expect(r?.body).toMatchObject({
      error: 'over_remaining',
      message: 'Line 2, SOFA-01 on DO-1: delivered 5, already invoiced 3, this invoice asks for 4. Only 2 left to invoice.',
    });
  });

  test('within what is left: no refusal', async () => {
    const r = await checkSiOverRemaining(fakeSb(LEDGER()), [{ doItemId: 'dl-1', itemCode: 'SOFA-01', qty: 2 }], undefined, true);
    expect(r).toBeNull();
  });

  test('editing an existing line leaves its own qty out of "already invoiced"', async () => {
    // The 3 already invoiced IS the line being edited (exclude 3); asking 6 of 5 delivered.
    const r = await checkSiOverRemaining(fakeSb(LEDGER()), [{ doItemId: 'dl-1', itemCode: 'SOFA-01', qty: 6 }], new Map([['dl-1', 3]]));
    expect((r?.body as { message: string }).message)
      .toBe('SOFA-01 on DO-1: delivered 5, already invoiced 0, this invoice asks for 6. Only 5 left to invoice.');
  });

  test('several lines over: one problem line each, every sentence short enough to show', async () => {
    const r = await checkSiOverRemaining(fakeSb(LEDGER()), [
      { doItemId: 'dl-1', itemCode: 'SOFA-01', qty: 9 },
      { doItemId: 'dl-2', itemCode: 'BED-02', qty: 3 },
    ], undefined, true);
    const body = r?.body as { message: string; problems: Array<{ message: string }> };
    expect(body.message).toBe('2 lines ask for more than was delivered and not yet invoiced.');
    expect(body.problems.map((p) => p.message)).toEqual([
      'Line 1, SOFA-01 on DO-1: delivered 5, already invoiced 3, this invoice asks for 9. Only 2 left to invoice.',
      'Line 2, BED-02 on DO-1: delivered 2, already invoiced 0, this invoice asks for 3. Only 2 left to invoice.',
    ]);
    for (const p of body.problems) expect(p.message.length).toBeLessThan(200);
  });
});

describe('siOverRemainingSentence', () => {
  test('mentions returns and says when nothing is left', () => {
    expect(siOverRemainingSentence({
      doItemId: 'x', requested: 1, remaining: 0, itemCode: 'A', doNumber: 'DO-9', delivered: 4, returned: 1, invoiced: 3,
    })).toBe('A on DO-9: delivered 4, returned 1, already invoiced 3, this invoice asks for 1. Nothing is left to invoice.');
  });
});
