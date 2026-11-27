/**
 * mcpScreens.ts: AI Connector screen help (owner, 27 Nov 2026), mirroring Hookka PR 1644 / Houzs PR 6130:
 *   explain_screen {path?, visible_text?}  which page this is (from a URL, or from labels read off a screenshot) and
 *                                          what each button does, with canDo per action;
 *   where_is {thing}                       "where do I open X": the sidebar path and a link (?highlight= the button).
 * Data: howto/screensFull.ts (the busiest pages, button by button) + howto/screensBasic.ts (every other router page);
 * titles and sidebar paths of menu pages come from the menu itself (src/lib/navigation.ts NAV). Pure: `access` is the
 * ERP's own gate and levels (mcpHowto.ts Access), so canOpen / canDo match what the ERP would allow.
 */
import type { ScreenEntry } from './howto/screenTypes';
import { FULL_SCREENS } from './howto/screensFull';
import { BASIC_SCREENS, LEDGER_PURPOSE } from './howto/screensBasic';
import { GLOSSARY, GUIDES, holds, isEngineScreen, normaliseLabelText, pageLink, resolveCompany, scoreText, ENGINE_NOTE, COMPANY_LABEL, type Access, type HelpAnswer } from './mcpHowto';
import { NAV, areaOfPath } from '../../src/lib/navigation';
import { LEDGER_SCREENS } from '../../src/lib/scmEngine';

const RANK: Record<string, number> = { none: 0, view: 1, edit: 2, full: 3 };

/** Menu title and sidebar path of every menu address ("RESERVATIONS > Reservations", "FINANCE > Suppliers > ..."). */
export function menuInfo(): Map<string, { title: string; sidebar: string; workspace: 'rental' | 'supply' }> {
  const out = new Map<string, { title: string; sidebar: string; workspace: 'rental' | 'supply' }>();
  for (const g of NAV) for (const it of g.items) {
    if (it.path && !out.has(it.path)) out.set(it.path, { title: it.label, sidebar: `${g.label} > ${it.label}`, workspace: g.workspace });
    for (const c of it.children ?? []) if (!out.has(c.path)) out.set(c.path, { title: c.label, sidebar: `${g.label} > ${it.label} > ${c.label}`, workspace: g.workspace });
  }
  return out;
}

function buildScreens(): ScreenEntry[] {
  const menu = menuInfo();
  const out: ScreenEntry[] = [...FULL_SCREENS];
  const have = new Set(out.map(s => s.path));
  for (const [path, b] of Object.entries(BASIC_SCREENS)) {
    if (have.has(path)) continue;
    const m = menu.get(path);
    out.push({ path, title: b.title ?? m?.title ?? path, sidebar: b.sidebar ?? m?.sidebar ?? '(not in the menu)', purpose: b.purpose, sections: [], actions: [], detail: 'basic', company: b.company, ...(b.keywords ? { keywords: b.keywords } : {}) });
    have.add(path);
  }
  for (const s of LEDGER_SCREENS) {
    for (const [prefix, company] of [['/finance', 'conts'], ['/supply/finance', 'dream_crafter']] as const) {
      const path = `${prefix}/${s.slug}`;
      if (have.has(path)) continue;
      const m = menu.get(path);
      out.push({ path, title: s.label, sidebar: m?.sidebar ?? `FINANCE > ${s.label}`, purpose: LEDGER_PURPOSE[s.slug] ?? '', sections: [], actions: [], detail: 'basic', company });
      have.add(path);
    }
  }
  return out;
}

export const SCREENS: ScreenEntry[] = buildScreens();

const SHOW_ME_TIP = 'show_me {path, label} gives a screenshot of this screen with the button boxed in red (when one is captured).';
const norm = (p: string) => p.replace(/\/+$/, '') || '/';

/** The screen for a URL or path (origin, query and hash ignored; ":id" segments match anything; most specific wins). */
export function screenForPath(raw: string): { screen: ScreenEntry; path: string; tab: string } | null {
  let p = String(raw ?? '').trim();
  if (!p) return null;
  let tab = '';
  try {
    const u = new URL(p, 'https://x.invalid');
    p = u.pathname;
    tab = u.searchParams.get('tab') ?? '';
  } catch {
    return null;
  }
  const segs = norm(p).split('/');
  let best: ScreenEntry | null = null;
  let bestStatic = -1;
  for (const s of SCREENS) {
    const ps = norm(s.path).split('/');
    if (ps.length !== segs.length) continue;
    let ok = true;
    let statics = 0;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(':')) continue;
      if (ps[i] !== segs[i]) { ok = false; break; }
      statics++;
    }
    if (ok && statics > bestStatic) { best = s; bestStatic = statics; }
  }
  return best ? { screen: best, path: norm(p), tab } : null;
}

/** Score screens by how many of the labels read off a screenshot they carry. */
export function screensForLabels(visible: string[]): { screen: ScreenEntry; score: number }[] {
  const seen = new Set(visible.map(normaliseLabelText).filter(x => x.length >= 2));
  if (!seen.size) return [];
  return SCREENS.map(s => {
    const labels = new Set([s.title, ...s.sections, ...s.actions.map(a => a.label)].map(normaliseLabelText));
    let score = 0;
    for (const l of labels) if (seen.has(l)) score += l.length > 12 ? 3 : 2;
    if (seen.has(normaliseLabelText(s.title))) score += 3;
    return { screen: s, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}

/** Whether the person can open a page: their level on its menu area (src/lib/navigation.ts areaOfPath). */
export async function canOpenPage(access: Access, path: string): Promise<boolean> {
  const area = areaOfPath(path.split('?')[0]);
  if (!area || area === 'account') return true;
  return (RANK[await access.level(area)] ?? 0) >= RANK.view;
}

async function screenOut(s: ScreenEntry, path: string, origin: string, access: Access, tab = '') {
  const base = path.includes(':') ? s.path : path;
  const pagePath = tab ? `${base}?tab=${tab}` : base;
  const canOpen = await canOpenPage(access, s.path);
  const actions = await Promise.all(s.actions.map(async a => {
    const canDo = canOpen && (a.permission ? await holds(access, a.permission) : true);
    const link = pageLink(origin, pagePath, a.label);
    return { label: a.label, kind: a.kind, does: a.does, ...(a.sideEffects ? { sideEffects: a.sideEffects } : {}), ...(a.permission ? { permission: a.permission } : {}), canDo, ...(link ? { link } : {}) };
  }));
  return {
    path: s.path, title: s.title, purpose: s.purpose, sidebar: s.sidebar, company: s.company === 'both' ? 'both' : COMPANY_LABEL[s.company],
    erpLink: pageLink(origin, pagePath), canOpen,
    ...(canOpen ? {} : { note: "You can't open this page with your ERP access: ask your supervisor or management." }),
    ...(isEngineScreen(s.path) ? { engineScreenNote: ENGINE_NOTE } : {}),
    sections: s.sections, actions, detail: s.detail,
  };
}

/** explain_screen: from a path / URL, or from labels read off a screenshot. */
export async function explainScreen(args: { path?: unknown; visible_text?: unknown }, origin: string, access: Access): Promise<HelpAnswer> {
  const path = typeof args.path === 'string' ? args.path : '';
  const visible = Array.isArray(args.visible_text) ? args.visible_text.filter((x): x is string => typeof x === 'string').slice(0, 80) : [];
  if (path) {
    const hit = screenForPath(path);
    if (hit) return { matched: true, value: { identifiedBy: 'path', screen: await screenOut(hit.screen, hit.path, origin, access, hit.tab), showMe: SHOW_ME_TIP } };
  }
  const ranked = screensForLabels(visible);
  if (ranked.length) {
    const top = ranked[0];
    const close = ranked.slice(1, 3).filter(x => x.score >= top.score * 0.8);
    return {
      matched: true,
      value: {
        identifiedBy: 'visible labels',
        confidence: close.length ? 'low: compare the alternatives' : top.score >= 6 ? 'high' : 'medium',
        screen: await screenOut(top.screen, top.screen.path, origin, access),
        ...(close.length ? { alternatives: close.map(x => ({ path: x.screen.path, title: x.screen.title })) } : {}),
        showMe: SHOW_ME_TIP,
      },
    };
  }
  return { matched: false, value: { noMatch: 'I could not tell which ERP page this is. Read the address bar (the part after the domain) or more of the button and tab labels and try again.' } };
}

const GENERIC = new Set(['open', 'edit', 'save', 'cancel', 'close', 'delete', 'print', 'search', 'filter', 'export', 'import', 'view', 'back', 'next', 'submit', 'confirm', 'refresh', 'reset', 'apply', 'clear', 'details', 'download']);
const CREATE_INTENT = /\b(open|create|new|add|raise|make|record)\b|开|新建|新增|加|buat|baru|tambah/i;
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "open a VO" -> "open a VO variation order": glossary abbreviations get their long name added. */
export function expandAbbreviations(q: string): string {
  const extra: string[] = [];
  for (const w of q.split(/[^A-Za-z&]+/)) {
    if (w.length < 2 || w.length > 6 || w !== w.toUpperCase()) continue;
    const e = GLOSSARY.find(g => g.term === w || g.aliases.includes(w));
    if (e?.aliases[0]) extra.push(e.term === w ? e.aliases[0] : e.term);
  }
  return extra.length ? `${q} ${extra.join(' ')}` : q;
}

/** where_is: "where do I open X": screens and task guides, best first, for the person's company. */
export async function whereIs(args: { thing?: unknown; company?: unknown }, origin: string, access: Access, side?: string | null): Promise<HelpAnswer> {
  const thing = typeof args.thing === 'string' ? args.thing.trim().slice(0, 200) : '';
  if (!thing) return { matched: false, value: { tip: "Say what you are looking for, e.g. 'owner payouts' or 'quotation'." } };
  const company = resolveCompany(args.company, side);
  const q = expandAbbreviations(thing);
  const tl = normaliseLabelText(q);
  const scored = SCREENS.filter(s => !company || s.company === 'both' || s.company === company).map(s => {
    // A button named in the question ("payout run" -> "Start payout run"); one-word generic labels never count.
    const named = s.actions.find(a => {
      const l = normaliseLabelText(a.label);
      if (l.length < 3 || GENERIC.has(l)) return false;
      return new RegExp(`(^|\\W)${escapeRe(l)}(\\W|$)`).test(tl) || (tl.length >= 5 && l.includes(tl));
    });
    const action = named ?? (CREATE_INTENT.test(q) ? s.actions.find(a => a.kind === 'button' && /^\+?\s*(new|create|add|record)\b/i.test(a.label)) : undefined);
    const score = scoreText(q, { id: s.path.replace(/[/:]+/g, '-'), title: `${s.title} ${s.sections.join(' ')}`, keywords: [...(s.keywords ?? []), s.title] })
      + (action ? 3 : 0) + (s.detail === 'full' ? 0.5 : 0) + (s.path.includes(':') ? -3 : 0);
    return { s, score, action };
  }).filter(x => x.score > 0.5).sort((a, b) => b.score - a.score).slice(0, 3);
  const guides = GUIDES.filter(g => !company || g.companies.includes(company)).map(g => ({ g, score: scoreText(thing, g) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  if (!scored.length && !guides.length) return { matched: false, value: { noMatch: `I could not find "${thing}" in the ERP map.`, tip: 'Try another word, or module_overview for the list of modules.' } };
  const places = await Promise.all(scored.map(async ({ s, action }) => {
    const canOpen = await canOpenPage(access, s.path);
    return {
      title: s.title, sidebar: s.sidebar, link: pageLink(origin, s.path, action?.label),
      ...(action ? { press: action.label, does: action.does } : {}),
      purpose: s.purpose, canOpen, ...(canOpen ? {} : { note: "You don't have access to this in the ERP: ask your supervisor or management." }),
      ...(isEngineScreen(s.path) ? { engineScreen: true } : {}),
    };
  }));
  return { matched: true, value: { places, ...(guides.length ? { guides: guides.map(x => ({ id: x.g.id, title: x.g.title, tip: 'how_to {topic} for the steps' })) } : {}), showMe: SHOW_ME_TIP, ...(company ? { company: COMPANY_LABEL[company] } : {}) } };
}

// ── tool definitions (run by mcpHowtoTools.ts) ────────────────────────────────

const RO = { readOnlyHint: true, openWorldHint: false };
export const SCREEN_TOOLS = [
  {
    name: 'explain_screen', title: 'Explain this ERP screen',
    description: 'Which ERP page this is and what each button, tab and menu on it does (with canDo for this person). Give the URL path if you can read it, and/or the labels visible on a screenshot (visible_text).',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The URL or path, e.g. /owners/payouts' }, visible_text: { type: 'array', items: { type: 'string' }, description: 'Button / tab / heading labels read off the screenshot' } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'where_is', title: 'Where do I open...',
    description: "Where something is in the ERP (e.g. 'owner payouts', 'quotation', 'add a maintenance job'): the sidebar path and a link that outlines the button to press, plus the matching how-to guide. Follows the person's company.",
    inputSchema: { type: 'object', properties: { thing: { type: 'string' }, company: { type: 'string', description: 'The Conts or Dream Crafter (default: your own side)' } }, required: ['thing'], additionalProperties: false },
    annotations: RO,
  },
];
