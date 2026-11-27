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
import { HOWTO_TOOL_NAMES, explainError, glossary, helpOutcome, howTo, moduleOverview, onboarding, type Access } from './mcpHowto';

import { SCREEN_TOOLS, explainScreen, whereIs } from './mcpScreens';

export { HOWTO_TOOLS } from './mcpHowto';
export { SCREEN_TOOLS } from './mcpScreens';
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

export async function runHowtoTool(name: string, args: Record<string, unknown>, c: ToolCtx): Promise<Outcome | null> {
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
