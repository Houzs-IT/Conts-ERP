// Conts only (not part of Houzs's code): a project's limit and extra limit (finance phase 1.5; SOP 3.4). Mounted under
// /accounting, behind the Ledger guard.
//   GET  /accounting/projects/:id/limit                 limit, used, reserved, left
//   POST /accounting/projects/:id/limit-requests        ask for more: { kind: amount|pct|budget, amountSen?, pctBp?, reason }
//   GET  /accounting/limit-requests?status=PENDING      the requests, newest first
//   POST /accounting/limit-requests/:id/approve|reject  { note? } — needs scm.project_limit.approve, never one's own
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { projectLimit } from './project-limit';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
export const APPROVE_KEY = 'scm.project_limit.approve';
const who = (c: Ctx): string => String(c.get('houzsUser')?.name ?? c.get('houzsUser')?.email ?? 'unknown');

export const projectLimitHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  const r = await projectLimit(c.get('supabase'), co.companyId, id);
  if (!r.ok) return c.json({ error: 'load_failed', reason: r.error }, 404);
  return c.json(r);
};

export const createLimitRequestHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.create')) return c.json({ error: "You don't have permission to ask for extra limit." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const id = Number(c.req.param('id'));
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const kind = String(body.kind ?? '');
  const reason = String(body.reason ?? '').trim();
  if (!['amount', 'pct', 'budget'].includes(kind)) return c.json({ error: 'kind_invalid', message: 'Ask for an amount, a percentage, or more budget.' }, 400);
  if (!reason) return c.json({ error: 'reason_required', message: 'Say why the project needs more.' }, 400);
  const amount = Number(body.amountSen);
  const pct = Number(body.pctBp);
  if ((kind === 'amount' || kind === 'budget') && !(Number.isInteger(amount) && amount > 0)) return c.json({ error: 'amount_invalid' }, 400);
  if (kind === 'pct' && !(Number.isInteger(pct) && pct > 0 && pct <= 10_000)) return c.json({ error: 'pct_invalid' }, 400);
  const sb = c.get('supabase');
  const lim = await projectLimit(sb, co.companyId, id);
  if (!lim.ok) return c.json({ error: 'not_found', message: lim.error }, 404);
  if ((kind === 'budget') !== (lim.funding === 'internal')) {
    return c.json({ error: 'kind_invalid', message: lim.funding === 'internal' ? 'An internal project asks for more budget.' : "A customer project asks for an amount or a higher percentage." }, 400);
  }
  const { data, error } = await sb.from('project_limit_requests').insert({
    company_id: co.companyId, project_id: id, kind, amount_sen: kind === 'pct' ? null : amount, pct_bp: kind === 'pct' ? pct : null,
    reason, status: 'PENDING', requested_by: who(c),
  }).select('*').single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ request: data }, 201);
};

export const listLimitRequestsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const status = String(c.req.query('status') ?? '').toUpperCase();
  const sb = c.get('supabase');
  let q = sb.from('project_limit_requests').select('*').eq('company_id', co.companyId);
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) q = q.eq('status', status);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = (data ?? []) as Array<Record<string, any>>;
  const ids = [...new Set(rows.map((r) => Number(r.project_id)))];
  const names = new Map<number, string>();
  if (ids.length > 0) {
    const { data: ps, error: pErr } = await sb.from('projects').select('id, code, name').eq('company_id', co.companyId).in('id', ids);
    if (pErr) return c.json({ error: 'load_failed', reason: pErr.message }, 500);
    for (const p of (ps ?? []) as Array<{ id: number; code: string | null; name: string }>) names.set(Number(p.id), p.code ? `${p.code} ${p.name}` : p.name);
  }
  return c.json({ requests: rows.map((r) => ({ ...r, project_name: names.get(Number(r.project_id)) ?? String(r.project_id) })) });
};

const decide = (to: 'APPROVED' | 'REJECTED') => async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, APPROVE_KEY)) return c.json({ error: "You don't have permission to decide extra limit." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let note: string | null = null;
  try { note = String(((await c.req.json()) as { note?: unknown }).note ?? '').trim() || null; } catch { /* no body: no note */ }
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data: req, error } = await sb.from('project_limit_requests').select('*').eq('company_id', co.companyId).eq('id', id).maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!req) return c.json({ error: 'not_found' }, 404);
  const r = req as { status: string; requested_by: string; kind: string; pct_bp: number | null; project_id: number };
  if (r.status !== 'PENDING') return c.json({ error: 'decided', message: `This request is ${r.status.toLowerCase()} already.` }, 409);
  /* Nobody approves their own spending (SOP 3.4). */
  if (to === 'APPROVED' && r.requested_by === who(c)) return c.json({ error: 'own_request', message: 'Someone else must approve your own request.' }, 409);
  const { data: done, error: uErr } = await sb.from('project_limit_requests')
    .update({ status: to, decided_by: who(c), decided_at: new Date().toISOString(), decision_note: note })
    .eq('company_id', co.companyId).eq('id', id).eq('status', 'PENDING').select('*').maybeSingle();
  if (uErr) return c.json({ error: 'save_failed', reason: uErr.message }, 500);
  if (!done) return c.json({ error: 'decided', message: 'This request was decided a moment ago.' }, 409);
  /* A higher percentage is the project's own share from now on. */
  if (to === 'APPROVED' && r.kind === 'pct' && r.pct_bp != null) {
    const { error: pErr } = await sb.from('projects').update({ limit_pct_bp: r.pct_bp }).eq('company_id', co.companyId).eq('id', r.project_id);
    if (pErr) return c.json({ error: 'save_failed', reason: pErr.message }, 500);
  }
  return c.json({ request: done });
};
export const approveLimitRequestHandler = decide('APPROVED');
export const rejectLimitRequestHandler = decide('REJECTED');
