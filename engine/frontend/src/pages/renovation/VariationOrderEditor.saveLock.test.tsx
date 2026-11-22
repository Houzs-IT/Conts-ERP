// D21 (save-integrity, 22 Nov 2026): while a VO saves, its fields are shut, so nothing typed during the save is
// replaced by the server's copy when it lands.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('../../lib/renovation/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/renovation/api')>();
  const vo = {
    id: 'vo-1', voNo: 'TC-VO-001', soDocNo: 'TC-SO-1', seq: 1, status: 'DRAFT', title: 'Wall skim', docDate: '2026-11-22', version: 3,
    signedName: null, signedAt: null, approvedAt: null, approvedBy: null, amendmentId: null, sections: [], totals: { addSen: 0, omitSen: 0, netSen: 0 },
  };
  return {
    ...real,
    useVo: () => ({ data: vo, isLoading: false, isFetching: false, error: null }),
    useContract: () => ({ data: { sections: [], header: { brandId: null, customerName: 'A' }, totals: { revisedContractSen: 0 }, debtorName: 'A' } }),
    useBrands: () => ({ data: { brands: [] } }),
    renoSend: send,
  };
});
vi.mock('./DocEditor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./DocEditor')>()),
  DocEditor: () => null,
}));
vi.mock('../../components/doc-attachments/DocAttachments', () => ({ DocAttachments: () => null }));
vi.mock('../scm-v2/renovationQuotationPrint', () => ({ QuotationSoPrint: () => null }));
vi.mock('../../lib/renovation/renovationPackagesApi', () => ({ usePackages: () => ({ data: { packages: [] } }) }));
vi.mock('../../lib/renovation/renovationFormDraft', () => ({ useRenovationDraft: () => ({ offered: null, stale: false, clear: vi.fn(), answer: vi.fn() }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

import { VariationOrderEditor } from './VariationOrderEditor';

describe('VO editor save', () => {
  it('shuts the fields while the save is in flight', async () => {
    let finish!: (v: unknown) => void;
    send.mockImplementation(() => new Promise((ok) => { finish = ok; }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/vo/vo-1']}>
          <Routes><Route path="/vo/:id" element={<VariationOrderEditor />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const title = await screen.findByPlaceholderText('e.g. Add wall skim, drop study table');
    fireEvent.change(title, { target: { value: 'Wall skim and study table' } });
    expect((title as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((title as HTMLInputElement).disabled).toBe(true);
    finish({});
    await waitFor(() => expect((title as HTMLInputElement).disabled).toBe(false));
  });
});
