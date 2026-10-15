// ----------------------------------------------------------------------------
// /api/scm/renovation-catalog — the renovation catalog's sub-categories, edited
// from Products > SKU Master > Sub-categories (Conts, 2026-10-15).
//
// Reads the two tables of migration 0061. Groups are read-only: each is a value
// of the product category enum and carries a project stage and photo rule, so a
// group change is a migration. Sub-categories can be added, renamed, reordered
// and hidden, never deleted: SKUs, PO/GRN lines and procurement dates store the
// code. WORKS sub-categories are the site trades and stay fixed too
// (FIXED_SUB_GROUPS). The list is shared by every company, like the table.
// Writes need the same permission as editing a SKU (canWriteScmConfig).
// ----------------------------------------------------------------------------
import { Hono, type Context } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { canWriteScmConfig } from '../lib/houzs-perms';
import type { Env, Variables } from '../env';
import {
  CATALOG_GROUPS,
  FIXED_SUB_GROUPS,
  isCatalogGroup,
  subCategoryCodeOf,
  type CatalogGroup,
  type SubCategoryDef,
} from '../shared/renovation-catalog';

type C = Context<{ Bindings: Env; Variables: Variables }>;
type Sb = Variables['supabase'];

type SubRow = { group_code: string; code: string; label: string; sort_order: number; legacy_categories: string[] | null; active: boolean };

const toDef = (r: SubRow): SubCategoryDef => ({
  group: r.group_code as CatalogGroup,
  code: r.code,
  label: r.label,
  sort: r.sort_order,
  legacy: r.legacy_categories ?? [],
  active: r.active,
});

/** Every sub-category in the database, hidden ones included (a SKU may still carry one). */
export async function loadSubCategories(sb: Sb): Promise<SubCategoryDef[]> {
  const { data, error } = await sb
    .from('product_sub_categories')
    .select('group_code, code, label, sort_order, legacy_categories, active')
    .order('group_code')
    .order('sort_order');
  if (error) throw new Error(`sub-categories could not be read: ${error.message}`);
  return ((data ?? []) as SubRow[]).map(toDef);
}

export const renovationCatalogSettings = new Hono<{ Bindings: Env; Variables: Variables }>();
renovationCatalogSettings.use('*', supabaseAuth);

const refuse = (c: C, status: 400 | 403 | 404 | 409, error: string, message: string) => c.json({ error, message }, status);

async function body(c: C): Promise<Record<string, unknown> | null> {
  try { return (await c.req.json()) as Record<string, unknown>; } catch { return null; }
}

const cleanLabel = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return s && s.length <= 60 ? s : null;
};

renovationCatalogSettings.get('/', async (c) => {
  const sb = c.get('supabase');
  const { data: groups, error } = await sb.from('product_category_groups').select('code, label, sort_order').order('sort_order');
  if (error) return c.json({ error: 'load_failed', message: error.message }, 500);
  try {
    return c.json({ groups: groups ?? [], subCategories: await loadSubCategories(sb), canEdit: canWriteScmConfig(c) });
  } catch (e) {
    return c.json({ error: 'load_failed', message: (e as Error).message }, 500);
  }
});

renovationCatalogSettings.post('/sub-categories', async (c) => {
  if (!canWriteScmConfig(c)) return refuse(c, 403, 'forbidden', 'You cannot change the catalog.');
  const b = await body(c);
  if (!b) return refuse(c, 400, 'invalid_json', 'The request body is not valid JSON.');
  const group = String(b.group ?? '').toUpperCase();
  if (!isCatalogGroup(group)) return refuse(c, 400, 'invalid_group', 'Pick a group.');
  if (FIXED_SUB_GROUPS.includes(group)) return refuse(c, 400, 'group_fixed', 'Works trades follow the site stage order and cannot be changed here.');
  const label = cleanLabel(b.label);
  if (!label) return refuse(c, 400, 'invalid_label', 'Type a name of up to 60 characters.');
  const code = subCategoryCodeOf(label);
  if (code.length < 2 || !/^[A-Z]/.test(code)) return refuse(c, 400, 'invalid_label', 'The name needs to start with a letter.');
  /* A code that is also a category (SOFA, SERVICE, ...) would read as a legacy category on import. */
  if ((CATALOG_GROUPS as readonly string[]).includes(code)) return refuse(c, 409, 'code_taken', `"${label}" is already a group name.`);

  const sb = c.get('supabase');
  let all: SubCategoryDef[];
  try { all = await loadSubCategories(sb); } catch (e) { return c.json({ error: 'load_failed', message: (e as Error).message }, 500); }
  const lower = label.toLowerCase();
  const clash = all.find((s) => s.code === code || s.legacy?.includes(code) || (s.group === group && s.label.toLowerCase() === lower));
  if (clash) {
    return refuse(c, 409, 'code_taken', clash.active === false
      ? `"${clash.label}" already exists but is hidden. Show it instead.`
      : `"${clash.label}" already exists${clash.group === group ? '' : ' in another group'}.`);
  }
  const sort = Math.max(0, ...all.filter((s) => s.group === group).map((s) => s.sort)) + 10;
  const { error } = await sb.from('product_sub_categories').insert({ group_code: group, code, label, sort_order: sort, active: true });
  if (error) {
    if (error.code === '23505') return refuse(c, 409, 'code_taken', `"${label}" already exists.`);
    return c.json({ error: 'save_failed', message: error.message }, 500);
  }
  return c.json({ ok: true, code }, 201);
});

renovationCatalogSettings.patch('/sub-categories/:code', async (c) => {
  if (!canWriteScmConfig(c)) return refuse(c, 403, 'forbidden', 'You cannot change the catalog.');
  const b = await body(c);
  if (!b) return refuse(c, 400, 'invalid_json', 'The request body is not valid JSON.');
  const code = String(c.req.param('code') ?? '').toUpperCase();
  const sb = c.get('supabase');
  let all: SubCategoryDef[];
  try { all = await loadSubCategories(sb); } catch (e) { return c.json({ error: 'load_failed', message: (e as Error).message }, 500); }
  const cur = all.find((s) => s.code === code);
  if (!cur) return refuse(c, 404, 'not_found', 'That sub-category does not exist.');
  if (FIXED_SUB_GROUPS.includes(cur.group)) return refuse(c, 400, 'group_fixed', 'Works trades follow the site stage order and cannot be changed here.');

  const patch: Record<string, unknown> = {};
  if (b.label !== undefined) {
    const label = cleanLabel(b.label);
    if (!label) return refuse(c, 400, 'invalid_label', 'Type a name of up to 60 characters.');
    const lower = label.toLowerCase();
    if (all.some((s) => s.code !== code && s.group === cur.group && s.label.toLowerCase() === lower)) {
      return refuse(c, 409, 'label_taken', `"${label}" already exists in this group.`);
    }
    patch.label = label;
  }
  if (b.sortOrder !== undefined) {
    const n = Number(b.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return refuse(c, 400, 'invalid_sort', 'The order must be a whole number.');
    patch.sort_order = n;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return refuse(c, 400, 'invalid_active', 'active must be true or false.');
    /* Old Houzs categories (SOFA, BEDLINES, ...) map to their sub-category through this row. */
    if (!b.active && (cur.legacy?.length ?? 0) > 0) {
      return refuse(c, 400, 'legacy_mapped', `"${cur.label}" holds the older ${cur.legacy!.join(', ')} SKUs and cannot be hidden.`);
    }
    if (!b.active && all.filter((s) => s.group === cur.group && s.active !== false && s.code !== code).length === 0) {
      return refuse(c, 400, 'last_one', 'A group needs at least one sub-category to pick.');
    }
    patch.active = b.active;
  }
  if (Object.keys(patch).length === 0) return refuse(c, 400, 'nothing_to_change', 'Nothing to change.');
  const { error } = await sb.from('product_sub_categories').update(patch).eq('code', code);
  if (error) return c.json({ error: 'save_failed', message: error.message }, 500);
  return c.json({ ok: true });
});
