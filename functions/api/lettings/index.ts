import { type Env, all, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';
import { maySee } from '../../_lib/access';
import { invalidLetting, REMIND_DAYS, type LettingInput } from '../../_lib/lettings';

const READ = ['management', 'operations_manager', 'finance_admin', 'operations_staff'];
const ready = (env: Env) => hasColumn(env, 'unit_lettings', 'id').catch(() => false);

/** GET /api/lettings[?unitId=] — every Agent-to-let record (or one unit's), latest change first, with the unit and
 *  owner, and whether a rented unit's agreement ends within REMIND_DAYS (time to find next year's tenant). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!maySee(session, READ)) return fail('FORBIDDEN', 'Agent to let is visible to operations, finance and management.', 403);
  if (!(await ready(env))) return json({ ready: false, remindDays: REMIND_DAYS, data: [] });
  const unitId = new URL(request.url).searchParams.get('unitId');
  const rows = await all<any>(env, `
    SELECT l.*, u.unit_number, u.unit_code, p.id AS building_id, p.name AS building, o.id AS owner_id, o.display_name AS owner_name
    FROM unit_lettings l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id
    ${unitId ? 'WHERE l.unit_id = ?' : ''}
    ORDER BY l.updated_at DESC`, ...(unitId ? [unitId] : []));
  const today = mytToday();
  const days = (d: string | null) => (d ? Math.round((Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5) : null);
  const money = session.manage;
  return json({
    ready: true, remindDays: REMIND_DAYS,
    data: rows.map(r => {
      const left = r.status === 'rented' ? days(r.ends_on) : null;
      return {
        id: r.id, unitId: r.unit_id, unitLabel: `${r.building} ${r.unit_code || r.unit_number}`, buildingId: r.building_id, building: r.building,
        ownerId: r.owner_id, ownerName: r.owner_name, status: r.status, tenantName: r.tenant_name, tenantPhone: r.tenant_phone,
        startsOn: r.starts_on ? String(r.starts_on).slice(0, 10) : null, endsOn: r.ends_on ? String(r.ends_on).slice(0, 10) : null,
        ...(money ? { monthlyRent: r.monthly_rent == null ? null : Number(r.monthly_rent), agentFee: r.agent_fee == null ? null : Number(r.agent_fee) } : {}),
        notes: r.notes, daysLeft: left, remind: left != null && left <= REMIND_DAYS, updatedAt: r.updated_at,
      };
    }),
  });
};

/** POST /api/lettings { unitId, status, tenantName, tenantPhone, startsOn, endsOn, monthlyRent, agentFee, notes } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can record lettings.', 403);
  if (!(await ready(env))) return fail('NOT_READY', 'Agent to let needs the latest database update.', 501);
  const b = await request.json<LettingInput>().catch(() => null);
  if (!b?.unitId) return fail('VALIDATION', 'Pick the unit.', 422, { unitId: 'Pick the unit.' });
  const m = { ...b, status: b.status ?? 'looking' };
  const fields = invalidLetting(m);
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the letting details.', 422, fields);
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', b.unitId))) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO unit_lettings (id, unit_id, status, tenant_name, tenant_phone, starts_on, ends_on, monthly_rent, agent_fee, notes, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, b.unitId, m.status, m.tenantName?.trim() || null, m.tenantPhone?.trim() || null,
    m.startsOn || null, m.endsOn || null, m.monthlyRent ?? null, m.agentFee ?? null, m.notes?.trim() || null, now, now, session.userId);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'letting.create', entityTable: 'unit_lettings', entityId: id,
    after: { unitId: b.unitId, status: m.status, tenant: m.tenantName ?? null, startsOn: m.startsOn ?? null, endsOn: m.endsOn ?? null } });
  return json({ id }, 201);
};
