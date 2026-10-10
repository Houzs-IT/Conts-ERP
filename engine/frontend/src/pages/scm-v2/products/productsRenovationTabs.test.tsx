/* The Products page with the Conts renovation switch on: only SKU Master,
   Maintenance, Combo Pricing and Variants; a hidden ?tab lands on the
   renovation SKU Master; the Fabrics maintenance list is gone. */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../../vendor/scm/lib/mfg-products-queries', async (orig) => ({
  ...(await orig<typeof import('../../../vendor/scm/lib/mfg-products-queries')>()),
  useRenovationSkus: () => ({ data: [], isLoading: false, error: null }),
  useMaintenanceConfig: () => ({ data: { data: {} }, isLoading: false }),
  useMaintenanceConfigHistory: () => ({ data: [], isLoading: false }),
  useSpecialAddons: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../../vendor/scm/lib/product-models-queries', async (orig) => ({
  ...(await orig<typeof import('../../../vendor/scm/lib/product-models-queries')>()),
  useBrandingPool: () => ({ pool: [], distinct: [] }),
}));

import { Products } from '../Products';
import { NotifyProvider } from '../../../vendor/scm/components/NotifyDialog';
import { ConfirmProvider } from '../../../vendor/scm/components/ConfirmDialog';
import { PromptProvider } from '../../../vendor/scm/components/PromptDialog';

const open = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
      <NotifyProvider><ConfirmProvider><PromptProvider><MemoryRouter initialEntries={[url]}><Products /></MemoryRouter></PromptProvider></ConfirmProvider></NotifyProvider>
    </QueryClientProvider>,
  );

describe('Products page, Conts renovation catalog', () => {
  test('shows only SKU Master, Maintenance, Combo Pricing and Variants', () => {
    open('/scm/products');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['SKU Master', 'Maintenance', 'Combo Pricing', 'Variants']);
  });

  test('a hidden tab in the URL opens the renovation SKU Master', () => {
    open('/scm/products?tab=fabric');
    expect(screen.getByRole('tab', { name: 'SKU Master' }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('group', { name: 'Category group' })).toBeTruthy();
    expect(screen.getByText('New SKU')).toBeTruthy();
  });

  test('the Fabrics maintenance list is hidden', () => {
    open('/scm/products?tab=maintenance');
    expect(screen.queryByText('Fabrics')).toBeNull();
    expect(screen.queryByText('Common')).toBeNull();
    expect(screen.getAllByText('Brandings').length).toBeGreaterThan(0);
  });
});
