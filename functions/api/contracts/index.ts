import { maySee } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { type ContractInput, normalise, invalidContract } from '../../_lib/contracts';
import { modelOf } from '../../_lib/revenueModel';
import { codeOf } from '../../_lib/unitPurpose';
import { contractView } from '../../_lib/unitContract';

const READ_ROLES = ['management', 'operations_manager', 'operations_staff', 'finance_admin'];

/** GET /api/contracts — every owner agreement. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const ownerScoped = session.role === 'owner';
  if (!maySee(session, READ_ROLES) && !ownerScoped) return fail('FORBIDDEN', 'Contracts are visible to operations, finance and management.', 403);

  const rows = await all<any>(env, `
    SELECT c.*, o.display_name,
           (SELECT string_agg(p.name || ' ' || u.unit_number, ', ')
            FROM units u JOIN properties p ON p.id = u.property_id
            WHERE u.contract_id = c.id OR (u.owner_id = c.owner_id AND u.contract_id IS NULL)) AS units_label,
           (SELECT COUNT(*) FROM units u WHERE u.contract_id = c.id OR (u.owner_id = c.owner_id AND u.contract_id IS NULL)) AS unit_count,
           -- The units this record is in force on, for Extend (a renewal is per unit).
           (SELECT json_agg(json_build_object('id', u.id, 'label', p.name || ' ' || u.unit_number) ORDER BY p.name, u.unit_number)
            FROM units u JOIN properties p ON p.id = u.property_id WHERE u.contract_id = c.id) AS in_force_units,
           (SELECT MIN(u.package) FROM units u WHERE u.contract_id = c.id) AS package
    FROM owner_contracts c JOIN owners o ON o.id = c.owner_id
    WHERE 1 = 1 ${ownerScoped ? 'AND o.user_id = ?' : ''}
    ORDER BY COALESCE(c.ends_on, c.renews_on) NULLS LAST, o.display_name`, ...(ownerScoped ? [session.userId] : []));

  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({
      id: r.id, ownerId: r.owner_id, ownerName: r.display_name, unitsLabel: r.units_label ?? '—', unitCount: Number(r.unit_count), model: r.model,
      managementFeePct: Number(r.management_fee_pct), grrAmount: Number(r.grr_amount),
      startsOn: r.starts_on, renewsOn: r.renews_on, endsOn: r.ends_on, offerLetter: r.offer_letter,
      termsLabel: contractView(r, { package: r.package }, 25).termsLabel,
      revenueModel: modelOf({ ...r, contract_id: r.id }), contractCode: codeOf(modelOf({ ...r, contract_id: r.id }), r.contract_code),
      units: (typeof r.in_force_units === 'string' ? JSON.parse(r.in_force_units) : r.in_force_units) ?? [],
    })),
  });
};

/** The owner named by id or by display name; null when none or more than one. */
async function findOwner(env: Env, b: ContractInput): Promise<{ id: string } | 'ambiguous' | null> {
  if (b.ownerId) return one<{ id: string }>(env, 'SELECT id FROM owners WHERE id = ?', b.ownerId);
  const rows = await all<{ id: string }>(env, 'SELECT id FROM owners WHERE lower(display_name) = lower(?)', String(b.ownerName ?? '').trim());
  return rows.length === 1 ? rows[0] : rows.length > 1 ? 'ambiguous' : null;
}

/** POST /api/contracts { ownerId | ownerName, model, managementFeePct, grrAmount, startsOn, renewsOn, offerLetter } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Finance or management access is required.', 403);

  const b = await request.json<ContractInput>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Check the contract details.', 422);
  const fields = invalidContract(b, true);
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the contract details.', 422, fields);
  const owner = await findOwner(env, b);
  if (owner === 'ambiguous') return fail('VALIDATION', 'More than one owner has that name.', 422, { ownerName: 'Pick the owner from the list.' });
  if (!owner) return fail('NOT_FOUND', 'That owner is not on file. Add them under Owners first.', 404, { ownerName: 'Add this owner first.' });

  const n = normalise(b), id = crypto.randomUUID();
  await run(env, `
    INSERT INTO owner_contracts (id, owner_id, management_fee_pct, model, grr_amount, starts_on, renews_on, ends_on, offer_letter, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, owner.id, n.fee ?? 0, n.model, n.grr, n.starts, n.renews, n.ends, b.offerLetter ?? null, nowIso());
  // The new agreement covers every unit of that owner that has none yet.
  await run(env, 'UPDATE units SET contract_id = ?, updated_at = ? WHERE owner_id = ? AND contract_id IS NULL', id, nowIso(), owner.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'contract.create', entityTable: 'owner_contracts', entityId: id, after: { ownerId: owner.id, model: n.model, fee: n.fee, startsOn: n.starts } });
  return json({ id }, 201);
};
