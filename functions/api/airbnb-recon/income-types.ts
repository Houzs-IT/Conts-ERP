import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';
import { can } from '../../_lib/access';

/* The kinds of company income on Airbnb reconciliation, kept by finance (chew, 11 Nov 2026: "这个我到时要能自己维护"):
   types, and sub-types under a type (Additional charge: Early check-in / late checkout, Pickup, Others). The four with a
   system_key are the ones the rules pick by themselves; any type can be renamed or made inactive ("也可以inactive 吗？"),
   and is never deleted, so the income recorded with it keeps its name. match_words: words in Airbnb's Details that
   pick the type ("reconciliation 认的字眼"). Migration 0259. */

export interface IncomeType { id: string; parentId: string | null; name: string; systemKey: string | null; matchWords: string | null; active: boolean; sortOrder: number }
interface Row { id: string; parent_id: string | null; name: string; system_key: string | null; match_words: string | null; active: boolean; sort_order: number }

export const hasIncomeTypes = (env: Env) => hasColumn(env, 'airbnb_income_types', 'system_key');
export async function loadIncomeTypes(env: Env): Promise<IncomeType[]> {
  const rows = await all<Row>(env, `SELECT id, parent_id, name, system_key, match_words, active, sort_order FROM airbnb_income_types ORDER BY sort_order, name`);
  return rows.map(r => ({ id: r.id, parentId: r.parent_id, name: r.name, systemKey: r.system_key, matchWords: r.match_words, active: !!r.active, sortOrder: Number(r.sort_order) }));
}

/** GET /api/airbnb-recon/income-types — every type and sub-type, active or not. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'airbnbRecon', 'view')) return fail('FORBIDDEN', 'Your access does not include Airbnb reconciliation.', 403);
  if (!(await hasIncomeTypes(env))) return json({ ready: false, types: [], mayEdit: false });
  return json({ ready: true, types: await loadIncomeTypes(env), mayEdit: can(session, 'airbnbRecon', 'full') });
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** POST /api/airbnb-recon/income-types { id?, parentId?, name, matchWords?, active? } — add a type or a sub-type (a
 *  type under a top-level type), or change one: its name, the words that pick it, active or not. A type's place never
 *  moves. Full access to Airbnb reconciliation only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'airbnbRecon', 'full')) return fail('FORBIDDEN', 'Only people with full access to Airbnb reconciliation change its income types.', 403);
  if (!(await hasIncomeTypes(env))) return fail('NOT_READY', 'Income types are not set up on this database yet (migration 0259).', 503);
  const b = await request.json<any>().catch(() => null);
  const name = clean(b?.name, 80);
  if (!name) return fail('VALIDATION', 'Give the type a name.', 422, { name: 'Give the type a name.' });
  const matchWords = clean(b?.matchWords, 300) || null;
  const active = b?.active === undefined ? true : !!b.active;
  const id = typeof b?.id === 'string' && b.id ? b.id : null;
  const at = nowIso();

  if (id) {
    const before = await one<Row>(env, `SELECT id, parent_id, name, system_key, match_words, active, sort_order FROM airbnb_income_types WHERE id = ?`, id);
    if (!before) return fail('NOT_FOUND', 'That income type is gone. Reload the page.', 404);
    const clash = await one<{ id: string }>(env, `SELECT id FROM airbnb_income_types WHERE lower(name) = lower(?) AND parent_id IS NOT DISTINCT FROM ? AND id <> ?`, name, before.parent_id, id);
    if (clash) return fail('VALIDATION', `There is already a type called ${name} here.`, 422, { name: 'That name is taken here.' });
    await run(env, `UPDATE airbnb_income_types SET name = ?, match_words = ?, active = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
      name, matchWords, active, session.userId, at, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'airbnb_recon.income_type_update', entityTable: 'airbnb_income_types', entityId: id,
      before: { name: before.name, matchWords: before.match_words, active: !!before.active }, after: { name, matchWords, active } });
    return json({ ok: true, id });
  }

  const parentId = typeof b?.parentId === 'string' && b.parentId ? b.parentId : null;
  if (parentId) {
    const parent = await one<{ parent_id: string | null }>(env, `SELECT parent_id FROM airbnb_income_types WHERE id = ?`, parentId);
    if (!parent) return fail('VALIDATION', 'That type is gone. Reload the page.', 422, { parentId: 'Choose the type again.' });
    if (parent.parent_id) return fail('VALIDATION', 'A sub-type goes under a type, not under another sub-type.', 422, { parentId: 'Choose a type.' });
  }
  const clash = await one<{ id: string }>(env, `SELECT id FROM airbnb_income_types WHERE lower(name) = lower(?) AND parent_id IS NOT DISTINCT FROM ?`, name, parentId);
  if (clash) return fail('VALIDATION', `There is already a type called ${name} here.`, 422, { name: 'That name is taken here.' });
  const last = await one<{ n: number | null }>(env, `SELECT max(sort_order) AS n FROM airbnb_income_types WHERE parent_id IS NOT DISTINCT FROM ?`, parentId);
  const parentOrder = parentId ? (await one<{ sort_order: number }>(env, `SELECT sort_order FROM airbnb_income_types WHERE id = ?`, parentId))?.sort_order ?? 0 : 0;
  const sortOrder = Number(last?.n ?? (parentId ? parentOrder : 0)) + (parentId ? 1 : 10);
  const newId = `ait-${crypto.randomUUID()}`;
  await run(env, `INSERT INTO airbnb_income_types (id, parent_id, name, system_key, match_words, active, sort_order, updated_by, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    newId, parentId, name, matchWords, active, sortOrder, session.userId, at);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'airbnb_recon.income_type_create', entityTable: 'airbnb_income_types', entityId: newId,
    after: { parentId, name, matchWords, active } });
  return json({ ok: true, id: newId });
};
