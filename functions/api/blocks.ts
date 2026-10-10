import { type Env, run, json, fail, audit, nowIso } from '../_lib/db';
import { requireSession, isFieldRole } from '../_lib/auth';
import { findClash, clashResponseBody } from '../_lib/reservations';
import { resolveUnit } from '../_lib/ops';
import { syncAvailabilityIfLinked, channexMappingFor } from '../_lib/channexSync';
import { channexConfigured } from '../_lib/channex';
import { checkDate, invalid, type Fields } from '../_lib/validate';

const KINDS = ['maintenance', 'owner_stay', 'other'] as const;
const KIND_LABEL: Record<typeof KINDS[number], string> = { maintenance: 'Maintenance', owner_stay: 'Owner stay', other: 'Blocked' };

/** POST /api/blocks { unitId, from, to, kind?, reason?, issueId? } — takes a unit off sale.
 *  With dates it also holds them on the calendar (`to` is the check-out day). `kind` says why: maintenance (the
 *  default), owner_stay (held as an owner stay, channel owner_stay) or other (a note is then required).
 *  `reason` is the note shown on the hold. With only an issueId (from a maintenance job) it marks the unit and
 *  the job as blocking, with no calendar dates yet. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot block dates.', 403);

  const b = await request.json<any>().catch(() => null);
  const unit = await resolveUnit(env, b?.unitId, b?.propertyName);
  if (unit === 'ambiguous') return fail('VALIDATION', 'More than one unit has that number. Say which building.', 422);
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404);

  const kind = (b.kind ?? 'maintenance') as typeof KINDS[number];
  if (!KINDS.includes(kind)) return fail('VALIDATION', 'Say why the dates are held: maintenance, owner stay or other.', 422, { kind: 'Pick a reason.' });
  const note = String(b.reason ?? '').trim().slice(0, 200);
  if (kind === 'other' && !note) return fail('VALIDATION', 'Add a note saying why the dates are held.', 422, { reason: 'Add a note.' });

  const now = nowIso();
  let id: string | null = null;
  if (b.from || b.to) {
    if (!b.from || !b.to) return fail('VALIDATION', 'Give both dates.', 422);
    const fields: Fields = {};
    checkDate(fields, 'from', b.from, { label: 'From', required: true });
    checkDate(fields, 'to', b.to, { label: 'To', required: true });
    const bad = invalid(fields); if (bad) return bad;
    if (b.to <= b.from) return fail('VALIDATION', 'The end date must be after the start date.', 422, { to: 'Pick a later end date.' });
    const clash = await findClash(env, unit.id, b.from, b.to, null);
    if (clash) return json(clashResponseBody(clash), 409);
    id = crypto.randomUUID();
    await run(env, `
      INSERT INTO reservations (id, unit_id, channel, state, check_in, check_out, guests_count, gross_booking_value, currency, notes, block_reason, created_at, updated_at)
      VALUES (?, ?, ?, 'confirmed', ?, ?, 0, 0, 'MYR', ?, ?, ?, ?)`,
      id, unit.id, kind === 'owner_stay' ? 'owner_stay' : 'maintenance_block', b.from, b.to, note || KIND_LABEL[kind], kind, now, now);
    // The repair job this block is for, so closing the job gives the nights back (migration 0095; skipped without it).
    if (b.issueId) await run(env, 'UPDATE reservations SET maintenance_issue_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM maintenance_issues WHERE id = ? AND unit_id = ?)', String(b.issueId), id, String(b.issueId), unit.id).catch(() => {});
  } else if (!b.issueId) {
    return fail('VALIDATION', 'Give the dates to block.', 422);
  }

  if (b.issueId) {
    await run(env, `UPDATE maintenance_issues SET blocks_unit = 1, blocked_from = COALESCE(blocked_from, ?), updated_at = ? WHERE id = ? AND unit_id = ?`, b.from ?? now.slice(0, 10), now, String(b.issueId), unit.id);
    await run(env, `UPDATE units SET readiness = 'maintenance', updated_at = ? WHERE id = ?`, now, unit.id);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.block', entityTable: 'units', entityId: unit.id, after: { from: b.from ?? null, to: b.to ?? null, kind, reason: note || null, issueId: b.issueId ?? null } });
  // Says whether the channels were told, so the screen does not claim it when the unit is not linked.
  let channel: 'queued' | 'not_linked' | 'failed' | null = null;
  if (b.from && b.to) {
    try {
      if (!channexConfigured(env) || !(await channexMappingFor(env, unit.id))) channel = 'not_linked';
      else { await syncAvailabilityIfLinked(env, unit.id, b.from, b.to, false); channel = 'queued'; }
    } catch { channel = 'failed'; }
  }
  return json({ id, unitId: unit.id, kind, effects: { channel } }, 201);
};
