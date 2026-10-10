import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidDriver, toDriverPayload, type DriverRow } from '../../_lib/transport';
import { strOrNull, flag, genId } from '../../_lib/scm-util';
import { checkPhone, invalid, type Fields } from '../../_lib/validate';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const rows = await all<DriverRow>(env, 'SELECT id, driver_code, name, phone, ic_number, vehicle, active FROM drivers ORDER BY name');
  return json({ generatedAt: nowIso(), data: rows.map(toDriverPayload) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add drivers.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidDriver(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const fields: Fields = {};
  checkPhone(fields, 'phone', b.phone, { label: 'Phone' });
  const badPhone = invalid(fields); if (badPhone) return badPhone;
  const code = (b.driverCode as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM drivers WHERE lower(driver_code) = lower(?)', code)) return fail('CONFLICT', 'A driver with this code already exists.', 409, { driverCode: 'This code is already used.' });
  const id = genId('drv');
  const now = nowIso();
  await run(env, 'INSERT INTO drivers (id, driver_code, name, phone, ic_number, vehicle, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, code, (b.name as string).trim(), strOrNull(b.phone), strOrNull(b.icNumber), strOrNull(b.vehicle), flag(b.active) ?? 1, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'driver.create', entityTable: 'drivers', entityId: id, after: { code } });
  return json({ id, driverCode: code }, 201);
};
