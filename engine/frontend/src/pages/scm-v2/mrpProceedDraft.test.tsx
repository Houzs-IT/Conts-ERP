/* MRP Proceed PO can save the POs as drafts (owner 2026-11-27: "我的PO 要可以开draft").
 * The confirm dialog offers "Save as Draft" beside Confirm; only the draft path
 * sends asDraft, so Confirm keeps creating sent POs. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MrpResponse, MrpSku } from '../../vendor/scm/lib/mrp-queries';

const sku = (itemCode: string, shortage: number): MrpSku => ({
  warehouseId: null, warehouseCode: null, warehouseName: null,
  itemCode, variantKey: '', variantLabel: null,
  description: `${itemCode} mattress`, category: 'MATTRESS',
  qtyNeeded: 2, stock: 2 - shortage, poOutstanding: 0, shortage,
  mainSupplierCode: null, mainSupplierName: null, suppliers: [],
  lines: [{
    soItemId: `si-${itemCode}`, soDocNo: `SO-${itemCode}`, lineNo: 1, createdAt: null,
    debtorName: 'CUST', customerState: null, soDate: '2026-09-01',
    deliveryDate: '2026-10-01', processingDate: null, orderByDate: null,
    qty: 2, source: 'shortage', poNumber: null, poEta: null,
    shortageQty: shortage, poSupplierId: null, poSupplierName: null,
  }],
});

const mrpData: MrpResponse = {
  asOf: '2026-11-27T00:00:00Z',
  categories: ['MATTRESS'], warehouses: [], sofaSets: [],
  skus: [sku('MT-SHORT', 2)],
  undated: { lines: 0, shortageUnits: 0, sofaSets: 0, sofaShortageUnits: 0, hidden: true },
  totals: { skuCount: 1, shortageSkuCount: 1, shortageUnits: 2, sofaSetCount: 0, sofaSetShortageCount: 0 },
};

const createPos = vi.fn(async (_body: Record<string, unknown>) => ({ created: [{ poNumber: 'PO-0001' }] }));

vi.mock('../../vendor/scm/lib/renovation-catalog-queries', () => ({ useRenovationCatalog: () => ({ query: { data: undefined }, groups: [] }) }));
vi.mock('../../vendor/scm/lib/mrp-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../vendor/scm/lib/mrp-queries')>()),
  useMrp: () => ({ data: mrpData, isLoading: false, isError: false, error: null, refetch: () => {} }),
  useCategoryLeadTimes: () => ({ data: { leadTimes: {} }, isLoading: false }),
  useUpdateCategoryLeadTime: () => ({ mutate: () => {}, isPending: false }),
  useRegenerateMrp: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock('../../vendor/scm/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }),
  isAdminLevel: () => true,
}));
vi.mock('../../vendor/scm/lib/suppliers-queries', () => ({
  useSuppliers: () => ({ data: [] }),
  useCreateBinding: () => ({ mutateAsync: async () => ({}), isPending: false }),
  useCreatePosFromSoItems: () => ({ mutate: () => {}, mutateAsync: createPos, isPending: false }),
}));

import { Mrp } from './Mrp';

const openProceedDialog = () => {
  render(<MemoryRouter><Mrp /></MemoryRouter>);
  const tab = screen.queryByRole('tab', { name: /mattress/i });
  if (tab) fireEvent.click(tab);
  const row = screen.getByText('MT-SHORT').closest('tr[data-vrow]') as HTMLElement;
  fireEvent.click(within(row).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /^Proceed PO/ }));
  return screen.getByRole('heading', { name: 'Proceed PO' }).parentElement as HTMLElement;
};

beforeEach(() => { createPos.mockClear(); });

describe('MRP Proceed PO draft', () => {
  test('Save as Draft sends asDraft and reports a draft PO', async () => {
    const dialog = openProceedDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as Draft' }));
    await waitFor(() => expect(createPos).toHaveBeenCalledTimes(1));
    expect(createPos.mock.calls[0]![0]).toMatchObject({ asDraft: true, fromMrp: true });
    expect(await screen.findByText('Saved 1 draft PO')).toBeTruthy();
  });

  test('Confirm creates a normal PO without asDraft', async () => {
    const dialog = openProceedDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Confirm/ }));
    await waitFor(() => expect(createPos).toHaveBeenCalledTimes(1));
    expect(createPos.mock.calls[0]![0]).not.toHaveProperty('asDraft');
    expect(await screen.findByText('Successfully created 1 PO')).toBeTruthy();
  });
});
