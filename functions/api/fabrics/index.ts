import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidFabric, toFabricPayload, type FabricRow } from '../../_lib/fabric';
import { strOrNull, intOrNull, flag } from '../../_lib/scm-util';
import { checkSen, checkInt, invalid as invalidFields, type Fields } from '../../_lib/validate';

const COLS = 'id, fabric_code, label, tier, default_surcharge_sen, sofa_tier, bedframe_tier, swatch_key, active, sort_order';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const rows = await all<FabricRow>(env, `SELECT ${COLS} FROM fabric_library ORDER BY sort_order, label`);
  return json({ generatedAt: nowIso(), data: rows.map(toFabricPayload) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add fabrics.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidFabric(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const fields: Fields = {};
  checkSen(fields, 'defaultSurchargeSen', b.defaultSurchargeSen, { label: 'Surcharge' });
  checkInt(fields, 'sortOrder', b.sortOrder, { label: 'Sort order' });
  const badFields = invalidFields(fields); if (badFields) return badFields;
  const id = (b.id as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM fabric_library WHERE lower(id) = lower(?)', id)) return fail('CONFLICT', 'A fabric with this id already exists.', 409, { id: 'This id is already used.' });
  const now = nowIso();
  await run(env, `INSERT INTO fabric_library (id, fabric_code, label, tier, default_surcharge_sen, sofa_tier, bedframe_tier, swatch_key, active, sort_order, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, strOrNull(b.fabricCode), (b.label as string).trim(), strOrNull(b.tier) ?? 'standard', intOrNull(b.defaultSurchargeSen) ?? 0,
    strOrNull(b.sofaTier), strOrNull(b.bedframeTier), strOrNull(b.swatchKey), flag(b.active) ?? 1, intOrNull(b.sortOrder) ?? 0, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'fabric.create', entityTable: 'fabric_library', entityId: id, after: { label: b.label } });
  return json({ id }, 201);
};
