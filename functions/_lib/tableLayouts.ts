import { can, type Level } from './access';
import { isFieldRole } from './auth';

/** Saved table views (migration 0094, src/components/DataTable.tsx). A view belongs to one person, or to the
 *  whole company when user_id is NULL; only people with Finance access (management, finance, operations managers) write company views. */

export const TABLE_KEY = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const PARAM_KEY = /^[A-Za-z0-9_.:-]{1,60}$/;
const COL_KEY = /^[A-Za-z0-9_.:-]{1,60}$/;

export interface Layout {
  columns: { key: string; hidden: boolean }[];
  sort: string | null;
  pageSize: number | null;
  filters: Record<string, string>;
}

/** Who may keep views at all: everyone on the desk app. Owners and field roles have no tables. */
export const mayUseViews = (role: string) => role !== 'owner' && !isFieldRole(role);
export const mayShare = (s: { levels?: Record<string, Level> }): boolean => can(s, 'finance', 'view');

/** The layout as stored, or the reason it is refused. Unknown keys are dropped. */
export function cleanLayout(v: unknown): Layout | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'The view is missing its layout.';
  const o = v as Record<string, unknown>;
  if (o.columns !== undefined && !Array.isArray(o.columns)) return 'One of the columns in this view is not valid.';
  const cols = Array.isArray(o.columns) ? o.columns : [];
  if (cols.length > 80) return 'A view can hold at most 80 columns.';
  const columns: Layout['columns'] = [];
  const seen = new Set<string>();
  for (const c of cols) {
    const key = (c as { key?: unknown })?.key;
    if (typeof key !== 'string' || !COL_KEY.test(key) || seen.has(key)) return 'One of the columns in this view is not valid.';
    seen.add(key);
    columns.push({ key, hidden: !!(c as { hidden?: unknown }).hidden });
  }
  const sort = typeof o.sort === 'string' && o.sort ? o.sort.slice(0, 80) : null;
  const size = Number(o.pageSize);
  const pageSize = Number.isInteger(size) && size >= 10 && size <= 1000 ? size : null;
  const filters: Record<string, string> = {};
  if (o.filters && typeof o.filters === 'object' && !Array.isArray(o.filters)) {
    const entries = Object.entries(o.filters as Record<string, unknown>);
    if (entries.length > 40) return 'A view can hold at most 40 filters.';
    for (const [k, val] of entries) {
      if (!PARAM_KEY.test(k) || typeof val !== 'string' || val.length > 200) return 'One of the filters in this view is not valid.';
      if (val) filters[k] = val;
    }
  }
  return { columns, sort, pageSize, filters };
}

export const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export interface ViewRow { id: string; table_key: string; user_id: string | null; name: string; is_default: boolean; layout: unknown; created_by: string | null; updated_at: string }

export const toView = (r: ViewRow, me: string) => ({
  id: r.id, table: r.table_key, name: r.name, scope: r.user_id ? 'mine' as const : 'company' as const,
  isDefault: !!r.is_default, layout: typeof r.layout === 'string' ? JSON.parse(r.layout) : r.layout,
  mine: r.user_id === me || (!r.user_id && r.created_by === me), updatedAt: r.updated_at,
});
