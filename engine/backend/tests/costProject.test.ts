/* Booked cost carries its project (Conts, renovation completion %; plan docs/superpowers/plans/2026-10-31-renovation-
   completion-dashboard.md Task 2). Pinned, one per kind of cost posting:
     · a purchase invoice: the project of its PO, else its GRN, on its cost legs; the AP leg has none;
     · an AP invoice line's project on its expense leg;
     · a payment voucher's direct-expense line keeps its project; a leg settling a bill has none;
     · a petty cash receipt line's project on its expense leg;
     · a supplier credit note gives cost back to its purchase invoice's (or AP invoice's) project. */
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { postPiAccounting } from '../src/scm/routes/accounting';
import { postCreditNote } from '../src/acc/credit-notes';
import { postReceiptJournal } from '../src/conts/petty-cash-ledger';
import { apInvoiceLines, pvLines, DEFAULT_ROLE_CODES } from '../src/acc/rules';

const CO = 1;
const acct = (code: string, type: string, special: string | null = null): Row => ({
  company_id: CO, account_code: code, account_name: code, account_type: type, parent_code: null, is_active: true, special_type: special,
});
const world = (over: Record<string, Row[]> = {}) => fakeSb({
  accounts: [acct('405-0000', 'LIABILITY', 'SCC'), acct('315-0100', 'ASSET'), acct('620-0010', 'EXPENSE'), acct('612-0000', 'EXPENSE')],
  companies: [{ id: CO, code: 'CONTS', name: 'THE CONTS' }],
  acc_account_roles: [], acc_company_settings: [],
  acc_item_group_accounts: [{ company_id: CO, group_code: 'WORKS', purchase_account: '620-0010', purchase_return_account: '612-0000' }],
  suppliers: [{ id: 's1', company_id: CO, code: '405-K001', name: 'KC TAN', control_account: '405-0000' }],
  purchase_orders: [{ id: 'po1', company_id: CO, project_id: 7 }],
  grns: [{ id: 'g1', company_id: CO, project_id: 8 }],
  journal_entries: [], journal_entry_lines: [],
  ...over,
}, {}, [], ['journal_entry_lines']);
const legs = (sb: ReturnType<typeof world>) => (sb.tables.journal_entry_lines as Row[]).map((l) => [l.account_code, l.project_id ?? null]);
const PI = (over: Row = {}): Row => ({
  id: 'pi1', invoice_number: 'PI-2611-001', invoice_date: '2026-11-05', supplier_id: 's1', total_sen: 10_000, currency: 'MYR', exchange_rate: 1,
  company_id: CO, migrated_no_stock: false, opening_balance: false, purchase_order_id: 'po1', grn_id: null,
  suppliers: { code: '405-K001', name: 'KC TAN', control_account: '405-0000' }, ...over,
});
const PI_ITEMS = [{ purchase_invoice_id: 'pi1', item_group: 'works', line_total_sen: 10_000, company_id: CO }];

describe('cost postings stamp their project', () => {
  test("PI for a project's PO stamps the project on its cost lines", async () => {
    const sb = world({ purchase_invoices: [PI()], purchase_invoice_items: PI_ITEMS });
    expect(await postPiAccounting(sb, 'PI-2611-001')).toMatchObject({ ok: true, status: 'posted' });
    expect(legs(sb)).toEqual([['620-0010', 7], ['405-0000', null]]);
  });

  test("a PI without a PO takes its GRN's project; with neither, none", async () => {
    const sb = world({ purchase_invoices: [PI({ purchase_order_id: null, grn_id: 'g1' })], purchase_invoice_items: PI_ITEMS });
    await postPiAccounting(sb, 'PI-2611-001');
    expect(legs(sb)[0]).toEqual(['620-0010', 8]);
    const none = world({ purchase_invoices: [PI({ purchase_order_id: null })], purchase_invoice_items: PI_ITEMS });
    await postPiAccounting(none, 'PI-2611-001');
    expect(legs(none)[0]).toEqual(['620-0010', null]);
  });

  test('AP invoice line project lands on its expense line', () => {
    const lines = apInvoiceLines({ ...DEFAULT_ROLE_CODES }, { invoice_number: 'API-1' }, { code: '405-K001', name: 'KC TAN', control_account: '405-0000' },
      [{ accountCode: '620-0010', myrSen: 500, description: 'Tiling labour', projectId: 7 }, { accountCode: '612-0000', myrSen: 100, description: null }]);
    expect(lines.map((l) => [l.accountCode, l.projectId ?? null])).toEqual([['620-0010', 7], ['612-0000', null], ['405-0000', null]]);
  });

  test('PV direct expense keeps its line\'s project; a bill settlement line has none', () => {
    const lines = pvLines({ pv_number: 'PV-1', payee_name: 'KC TAN', credit_account_code: '310-0010' },
      [{ description: 'Site cleaning', debit_account_code: '620-0010', myrSen: 300, project_id: 7 },
        { description: 'Bill', debit_account_code: '405-0000', myrSen: 200, project_id: 7 }],
      { code: '405-K001', name: 'KC TAN', control_account: '405-0000' }, '405-0000');
    expect(lines.map((l) => [l.accountCode, l.projectId ?? null])).toEqual([['620-0010', 7], ['405-0000', null], ['310-0010', null]]);
  });

  test('petty cash claim line project lands on the ledger', async () => {
    const sb = world();
    const r = await postReceiptJournal(sb, CO, { receiptNo: 'CLM-1', spendDate: '2026-11-05', floatAccountCode: '315-0100',
      lines: [{ accountCode: '620-0010', amountSen: 1_000, department: 'supply', projectId: 7 }] });
    expect(r).toMatchObject({ ok: true });
    expect(legs(sb)).toEqual([['620-0010', 7], ['315-0100', null]]);
  });

  test('SCN against a project PI gives back cost to that project', async () => {
    const note: Row = { id: 'n1', company_id: CO, kind: 'SCN', note_number: 'SCN-1', note_date: '2026-11-08', status: 'DRAFT',
      party_type: 'SUPPLIER', party_code: '405-K001', party_name: 'KC TAN', purchase_invoice_id: 'pi1' };
    const sb = world({ purchase_invoices: [PI()], acc_credit_notes: [note],
      acc_credit_note_lines: [{ id: 'l1', company_id: CO, note_id: 'n1', line_no: 1, description: 'Return', account_code: '612-0000', amount_sen: 1_500 }] });
    expect(await postCreditNote(sb, { companyId: CO, note, actor: 'T' })).toMatchObject({ ok: true });
    expect(legs(sb)).toEqual([['405-0000', null], ['612-0000', 7]]);
  });

  test("SCN against an AP invoice with one project takes it", async () => {
    const note: Row = { id: 'n2', company_id: CO, kind: 'SCN', note_number: 'SCN-2', note_date: '2026-11-08', status: 'DRAFT',
      party_type: 'SUPPLIER', party_code: '405-K001', party_name: 'KC TAN', ap_invoice_id: 'ap1' };
    const sb = world({ acc_credit_notes: [note], ap_invoice_lines: [{ company_id: CO, invoice_id: 'ap1', project_id: 9 }, { company_id: CO, invoice_id: 'ap1', project_id: 9 }],
      acc_credit_note_lines: [{ id: 'l2', company_id: CO, note_id: 'n2', line_no: 1, description: 'Less work', account_code: '612-0000', amount_sen: 800 }] });
    await postCreditNote(sb, { companyId: CO, note, actor: 'T' });
    expect(legs(sb)).toEqual([['405-0000', null], ['612-0000', 9]]);
  });
});
