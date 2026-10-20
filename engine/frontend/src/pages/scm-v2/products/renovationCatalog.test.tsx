/* Renovation SKU Master components (spec 2026-10-09 section 3): chips, the
   group / sub-category picker, New SKU, the status badge, the SKU drawer, the
   photo gallery on a SKU, the first-binding-is-main default and the six badges. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { MfgProductRow } from '../../../vendor/scm/lib/mfg-products-queries';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  patch: vi.fn(),
  bind: vi.fn(),
  rows: [] as unknown[],
  fetched: [] as string[],
  posted: [] as Array<{ path: string; file: File | null }>,
  heicFails: false,
  catalog: null as unknown,
}));

vi.mock('../../../vendor/scm/lib/mfg-products-queries', async (orig) => ({
  ...(await orig<typeof import('../../../vendor/scm/lib/mfg-products-queries')>()),
  useCreateMfgProduct: () => ({ mutate: h.create, isPending: false }),
  useUpdateMfgProductCatalog: () => ({ mutate: h.patch, isPending: false }),
  useRenovationSkus: () => ({ data: h.rows, isLoading: false, error: null }),
}));
vi.mock('../../../vendor/scm/lib/suppliers-queries', () => ({
  useSuppliers: () => ({ isLoading: false, data: [{ id: 'sup-1', code: 'S1', name: 'Ah Seng Renovation' }] }),
  useCreateBinding: () => ({ mutate: h.bind, isPending: false }),
}));
vi.mock('../../../vendor/scm/lib/authed-fetch', async (orig) => ({
  ...(await orig<typeof import('../../../vendor/scm/lib/authed-fetch')>()),
  authedFetch: async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const fd = init.body as FormData;
      h.posted.push({ path, file: (fd.get('file') as File | null) ?? null });
      return { photo: {} };
    }
    if (path === '/renovation-catalog' && h.catalog) return h.catalog;
    h.fetched.push(path);
    return { photos: [] };
  },
}));
vi.mock('../../../lib/heicToJpeg', async (orig) => {
  const actual = await orig<typeof import('../../../lib/heicToJpeg')>();
  return {
    ...actual,
    toUploadableImage: async (f: File) => {
      if (!actual.isHeicFile(f)) return f;
      if (h.heicFails) throw new actual.HeicConversionError(f.name);
      return new File(['jpeg'], f.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
    },
  };
});

import { CatalogChips } from './CatalogChips';
import { CatalogCategoryPicker } from './CatalogCategoryPicker';
import { RenovationNewSku } from './RenovationNewSku';
import { RenovationSkuMaster } from './RenovationSkuMaster';
import { RenovationUomSettings } from './RenovationUomSettings';
import { ConfirmProvider } from '../../../vendor/scm/components/ConfirmDialog';
import { SkuStatusBadge } from './renovationSkuColumns';
import { AddSupplierBinding } from '../AddSupplierBinding';
import { PhotoGallery } from '../../../components/scm-v2/PhotoGallery';
import { badgeFor } from '../../../vendor/scm/lib/category-badges';
import { NotifyProvider } from '../../../vendor/scm/components/NotifyDialog';
import { SUB_CATEGORIES, UOMS, type CatalogGroup } from '../../../vendor/shared/renovation-catalog';

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NotifyProvider>{ui}</NotifyProvider>
    </QueryClientProvider>,
  );

const sku = (over: Partial<MfgProductRow>): MfgProductRow => ({
  id: 'p1', code: 'X', name: 'X', category: 'WORKS', base_price_sen: null, price1_sen: null,
  status: 'ACTIVE', unit_m3_milli: 0, ...over,
});

beforeEach(() => { h.create.mockReset(); h.patch.mockReset(); h.bind.mockReset(); h.fetched = []; h.rows = []; h.catalog = null; });

describe('CatalogChips', () => {
  function Harness() {
    const [g, setG] = useState<CatalogGroup | null>(null);
    const [s, setS] = useState<string | null>(null);
    return (<><CatalogChips group={g} sub={s} onGroup={setG} onSub={setS} /><output>{`${g}|${s}`}</output></>);
  }
  test('shows the seven groups; a group shows its own sub-categories; picking a new group clears the sub', () => {
    wrap(<Harness />);
    const groups = within(screen.getByRole('group', { name: 'Category group' })).getAllByRole('button');
    expect(groups.map((b) => b.textContent)).toEqual(['All', 'Works', 'Built-in', 'Furniture', 'Lighting', 'Appliances', 'Soft furnishing', 'Service']);
    expect(screen.queryByRole('group', { name: 'Sub-category' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Works' }));
    const subs = within(screen.getByRole('group', { name: 'Sub-category' })).getAllByRole('button').map((b) => b.textContent);
    expect(subs.slice(1, 4)).toEqual(['Protection', 'Hacking', 'Plumbing']);
    fireEvent.click(screen.getByRole('button', { name: 'Electrical' }));
    expect(screen.getByText('WORKS|ELECTRICAL')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lighting' }));
    expect(screen.getByText('LIGHTING|null')).toBeTruthy();
  });
});

describe('CatalogCategoryPicker', () => {
  test('changing the group drops a sub-category that does not belong to it', () => {
    const onChange = vi.fn();
    wrap(<CatalogCategoryPicker group="WORKS" sub="ELECTRICAL" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Group *'), { target: { value: 'BUILTIN' } });
    expect(onChange).toHaveBeenCalledWith({ group: 'BUILTIN', sub: null });
  });
  test('says nothing about photos: they are optional', () => {
    wrap(<CatalogCategoryPicker group="APPLIANCE" sub={null} onChange={() => {}} />);
    expect(screen.queryByText(/photo/i)).toBeNull();
  });
  test('offers the saved list: an added sub-category shows, a hidden one only on the SKU that has it', async () => {
    h.catalog = {
      canEdit: true,
      subCategories: [
        { group: 'SERVICE', code: 'DELIVERY', label: 'Delivery', sort: 10, active: true },
        { group: 'SERVICE', code: 'STYLING', label: 'Styling', sort: 20, active: false },
        { group: 'SERVICE', code: 'CURTAIN_INSTALL', label: 'Curtain install', sort: 50, active: true },
      ],
    };
    const options = () => Array.from((screen.getByLabelText('Sub-category *') as HTMLSelectElement).options).map((o) => o.textContent);
    const a = wrap(<CatalogCategoryPicker group="SERVICE" sub={null} onChange={() => {}} />);
    expect(await screen.findByRole('option', { name: 'Curtain install' })).toBeTruthy();
    expect(options()).toEqual(['Choose…', 'Delivery', 'Curtain install']);
    a.unmount();
    wrap(<CatalogCategoryPicker group="SERVICE" sub="STYLING" onChange={() => {}} />);
    await screen.findByRole('option', { name: 'Curtain install' });
    expect(options()).toEqual(['Choose…', 'Delivery', 'Styling', 'Curtain install']);
  });
});

describe('RenovationNewSku', () => {
  test('creates a Works SKU with its trade and the trade\'s unit', () => {
    wrap(<RenovationNewSku initialGroup="WORKS" initialSub={null} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'EL-PT' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lighting point' } });
    fireEvent.change(screen.getByLabelText('Trade *'), { target: { value: 'ELECTRICAL' } });
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('POINT');
    fireEvent.click(screen.getByText('Create SKU'));
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0]).toMatchObject({ code: 'EL-PT', name: 'Lighting point', category: 'WORKS', subCategory: 'ELECTRICAL', uom: 'POINT' });
  });
  test('refuses without a sub-category and says why', () => {
    wrap(<RenovationNewSku initialGroup="BUILTIN" initialSub={null} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'KC-1' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByText('Create SKU'));
    expect(h.create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/sub-category/);
  });
});

describe('status badge', () => {
  test('a SKU with no photo reads Active or Inactive, never Needs photo', () => {
    const a = render(<SkuStatusBadge row={sku({ category: 'BUILTIN', status: 'INACTIVE', photoCount: 0 })} />);
    expect(screen.getByText('Inactive')).toBeTruthy();
    expect(screen.queryByText('Needs photo')).toBeNull();
    a.unmount();
    render(<SkuStatusBadge row={sku({ category: 'FURNITURE', status: 'ACTIVE', photoCount: 0 })} />);
    expect(screen.getByText('Active')).toBeTruthy();
  });
});

describe('RenovationSkuMaster', () => {
  test('lists SKUs with no photo warning, and the drawer activates through PATCH', () => {
    h.rows = [
      sku({ id: 'a', code: 'HK-1', name: 'Hacking', category: 'WORKS', category_group: 'WORKS', sub_category: 'HACKING', uom: 'LOT', mainSupplierName: 'Ah Seng Renovation', supplierCount: 1 }),
      sku({ id: 'b', code: 'WR-1', name: 'Wardrobe', category: 'BUILTIN', category_group: 'BUILTIN', sub_category: 'WARDROBE', status: 'INACTIVE', photoCount: 0 }),
    ];
    wrap(<RenovationSkuMaster onImport={() => {}} onOpenSuppliers={() => {}} />);
    expect(screen.getByText(/2 SKUs/)).toBeTruthy();
    expect(screen.queryByText(/need a photo/)).toBeNull();
    expect(screen.queryByText('Needs photo')).toBeNull();
    expect(screen.getAllByText('Ah Seng Renovation').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText('WR-1')[0]);
    const drawer = screen.getByRole('dialog', { name: 'SKU WR-1' });
    expect(within(drawer).queryByText(/Add a photo to make this SKU active/)).toBeNull();
    fireEvent.click(within(drawer).getByText('Make active'));
    expect(h.patch.mock.calls[0][0]).toEqual({ id: 'b', status: 'ACTIVE' });
  });

  test('moving a SKU to another sub-category sends the pair', () => {
    h.rows = [sku({ id: 'a', code: 'HK-1', category: 'WORKS', category_group: 'WORKS', sub_category: 'HACKING', uom: 'LOT' })];
    wrap(<RenovationSkuMaster onImport={() => {}} onOpenSuppliers={() => {}} />);
    fireEvent.click(screen.getAllByText('HK-1')[0]);
    const drawer = screen.getByRole('dialog', { name: 'SKU HK-1' });
    fireEvent.change(within(drawer).getByLabelText('Trade *'), { target: { value: 'PLUMBING' } });
    fireEvent.click(within(drawer).getByText('Save'));
    expect(h.patch.mock.calls[0][0]).toEqual({ id: 'a', category: 'WORKS', subCategory: 'PLUMBING' });
  });
});

describe('PhotoGallery on a SKU', () => {
  test('reads the SKU photo endpoint, not the model one', async () => {
    wrap(<PhotoGallery productId="p-9" productName="TV 55" />);
    await screen.findByText(/Gallery/);
    expect(h.fetched).toContain('/mfg-products/p-9/photos');
  });
  test('an iPhone HEIC photo is offered, converted and uploaded as JPEG; one that cannot convert shows why', async () => {
    const { container } = wrap(<PhotoGallery productId="p-9" productName="TV 55" />);
    await screen.findByText(/Gallery/);
    const input = await vi.waitFor(() => {
      const el = container.querySelector('input[type="file"][multiple]') as HTMLInputElement | null;
      if (!el) throw new Error('upload input not rendered yet');
      return el;
    });
    expect(input.accept).toContain('.heic');
    fireEvent.change(input, { target: { files: [new File(['heic'], 'IMG_0001.HEIC', { type: '' })] } });
    await vi.waitFor(() => expect(h.posted).toHaveLength(1));
    expect(h.posted[0]!.path).toBe('/mfg-products/p-9/photos');
    expect(h.posted[0]!.file).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg' });
    h.heicFails = true;
    fireEvent.change(input, { target: { files: [new File(['heic'], 'IMG_0002.HEIC', { type: 'image/heic' })] } });
    expect(await screen.findByText(/IMG_0002\.HEIC .*Most Compatible/)).toBeTruthy();
    expect(h.posted).toHaveLength(1);
    h.heicFails = false;
  });
});

describe('AddSupplierBinding — first supplier', () => {
  test('defaults to main when the SKU has no supplier yet', () => {
    wrap(<AddSupplierBinding productCode="HK-1" productName="Hacking" hasBindings={false} />);
    fireEvent.click(screen.getByText('+ Add supplier binding'));
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'sup-1' } });
    fireEvent.click(screen.getByText('Add'));
    expect(h.bind.mock.calls[0][0]).toMatchObject({ isMainSupplier: true });
  });
  test('stays secondary by default once the SKU has a supplier', () => {
    wrap(<AddSupplierBinding productCode="HK-1" productName="Hacking" hasBindings />);
    fireEvent.click(screen.getByText('+ Add supplier binding'));
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'sup-1' } });
    fireEvent.click(screen.getByText('Add'));
    expect(h.bind.mock.calls[0][0]).toMatchObject({ isMainSupplier: false });
  });
});

describe('badges for the six groups', () => {
  test('each renovation group has its own label, not OTHERS', () => {
    expect(['works', 'builtin', 'furniture', 'lighting', 'appliance', 'soft'].map((g) => badgeFor(g).label)).toEqual([
      'WORKS', 'BUILT-IN', 'FURNITURE', 'LIGHTING', 'APPLIANCES', 'SOFT FURNISHING',
    ]);
  });
});

describe('units from SKU Master > Units', () => {
  const savedUnits = () => [
    ...UOMS.map((u, i) => ({ ...u, builtin: true, sort: (i + 1) * 10, active: u.code !== 'POINT' })),
    { code: 'BOX', label: 'Box', printLabel: 'BOX', measure: false, builtin: false, sort: 90, active: true },
  ];

  test('the unit picker offers an added unit and drops a hidden one, except on the SKU that has it', async () => {
    h.catalog = { subCategories: SUB_CATEGORIES, uoms: savedUnits(), canEdit: true };
    wrap(<RenovationNewSku initialGroup="WORKS" initialSub={null} onClose={() => {}} onCreated={() => {}} />);
    await screen.findByRole('option', { name: 'Box (BOX)' });
    expect(screen.queryByRole('option', { name: /Point/ })).toBeNull();
    // Electrical defaults to POINT, which is hidden here, so a new SKU starts on UNIT.
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'EL-2' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Switch point' } });
    fireEvent.change(screen.getByLabelText('Trade *'), { target: { value: 'ELECTRICAL' } });
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('UNIT');
    fireEvent.click(screen.getByText('Create SKU'));
    expect(h.create.mock.calls[0][0]).toMatchObject({ subCategory: 'ELECTRICAL', uom: 'UNIT' });

    h.rows = [sku({ id: 'a', code: 'EL-1', category: 'WORKS', category_group: 'WORKS', sub_category: 'ELECTRICAL', uom: 'POINT' })];
    wrap(<RenovationSkuMaster onImport={() => {}} onOpenSuppliers={() => {}} />);
    fireEvent.click(screen.getAllByText('EL-1')[0]);
    const drawer = screen.getByRole('dialog', { name: 'SKU EL-1' });
    expect(await within(drawer).findByRole('option', { name: 'Point (POINT) - hidden' })).toBeTruthy();
  });

  test('the Units panel: built-in units hide but do not delete, UNIT and FT stay shown, an added unit deletes', async () => {
    h.catalog = { subCategories: SUB_CATEGORIES, uoms: savedUnits(), canEdit: true };
    wrap(<ConfirmProvider><RenovationUomSettings onClose={() => {}} /></ConfirmProvider>);
    const panel = await screen.findByRole('dialog', { name: 'Units' });
    await within(panel).findByLabelText('Delete Box');
    expect((within(panel).getByLabelText('Delete Box') as HTMLButtonElement).disabled).toBe(false);
    expect((within(panel).getByLabelText('Delete Lump sum') as HTMLButtonElement).disabled).toBe(true);
    expect((within(panel).getByLabelText('Hide Unit') as HTMLButtonElement).disabled).toBe(true);
    expect((within(panel).getByLabelText('Hide Feet (run)') as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByLabelText('Show Point')).toBeTruthy();
    expect(within(panel).getAllByText('Measured')).toHaveLength(2);

    const add = within(panel).getByRole('button', { name: /Add unit/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(within(panel).getByLabelText('New unit name'), { target: { value: 'Metre' } });
    fireEvent.change(within(panel).getByLabelText('New unit short code'), { target: { value: 'm-1' } });
    expect((within(panel).getByLabelText('New unit short code') as HTMLInputElement).value).toBe('M1');
    expect(add.disabled).toBe(false);
  });
});
