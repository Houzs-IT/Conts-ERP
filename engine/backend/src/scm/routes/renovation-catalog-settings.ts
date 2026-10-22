// ----------------------------------------------------------------------------
// /api/scm/renovation-catalog — the renovation catalog's sub-categories, edited
// from Products > SKU Master > Sub-categories (Conts, 2026-10-15).
//
// Reads the two tables of migration 0061. Groups are read-only: each is a value
// of the product category enum and carries a project stage and photo rule, so a
// group change is a migration. Sub-categories can be added, renamed, reordered
// and hidden, never deleted: SKUs, PO/GRN lines and procurement dates store the
// code. WORKS sub-categories are the site trades and stay fixed too
// (FIXED_SUB_GROUPS), as do the site-trade services under SERVICE
// (isFixedSub). The list is shared by every company, like the table.
// Writes need the same permission as editing a SKU (canWriteScmConfig).
//
// Units (migration 0118) are edited here too. A unit's code is what prints and
// what an import sheet names, and its measure flag decides whether a line asks
// for a length or area, so both are fixed once added. The eight built-in units
// can be hidden but not deleted (code falls back to them); UNIT and FT, the
// fallbacks themselves, cannot be hidden. An added unit can be deleted while no
// SKU and no document line uses it.
// ----------------------------------------------------------------------------
import { Hono, type Context } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { canWriteScmConfig } from '../lib/houzs-perms';
import type { Env, Variables } from '../env';
import {
  CATALOG_GROUPS,
  FIXED_SUB_GROUPS,
  isCatalogGroup,
  isFixedSub,
  subCategoryCodeOf,
  type CatalogGroup,
  type SubCategoryDef,
  type UomDef,
} from '../shared/renovation-catalog';
import type { RenoDb } from '../lib/renovation-db';

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

type UomRow = { code: string; label: string; print_label: string; measure: boolean; builtin: boolean; sort_order: number; active: boolean };

const toUom = (r: UomRow): UomDef => ({
  code: r.code,
  label: r.label,
  printLabel: r.print_label,
  measure: r.measure,
  builtin: r.builtin,
  sort: r.sort_order,
  active: r.active,
});

const UOM_COLS = 'code, label, print_label, measure, builtin, sort_order, active';

/** Every unit in the database, hidden ones included (a SKU or line may still carry one). */
export async function loadUoms(sb: Sb): Promise<UomDef[]> {
  const { data, error } = await sb.from('product_uoms').select(UOM_COLS).order('sort_order');
  if (error) throw new Error(`units could not be read: ${error.message}`);
  return ((data ?? []) as UomRow[]).map(toUom);
}

/** The same list for the document routes, which talk SQL. */
export async function loadUomsSql(db: RenoDb): Promise<UomDef[]> {
  return (await db.q<UomRow>(`select ${UOM_COLS} from scm.product_uoms order by sort_order`)).map(toUom);
}

/* Code fallbacks: a SKU with no unit is UNIT, a measured line with no unit is FT. */
const UNHIDEABLE_UOMS = ['UNIT', 'FT'];

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
    const [subCategories, uoms] = await Promise.all([loadSubCategories(sb), loadUoms(sb)]);
    return c.json({ groups: groups ?? [], subCategories, uoms, canEdit: canWriteScmConfig(c) });
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
  if (isFixedSub(cur.group, cur.code)) return refuse(c, 400, 'group_fixed', 'Works trades follow the site stage order and cannot be changed here.');

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

const cleanUomCode = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z][A-Z0-9]{0,7}$/.test(s) ? s : null;
};

renovationCatalogSettings.post('/uoms', async (c) => {
  if (!canWriteScmConfig(c)) return refuse(c, 403, 'forbidden', 'You cannot change the catalog.');
  const b = await body(c);
  if (!b) return refuse(c, 400, 'invalid_json', 'The request body is not valid JSON.');
  const code = cleanUomCode(b.code);
  if (!code) return refuse(c, 400, 'invalid_code', 'The short code is 1 to 8 letters or digits and starts with a letter, e.g. M or BOX.');
  const label = cleanLabel(b.label);
  if (!label) return refuse(c, 400, 'invalid_label', 'Type a name of up to 60 characters.');
  if (b.measure !== undefined && typeof b.measure !== 'boolean') return refuse(c, 400, 'invalid_measure', 'measure must be true or false.');

  const sb = c.get('supabase');
  let all: UomDef[];
  try { all = await loadUoms(sb); } catch (e) { return c.json({ error: 'load_failed', message: (e as Error).message }, 500); }
  const lower = label.toLowerCase();
  const clash = all.find((u) => u.code === code || u.printLabel === code || u.label.toLowerCase() === lower);
  if (clash) {
    return refuse(c, 409, 'code_taken', clash.active === false
      ? `"${clash.label}" (${clash.printLabel}) already exists but is hidden. Show it instead.`
      : `"${clash.label}" (${clash.printLabel}) already exists.`);
  }
  const sort = Math.max(0, ...all.map((u) => u.sort ?? 0)) + 10;
  const { error } = await sb.from('product_uoms').insert({ code, label, print_label: code, measure: b.measure === true, builtin: false, sort_order: sort, active: true });
  if (error) {
    if (error.code === '23505') return refuse(c, 409, 'code_taken', `${code} already exists.`);
    return c.json({ error: 'save_failed', message: error.message }, 500);
  }
  return c.json({ ok: true, code }, 201);
});

renovationCatalogSettings.patch('/uoms/:code', async (c) => {
  if (!canWriteScmConfig(c)) return refuse(c, 403, 'forbidden', 'You cannot change the catalog.');
  const b = await body(c);
  if (!b) return refuse(c, 400, 'invalid_json', 'The request body is not valid JSON.');
  const code = String(c.req.param('code') ?? '').toUpperCase();
  if (b.code !== undefined || b.measure !== undefined || b.printLabel !== undefined) {
    return refuse(c, 400, 'fixed_field', 'The short code and whether a unit is a measurement cannot change. Add a new unit instead.');
  }
  const sb = c.get('supabase');
  let all: UomDef[];
  try { all = await loadUoms(sb); } catch (e) { return c.json({ error: 'load_failed', message: (e as Error).message }, 500); }
  const cur = all.find((u) => u.code === code);
  if (!cur) return refuse(c, 404, 'not_found', 'That unit does not exist.');

  const patch: Record<string, unknown> = {};
  if (b.label !== undefined) {
    const label = cleanLabel(b.label);
    if (!label) return refuse(c, 400, 'invalid_label', 'Type a name of up to 60 characters.');
    const lower = label.toLowerCase();
    if (all.some((u) => u.code !== code && u.label.toLowerCase() === lower)) return refuse(c, 409, 'label_taken', `"${label}" already exists.`);
    patch.label = label;
  }
  if (b.sortOrder !== undefined) {
    const n = Number(b.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return refuse(c, 400, 'invalid_sort', 'The order must be a whole number.');
    patch.sort_order = n;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return refuse(c, 400, 'invalid_active', 'active must be true or false.');
    if (!b.active && UNHIDEABLE_UOMS.includes(code)) return refuse(c, 400, 'fallback_unit', `${cur.label} is the unit the system falls back to, so it cannot be hidden.`);
    patch.active = b.active;
  }
  if (Object.keys(patch).length === 0) return refuse(c, 400, 'nothing_to_change', 'Nothing to change.');
  const { error } = await sb.from('product_uoms').update(patch).eq('code', code);
  if (error) return c.json({ error: 'save_failed', message: error.message }, 500);
  return c.json({ ok: true });
});

renovationCatalogSettings.delete('/uoms/:code', async (c) => {
  if (!canWriteScmConfig(c)) return refuse(c, 403, 'forbidden', 'You cannot change the catalog.');
  const code = String(c.req.param('code') ?? '').toUpperCase();
  const sb = c.get('supabase');
  let all: UomDef[];
  try { all = await loadUoms(sb); } catch (e) { return c.json({ error: 'load_failed', message: (e as Error).message }, 500); }
  const cur = all.find((u) => u.code === code);
  if (!cur) return refuse(c, 404, 'not_found', 'That unit does not exist.');
  if (cur.builtin) return refuse(c, 400, 'builtin_unit', `${cur.label} is a built-in unit. Hide it instead.`);

  /* Every company's SKUs count, the list is shared. A measured line keeps its unit in measure_uom. */
  const used = async (table: string, col: string) => {
    const { count, error } = await sb.from(table).select(col, { count: 'exact', head: true }).eq(col, code);
    if (error) throw new Error(`${table} could not be read: ${error.message}`);
    return count ?? 0;
  };
  let skus: number;
  let lines: number;
  try {
    skus = await used('mfg_products', 'uom');
    lines = (await used('reno_doc_lines', 'uom')) + (await used('reno_doc_lines', 'measure_uom'));
  } catch (e) {
    return c.json({ error: 'load_failed', message: (e as Error).message }, 500);
  }
  if (skus > 0 || lines > 0) {
    const what = [skus > 0 ? `${skus} SKU${skus === 1 ? '' : 's'}` : '', lines > 0 ? `${lines} document line${lines === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
    return refuse(c, 409, 'in_use', `${cur.label} is used by ${what}, so it can only be hidden.`);
  }
  const { error } = await sb.from('product_uoms').delete().eq('code', code);
  if (error) {
    if (error.code === '23503') return refuse(c, 409, 'in_use', `${cur.label} is still used by a SKU, so it can only be hidden.`);
    return c.json({ error: 'save_failed', message: error.message }, 500);
  }
  return c.json({ ok: true });
});
