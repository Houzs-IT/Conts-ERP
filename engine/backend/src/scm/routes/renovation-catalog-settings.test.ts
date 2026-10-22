/* Sub-category settings (Products > SKU Master > Sub-categories): what can be
 * added, renamed and hidden, and what stays fixed (the Works trades and the site-trade services, the rows
 * old Houzs categories map through, the last shown one of a group). */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';

import { fakeSb } from '../lib/fake-postgrest';
import type { Env, Variables } from '../env';

const sub = (group_code: string, code: string, label: string, sort_order: number, legacy: string[] = [], active = true) =>
  ({ group_code, code, label, sort_order, legacy_categories: legacy, active });

const uom = (code: string, label: string, print_label: string, measure: boolean, sort_order: number, builtin = true) =>
  ({ code, label, print_label, measure, builtin, sort_order, active: true });

const T: Record<string, Record<string, unknown>[]> = {
  product_category_groups: [{ code: 'WORKS', label: 'Works', sort_order: 10 }, { code: 'SERVICE', label: 'Service', sort_order: 70 }],
  product_sub_categories: [
    sub('WORKS', 'HACKING', 'Hacking', 20),
    sub('FURNITURE', 'SOFA', 'Sofa', 10, ['SOFA']),
    sub('SERVICE', 'DELIVERY', 'Delivery', 10),
    sub('SERVICE', 'STYLING', 'Styling', 20),
    sub('SERVICE', 'CLEANING', 'Cleaning', 60),
    sub('LIGHTING', 'DOWNLIGHT', 'Downlight', 10),
  ],
  product_uoms: [
    uom('UNIT', 'Unit', 'UNIT', false, 20),
    uom('LOT', 'Lump sum', 'LS', false, 40),
    uom('FT', 'Feet (run)', 'FT', true, 50),
    uom('SQFT', 'Square feet', 'SQFT', true, 60),
  ],
  mfg_products: [{ id: 'p1', code: 'TL-1', uom: 'SQFT' }],
  reno_doc_lines: [{ id: 'l1', uom: null, measure_uom: 'SQFT' }],
};
const sb = fakeSb(T as never);

vi.mock('../middleware/auth', () => ({ supabaseAuth: async (_c: unknown, next: () => Promise<void>) => next() }));

const CALLER = { id: '7', email: 'a@conts.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' } as unknown as User;

const { renovationCatalogSettings, loadSubCategories, loadUoms } = await import('./renovation-catalog-settings');
const { validateCategoryPair, parseSubCategory, isUom, parseUom, uomPrintLabel } = await import('../shared/renovation-catalog');

function app(perms: string[] = ['*']) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    c.set('user', CALLER);
    c.set('companyId', 1);
    c.set('supabase', sb as never);
    c.set('houzsUser' as never, { id: 9, name: 'Boss', permissions_set: new Set(perms), permissions: perms } as never);
    await next();
  });
  a.route('/', renovationCatalogSettings);
  return a;
}

const send = (method: string, path: string, body: unknown, perms?: string[]) =>
  app(perms).request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('sub-category settings', () => {
  it('adds a Service sub-category with a code from its name, after the last one', async () => {
    const r = await send('POST', '/sub-categories', { group: 'SERVICE', label: ' Curtain  install ' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ code: 'CURTAIN_INSTALL' });
    const added = (await loadSubCategories(sb as never)).find((s) => s.code === 'CURTAIN_INSTALL');
    expect(added).toMatchObject({ group: 'SERVICE', label: 'Curtain install', sort: 70, active: true });
  });

  it('the saved list is what a SKU save and an import check against', async () => {
    const list = await loadSubCategories(sb as never);
    expect(validateCategoryPair('SERVICE', 'CURTAIN_INSTALL', list)).toEqual({ ok: true });
    expect(validateCategoryPair('SERVICE', 'CURTAIN_INSTALL')).toEqual({ ok: false, error: 'sub_category_mismatch' });
    expect(parseSubCategory('curtain install', list)).toBe('CURTAIN_INSTALL');
  });

  it('refuses a name that already exists, and anything under Works', async () => {
    expect((await send('POST', '/sub-categories', { group: 'SERVICE', label: 'delivery' })).status).toBe(409);
    expect((await send('POST', '/sub-categories', { group: 'SERVICE', label: 'Sofa' })).status).toBe(409);
    expect((await send('POST', '/sub-categories', { group: 'WORKS', label: 'Roofing' })).status).toBe(400);
    expect((await send('PATCH', '/sub-categories/HACKING', { label: 'Demolition' })).status).toBe(400);
  });

  it('the site-trade services filed under Service (cleaning, aircon install, project management) stay fixed', async () => {
    const rename = await send('PATCH', '/sub-categories/CLEANING', { label: 'Deep clean' });
    expect(rename.status).toBe(400);
    expect(await rename.json()).toMatchObject({ error: 'group_fixed' });
    expect((await send('PATCH', '/sub-categories/CLEANING', { active: false })).status).toBe(400);
    const list = (await (await app().request('/')).json()) as { subCategories: Array<{ code: string }> };
    expect(list.subCategories.find((s) => s.code === 'CLEANING')).toMatchObject({ label: 'Cleaning', active: true });
  });

  it('renames and hides; a hidden one can be shown again', async () => {
    expect((await send('PATCH', '/sub-categories/STYLING', { label: 'Interior styling' })).status).toBe(200);
    expect((await send('PATCH', '/sub-categories/STYLING', { active: false })).status).toBe(200);
    const row = (await loadSubCategories(sb as never)).find((s) => s.code === 'STYLING');
    expect(row).toMatchObject({ label: 'Interior styling', active: false });
    expect((await send('PATCH', '/sub-categories/STYLING', { active: true })).status).toBe(200);
  });

  it('will not hide a row old Houzs categories map through, or the last shown one of a group', async () => {
    const legacy = await send('PATCH', '/sub-categories/SOFA', { active: false });
    expect(legacy.status).toBe(400);
    expect(await legacy.json()).toMatchObject({ error: 'legacy_mapped' });
    expect((await send('PATCH', '/sub-categories/STYLING', { active: false })).status).toBe(200);
    expect((await send('PATCH', '/sub-categories/CURTAIN_INSTALL', { active: false })).status).toBe(200);
    /* Service keeps Cleaning (fixed, always shown), so Delivery may go; Lighting's only one may not. */
    expect((await send('PATCH', '/sub-categories/DELIVERY', { active: false })).status).toBe(200);
    const last = await send('PATCH', '/sub-categories/DOWNLIGHT', { active: false });
    expect(await last.json()).toMatchObject({ error: 'last_one' });
  });

  it('needs permission to edit products', async () => {
    expect((await send('POST', '/sub-categories', { group: 'SERVICE', label: 'Photoshoot' }, [])).status).toBe(403);
    const r = await app([]).request('/');
    expect(await r.json()).toMatchObject({ canEdit: false });
  });
});

describe('unit settings', () => {
  it('adds a unit after the last one; its code is what prints', async () => {
    const r = await send('POST', '/uoms', { code: ' box ', label: 'Box' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ code: 'BOX' });
    expect((await send('POST', '/uoms', { code: 'm', label: 'Metre (run)', measure: true })).status).toBe(201);
    const list = await loadUoms(sb as never);
    expect(list.find((u) => u.code === 'BOX')).toMatchObject({ label: 'Box', printLabel: 'BOX', measure: false, builtin: false, sort: 70, active: true });
    expect(list.find((u) => u.code === 'M')).toMatchObject({ measure: true, sort: 80 });
  });

  it('the saved list is what a SKU save, an import and a document line check against', async () => {
    const list = await loadUoms(sb as never);
    expect(isUom('BOX', list)).toBe(true);
    expect(isUom('BOX')).toBe(false);
    expect(parseUom('box', list)).toBe('BOX');
    expect(uomPrintLabel('LOT', list)).toBe('LS');
    expect(GET_list(await (await app().request('/')).json())).toContain('BOX');
  });

  it('refuses a bad or taken code, a taken name, and changing the code or measure', async () => {
    expect((await send('POST', '/uoms', { code: '9X', label: 'Nine' })).status).toBe(400);
    expect((await send('POST', '/uoms', { code: 'TOOLONGCODE', label: 'Long' })).status).toBe(400);
    expect((await send('POST', '/uoms', { code: 'ls', label: 'Lump' })).status).toBe(409);
    expect((await send('POST', '/uoms', { code: 'BX', label: 'box' })).status).toBe(409);
    expect((await send('PATCH', '/uoms/BOX', { measure: true })).status).toBe(400);
    expect((await send('PATCH', '/uoms/BOX', { code: 'BX' })).status).toBe(400);
  });

  it('renames, hides and shows; the fallback units cannot be hidden', async () => {
    expect((await send('PATCH', '/uoms/BOX', { label: 'Carton box' })).status).toBe(200);
    expect((await send('PATCH', '/uoms/LOT', { active: false })).status).toBe(200);
    expect((await loadUoms(sb as never)).find((u) => u.code === 'LOT')).toMatchObject({ active: false });
    expect((await send('PATCH', '/uoms/LOT', { active: true })).status).toBe(200);
    for (const code of ['UNIT', 'FT']) {
      const r = await send('PATCH', `/uoms/${code}`, { active: false });
      expect(await r.json()).toMatchObject({ error: 'fallback_unit' });
    }
  });

  it('deletes an added unit nothing uses; a built-in or used one can only be hidden', async () => {
    expect(await (await send('DELETE', '/uoms/LOT', {})).json()).toMatchObject({ error: 'builtin_unit' });
    T.mfg_products.push({ id: 'p2', code: 'BX-1', uom: 'BOX' });
    const used = await send('DELETE', '/uoms/BOX', {});
    expect(used.status).toBe(409);
    expect(await used.json()).toMatchObject({ message: expect.stringMatching(/1 SKU/) });
    T.reno_doc_lines.push({ id: 'l2', uom: null, measure_uom: 'M' });
    expect(await (await send('DELETE', '/uoms/M', {})).json()).toMatchObject({ message: expect.stringMatching(/1 document line/) });
    T.reno_doc_lines.pop();
    expect((await send('DELETE', '/uoms/M', {})).status).toBe(200);
    expect((await loadUoms(sb as never)).some((u) => u.code === 'M')).toBe(false);
  });

  it('needs permission to edit products', async () => {
    expect((await send('POST', '/uoms', { code: 'ROLL', label: 'Roll' }, [])).status).toBe(403);
    expect((await send('DELETE', '/uoms/BOX', {}, [])).status).toBe(403);
  });
});

const GET_list = (j: { uoms: { code: string }[] }) => j.uoms.map((u) => u.code);
