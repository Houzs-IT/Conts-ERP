/* Works and Built-in are made for one unit (owner, 4 Nov 2026): a PO opened from an SO serves that unit only, and
   nothing received for another unit is its evidence. The rule beside isHardBoundLine (so-stock-allocation.ts), read from
   the SKU's category because every renovation contract line carries item_group RENOVATION. Other goods pool. */
import { chunkIn } from './paginate-all';
import { pgrestInList } from './pgrest-in-list';

const UNIT_BOUND_CATEGORIES: ReadonlySet<string> = new Set(['WORKS', 'BUILTIN']);

export const isUnitBoundCategory = (category: string | null | undefined): boolean =>
  UNIT_BOUND_CATEGORIES.has(String(category ?? '').toUpperCase());

/** Built-in is sales order to PO only (owner, 7 Nov 2026): never a production order, even bound to In-house. */
export const isBuiltInCategory = (category: string | null | undefined): boolean => String(category ?? '').toUpperCase() === 'BUILTIN';

export const NO_UNIT_BOUND_CODES: ReadonlySet<string> = new Set();

/** The codes among `codes` whose SKU is Works or Built-in. Throws on a failed read: an answer of "none" would pool a line
    that must not, which is the permissive direction. */
export async function loadUnitBoundCodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the scm PostgREST client is untyped
  sb: any,
  companyId: number | null,
  codes: ReadonlyArray<string | null | undefined>,
): Promise<ReadonlySet<string>> {
  const wanted = [...new Set(codes.map((c) => (c ?? '').trim()).filter(Boolean))];
  if (companyId == null || wanted.length === 0) return NO_UNIT_BOUND_CODES;
  const { data, error } = await chunkIn<{ code: string; category: string | null }>(wanted, (batch, from, to) => sb
    .from('mfg_products')
    .select('code, category')
    .eq('company_id', companyId)
    .filter('code', 'in', pgrestInList(batch))
    .order('id')
    .range(from, to));
  if (error) throw new Error(`unit_bound_load_failed: ${error.message}`);
  return new Set((data ?? []).filter((p) => isUnitBoundCategory(p.category)).map((p) => p.code));
}
