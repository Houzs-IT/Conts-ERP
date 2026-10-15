/* Sub-category settings (Products > SKU Master > Sub-categories): what can be
 * added, renamed and hidden, and what stays fixed (the Works trades, the rows
 * old Houzs categories map through, the last shown one of a group). */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';

import { fakeSb } from '../lib/fake-postgrest';
import type { Env, Variables } from '../env';

const sub = (group_code: string, code: string, label: string, sort_order: number, legacy: string[] = [], active = true) =>
  ({ group_code, code, label, sort_order, legacy_categories: legacy, active });

const sb = fakeSb({
  product_category_groups: [{ code: 'WORKS', label: 'Works', sort_order: 10 }, { code: 'SERVICE', label: 'Service', sort_order: 70 }],
  product_sub_categories: [
    sub('WORKS', 'HACKING', 'Hacking', 20),
    sub('FURNITURE', 'SOFA', 'Sofa', 10, ['SOFA']),
    sub('SERVICE', 'DELIVERY', 'Delivery', 10),
    sub('SERVICE', 'STYLING', 'Styling', 20),
  ],
});

vi.mock('../middleware/auth', () => ({ supabaseAuth: async (_c: unknown, next: () => Promise<void>) => next() }));

const CALLER = { id: '7', email: 'a@conts.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' } as unknown as User;

const { renovationCatalogSettings, loadSubCategories } = await import('./renovation-catalog-settings');
const { validateCategoryPair, parseSubCategory } = await import('../shared/renovation-catalog');

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
    expect(added).toMatchObject({ group: 'SERVICE', label: 'Curtain install', sort: 30, active: true });
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
    const last = await send('PATCH', '/sub-categories/DELIVERY', { active: false });
    expect(await last.json()).toMatchObject({ error: 'last_one' });
  });

  it('needs permission to edit products', async () => {
    expect((await send('POST', '/sub-categories', { group: 'SERVICE', label: 'Photoshoot' }, [])).status).toBe(403);
    const r = await app([]).request('/');
    expect(await r.json()).toMatchObject({ canEdit: false });
  });
});
