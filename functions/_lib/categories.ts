/** Product-category display master, ported from 2990's SCM (`categories`). */

export interface CategoryRow {
  id: string; label: string; icon: string; tbc: number; hero_image_key: string | null; sort_order: number;
}

export function toCategoryPayload(r: CategoryRow) {
  return { id: r.id, label: r.label, icon: r.icon, tbc: r.tbc === 1, heroImageKey: r.hero_image_key ?? '', sortOrder: r.sort_order };
}

export function invalidCategory(b: { id?: unknown; label?: unknown; icon?: unknown }): { field: string; message: string } | null {
  if (typeof b.id !== 'string' || !b.id.trim()) return { field: 'id', message: 'Enter a category id.' };
  if (typeof b.label !== 'string' || !b.label.trim()) return { field: 'label', message: 'Enter a label.' };
  if (typeof b.icon !== 'string' || !b.icon.trim()) return { field: 'icon', message: 'Enter an icon name.' };
  return null;
}
