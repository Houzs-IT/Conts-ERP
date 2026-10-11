// Owner decision C3 (Conts, 11 Oct 2026): a credit note MAY exceed what its
// invoice still owes. There is no cap to remove — neither the raise
// (insertCreditNote, routes/credit-notes.ts POST) nor the post reads the
// invoice's balance — and this pins that it stays that way: the customer simply
// ends up in credit.
import { describe, expect, it } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { insertCreditNote } from './credit-notes';

describe('a credit note larger than the invoice balance (C3)', () => {
  it('is raised in full against an invoice that owes less than the note', async () => {
    const sb = fakeSb({
      // RM 100 invoice, RM 90 already received: it owes RM 10.
      sales_invoices: [{ id: 'si-1', company_id: 1, invoice_number: 'TC-SI-2610-001', total_sen: 10000, paid_sen: 9000 }],
      acc_credit_notes: [],
      acc_credit_note_lines: [],
    });
    const r = await insertCreditNote(sb as never, {
      companyId: 1, docPrefix: 'TC-', kind: 'CN',
      party: { code: '300-C001', name: 'Customer' },
      salesInvoiceId: 'si-1', noteDate: '2026-10-11', createdBy: 'test',
      lines: [{ description: 'Goodwill credit', code: '510-000', amountSen: 50000 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.note.total_sen).toBe(50000);
    expect(r.note.note_number).toBe('TC-CN-2610-001');
    expect(r.note.sales_invoice_id).toBe('si-1');
  });
});
