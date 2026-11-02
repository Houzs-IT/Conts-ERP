/* PaymentVoucherDetail — Edit on a DRAFT AP Payment (owner 2026-09-08, on a
   rejected voucher whose bill was an AP invoice: 当我 reject ap payment 后, 他的
   edit 不是退回去 knock pi? 而是这样? → 做). The Edit used to show the plain
   voucher's line editor (a "Settle 1 invoice(s)" line demanding a debit
   account) and a picker of purchase invoices only, so the AP invoice the
   voucher paid was "no outstanding purchase invoices" and could not be
   re-knocked. Now the Edit IS the AP form PV New shows: no typed lines, both
   invoice kinds with the knock-off prefilled, a prepay box, the total
   following ticks + prepay, and the one AP-control line written on save. */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/* Hoisted with the mocks that read them (vi.mock factories run before the
   file's own consts exist). */
const { updateAsync, idle, DETAIL, shown, notifyMock } = vi.hoisted(() => {
  const updateAsync = vi.fn(async (_b: Record<string, unknown>) => ({ ok: true }));
  const idle = () => ({ mutateAsync: vi.fn(async () => ({ ok: true })), isPending: false });
  /* The rejected voucher as prod holds it: its formal number kept, every mark
     cleared, ONE stored line on the Other Creditor control, one AP-invoice
     allocation. */
  const DETAIL = {
    paymentVoucher: {
      id: 'pv-9', pv_number: '2990-HPV-2609-009', status: 'DRAFT', purpose: 'SUPPLIER_PAYMENT',
      supplier_id: 'sup-meta', payee_name: 'META PLATFORM IRELAND LIMITED', credit_account_code: '310-0020',
      voucher_date: '2026-09-08', total_sen: 1007742, currency: 'MYR', exchange_rate: 1, notes: null,
      submitted_at: null, checked_at: null, approved_at: null, company_id: 2,
    },
    lines: [{ id: 'l1', line_no: 1, description: 'Settle 1 invoice(s) — META PLATFORM IRELAND LIMITED', debit_account_code: '405-0000', amount_sen: 1007742 }],
    allocations: [{ id: 'a1', kind: 'API', apInvoiceId: 'api-meta', invoiceNumber: '2990-API-2609-004', supplierInvoiceRef: 'META-SEP', invoiceDate: '2026-09-01', amountSen: 1007742, status: 'POSTED' }],
  };
  /* What the page loads: the AP payment above unless a test swaps it. */
  const shown: { detail: Record<string, unknown> } = { detail: DETAIL };
  const notifyMock = vi.fn();
  return { updateAsync, idle, DETAIL, shown, notifyMock };
});
/* Conts (finance phase 1.5): the project field reads its own queries; it says here which project it shows and whether
   it can be changed. */
vi.mock('../../conts/ProjectLimitField', () => ({
  ProjectLimitField: ({ projectId, disabled }: { projectId: number | null; disabled?: boolean }) => <span>{`Voucher project ${projectId ?? 'none'}${disabled ? ' (read-only)' : ''}`}</span>,
}));
vi.mock('../../conts/Pickers', () => ({
  UnitPicker: ({ value, onChange, ariaLabel }: { value: string | null; onChange: (v: string | null) => void; ariaLabel: string }) => <input aria-label={ariaLabel} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />,
  ProjectPicker: ({ value, onChange, ariaLabel }: { value: number | null; onChange: (v: number | null) => void; ariaLabel: string }) => <input aria-label={ariaLabel} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} />,
  UnitName: ({ id }: { id: string | null }) => <>{id ? `unit ${id}` : null}</>,
  ProjectName: ({ id }: { id: number | null }) => <>{id != null ? `project ${id}` : null}</>,
}));
vi.mock('../../conts/projectLimitQueries', () => ({
  useProjectOptions: () => ({ data: { projects: [
    { id: 7, code: 'RN-7', name: 'ASTER HILL A-08-11', funding: 'customer', internal_department: null },
    { id: 8, code: 'RN-8', name: 'OWN UNIT B-2-3', funding: 'internal', internal_department: 'rental' },
  ] } }),
}));
vi.mock('../../components/doc-attachments/DocAttachments', () => ({ LineFilesButton: () => null, DocAttachments: () => null }));
vi.mock('../../vendor/scm/lib/payment-voucher-queries', async (importOriginal) => ({
  /* The real constants stay (PV_FILE_ACCEPT for the files card); only the hooks are stubbed. */
  ...(await importOriginal<typeof import('../../vendor/scm/lib/payment-voucher-queries')>()),
  usePaymentVoucherDetail: () => ({ data: shown.detail, isLoading: false }),
  useUpdatePaymentVoucher: () => ({ mutateAsync: updateAsync, isPending: false }),
  useCancelPaymentVoucher: idle, useSubmitPaymentVoucher: idle, useWithdrawPaymentVoucher: idle,
  useCheckPaymentVoucher: idle, useApprovePaymentVoucher: idle, usePostNowPaymentVoucher: idle, useRejectPaymentVoucher: idle,
  useApplyAdvance: idle, useUploadPvFile: idle, useDeletePvFile: idle,
  useSupplierAdvances: () => ({ data: { advances: [], totalRemainingSen: 0 }, isLoading: false }),
  usePvFiles: () => ({ data: { files: [] }, isLoading: false, refetch: async () => ({ data: { files: [] } }) }),
  fetchPvFileBlobUrl: async () => ({ url: '', contentType: '' }),
  usePvReservations: () => ({ data: { byPi: {}, byApInvoice: {}, holders: {} }, isLoading: false }),
  NO_RESERVATIONS: { byPi: {}, byApInvoice: {}, holders: {} },
}));
/* The AP invoices (non-stock bills): META's, and another supplier's that must
   stay off this voucher's picker. */
vi.mock('../../vendor/scm/lib/ap-invoice-queries', () => ({
  useApInvoices: () => ({ data: { rows: [
    { kind: 'API', id: 'api-meta', invoiceNumber: '2990-API-2609-004', supplierId: 'sup-meta', supplierCode: '405-M001', supplierName: 'META PLATFORM IRELAND LIMITED', supplierInvoiceRef: 'META-SEP', invoiceDate: '2026-09-01', dueDate: null, currency: 'MYR', totalSen: 1007742, paidSen: 0, outstandingSen: 1007742, status: 'POSTED' },
    { kind: 'API', id: 'api-other', invoiceNumber: '2990-API-2609-777', supplierId: 'sup-x', supplierCode: '405-X001', supplierName: 'SOMEONE ELSE', supplierInvoiceRef: null, invoiceDate: '2026-09-02', dueDate: null, currency: 'MYR', totalSen: 5000, paidSen: 0, outstandingSen: 5000, status: 'POSTED' },
  ] }, isLoading: false }),
}));
vi.mock('../../vendor/scm/lib/purchase-invoice-queries', () => ({
  usePurchaseInvoices: () => ({ data: { purchaseInvoices: [] }, isLoading: false }),
}));
vi.mock('../../vendor/scm/lib/suppliers-queries', () => ({
  useSuppliers: () => ({ data: [{ id: 'sup-meta', code: '405-M001', name: 'META PLATFORM IRELAND LIMITED', currency: 'MYR' }], isLoading: false }),
  useSupplierDetail: () => ({ data: { supplier: { id: 'sup-meta', currency: 'MYR' } } }),
}));
vi.mock('../../vendor/scm/lib/accounting-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../vendor/scm/lib/accounting-queries')>()),
  useAccounts: () => ({ data: { accounts: [
    { account_code: '310-0020', account_name: 'CASH AT BANK - HLBB', account_type: 'ASSET', parent_code: null, is_active: true, acc_money: true },
    { account_code: '400-0000', account_name: 'ACCOUNT PAYABLE', account_type: 'LIABILITY', parent_code: null, is_active: true, acc_money: false },
    { account_code: '405-0000', account_name: 'OTHER CREDITOS', account_type: 'LIABILITY', parent_code: null, is_active: true, acc_money: false },
    { account_code: '900-A002', account_name: 'Advertisement', account_type: 'EXPENSE', parent_code: null, is_active: true, acc_money: false },
  ] }, isLoading: false }),
  useAccountRoles: () => ({ data: { roles: { AP: '400-0000', AP_OTHER: '405-0000', AR: '300-0000', BANK_DEFAULT: '310-0020' }, overridden: {} }, isLoading: false }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../../vendor/scm/components/ConfirmDialog', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('../../vendor/scm/components/NotifyDialog', () => ({ useNotify: () => notifyMock }));
vi.mock('./EntityHistoryPanel', () => ({ EntityHistoryPanel: () => null }));
vi.mock('../../components/scm-v2/PrintPreviewModal', () => ({
  PrintPreviewModal: () => null,
  usePrintPreview: () => ({ open: false, close: () => {}, openPreview: () => {} }),
  useOpenPrintPreviewFromUrl: () => {},
}));

import { PaymentVoucherDetail } from './PaymentVoucherDetail';

const draw = (url = '/scm/payment-vouchers/pv-9?edit=1') => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="/scm/payment-vouchers/:id" element={<PaymentVoucherDetail />} /></Routes>
  </MemoryRouter>,
);

describe('Edit on a DRAFT AP Payment is the AP form, not the plain voucher\'s', () => {
  test('no line editor; the supplier\'s AP invoice is on the picker with its knock-off prefilled; a prepay adds to the total; Save writes the one AP-control line and the allocation', async () => {
    updateAsync.mockClear();
    draw();
    await waitFor(() => expect(screen.getByText(/One line, written by the system on save/)).toBeTruthy());
    /* The plain voucher's editor is gone — no debit account to pick, no line to add. */
    expect(screen.queryByText('Add another line')).toBeNull();
    expect(screen.queryByText('Account (Debit) *')).toBeNull();
    expect(screen.getByText('Lines (1)')).toBeTruthy();

    /* The AP invoice (not a purchase invoice) is listed, marked, prefilled at
       what the voucher already applies; another supplier's stays off. */
    expect(screen.getByText('2990-API-2609-004')).toBeTruthy();
    expect(screen.queryByText('2990-API-2609-777')).toBeNull();
    expect(screen.queryByText(/no outstanding purchase invoices/)).toBeNull();
    expect((screen.getByLabelText('Pay 2990-API-2609-004 in full') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Apply to 2990-API-2609-004') as HTMLInputElement).value).toBe('10,077.42');
    expect(screen.getByText('Applying RM 10,077.42 = RM 10,077.42')).toBeTruthy();

    /* A prepay rides the same voucher; the total follows ticks + prepay. */
    const prepay = screen.getByLabelText('Prepay amount') as HTMLInputElement;
    fireEvent.focus(prepay);
    fireEvent.change(prepay, { target: { value: '100' } });
    fireEvent.blur(prepay);
    expect(screen.getByText('Applying RM 10,077.42 + prepay RM 100.00 = RM 10,177.42')).toBeTruthy();
    expect(screen.getByText(/Books: Dr 405-0000 Account Payable RM 10,177\.42 \(incl\. prepay RM 100\.00\)/)).toBeTruthy();

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    expect(updateAsync.mock.calls[0]![0]).toMatchObject({
      id: 'pv-9', purpose: 'SUPPLIER_PAYMENT', supplierId: 'sup-meta', creditAccountCode: '310-0020',
      lines: [{ debitAccountCode: '405-0000', amountSen: 1017742, description: 'Settle 1 invoice(s) + prepay 100.00 — META PLATFORM IRELAND LIMITED' }],
      allocations: [{ apInvoiceId: 'api-meta', amountSen: 1007742 }],
    });
  });

  test('unticking the invoice leaves only the prepay — nothing is knocked off, the line is the prepay alone', async () => {
    updateAsync.mockClear();
    draw();
    await waitFor(() => expect(screen.getByLabelText('Pay 2990-API-2609-004 in full')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Pay 2990-API-2609-004 in full'));
    expect(screen.getByText('Applying RM 0.00 = RM 0.00')).toBeTruthy();
    const prepay = screen.getByLabelText('Prepay amount') as HTMLInputElement;
    fireEvent.focus(prepay);
    fireEvent.change(prepay, { target: { value: '2500' } });
    fireEvent.blur(prepay);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    expect(updateAsync.mock.calls[0]![0]).toMatchObject({
      lines: [{ debitAccountCode: '405-0000', amountSen: 250000, description: 'prepay 2500.00 — META PLATFORM IRELAND LIMITED' }],
      allocations: [],
    });
  });
});

/* Each line says what it is for (chew 2 Nov 2026; plan 2026-11-02-voucher-line-purpose Task 3). An older Mixed voucher
   (made with the voucher-wide For) opens line by line as Unit, Project or Company and, saved untouched, sends back each
   line's department, unit and project; the read-only view shows each line's tag and its unit or project. */
describe('a plain voucher: each line says what it is for', () => {
  const MIXED = {
    paymentVoucher: {
      id: 'pv-9', pv_number: '2990-HPV-2610-021', status: 'DRAFT', purpose: 'OTHER',
      supplier_id: null, payee_name: 'ACE HARDWARE', credit_account_code: '310-0020',
      voucher_date: '2026-10-21', total_sen: 35000, currency: 'MYR', exchange_rate: 1, notes: null,
      submitted_at: null, checked_at: null, approved_at: null, company_id: 2,
    },
    lines: [
      { id: 'm1', line_no: 1, description: 'Aircon service', debit_account_code: '900-A002', amount_sen: 20000, department: 'rental', unit_id: 'u-a31', project_id: null },
      { id: 'm2', line_no: 2, description: 'Tiles', debit_account_code: '900-A002', amount_sen: 10000, department: 'supply', unit_id: null, project_id: 7 },
      { id: 'm3', line_no: 3, description: 'Stationery', debit_account_code: '900-A002', amount_sen: 5000, department: 'shared', unit_id: null, project_id: null },
    ],
    allocations: [],
  };
  const forOf = (n: number) => screen.getByRole('radiogroup', { name: `Line ${n} for` });
  const checked = (n: number) => within(forOf(n)).getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')?.textContent;

  test('there is no For switch; the lines load as Unit, Project and Company and save unchanged', async () => {
    shown.detail = MIXED;
    updateAsync.mockClear();
    try {
      draw();
      await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Line 1 for' })).toBeTruthy());
      expect(screen.queryByText('For *')).toBeNull();
      expect(screen.queryByRole('radio', { name: 'Mixed' })).toBeNull();
      expect([checked(1), checked(2), checked(3)]).toEqual(['Unit', 'Project', 'Company']);
      expect((screen.getByLabelText('Line 1 unit') as HTMLInputElement).value).toBe('u-a31');
      expect((screen.getByLabelText('Line 2 project') as HTMLInputElement).value).toBe('7');
      expect(['Line 1 department', 'Line 2 department', 'Line 3 department'].map((l) => screen.getByLabelText(l).textContent))
        .toEqual(['Rental', 'Renovation', 'Company']);
      /* No voucher-wide project on a plain voucher. */
      expect(screen.queryByText(/Voucher project/)).toBeNull();
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
      const body = updateAsync.mock.calls[0]![0] as { lines: Array<Record<string, unknown>> } & Record<string, unknown>;
      expect(body.lines).toEqual([
        expect.objectContaining({ description: 'Aircon service', department: 'rental', unitId: 'u-a31', projectId: null }),
        expect.objectContaining({ description: 'Tiles', department: 'supply', unitId: null, projectId: 7 }),
        expect.objectContaining({ description: 'Stationery', department: 'shared', unitId: null, projectId: null }),
      ]);
      expect('projectId' in body).toBe(false);
    } finally {
      shown.detail = DETAIL;
    }
  });

  /* Review 2 Nov 2026: before this change a voucher's one project was stamped on every line, and a Rental line's unit
     was optional. Such a voucher opened and saved without touching its lines must send every line back as it was. */
  test('an older voucher with its project on every line saves every line unchanged; no unit or project is asked for', async () => {
    shown.detail = { ...MIXED, lines: [
      { id: 's1', line_no: 1, description: 'Aircon service', debit_account_code: '900-A002', amount_sen: 20000, department: 'rental', unit_id: 'u-a31', project_id: 7 },
      { id: 's2', line_no: 2, description: 'Paint', debit_account_code: '900-A002', amount_sen: 10000, department: 'rental', unit_id: null, project_id: 7 },
      { id: 's3', line_no: 3, description: 'Stationery', debit_account_code: '900-A002', amount_sen: 3000, department: 'shared', unit_id: null, project_id: 7 },
      { id: 's4', line_no: 4, description: 'Tiles', debit_account_code: '900-A002', amount_sen: 2000, department: 'supply', unit_id: null, project_id: null },
    ] };
    updateAsync.mockClear();
    try {
      draw();
      await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Line 1 for' })).toBeTruthy());
      expect(['Line 1 department', 'Line 2 department', 'Line 3 department', 'Line 4 department'].map((l) => screen.getByLabelText(l).textContent))
        .toEqual(['Rental', 'Rental', 'Company', 'Renovation']);
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
      const body = updateAsync.mock.calls[0]![0] as { lines: Array<Record<string, unknown>> };
      expect(body.lines.map((l) => [l.department, l.unitId, l.projectId])).toEqual([
        ['rental', 'u-a31', 7], ['rental', null, 7], ['shared', null, 7], ['supply', null, null],
      ]);
    } finally {
      shown.detail = DETAIL;
    }
  });

  test('a Unit line left without its unit says "Pick the unit"', async () => {
    shown.detail = MIXED;
    updateAsync.mockClear();
    try {
      draw();
      await waitFor(() => expect(screen.getByLabelText('Line 1 unit')).toBeTruthy());
      fireEvent.change(screen.getByLabelText('Line 1 unit'), { target: { value: '' } });
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pick the unit' })));
      expect(updateAsync).not.toHaveBeenCalled();
    } finally {
      shown.detail = DETAIL;
    }
  });

  test('the read-only view shows each line\'s tag and its unit or project', async () => {
    shown.detail = MIXED;
    try {
      draw('/scm/payment-vouchers/pv-9');
      await waitFor(() => expect(screen.getByText('Aircon service')).toBeTruthy());
      const row = (text: string) => screen.getByText(text).closest('tr')!.textContent ?? '';
      expect(row('Aircon service')).toContain('Rental');
      expect(row('Aircon service')).toContain('unit u-a31');
      expect(row('Tiles')).toContain('Renovation');
      expect(row('Tiles')).toContain('project 7');
      expect(row('Stationery')).toContain('Company');
      expect(screen.queryByText(/Voucher project/)).toBeNull();
    } finally {
      shown.detail = DETAIL;
    }
  });

  test('an AP payment still shows its one project, read-only', async () => {
    shown.detail = { ...DETAIL, lines: DETAIL.lines.map((l) => ({ ...l, department: 'supply', project_id: 7 })) };
    try {
      draw('/scm/payment-vouchers/pv-9');
      await waitFor(() => expect(screen.getByText('Voucher project 7 (read-only)')).toBeTruthy());
      expect(screen.queryByRole('radiogroup', { name: 'Line 1 for' })).toBeNull();
    } finally {
      shown.detail = DETAIL;
    }
  });
});
