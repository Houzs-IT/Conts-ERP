/**
 * AI Connector process help tools (owner, 27 Nov 2026): how_to, module_overview, glossary, explain_error, onboarding.
 * Called from mcpServer.ts callTool, which applies the rate limit and logs every call in mcp_calls. The answers are
 * pure (mcpHowto.ts); this file only supplies the person's access and company and records unanswered questions.
 *
 * RBAC: canDo is the session middleware's own gate (mcpActionTools.ts gateFor: access.ts accessFor + refusalFor) for
 * each "METHOD /api/path" a guide names, and the person's level (levelAt) for each "area:<key>:<level>": the same
 * checks the connector's tools/list and actions use, so nothing here is a connector-only rule. The help itself reads no
 * ERP data, so every connected person can use it; what they may DO is told per guide.
 *
 * Company: the person's side (Users and roles: The Conts, Dream Crafter or both; management sees both) picks the
 * guides, unless the call names a company.
 *
 * Gap log: a question no guide answered is logged with the note `no-guide` and the question (personal data stripped)
 * as the target, so System > AI Connector lists what to write next.
 */
import type { Outcome, ToolCtx } from './mcpActionTools';
import { gateFor } from './mcpActionTools';
import { sessionState } from './auth';
import { HOWTO_TOOL_NAMES, NO_GUIDE_NOTE, explainError, glossary, helpOutcome, howTo, moduleOverview, onboarding, pageLink, scrubQuestion, type Access } from './mcpHowto';

import { SCREEN_TOOLS, explainScreen, whereIs } from './mcpScreens';
import { SHOW_ME_TOOL, annotatedHtml, annotatedSvg, resolveShot, showMeText } from './mcpShowMe';
import { HELP_SHOTS_CAPTURED_AT } from './howto/helpShots';
import { EXPORT_PREFIX, EXPORT_TTL_MS, signExport } from './mcpActions';
import { mytToday } from './db';
import { randomToken } from './mcpStore';

export { HOWTO_TOOLS } from './mcpHowto';
export { SCREEN_TOOLS } from './mcpScreens';
export const SHOW_ME_TOOLS = [SHOW_ME_TOOL];
const SCREEN_TOOL_NAMES = new Set(SCREEN_TOOLS.map(t => t.name));

/** The person's access as the ERP checks it, and their side ('' = both). */
export function accessFor(c: ToolCtx): { access: Access; side: () => Promise<string> } {
  const gate = gateFor(c.env, c.id.user.id);
  let side: Promise<string> | null = null;
  return {
    access: { gate: (method, path) => gate(method, path), level: area => gate.level(area) },
    // Management always sees both sides (access.ts closedBySide), so it gets every guide.
    side: () => (side ??= sessionState(c.env, c.id.user.id).then(s => (s.user?.kind === 'management' || c.id.user.role === 'management' ? 'both' : s.user?.side ?? 'both')).catch(() => 'both')),
  };
}

/** base64 of a byte array (Workers and Node). */
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** show_me: the plain WebP screenshot as an image (Claude rejects SVG), the box, the live link, and a 15-minute link to
 *  the annotated picture (an HTML page under mcp-exports/, served by GET /api/mcp/export like get_pdf's files). */
async function showMe(args: Record<string, unknown>, c: ToolCtx): Promise<Outcome> {
  const r = resolveShot(args);
  const text = (v: unknown) => ({ type: 'text' as const, text: JSON.stringify(v) });
  if ('error' in r) {
    const link = r.page ? pageLink(c.origin, r.page, r.label || undefined) : null;
    return { result: { content: [text({ matched: false, message: r.error, ...(link ? { openThePage: link } : {}) })] }, status: 200, note: NO_GUIDE_NOTE, target: scrubQuestion(String(args.label ?? args.guide_id ?? args.path ?? 'show_me')) };
  }
  const { hit, caption } = r;
  const target = `show_me ${hit.page} ${hit.label}`.slice(0, 200);
  const url = `${c.origin}/help-shots/${hit.shot.file}`;
  const res = await (c.env.ASSETS ? c.env.ASSETS.fetch(new Request(url)) : fetch(url)).catch(() => null);
  if (!res || !res.ok) return { result: { content: [text({ ...showMeText(hit, c.origin, caption, null, HELP_SHOTS_CAPTURED_AT), problem: 'The screenshot could not be loaded; use openThePage: it outlines the button on the real page.' })] }, status: 200, note: 'shot missing', target };
  const b64 = toBase64(new Uint8Array(await res.arrayBuffer()));
  let link: string | null = null;
  if (c.env.MEDIA) {
    const exp = Date.now() + EXPORT_TTL_MS;
    const key = `${EXPORT_PREFIX}${mytToday()}/${randomToken(12)}/show-me.html`;
    await c.env.MEDIA.put(key, annotatedHtml(annotatedSvg(hit, b64, caption), caption), { httpMetadata: { contentType: 'text/html; charset=utf-8' }, customMetadata: { userId: c.id.user.id, expiresAt: new Date(exp).toISOString() } });
    link = `${c.origin}/api/mcp/export?${await signExport(c.env.SESSION_SECRET, key, exp)}`;
  }
  return { result: { content: [{ type: 'image', data: b64, mimeType: 'image/webp' }, text(showMeText(hit, c.origin, caption, link, HELP_SHOTS_CAPTURED_AT))] }, status: 200, note: '', target };
}

export async function runHowtoTool(name: string, args: Record<string, unknown>, c: ToolCtx): Promise<Outcome | null> {
  if (name === 'show_me') return showMe(args, c);
  if (!HOWTO_TOOL_NAMES.has(name) && !SCREEN_TOOL_NAMES.has(name)) return null;
  const { access, side } = accessFor(c);
  const ans =
    name === 'explain_screen' ? await explainScreen(args, c.origin, access)
    : name === 'where_is' ? await whereIs(args, c.origin, access, await side())
    : name === 'how_to' ? await howTo(args, c.origin, access, await side())
    : name === 'module_overview' ? await moduleOverview(args, c.origin, access, await side())
    : name === 'glossary' ? glossary(args, c.origin)
    : name === 'explain_error' ? explainError(args)
    : await onboarding(args, c.origin, access, await side());
  return helpOutcome(name, args, ans);
}
