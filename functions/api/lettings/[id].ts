import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';
import { invalidLetting, type LettingInput } from '../../_lib/lettings';

const COLS: [keyof LettingInput, string][] = [['status', 'status'], ['tenantName', 'tenant_name'], ['tenantPhone', 'tenant_phone'], ['startsOn', 'starts_on'],
  ['endsOn', 'ends_on'], ['monthlyRent', 'monthly_rent'], ['agentFee', 'agent_fee'], ['notes', 'notes']];

/** PATCH /api/lettings/:id — changes an Agent-to-let record; only the fields sent. A rented record must keep its
 *  tenant, dates and rent. Records are closed (status closed), not deleted, so the unit's letting history stays. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change lettings.', 403);
  if (!(await hasColumn(env, 'unit_lettings', 'id').catch(() => false))) return fail('NOT_READY', 'Agent to let needs the latest database update.', 501);
  const id = String(params.id);
  const cur = await one<any>(env, 'SELECT * FROM unit_lettings WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That record no longer exists.', 404);
  const b = await request.json<LettingInput>().catch(() => null);
  if (!b || typeof b !== 'object') return fail('VALIDATION', 'Nothing to save.', 422);
  const stored: LettingInput = {
    status: cur.status, tenantName: cur.tenant_name, tenantPhone: cur.tenant_phone, notes: cur.notes,
    startsOn: cur.starts_on ? String(cur.starts_on).slice(0, 10) : null, endsOn: cur.ends_on ? String(cur.ends_on).slice(0, 10) : null,
    monthlyRent: cur.monthly_rent == null ? null : Number(cur.monthly_rent), agentFee: cur.agent_fee == null ? null : Number(cur.agent_fee),
  };
  const sent = COLS.filter(([k]) => k in b);
  const merged: LettingInput = { ...stored, ...Object.fromEntries(sent.map(([k]) => [k, b[k]])) };
  const fields = invalidLetting(merged);
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the letting details.', 422, fields);
  if (!sent.length) return json({ ok: true });
  const val = (k: keyof LettingInput) => { const v = merged[k]; return typeof v === 'string' ? (v.trim() || null) : v ?? null; };
  await run(env, `UPDATE unit_lettings SET ${sent.map(([, c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...sent.map(([k]) => val(k)), nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'letting.update', entityTable: 'unit_lettings', entityId: id,
    before: Object.fromEntries(sent.map(([k]) => [k, stored[k] ?? null])), after: Object.fromEntries(sent.map(([k]) => [k, val(k)])) });
  return json({ ok: true });
};
