/**
 * howto/screenTypes.ts: the screen map (owner, 27 Nov 2026): every page in the router with its purpose and, for the
 * busiest pages, every button / tab / menu, so Claude can explain any screen (from a URL or from labels read off a
 * screenshot) and answer "where do I open X". Written by reading the page code; src/lib/mcpScreens.test.mjs checks
 * every path against the router and every label against the frontend.
 */
import type { Company } from './types';

export type ScreenAction = {
  /** The exact label on screen (must appear verbatim in the frontend). */
  label: string;
  kind: 'button' | 'tab' | 'menu' | 'row-action' | 'link' | 'toggle' | 'filter';
  /** What it does, read from the handler. */
  does: string;
  /** The permission the server checks, in the guides' form ("METHOD /api/path" or "area:<key>:<level>"). Omit for reads. */
  permission?: string;
  /** Moves money, sends to someone, cannot be undone... */
  sideEffects?: string;
};

export type ScreenEntry = {
  /** Router path exactly as in src/App.tsx or scmEngine.ts ENGINE_PATH (":id" kept). */
  path: string;
  title: string;
  purpose: string;
  /** How to reach it from the sidebar, e.g. "RESERVATIONS > Reservations". */
  sidebar: string;
  /** Section headings / tab labels on the page (exact labels). */
  sections: string[];
  actions: ScreenAction[];
  /** "full" = every main button documented; "basic" = purpose and where it is. */
  detail: 'full' | 'basic';
  company: Company | 'both';
  /** Extra words people use for this page (English / Chinese / Malay), for where_is. */
  keywords?: string[];
};
