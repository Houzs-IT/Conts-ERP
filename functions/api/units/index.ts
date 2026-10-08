import { type Env, all, one, run, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidUnit, ownerFor, saveExpenses, saveContract, auditUnit, type UnitInput } from '../../_lib/properties';

/** GET /api/units?propertyId=&readiness= — the unit list (also the roster behind every unit picker). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const propertyId = url.searchParams.get('propertyId');
  const readiness = url.searchParams.get('readiness');

  // Owners are scoped server-side. A mismatched id is never a silent empty list.
  const ownerScope = session.role === 'owner' ? 'AND o.user_id = ?' : '';
  const args: unknown[] = [];
  if (propertyId) args.push(propertyId);
  if (readiness) args.push(readiness);
  if (session.role === 'owner') args.push(session.userId);

  const rows = await all<any>(env, `
    SELECT u.id, u.unit_number, u.readiness, u.base_rate, u.is_listed, u.bedrooms, u.bathrooms, u.max_guests,
           p.id AS property_id, p.name AS property_name, p.city, p.state,
           o.id AS owner_id, o.display_name AS owner_name
    FROM units u
    JOIN properties p ON p.id = u.property_id
    JOIN owners o ON o.id = u.owner_id
    WHERE 1 = 1
      ${propertyId ? 'AND u.property_id = ?' : ''}
      ${readiness ? 'AND u.readiness = ?' : ''}
      ${ownerScope}
    ORDER BY p.state, p.name, u.unit_number`, ...args);

  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({
      id: r.id, unitNumber: r.unit_number, readiness: r.readiness,
      propertyId: r.property_id, propertyName: r.property_name, area: r.city, city: r.city, state: r.state,
      ownerId: r.owner_id, ownerName: r.owner_name,
      bedrooms: r.bedrooms, bathrooms: r.bathrooms, maxGuests: r.max_guests,
      isListed: !!r.is_listed,
      // baseRate is integer sen. Field roles never receive money at all.
      ...(session.manage ? { baseRate: r.base_rate } : {}),
    })),
  });
};

/** POST /api/units { id?, buildingId, listingName, unitCode, address, ownerName, ic, bank..., pkg, term, split, splitValue, expenses, contract } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add units.', 403);

  const b = await request.json<UnitInput & { id?: string }>().catch(() => null);
  if (!b?.buildingId) return fail('VALIDATION', 'Pick a building.', 422, { buildingId: 'Pick a building.' });
  const bad = invalidUnit(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  if (!(await one(env, 'SELECT 1 AS x FROM properties WHERE id = ?', b.buildingId))) return fail('NOT_FOUND', 'That building does not exist.', 404);

  const id = b.id && /^[0-9a-f-]{36}$/i.test(b.id) && !(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', b.id)) ? b.id : crypto.randomUUID();
  const number = (b.unitCode ?? '').trim() || `NEW-${id.slice(0, 6).toUpperCase()}`;
  if (await one(env, 'SELECT 1 AS x FROM units WHERE property_id = ? AND lower(unit_number) = lower(?)', b.buildingId, number)) {
    return fail('CONFLICT', 'That building already has a unit with this code.', 409, { unitCode: 'This code is already used in the building.' });
  }

  // A sub-unit must hang off a real unit in the same building; a bad parent just makes a top-level unit.
  let parentUnitId: string | null = null;
  if (typeof b.parentUnitId === 'string' && b.parentUnitId) {
    if (await one(env, 'SELECT 1 AS x FROM units WHERE id = ? AND property_id = ?', b.parentUnitId, b.buildingId)) parentUnitId = b.parentUnitId;
  }

  const ownerId = await ownerFor(env, b), now = nowIso();
  await run(env, `
    INSERT INTO units (id, property_id, parent_unit_id, owner_id, unit_number, unit_code, listing_name, address, package, term, split_kind, split_value, guarantee_period, readiness, base_rate, is_listed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 0, 0, ?, ?)`,
    id, b.buildingId, parentUnitId, ownerId, number, (b.unitCode ?? '').trim() || null, b.listingName ?? null, b.address ?? null,
    b.pkg ?? 'Package C', b.term ?? 'Long term', b.split ?? 'Not set', b.splitValue ?? null, b.guaranteePeriod ?? 'month', now, now);
  if (b.expenses?.length) await saveExpenses(env, id, b.expenses);
  if (b.contract) await saveContract(env, id, ownerId, b.contract);
  await auditUnit(env, session, 'unit.create', id, { buildingId: b.buildingId, unitCode: number });
  return json({ id }, 201);
};
