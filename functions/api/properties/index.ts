import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const area = (city: string, postcode: string | null) => (postcode ? `${city}, ${postcode}` : city);

/** GET /api/properties — every building and every unit with its owner, package, monthly expenses and contract (the Units screen's tree and forms). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && session.role !== 'operations_staff') return fail('FORBIDDEN', 'Property records are visible to operations and finance roles.', 403);
  // Owner identity and bank numbers are shown only to roles that manage them.
  const banking = session.manage;

  const buildings = await all<any>(env, 'SELECT id, name, city, state, postcode FROM properties ORDER BY state, name');
  const units = await all<any>(env, `
    SELECT u.id, u.property_id, u.parent_unit_id, u.unit_number, u.bedrooms, u.base_rate, u.listing_name, u.unit_code, u.address, u.package, u.term, u.split_kind, u.split_value, u.guarantee_period,
           p.state, p.address_line, o.display_name AS owner_name, o.ic_number, o.bank_name, o.bank_account_number, o.bank_account_holder,
           c.management_fee_pct, c.starts_on, c.renews_on,
           (SELECT COUNT(*) FROM documents d WHERE d.unit_id = u.id AND d.kind = 'contract') AS contract_docs
    FROM units u JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id
    LEFT JOIN owner_contracts c ON c.id = u.contract_id
    ORDER BY p.name, u.unit_number`);
  const expenses = await all<any>(env, 'SELECT id, unit_id, category, amount, note FROM unit_expenses ORDER BY unit_id, sort_order');
  const docs = await all<any>(env, `SELECT id, unit_id, file_name FROM documents WHERE kind = 'contract' AND unit_id IS NOT NULL ORDER BY created_at`);

  return json({
    generatedAt: nowIso(),
    buildings: buildings.map(b => ({ id: b.id, name: b.name, city: area(b.city, b.postcode), state: b.state })),
    units: units.map(u => ({
      id: u.id, buildingId: u.property_id, parentUnitId: u.parent_unit_id ?? null,
      listingName: u.listing_name ?? '', unitCode: u.unit_code ?? u.unit_number, state: u.state,
      address: u.address ?? `${u.unit_number}, ${u.address_line}`,
      ownerName: u.owner_name,
      ic: banking ? (u.ic_number ?? '') : '', bankName: banking ? (u.bank_name ?? '') : '',
      bankAccount: banking ? (u.bank_account_number ?? '') : '', accountHolder: banking ? (u.bank_account_holder ?? u.owner_name) : '',
      pkg: u.package, term: u.term, split: u.split_kind, splitValue: u.split_value, guaranteePeriod: u.guarantee_period ?? 'month',
      bedrooms: u.bedrooms, ...(banking ? { baseRate: Number(u.base_rate) } : {}),
      expenses: expenses.filter(e => e.unit_id === u.id).map(e => ({ id: e.id, category: e.category, amount: Number(e.amount), note: e.note })),
      contract: {
        feePct: u.management_fee_pct ?? 25, startedOn: u.starts_on ?? '', renewsOn: u.renews_on ?? '',
        documents: docs.filter(d => d.unit_id === u.id).map(d => ({ id: d.id, name: d.file_name })),
      },
    })),
  });
};

/** POST /api/properties { name, city, state } — a new building. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add buildings.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.name?.trim()) return fail('VALIDATION', 'Enter the building name.', 422, { name: 'Enter the building name.' });
  if (!b.state?.trim()) return fail('VALIDATION', 'Pick a state.', 422, { state: 'Pick a state.' });
  if (await one(env, 'SELECT 1 AS x FROM properties WHERE lower(name) = lower(?)', b.name.trim())) return fail('CONFLICT', 'A building with that name already exists.', 409, { name: 'That name is taken.' });

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?)`,
    id, b.name.trim(), String(b.city ?? '').trim(), b.state.trim(), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'property.create', entityTable: 'properties', entityId: id, after: { name: b.name } });
  return json({ id }, 201);
};
