import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/react-query', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../vendor/scm/lib/mfg-products-queries', () => ({
  useCreateMfgProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../vendor/scm/components/NotifyDialog', () => ({ useNotify: () => vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn() }) }));

import { RawMaterialAddPanel, type RawSku } from './RawMaterialAddPanel';

const RAW_SKUS: RawSku[] = [
  { code: 'PTN-KNK-002', name: 'Indogyps Gypsum Board 4x6 9mm', uom: 'PCS', suppliers: [{ code: '400-K003', name: 'K & K GYPSUM MARKETING SDN BHD' }, { code: '400-B001', name: 'BUILT-IN WORKS SDN BHD' }] },
  { code: 'DOR-KNK-001', name: 'Plywood Normal Full Door', uom: 'NOS', suppliers: [{ code: '400-D010', name: 'DOOR HOUSE' }] },
  { code: 'GLU-001', name: 'Wood glue', uom: 'BTL', suppliers: [] },
];

const renderPanel = () => render(<RawMaterialAddPanel skus={RAW_SKUS} onAdd={vi.fn(() => Promise.resolve())} />);
const offeredCodes = () => screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'));

describe('RawMaterialAddPanel supplier', () => {
  it('shows the main supplier, how many others, and No supplier when unbound', () => {
    renderPanel();
    expect(screen.getAllByText('K & K GYPSUM MARKETING SDN BHD +1 more').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DOOR HOUSE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No supplier').length).toBeGreaterThan(0);
  });

  it('finds raw materials by supplier name or code, including a non-main supplier', () => {
    renderPanel();
    const search = screen.getByLabelText('Search raw materials');
    fireEvent.change(search, { target: { value: 'k & k gypsum' } });
    expect(offeredCodes()).toEqual(['PTN-KNK-002 · Indogyps Gypsum Board 4x6 9mm']);
    fireEvent.change(search, { target: { value: '400-D010' } });
    expect(offeredCodes()).toEqual(['DOR-KNK-001 · Plywood Normal Full Door']);
    fireEvent.change(search, { target: { value: 'built-in works' } });
    expect(offeredCodes()).toEqual(['PTN-KNK-002 · Indogyps Gypsum Board 4x6 9mm']);
  });
});
