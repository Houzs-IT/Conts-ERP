import { type Env, all, one, run, json, fail, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { auditMany, type AuditEntry } from '../../_lib/history';
import { finalMonthsFor } from '../../_lib/expenses';
import { NET_FROM_MONTH, monthName, undoProblem, type Applied } from '../../_lib/airbnbConfirm';
import { MONTH, hasAirbnbRecon } from './index';
import { hasIncomeTypes } from './income-types';

/* Airbnb reconciliation, step 2: undo a confirmation, or a reservation kept as it is, while the owner statements it
   touched are still open (chew, 11 Nov 2026). The reservations go back to what they were, the owner credits and charges
   it made are removed, and the decision with its company income goes (migration 0259: ON DELETE CASCADE). Refused once
   a statement that has the change is final, or the reservation was changed since by anything else. */

class Refused extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
const FINAL = ['finalised', 'sent', 'paid'];

/** POST /api/airbnb-recon/undo { month, code } — edit access, as confirming. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'airbnbRecon', 'edit')) return fail('FORBIDDEN', 'Undoing needs edit access to Airbnb reconciliation.', 403);
  const b = await request.json<any>().catch(() => null);
  const month = typeof b?.month === 'string' ? b.month : '';
  const code = typeof b?.code === 'string' ? b.code.trim().toUpperCase() : '';
  if (!MONTH.test(month)) return fail('VALIDATION', 'Choose a month.', 422, { month: 'Choose a month.' });
  if (!code) return fail('VALIDATION', 'Choose the reservation to undo.', 422, { code: 'Choose a reservation.' });
  if (!(await hasAirbnbRecon(env)) || !(await hasIncomeTypes(env))) return fail('NOT_READY', 'Confirming is not set up on this database yet (migration 0259).', 503);

  const d = await one<{ id: string; rule: string; action: string; applied: string | null }>(env,
    `SELECT id, rule, action, applied FROM airbnb_recon_decisions WHERE month = ? AND code = ?`, month, code);
  if (!d) return fail('NOT_FOUND', `Nothing was confirmed for ${code} in ${monthName(month)}.`, 404);
  const applied: Applied = d.applied ? JSON.parse(d.applied) : { changes: [], shares: [], incomeIds: [] };
  const { changes, shares } = applied;

  const [stays, finals, adjustments] = await Promise.all([
    changes.length ? all<{ id: string; gross_booking_value: number; state: string }>(env,
      `SELECT id, gross_booking_value, state FROM reservations WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(changes.map(c => c.id)))
      : Promise.resolve([] as { id: string; gross_booking_value: number; state: string }[]),
    changes.length ? finalMonthsFor(env, changes.map(c => c.unitId), NET_FROM_MONTH) : Promise.resolve(new Map<string, Set<string>>()),
    shares.length ? all<{ id: string; state: string; statement_state: string | null; period_start: string | null }>(env, `
      SELECT a.id, a.state, s.state AS statement_state, s.period_start FROM owner_adjustments a LEFT JOIN owner_statements s ON s.id = a.statement_id
      WHERE a.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(shares.map(s => s.adjustmentId)))
      : Promise.resolve([] as { id: string; state: string; statement_state: string | null; period_start: string | null }[]),
  ]);
  const problem = undoProblem(applied, {
    stays: new Map(stays.map(s => [s.id, { gross: Number(s.gross_booking_value), state: s.state }])),
    finalMonthsOf: u => finals.get(u) ?? new Set(),
    adjustments: new Map(adjustments.map(a => [a.id, { state: a.state, final: FINAL.includes(a.statement_state ?? '') }])),
  });
  if (problem) return fail('CANNOT_UNDO', `${code}: ${problem}`, 409);

  const at = nowIso();
  const actor = { actorId: session.userId, actorLabel: session.fullName };
  const audits: AuditEntry[] = [
    { ...actor, action: 'airbnb_recon.undo', entityTable: 'airbnb_recon_decisions', entityId: d.id, before: { month, code, rule: d.rule, action: d.action }, after: null },
    ...changes.map((c): AuditEntry => ({ ...actor, action: c.before.state !== c.after.state ? 'reservation.status' : 'reservation.airbnb_amount', entityTable: 'reservations', entityId: c.id,
      before: { grossBookingValue: c.after.gross, state: c.after.state }, after: { grossBookingValue: c.before.gross, state: c.before.state, source: 'airbnb_recon_undo', month, code } })),
    ...adjustments.map((a): AuditEntry => ({ ...actor, action: 'owner_adjustment.delete', entityTable: 'owner_adjustments', entityId: a.id,
      before: { source: 'airbnb_recon', code, state: a.state }, after: null })),
  ];
  try {
    await transaction(env, async tx => {
      if (changes.length) {
        const back = await all<{ id: string }>(tx, `
          UPDATE reservations r SET gross_booking_value = x.gross, state = x.state, updated_at = ?
          FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, gross integer, state text, now_gross integer, now_state text)
          WHERE r.id = x.id AND r.gross_booking_value = x.now_gross AND r.state = x.now_state RETURNING r.id`, at,
          JSON.stringify(changes.map(c => ({ id: c.id, gross: c.before.gross, state: c.before.state, now_gross: c.after.gross, now_state: c.after.state }))));
        if (back.length !== changes.length) throw new Refused(409, 'CHANGED', 'A reservation changed a moment ago. Reload the page.');
      }
      if (adjustments.length) {
        await run(tx, `
          DELETE FROM owner_adjustments a WHERE a.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND a.state = 'open'
            AND NOT EXISTS (SELECT 1 FROM owner_statements s WHERE s.id = a.statement_id AND s.state IN ('finalised', 'sent', 'paid'))`,
          JSON.stringify(adjustments.map(a => a.id)));
      }
      await run(tx, `DELETE FROM airbnb_recon_decisions WHERE id = ?`, d.id);
      await auditMany(tx, audits);
    });
  } catch (e) {
    if (e instanceof Refused) return fail(e.code, e.message, e.status);
    throw e;
  }
  // Statements generated meanwhile still show the confirmed figures until generated again.
  const regenerate = new Set<string>([...changes.flatMap(c => c.openMonths), ...adjustments.filter(a => a.period_start).map(a => String(a.period_start).slice(0, 7))]);
  return json({ ok: true, regenerate: [...regenerate].sort() });
};
