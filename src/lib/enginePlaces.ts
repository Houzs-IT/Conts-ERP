// Where each Supply chain menu's frame was last, for this browser tab. The address only names the menu
// (/projects/list), so a refresh or a page tab would otherwise open the menu's list, not the record that was open.

export const ENGINE_PLACES_KEY = 'conts.enginePlaces.v1';

/** Navigation state of a page tab click: go back to where that page was left, not to its menu's first screen. */
export const RESUME = { resume: true } as const;

export const isResume = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'resume' in state && state.resume === true;

const isPath = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/') && !v.startsWith('//');

function readPlaces(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(ENGINE_PLACES_KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => isPath(e[1])));
  } catch {
    return {};
  }
}

export const lastEnginePath = (menu: string): string | null => readPlaces()[menu] ?? null;

export function rememberEnginePath(menu: string, path: string): void {
  try {
    sessionStorage.setItem(ENGINE_PLACES_KEY, JSON.stringify({ ...readPlaces(), [menu]: path }));
  } catch { /* storage blocked: a page tab or a refresh opens the menu's list */ }
}
