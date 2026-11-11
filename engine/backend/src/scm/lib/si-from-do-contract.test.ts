import { describe, expect, it } from 'vitest';
import { createSalesInvoiceFromDoLines } from './si-from-do';
import { fakeSb } from './fake-postgrest';

const tables = (soKind: string) => ({
  delivery_order_items: [{ id: 'di', delivery_order_id: 'd1', company_id: 1 }],
  delivery_orders: [{ id: 'd1', so_doc_no: 'TC-SO-1', company_id: 1, status: 'DELIVERED' }],
  mfg_sales_orders: [{ doc_no: 'TC-SO-1', so_kind: soKind, company_id: 1 }],
});
const raise = (sb: unknown) => createSalesInvoiceFromDoLines(sb as never, {
  companyId: 1, docPrefix: '', picks: [{ doItemId: 'di', qty: 1 }], asDraft: false, createdBy: null, actor: null,
} as never);

describe('an invoice off a delivery of a renovation contract', () => {
  it('is refused: contracts bill by instalment', async () => {
    const out = await raise(fakeSb(tables('RENOVATION')));
    expect(out).toMatchObject({ ok: false, status: 409, body: { error: 'renovation_so_bills_by_instalment' } });
  });
  it('an ordinary order passes this check', async () => {
    const out = await raise(fakeSb(tables('STANDARD')));
    expect(out.ok === false && out.body.error).not.toBe('renovation_so_bills_by_instalment');
  });
});
