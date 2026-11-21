/* PR #1126 deferred D5. A source-order pin (the create handler needs D1, R2 and the admin client, so it has no route
   harness): the deposit rows - and the journal each books - come only after the order's lines are in, so a create
   whose line insert fails leaves no deposit journal behind; and a deposit row that fails is returned to the screen
   as paymentErrors, never only logged. Fails on the code before the fix. */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const src = readFileSync(new URL('../src/scm/routes/mfg-sales-orders.ts', import.meta.url), 'utf8');

describe('SO create: deposit after lines, and a failed deposit is said', () => {
  const linesInsert = src.indexOf("from('mfg_sales_order_items').insert(stampCo(rowsWithDoc))");
  const splitDeposit = src.indexOf("note:               plan ? `Converted from ${plan.fromDocNo} at SO create` : 'POS split payment (auto-recorded at SO create)'");
  const singleDeposit = src.indexOf("note:               'POS deposit (auto-recorded at SO create)'");

  test('both deposit paths are written after the line insert', () => {
    expect(linesInsert).toBeGreaterThan(0);
    expect(splitDeposit).toBeGreaterThan(linesInsert);
    expect(singleDeposit).toBeGreaterThan(linesInsert);
  });

  test('a failed deposit row reaches the response', () => {
    const between = src.slice(splitDeposit, src.indexOf('/* ── FAIR LINK (owner 2026-09-13)', splitDeposit));
    expect((between.match(/paymentErrors\.push\(/g) ?? []).length).toBe(2);
    expect(src).toContain('return c.json({ ...created, ...(paymentErrors.length ? { paymentErrors } : {}) }, 201);');
  });
});
