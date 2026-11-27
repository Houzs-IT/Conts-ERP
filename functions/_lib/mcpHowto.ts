/**
 * mcpHowto.ts: AI Connector process help (owner, 27 Nov 2026): how_to, module_overview, glossary, explain_error,
 * onboarding. Mirrors the Hookka / Houzs design (same data model, same honesty tests).
 *
 * Pure functions over the data in ./howto/: no I/O, no external AI, simple keyword scoring. canDo comes from the
 * person's ERP access through `Access`, which the tool layer (mcpHowtoTools.ts) builds from the session middleware's
 * own gate (mcpActionTools.ts gateFor: access.ts accessFor + refusalFor, and the person's level per area), so a guide
 * never says someone can do what the ERP would refuse.
 *
 * Company: The Conts (short-stay rental) and Dream Crafter (renovation) share the system. Guides are tagged by company
 * and resolved to the person's own side (Users and roles: The Conts / Dream Crafter / both); `company` overrides it.
 *
 * Links carry `?highlight=<label>` for the button to press; the ERP's highlight helper outlines it on The Conts' own
 * screens. On a supply chain engine screen (Dream Crafter's, and Mail Center) the link opens the screen and the answer
 * says the button is inside it (`engineScreen`).
 */
import type { Company, HowToFlow, HowToGuide, HowToPermission, HowToStep } from './howto/types';
import { GUIDES as RESERVATIONS } from './howto/guidesContsReservations';
import { GUIDES as OPERATIONS } from './howto/guidesContsOperations';
import { GUIDES as OWNERS } from './howto/guidesContsOwners';
import { GUIDES as GROWTH } from './howto/guidesContsGrowth';
import { GUIDES as DREAM_CRAFTER } from './howto/guidesDcSupplyChain';
import { FLOWS, ONBOARDING } from './howto/flows';
import { MODULES } from './howto/modules';
import { GLOSSARY } from './howto/glossary';
import { ERRORS } from './howto/errors';
import { ENGINE_PATH } from '../../src/lib/scmEngine';

export const GUIDES: HowToGuide[] = [...RESERVATIONS, ...OPERATIONS, ...OWNERS, ...GROWTH, ...DREAM_CRAFTER];
export { FLOWS, ONBOARDING, MODULES, GLOSSARY, ERRORS };

export const NO_PERMISSION_NOTE = "You don't have permission for this in the ERP: ask your supervisor or management (Users and roles).";
/** The note mcp_calls carries when a help tool found nothing: the admin page lists these. */
export const NO_GUIDE_NOTE = 'no-guide';
export const ENGINE_NOTE = 'This screen is the supply chain screen inside the ERP: the link opens it; find the button by its label (it is not outlined there).';
export const COMPANY_LABEL: Record<Company, string> = { conts: 'The Conts', dream_crafter: 'Dream Crafter' };

/** What the person may do, from the ERP's own checks (mcpHowtoTools.ts builds it from gateFor). */
export interface Access {
  /** The session middleware's gate for one request (method + API path). */
  gate: (method: string, path: string) => Promise<boolean>;
  /** The person's level on a permission area: none | view | edit | full. */
  level: (area: string) => Promise<string>;
}

const RANK: Record<string, number> = { none: 0, view: 1, edit: 2, full: 3 };
const AREA_PERM = /^area:([A-Za-z]+):(view|edit|full)$/;
const API_PERM = /^(GET|POST|PUT|PATCH|DELETE) (\/api\/\S+)$/;

// ── scoring ─────────────────────────────────────────────────────────────────

const STOP = new Set(['how', 'to', 'do', 'i', 'a', 'an', 'the', 'in', 'on', 'of', 'for', 'and', 'or', 'is', 'it', 'my', 'me', 'we', 'can', 'what', 'where', 'when', 'with', 'erp', 'conts', 'please', 'macam', 'mana', 'nak', 'cara', 'saya', 'untuk', 'dan']);
const CJK = /[㐀-鿿]/;

/** Lower-case latin word tokens (stop words dropped). */
export function tokens(s: string): string[] {
  return String(s ?? '').toLowerCase().split(/[^a-z0-9&]+/).filter(t => t && !STOP.has(t));
}

/** Light stemming so "billing" / "bill" / "billed" meet. */
const stem = (t: string) => t.replace(/(ing|ed|es|s)$/, '') || t;

/** Score a candidate against a question: keywords most (whole phrase: latin by word, CJK by substring), then title
 *  words, then id words. 0 when nothing meets. */
export function scoreText(question: string, c: { id: string; title: string; keywords: string[] }): number {
  const q = String(question ?? '');
  const ql = q.toLowerCase();
  const qt = new Set(tokens(q).map(stem));
  let score = 0;
  for (const kw of c.keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    if (CJK.test(k)) { if (ql.includes(k)) score += 4 + k.length; continue; }
    const kt = tokens(k).map(stem);
    if (kt.length && kt.every(t => qt.has(t))) score += 3 + 2 * (kt.length - 1);
  }
  for (const t of new Set(tokens(c.title).map(stem))) if (qt.has(t)) score += 1;
  for (const t of new Set(c.id.split('-').map(stem))) if (qt.has(t)) score += 1;
  return score;
}

export function rank<T extends { id: string; title: string; keywords: string[] }>(question: string, items: T[]): { item: T; score: number }[] {
  return items.map(item => ({ item, score: scoreText(question, item) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}

/** Trim, collapse whitespace, lower-case (labels read off a screenshot against the map). */
export const normaliseLabelText = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// ── links ───────────────────────────────────────────────────────────────────

/** Whether a router path opens a supply chain engine screen (scmEngine.ts ENGINE_PATH). */
export const isEngineScreen = (page: string): boolean => Object.prototype.hasOwnProperty.call(ENGINE_PATH, page.split('?')[0]);

/** An ERP link for a page, with ?highlight= for the label to press. Pages with :params get no link (open the record first). */
export function pageLink(origin: string, page: string, highlight?: string): string | null {
  if (!page || page.includes(':')) return null;
  const [path, query] = page.split('?');
  const params = new URLSearchParams(query ?? '');
  if (highlight) params.set('highlight', highlight);
  const qs = params.toString().replace(/\+/g, '%20');
  return `${origin}${path}${qs ? `?${qs}` : ''}`;
}

// ── permissions ─────────────────────────────────────────────────────────────

/** One permission: "METHOD /api/path" through the gate, or "area:<key>:<level>" against the person's level. */
export async function holds(access: Access, perm: HowToPermission): Promise<boolean> {
  const a = AREA_PERM.exec(perm);
  if (a) return (RANK[await access.level(a[1])] ?? 0) >= RANK[a[2]];
  const p = API_PERM.exec(perm);
  return !!p && (await access.gate(p[1], p[2]));
}

/** canDo: every `permission` AND (no `permissionAny`, or at least one of it). */
export async function guideCanDo(g: Pick<HowToGuide, 'permission' | 'permissionAny'>, access: Access): Promise<boolean> {
  for (const p of g.permission) if (!(await holds(access, p))) return false;
  if (g.permissionAny?.length) {
    for (const p of g.permissionAny) if (await holds(access, p)) return true;
    return false;
  }
  return true;
}

// ── company ─────────────────────────────────────────────────────────────────

/** The company asked for (`company` argument) or, else, the person's own side; '' = both. */
export function resolveCompany(arg: unknown, side: string | null | undefined): Company | '' {
  const a = String(arg ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (a === 'conts' || a === 'the_conts') return 'conts';
  if (a === 'dream_crafter' || a === 'dreamcrafter' || a === 'dc') return 'dream_crafter';
  if (a === 'both' || a === 'all') return '';
  return side === 'conts' || side === 'dream_crafter' ? side : '';
}

const forCompany = (company: Company | '') => (x: { companies: Company[] }) => !company || x.companies.includes(company);

function narrow(g: HowToGuide, company: Company | ''): HowToGuide {
  if (!company) return g;
  return { ...g, variants: (g.variants ?? []).filter(v => !v.companies?.length || v.companies.includes(company)) };
}

// ── how_to ──────────────────────────────────────────────────────────────────

function stepOut(s: HowToStep, g: HowToGuide, origin: string, n: number) {
  const page = s.page ?? g.page;
  const link = pageLink(origin, page, s.highlight);
  return { n, ...s, page, ...(link ? { link } : {}), ...(isEngineScreen(page) ? { engineScreen: true } : {}) };
}

async function guideOut(g0: HowToGuide, origin: string, access: Access, company: Company | '') {
  const g = narrow(g0, company);
  const canDo = await guideCanDo(g, access);
  return {
    id: g.id, title: g.title, canDo, ...(canDo ? {} : { note: NO_PERMISSION_NOTE }),
    companies: g.companies.map(c => COMPANY_LABEL[c]),
    erpLink: pageLink(origin, g.page), sidebar: g.sidebar, module: g.module,
    ...(isEngineScreen(g.page) ? { engineScreenNote: ENGINE_NOTE } : {}),
    purpose: g.purpose, who: g.who, permission: g.permission, ...(g.permissionAny?.length ? { permissionAny: g.permissionAny } : {}),
    prerequisites: g.prerequisites, steps: g.steps.map((s, i) => stepOut(s, g, origin, i + 1)),
    checkBefore: g.checkBefore, result: g.result, warnings: g.warnings, undo: g.undo,
    ...(g.approvals ? { approvals: g.approvals } : {}), ...(g.deadlines ? { deadlines: g.deadlines } : {}),
    commonMistakes: g.commonMistakes, workedExample: g.workedExample, ...(g.variants?.length ? { variants: g.variants } : {}),
    related: g.related, ...(g.nextStep ? { nextStep: g.nextStep } : {}), contact: g.contact,
  };
}

/** A flow: each step with its guide's click-by-click steps (compact) and the person's canDo. */
async function flowOut(f: HowToFlow, origin: string, access: Access, company: Company | '') {
  const steps = [];
  let n = 0;
  for (const s of f.steps) {
    const g0 = GUIDES.find(x => x.id === s.guide);
    if (!g0) continue;
    const g = narrow(g0, company);
    const canDo = await guideCanDo(g, access);
    n++;
    steps.push({
      n, guide: g.id, title: g.title, role: s.role, handoff: s.handoff, sidebar: g.sidebar, erpLink: pageLink(origin, g.page),
      canDo, ...(canDo ? {} : { note: NO_PERMISSION_NOTE }),
      clicks: g.steps.map((x, i) => {
        const o = stepOut(x, g, origin, i + 1);
        return { n: o.n, do: o.do, ...(o.fields ? { fields: o.fields } : {}), ...(o.check ? { check: o.check } : {}), ...(o.then ? { then: o.then } : {}), ...(o.link ? { link: o.link } : {}) };
      }),
      warnings: g.warnings, result: g.result,
    });
  }
  return { id: f.id, title: f.title, summary: f.summary, companies: f.companies.map(c => COMPANY_LABEL[c]), steps, tip: 'Call how_to {topic: <guide id>} for any step\'s full SOP (prerequisites, undo, common mistakes, worked example).' };
}

const allTitles = (company: Company | '') => ({
  guides: GUIDES.filter(forCompany(company)).map(g => ({ id: g.id, title: g.title, module: g.module })),
  flows: FLOWS.filter(forCompany(company)).map(f => ({ id: f.id, title: f.title })),
});

export type HelpAnswer = { value: Record<string, unknown>; matched: boolean };

const companyOut = (c: Company | '') => (c ? { company: COMPANY_LABEL[c] } : {});

/** how_to: top 1-3 guides (or one flow) for a question or an exact topic id, for the person's company. */
export async function howTo(args: { question?: unknown; topic?: unknown; company?: unknown }, origin: string, access: Access, side?: string | null): Promise<HelpAnswer> {
  const topic = typeof args.topic === 'string' ? args.topic.trim() : '';
  const question = typeof args.question === 'string' ? args.question.trim().slice(0, 300) : '';
  const company = resolveCompany(args.company, side);
  const extra = { showMe: 'show_me {guide_id, step} gives a screenshot of that step with the button boxed in red (when one is captured).', ...companyOut(company) };
  if (topic) {
    const f = FLOWS.find(x => x.id === topic);
    if (f) return { matched: true, value: { flow: await flowOut(f, origin, access, company), ...extra } };
    const g = GUIDES.find(x => x.id === topic);
    if (g) return { matched: true, value: { guides: [await guideOut(g, origin, access, company)], ...extra } };
  }
  const q = question || topic;
  if (!q) return { matched: true, value: { tip: "Ask a question, e.g. 'how do I create a reservation', or give a topic id.", ...allTitles(company), ...extra } };
  const flowHits = rank(q, FLOWS.filter(forCompany(company)));
  const guideHits = rank(q, GUIDES.filter(forCompany(company)));
  // A flow wins only when the question is about the whole chain and beats the best single task.
  if (flowHits.length && (!guideHits.length || flowHits[0].score > guideHits[0].score)) {
    return { matched: true, value: { flow: await flowOut(flowHits[0].item, origin, access, company), ...extra } };
  }
  if (!guideHits.length) {
    // Nothing for their own company: say so when the other company has it, rather than silently showing it.
    const other = company ? rank(q, GUIDES.filter(g => !g.companies.includes(company)))[0]?.item : undefined;
    return {
      matched: false,
      value: {
        noMatch: `No ${company ? `${COMPANY_LABEL[company]} ` : ''}guide matches "${q}". These are the guides there are:`,
        ...(other ? { otherCompany: { id: other.id, title: other.title, companies: other.companies.map(c => COMPANY_LABEL[c]), tip: 'This is the other company\'s; ask with company to see it.' } } : {}),
        ...allTitles(company), ...companyOut(company),
      },
    };
  }
  const top = guideHits[0].score;
  const picked = guideHits.filter(h => h.score >= top / 2).slice(0, 3);
  return { matched: true, value: { guides: await Promise.all(picked.map(h => guideOut(h.item, origin, access, company))), ...extra } };
}

// ── module_overview ─────────────────────────────────────────────────────────

async function pageOpen(access: Access, area?: string): Promise<boolean> {
  if (!area || area === 'account') return true;
  return (RANK[await access.level(area)] ?? 0) >= RANK.view;
}

export async function moduleOverview(args: { module?: unknown; company?: unknown }, origin: string, access: Access, side?: string | null): Promise<HelpAnswer> {
  const company = resolveCompany(args.company, side);
  const mods = MODULES.filter(m => !company || m.company === 'both' || m.company === company);
  const m = typeof args.module === 'string' ? args.module.trim() : '';
  const line = (x: (typeof MODULES)[number]) => ({ id: x.id, section: x.section, company: x.company === 'both' ? 'both' : COMPANY_LABEL[x.company], oneLine: x.oneLine });
  if (!m) return { matched: true, value: { modules: mods.map(line), tip: 'Call module_overview {module: <id or section>} for one module.', ...companyOut(company) } };
  const ml = m.toLowerCase();
  const hit = mods.find(x => x.id === ml || x.section.toLowerCase() === ml)
    ?? rank(m, mods.map(x => ({ ...x, title: `${x.section} ${x.oneLine}`, keywords: [x.section, ...x.pages.map(p => p.name)] })))[0]?.item;
  if (!hit) return { matched: false, value: { noMatch: `No module matches "${m}".`, modules: mods.map(line) } };
  const pages = await Promise.all(hit.pages.map(async p => ({ name: p.name, link: pageLink(origin, p.path), canOpen: await pageOpen(access, p.area), ...(isEngineScreen(p.path) ? { engineScreen: true } : {}) })));
  return {
    matched: true,
    value: { id: hit.id, section: hit.section, company: hit.company === 'both' ? 'both' : COMPANY_LABEL[hit.company], purpose: hit.purpose, usedBy: hit.usedBy, pages, links: hit.links, guides: hit.guides.map(id => ({ id, title: GUIDES.find(g => g.id === id)?.title ?? id })) },
  };
}

// ── glossary ────────────────────────────────────────────────────────────────

export function glossary(args: { term?: unknown }, origin: string): HelpAnswer {
  const t = typeof args.term === 'string' ? args.term.trim() : '';
  const out = (e: (typeof GLOSSARY)[number]) => ({ term: e.term, aliases: e.aliases, definition: e.definition, company: e.company === 'both' ? 'both' : COMPANY_LABEL[e.company], ...(e.page ? { seeIt: pageLink(origin, e.page) } : {}), ...(e.guides?.length ? { guides: e.guides } : {}) });
  if (!t) return { matched: true, value: { terms: GLOSSARY.map(e => ({ term: e.term, definition: e.definition })) } };
  const tl = t.toLowerCase();
  const exact = GLOSSARY.filter(e => e.term.toLowerCase() === tl || e.aliases.some(a => a.toLowerCase() === tl) || e.keywords.some(k => k === t));
  if (exact.length) return { matched: true, value: { terms: exact.map(out) } };
  const hits = rank(t, GLOSSARY.map(e => ({ ...e, id: e.term.toLowerCase().replace(/\s+/g, '-'), title: `${e.term} ${e.aliases.join(' ')}`, keywords: [e.term, ...e.aliases, ...e.keywords] })));
  if (!hits.length) return { matched: false, value: { noMatch: `"${t}" is not in the glossary.`, terms: GLOSSARY.map(e => e.term) } };
  return { matched: true, value: { terms: hits.slice(0, 3).map(h => out(h.item)) } };
}

// ── explain_error ───────────────────────────────────────────────────────────

export function explainError(args: { text?: unknown }): HelpAnswer {
  const t = typeof args.text === 'string' ? args.text.trim().slice(0, 1000) : '';
  if (!t) return { matched: false, value: { tip: 'Paste the error text (or read it off the screenshot).' } };
  const tl = t.toLowerCase();
  const out = (e: (typeof ERRORS)[number]) => ({ module: e.module, message: e.match, meaning: e.meaning, cause: e.cause.replace(/^[\w/.[\]-]+\.ts\S*:?\s*/, ''), fix: e.fix });
  const direct = ERRORS.filter(e => tl.includes(e.match.toLowerCase()) || e.match.toLowerCase().includes(tl)).sort((a, b) => b.match.length - a.match.length);
  if (direct.length) return { matched: true, value: { errors: direct.slice(0, 2).map(out) } };
  const hits = rank(t, ERRORS.map(e => ({ ...e, title: e.match, keywords: [...(e.keywords ?? [])] })));
  if (!hits.length || hits[0].score < 2) return { matched: false, value: { noMatch: 'This message is not in the error list yet. Tell your supervisor or IT Support what you were doing when it appeared.', hint: 'Check the exact wording (a screenshot helps).' } };
  return { matched: true, value: { errors: hits.slice(0, 2).map(h => out(h.item)), note: 'Closest known messages: compare the wording.' } };
}

// ── onboarding ──────────────────────────────────────────────────────────────

export async function onboarding(args: { role?: unknown; company?: unknown }, origin: string, access: Access, side?: string | null): Promise<HelpAnswer> {
  const company = resolveCompany(args.company, side);
  const roles = Object.entries(ONBOARDING).filter(([, v]) => !company || v.company === 'both' || v.company === company);
  const r = typeof args.role === 'string' ? args.role.trim().toLowerCase().replace(/[\s_]+/g, '-') : '';
  const key = roles.map(([k]) => k).find(k => k === r) ?? roles.map(([k]) => k).find(k => r && (k.startsWith(r) || r.startsWith(k) || k.includes(r)));
  if (!r || !key) return { matched: !r, value: { roles: roles.map(([k, v]) => ({ role: k, title: v.title })), tip: "Call onboarding {role} for that role's first-week reading path.", ...companyOut(company) } };
  const items = await Promise.all(ONBOARDING[key].path.map(async (id, i) => {
    const f = FLOWS.find(x => x.id === id);
    if (f) return { day: Math.floor(i / 2) + 1, id, kind: 'flow', title: f.title };
    const g = GUIDES.find(x => x.id === id);
    return { day: Math.floor(i / 2) + 1, id, kind: 'guide', title: g?.title ?? id, link: g ? pageLink(origin, g.page) : null, canDo: g ? await guideCanDo(g, access) : false };
  }));
  return { matched: true, value: { role: key, title: ONBOARDING[key].title, path: items, tip: 'Open each with how_to {topic: <id>}.' } };
}

// ── gap log ─────────────────────────────────────────────────────────────────

/** A question with personal data stripped (emails, phone / long numbers, document numbers), for the "no guide yet" log. */
export function scrubQuestion(q: string): string {
  return String(q ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b[A-Z]{1,5}[-/]?\d{3,}[\w/-]*\b/gi, '[doc]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// ── the tools (definitions; run by mcpHowtoTools.ts) ─────────────────────────

const RO = { readOnlyHint: true, openWorldHint: false };
const COMPANY_ARG = { type: 'string', description: 'The Conts or Dream Crafter, to see the other company\'s steps (default: your own side)' };

export const HOWTO_TOOLS = [
  {
    name: 'how_to', title: 'How do I... (step-by-step ERP help)',
    description: "Step-by-step help for doing something in the ERP, e.g. 'how do I create a reservation', 'bill a renovation instalment', '报销', 'bayar pemilik'. Returns the top 1-3 guides (or one end-to-end flow such as reservation to owner payout, or a renovation project from quotation to handover) with exact button labels, fields, checks, warnings, how to undo, ERP links and canDo (whether this person has the ERP permission). Guides follow the person's company (The Conts or Dream Crafter). Read-only.",
    inputSchema: { type: 'object', properties: { question: { type: 'string', description: "The person's question, in any language" }, topic: { type: 'string', description: 'A guide or flow id from an earlier answer' }, company: COMPANY_ARG }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'module_overview', title: 'What an ERP module is for',
    description: 'For a sidebar section (Reservations, Operations, Units, Finance, Projects, Supply chain...): what it is for, its pages (with links and whether this person can open them), who uses it and how it links to other modules. No module: every module in one line.',
    inputSchema: { type: 'object', properties: { module: { type: 'string', description: 'Module id or sidebar section, e.g. reservations or projects' }, company: COMPANY_ARG }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'glossary', title: 'What does this ERP term mean',
    // vocab-ok: the industry abbreviations staff ask about, listed so the AI app knows to call this tool
    description: 'Plain-English meaning of a term or abbreviation staff meet in the ERP: ADR, RevPAR, occupancy, OTA / channel, host payout, service fee, owner statement, Net Payout to Owner, GRR, letting, quotation, VO (variation order), progress billing, defect, handover, project brand, commission, PO, payment voucher, sen vs RM. No term: the whole list.',
    inputSchema: { type: 'object', properties: { term: { type: 'string' } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'explain_error', title: 'Explain an ERP error message',
    description: 'What an ERP error or validation message means, why it happens and how to fix it. Pass the message text (read it off a screenshot if needed).',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The error message' } }, required: ['text'], additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'onboarding', title: 'First-week reading path for a role',
    description: 'An ordered list of guides and flows for a new starter: reservations, operations, finance (The Conts); renovation-sales, renovation-project, renovation-finance (Dream Crafter).',
    inputSchema: { type: 'object', properties: { role: { type: 'string', description: 'reservations | operations | finance | renovation-sales | renovation-project | renovation-finance' }, company: COMPANY_ARG }, additionalProperties: false },
    annotations: RO,
  },
];

export const HOWTO_TOOL_NAMES = new Set(HOWTO_TOOLS.map(t => t.name));

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/** The question a help call asked, for the gap log. */
export const askedOf = (args: Record<string, unknown>): string =>
  String(args.question ?? args.topic ?? args.text ?? args.thing ?? args.path ?? args.module ?? args.term ?? args.role ?? args.label ?? args.guide_id
    ?? (Array.isArray(args.visible_text) ? (args.visible_text as unknown[]).slice(0, 8).join(' | ') : ''));

/** Wraps a help answer as the tool's outcome; an unanswered question is logged as a gap. */
export function helpOutcome(name: string, args: Record<string, unknown>, ans: HelpAnswer): { result: { content: { type: 'text'; text: string }[] }; status: number; note: string; target: string } {
  return {
    result: text(JSON.stringify(ans.value)),
    status: 200,
    note: ans.matched ? '' : NO_GUIDE_NOTE,
    target: ans.matched ? `${name}:${scrubQuestion(askedOf(args)).slice(0, 120)}` : scrubQuestion(askedOf(args)),
  };
}

