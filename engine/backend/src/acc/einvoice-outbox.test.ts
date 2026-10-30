import { describe, expect, it } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { cancelOutbox, einvoiceWarning, prepareCreditNote, prepareInvoice, refreshAll, refreshForDebtor, refreshStale } from './einvoice-outbox';

const CO = 2;
const SO = '2990-SO-2611-001';
const SETTINGS: Row = {
  company_id: CO, einvoice_active: false, einvoice_classification: '022', einvoice_tax_type: '06',
  seller_tin: 'C12345678901', seller_brn: '202001012345', seller_msic: '43301', seller_activity: 'Renovation works',
  seller_address1: '1 Jalan Contoh', seller_city: 'Kuala Lumpur', seller_postcode: '50000', seller_state_code: '14', seller_phone: '0312345678',
};
const DESC = '1st Progress Billing for Interior Design & Renovation Works (15% Deposit as per Sales Order, refer to attached breakdown)';

function world(over: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    acc_company_settings: [{ ...SETTINGS }],
    mfg_sales_orders: [
      { doc_no: SO, company_id: CO, so_kind: 'RENOVATION', address1: 'D-25-13 Skyline', address2: null, city: 'Kuala Lumpur', postcode: '50450',
        customer_state: 'Kuala Lumpur', customer_country: 'Malaysia', phone: '0123456789', email: null },
      { doc_no: 'SO-FURN', company_id: CO, so_kind: 'STANDARD' },
    ],
    sales_invoices: [
      { id: 'si-1', company_id: CO, invoice_number: '2990SI-2611-001', so_doc_no: SO, invoice_date: '2026-11-03', total_sen: 1_500_000, status: 'SENT',
        debtor_code: '301-M002', debtor_name: 'MS LEE', address1: 'D-25-13 Skyline', address2: null, city: 'Kuala Lumpur', postcode: '50450',
        state: 'Kuala Lumpur', customer_country: 'Malaysia', phone: '0123456789', email: null },
      { id: 'si-9', company_id: CO, invoice_number: '2990SI-2611-009', so_doc_no: 'SO-FURN', invoice_date: '2026-11-03', total_sen: 100, status: 'SENT', debtor_code: '301-X001' },
    ],
    sales_invoice_items: [{ id: 'sii-1', sales_invoice_id: 'si-1', line_no: 1, description: DESC }],
    debtors: [{ id: 'd1', company_id: CO, code: '301-M002', name: 'MS LEE (SKYLINE D-25-13)', phone: '0123456789', tin: null, id_type: 'NRIC', id_number: '900101145678', sst_no: null }],
    acc_credit_notes: [
      { id: 'cn-1', company_id: CO, note_number: '2990CN-2611-001', kind: 'CN', party_code: '301-M002', party_name: 'MS LEE', so_doc_no: SO,
        note_date: '2026-11-10', total_sen: 600_000, reason: 'Special discount', status: 'POSTED' },
    ],
    acc_credit_note_lines: [{ id: 'cnl-1', company_id: CO, note_id: 'cn-1', line_no: 1, description: 'Special discount', amount_sen: 600_000 }],
    acc_einvoice_outbox: [],
    ...over,
  };
  return { sb: fakeSb(tables), tables };
}

describe('e-invoice outbox', () => {
  it('prepares a READY row for a renovation invoice with full details', async () => {
    const { sb, tables } = world();
    expect(await prepareInvoice(sb, CO, 'si-1')).toEqual({ status: 'READY', missing: [] });
    const row = tables.acc_einvoice_outbox[0];
    expect(row).toMatchObject({ company_id: CO, doc_kind: 'INVOICE', doc_number: '2990SI-2611-001', sales_invoice_id: 'si-1', debtor_code: '301-M002', status: 'READY' });
    expect(row.payload).toMatchObject({ invoiceTypeCode: '01', buyer: { name: 'MS LEE (SKYLINE D-25-13)', tin: 'EI00000000010' }, lines: [{ description: DESC, unitPrice: '15000.00' }] });
  });

  it('prepares NOT_READY with missing list when debtor has no ID', async () => {
    const { sb, tables } = world({ debtors: [{ id: 'd1', company_id: CO, code: '301-M002', name: 'MS LEE', tin: null, id_type: null, id_number: null }] });
    expect(await prepareInvoice(sb, CO, 'si-1')).toEqual({ status: 'NOT_READY', missing: ['buyer ID number'] });
    expect(tables.acc_einvoice_outbox[0]).toMatchObject({ status: 'NOT_READY', missing: ['buyer ID number'] });
  });

  it('non-renovation invoice is skipped', async () => {
    const { sb, tables } = world();
    expect(await prepareInvoice(sb, CO, 'si-9')).toBeNull();
    expect(tables.acc_einvoice_outbox).toEqual([]);
  });

  it('preparing twice updates the same row', async () => {
    const { sb, tables } = world();
    await prepareInvoice(sb, CO, 'si-1');
    await prepareInvoice(sb, CO, 'si-1');
    expect(tables.acc_einvoice_outbox).toHaveLength(1);
  });

  it('refreshForDebtor turns NOT_READY rows READY', async () => {
    const { sb, tables } = world({ debtors: [{ id: 'd1', company_id: CO, code: '301-M002', name: 'MS LEE', tin: null, id_type: null, id_number: null }] });
    await prepareInvoice(sb, CO, 'si-1');
    await prepareCreditNote(sb, CO, 'cn-1');
    Object.assign(tables.debtors[0], { id_type: 'NRIC', id_number: '900101145678' });
    expect(await refreshForDebtor(sb, CO, '301-M002')).toBe(2);
    expect(tables.acc_einvoice_outbox.map((r) => r.status)).toEqual(['READY', 'READY']);
  });

  it('refreshAll re-prepares after the seller details change', async () => {
    const { sb, tables } = world({ acc_company_settings: [{ ...SETTINGS, seller_msic: null }] });
    expect(await prepareInvoice(sb, CO, 'si-1')).toEqual({ status: 'NOT_READY', missing: ['seller MSIC code'] });
    tables.acc_company_settings[0].seller_msic = '43301';
    expect(await refreshAll(sb, CO)).toBe(1);
    expect(tables.acc_einvoice_outbox[0].status).toBe('READY');
  });

  it('cancelled invoice cancels its outbox row', async () => {
    const { sb, tables } = world();
    await prepareInvoice(sb, CO, 'si-1');
    await cancelOutbox(sb, CO, 'INVOICE', '2990SI-2611-001');
    expect(tables.acc_einvoice_outbox[0].status).toBe('CANCELLED');
    expect(await refreshAll(sb, CO)).toBe(0);
  });

  it('submitted rows are never re-prepared or cancelled', async () => {
    const { sb, tables } = world({ acc_einvoice_outbox: [{ id: 'o1', company_id: CO, doc_kind: 'INVOICE', doc_number: '2990SI-2611-001', debtor_code: '301-M002', status: 'SUBMITTED', missing: [], payload: { x: 1 } }] });
    expect(await prepareInvoice(sb, CO, 'si-1')).toEqual({ status: 'SUBMITTED', missing: [] });
    await cancelOutbox(sb, CO, 'INVOICE', '2990SI-2611-001');
    expect(await refreshForDebtor(sb, CO, '301-M002')).toBe(0);
    expect(tables.acc_einvoice_outbox[0]).toMatchObject({ status: 'SUBMITTED', payload: { x: 1 } });
  });

  it("credit note row references the contract's invoices", async () => {
    const { sb, tables } = world({
      sales_invoices: [
        ...world().tables.sales_invoices,
        { id: 'si-2', company_id: CO, invoice_number: '2990SI-2611-002', so_doc_no: SO, invoice_date: '2026-11-08', total_sen: 100, status: 'CANCELLED' },
        { id: 'si-3', company_id: CO, invoice_number: '2990SI-2612-001', so_doc_no: SO, invoice_date: '2026-12-01', total_sen: 100, status: 'SENT' },
      ],
    });
    expect(await prepareCreditNote(sb, CO, 'cn-1')).toEqual({ status: 'READY', missing: [] });
    const row = tables.acc_einvoice_outbox[0];
    expect(row).toMatchObject({ doc_kind: 'CREDIT_NOTE', doc_number: '2990CN-2611-001', credit_note_id: 'cn-1', status: 'READY' });
    expect(row.payload).toMatchObject({ invoiceTypeCode: '02', billingReferences: ['2990SI-2611-001'], lines: [{ description: 'Special discount', unitPrice: '6000.00' }] });
  });

  it('a credit note on a non-renovation order is skipped', async () => {
    const { sb } = world({ acc_credit_notes: [{ id: 'cn-9', company_id: CO, note_number: 'CN-9', kind: 'CN', so_doc_no: 'SO-FURN', note_date: '2026-11-10', total_sen: 1, status: 'POSTED' }] });
    expect(await prepareCreditNote(sb, CO, 'cn-9')).toBeNull();
  });

  it('warns only while e-invoice is active and the row is not ready', async () => {
    const { sb, tables } = world({ debtors: [] });
    await prepareInvoice(sb, CO, 'si-1');
    expect(await einvoiceWarning(sb, CO, 'INVOICE', '2990SI-2611-001')).toBeNull();
    tables.acc_company_settings[0].einvoice_active = true;
    expect(await einvoiceWarning(sb, CO, 'INVOICE', '2990SI-2611-001'))
      .toBe("E-invoice not ready: buyer ID number. The invoice is saved; fill in the customer's details on the customer account.");
  });
});

describe('e-invoice outbox (review)', () => {
  it("the customer account's address fills what the contract lacks, and a later edit makes the row READY", async () => {
    const bare = { address1: 'D-25-13 Skyline', address2: 'Jalan Ampang', city: null, postcode: null, state: null, customer_country: null };
    const { sb, tables } = world({
      sales_invoices: [{ ...world().tables.sales_invoices[0], ...bare }],
      debtors: [{ id: 'd1', company_id: CO, code: '301-M002', name: 'MS LEE', id_type: 'NRIC', id_number: '900101145678' }],
    });
    expect(await prepareInvoice(sb, CO, 'si-1')).toEqual({ status: 'NOT_READY', missing: ['buyer address', 'buyer state'] });
    Object.assign(tables.debtors[0], { city: 'Kuala Lumpur', postcode: '50450', state: 'Kuala Lumpur' });
    expect(await refreshForDebtor(sb, CO, '301-M002')).toBe(1);
    expect(tables.acc_einvoice_outbox[0]).toMatchObject({ status: 'READY' });
    expect(tables.acc_einvoice_outbox[0].payload).toMatchObject({
      buyer: { address: { line1: 'D-25-13 Skyline', line2: 'Jalan Ampang', city: 'Kuala Lumpur', postcode: '50450', stateCode: '14', country: 'MYS' } },
    });
  });

  it("the customer account's own address line wins over the document's", async () => {
    const { sb, tables } = world({
      debtors: [{ id: 'd1', company_id: CO, code: '301-M002', name: 'MS LEE', id_type: 'NRIC', id_number: '900101145678',
        address: '12 Jalan Bukit', city: 'Petaling Jaya', postcode: '46000', state: 'Selangor' }],
    });
    await prepareInvoice(sb, CO, 'si-1');
    expect(tables.acc_einvoice_outbox[0].payload).toMatchObject({ buyer: { address: { line1: '12 Jalan Bukit', line2: null, city: 'Petaling Jaya', stateCode: '10' } } });
  });

  it('a reopened invoice is queued again', async () => {
    const { sb, tables } = world();
    await prepareInvoice(sb, CO, 'si-1');
    await cancelOutbox(sb, CO, 'INVOICE', '2990SI-2611-001');
    expect(await prepareInvoice(sb, CO, 'si-1')).toEqual({ status: 'READY', missing: [] });
    expect(tables.acc_einvoice_outbox).toHaveLength(1);
    expect(tables.acc_einvoice_outbox[0].status).toBe('READY');
  });

  it("a credit note's description is its reason, not the ledger's rewritten line, and fits 300 characters", async () => {
    const { sb, tables } = world({
      acc_credit_note_lines: [{ id: 'cnl-1', company_id: CO, note_id: 'cn-1', line_no: 1, description: 'Special discount — revenue given back', amount_sen: 600_000 }],
    });
    await prepareCreditNote(sb, CO, 'cn-1');
    expect((tables.acc_einvoice_outbox[0].payload as any).lines[0].description).toBe('Special discount');
    tables.acc_credit_notes[0].reason = 'r'.repeat(400);
    expect(await prepareCreditNote(sb, CO, 'cn-1')).toEqual({ status: 'READY', missing: [] });
    expect((tables.acc_einvoice_outbox[0].payload as any).lines[0].description).toHaveLength(300);
  });
});

describe('e-invoice outbox: catching up after a settings save', () => {
  it('re-prepares rows older than the last save, a batch at a time, then reports none left', async () => {
    const { sb, tables } = world();
    await prepareInvoice(sb, CO, 'si-1');
    await prepareCreditNote(sb, CO, 'cn-1');
    for (const r of tables.acc_einvoice_outbox) r.prepared_at = '2020-01-01T00:00:00.000Z';
    tables.acc_company_settings[0].updated_at = '2020-01-02T00:00:00.000Z';
    expect(await refreshStale(sb, CO, 1)).toEqual({ refreshed: 1, remaining: 1 });
    expect(await refreshStale(sb, CO, 1)).toEqual({ refreshed: 1, remaining: 0 });
    expect(await refreshStale(sb, CO, 1)).toEqual({ refreshed: 0, remaining: 0 });
  });
});
