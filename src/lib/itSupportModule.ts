import { NAV, WORKSPACE_LABEL, groupName } from './navigation';

/**
 * Which part of the system an IT request is about, so the IT Hub's Reports can say which module has the most
 * problems: the workspace and its menu group ("The Conts · Reservations", "Dream Crafter · Supply chain"), read from
 * NAV so a new screen needs no list edit.
 */
const moduleOf = (g: (typeof NAV)[number]) => `${WORKSPACE_LABEL[g.workspace]} · ${groupName(g.label)}`;

const pathOf = (page: string): string => {
  try { return new URL(page, 'http://x').pathname.replace(/\/+$/, '') || '/'; } catch { return ''; }
};

/** The module of a page (path or full address); '' when no menu entry covers it. */
export function itModuleFor(page: string): string {
  const path = pathOf(page);
  if (!path) return '';
  let best: { len: number; module: string } | null = null;
  for (const g of NAV) for (const it of g.items) {
    for (const p of [it.path, ...(it.children ?? []).map(c => c.path)]) {
      if (!p) continue;
      const q = pathOf(p);
      const covers = q === path || (q !== '/' && path.startsWith(`${q}/`));
      if (covers && (!best || q.length > best.len)) best = { len: q.length, module: moduleOf(g) };
    }
  }
  return best?.module ?? '';
}

/** Every module once, in menu order, for the picker. */
export const IT_MODULES: string[] = [...new Set(NAV.map(moduleOf))];
