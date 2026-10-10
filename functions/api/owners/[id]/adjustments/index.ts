import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { isIsoDate } from '../../../../_lib/validate';
import { mayChangeAdjustments as mayChange } from '../../../../_lib/ownerScope';

/** Money for or against an owner outside bookings and expenses (owner_adjustments, migration 0052): workbook
 *  credits, debts carried over, and manual credits and charges. Amounts are signed sen: positive adds to the
 *  owner's payout, negative deducts. 'open' ones go on the next statement generated; 'held' ones wait until
 *  someone releases them; 'settled' ones were paid outside Property OS. */


/** GET /api/owners/:id/adjustments — every adjustment of this owner, newest first, with the statement that carries it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Owner adjustments are visible to finance and management roles.', 403);
  const ownerId = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM owners WHERE id = ?', ownerId)) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  const rows = await all<any>(env, `
    SELECT a.id, a.kind, a.amount, a.description, a.occurred_on, a.reference, a.state, a.settled_note, a.source, a.created_at,
           a.unit_id, u.unit_number, p.name AS property_name,
           s.id AS statement_id, s.period_start, s.state AS statement_state
    FROM owner_adjustments a
    LEFT JOIN units u ON u.id = a.unit_id LEFT JOIN properties p ON p.id = u.property_id
    LEFT JOIN owner_statements s ON s.id = a.statement_id
    WHERE a.owner_id = ? ORDER BY a.occurred_on DESC, a.created_at DESC`, ownerId);
  const total = (state: string) => rows.filter(r => r.state === state).reduce((n, r) => n + Number(r.amount), 0);
  return json({
    generatedAt: nowIso(),
    canChange: mayChange(session),
    totals: { held: total('held'), open: rows.filter(r => r.state === 'open' && !r.statement_id).reduce((n, r) => n + Number(r.amount), 0) },
    data: rows.map(r => ({
      id: r.id, kind: r.kind, amount: Number(r.amount), description: r.description, occurredOn: r.occurred_on, reference: r.reference,
      state: r.state, settledNote: r.settled_note, source: r.source, createdAt: r.created_at,
      unit: r.unit_id ? { id: r.unit_id, label: [r.property_name, r.unit_number].filter(Boolean).join(' ') } : null,
      statement: r.statement_id ? { id: r.statement_id, period: String(r.period_start).slice(0, 7), state: r.statement_state } : null,
    })),
  });
};

/** POST /api/owners/:id/adjustments { kind: 'credit'|'charge', amount (sen, > 0), description, occurredOn, unitId? }
 *  A manual credit (adds to the payout) or charge (deducts). It is open, so the next statement generated for a
 *  month ending on or after occurredOn carries it. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayChange(session)) return fail('FORBIDDEN', 'Only management, finance and operations managers can add owner adjustments.', 403);
  const ownerId = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM owners WHERE id = ?', ownerId)) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  const b = await request.json<any>().catch(() => null);
  const kind = b?.kind, amount = Number(b?.amount), description = String(b?.description ?? '').trim(), occurredOn = String(b?.occurredOn ?? '');
  const fields: Record<string, string> = {};
  if (kind !== 'credit' && kind !== 'charge') fields.kind = 'Pick credit or charge.';
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) fields.amount = 'Enter an amount above RM 0.00 and up to RM 1,000,000.';
  if (!description || description.length > 200) fields.description = 'Describe it in up to 200 characters.';
  if (!isIsoDate(occurredOn)) fields.occurredOn = 'Enter the date.';
  const unitId = b?.unitId ? String(b.unitId) : null;
  if (unitId && !await one(env, 'SELECT 1 AS x FROM units WHERE id = ? AND owner_id = ?', unitId, ownerId)) fields.unitId = 'That unit is not this owner\'s.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the highlighted fields.', 422, fields);

  const id = crypto.randomUUID(), now = nowIso(), signed = kind === 'credit' ? amount : -amount;
  await run(env, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, state, source, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'manual', ?, ?, ?)`, id, ownerId, unitId, kind, signed, description, occurredOn, session.userId, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner_adjustment.create', entityTable: 'owner_adjustments', entityId: id,
    after: { ownerId, kind, amount: signed, occurredOn, state: 'open' } });
  return json({ id }, 201);
};
