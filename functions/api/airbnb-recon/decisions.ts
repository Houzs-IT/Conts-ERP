import { type Env, all, run, json, fail, mytToday, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { auditMany, type AuditEntry } from '../../_lib/history';
import { proposeIncomeType, rmText, type Line } from '../../_lib/airbnbRecon';
import { COUNTED, adjustmentText, bulkEligible, checkIncomeType, incomeKey, monthName, type Applied } from '../../_lib/airbnbConfirm';
import { confirmContext, planWith, setsAirbnbFigure } from '../../_lib/airbnbConfirmLoad';
import { MONTH, hasAirbnbRecon, loadMonth } from './index';
import { hasIncomeTypes, loadIncomeTypes } from './income-types';
import { syncLateIncome } from '../../_lib/ownerLocks';

/* Airbnb reconciliation, step 2 (chew, 11 Nov 2026): finance confirms a reservation's line, or keeps it as it is.
   Confirming writes what the confirm window listed, all together or nothing:
     - the reservation's guest total, so its net is Airbnb's (Airbnb's fee stays), or its cancellation (a past stay);
     - the company income, each line under the type finance chose, else the one the rules proposed;
     - for a month whose owner statement is already final, the owner's share of the change, as an open credit or
       charge dated on the next open month (source airbnb_recon), so that statement carries it;
     - the decision, with what it wrote (applied), to be undone while those statements are open (undo.ts).
   Keeping it as it is writes the decision only. Several at once: only lines that just record company income. The
   plan is worked out again here from fresh figures, never taken from the page. */

class Refused extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }

interface Choice { typeId: string | null; subTypeId: string | null }
interface Item { code: string; decision: 'confirm' | 'keep'; setAmount: boolean; note: string | null; income: Map<string, Choice> }

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

function readItems(raw: unknown): Item[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'Choose a reservation to confirm.';
  if (raw.length > 300) return 'Confirm at most 300 reservations at a time.';
  const out: Item[] = [];
  for (const r of raw as any[]) {
    const code = text(r?.code, 40).toUpperCase();
    if (!code) return 'A reservation in the list has no confirmation code.';
    if (r.decision !== 'confirm' && r.decision !== 'keep') return `${code}: confirm it, or keep it as it is.`;
    if (out.some(x => x.code === code)) return `${code} is in the list twice.`;
    const income = new Map<string, Choice>();
    for (const i of Array.isArray(r.income) ? r.income : []) {
      if (typeof i?.key === 'string') income.set(i.key, { typeId: typeof i.typeId === 'string' ? i.typeId : null, subTypeId: typeof i.subTypeId === 'string' ? i.subTypeId : null });
    }
    out.push({ code, decision: r.decision, setAmount: r.setAmount === true, note: text(r.note, 500) || null, income });
  }
  return out;
}

/** POST /api/airbnb-recon/decisions { month, items: [{ code, decision: 'confirm'|'keep', setAmount?, note?,
 *  income?: [{ key, typeId, subTypeId }] }] } — setAmount: a line to check takes Airbnb's figure. Edit access. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'airbnbRecon', 'edit')) return fail('FORBIDDEN', 'Confirming needs edit access to Airbnb reconciliation.', 403);
  const b = await request.json<any>().catch(() => null);
  const month = typeof b?.month === 'string' ? b.month : '';
  if (!MONTH.test(month)) return fail('VALIDATION', 'Choose a month.', 422, { month: 'Choose a month.' });
  const items = readItems(b?.items);
  if (typeof items === 'string') return fail('VALIDATION', items, 422, { items });
  const many = items.length > 1;
  if (many && items.some(i => i.decision !== 'confirm')) return fail('VALIDATION', 'Keep reservations as they are one at a time.', 422, { items: 'One at a time.' });
  if (!(await hasAirbnbRecon(env)) || !(await hasIncomeTypes(env))) return fail('NOT_READY', 'Confirming is not set up on this database yet (migration 0259).', 503);

  const today = mytToday();
  const [{ recon }, types, taken] = await Promise.all([
    loadMonth(env, month, today),
    loadIncomeTypes(env),
    all<{ code: string; action: string; confirmed_by: string | null }>(env, `
      SELECT d.code, d.action, u.full_name AS confirmed_by FROM airbnb_recon_decisions d LEFT JOIN users u ON u.id = d.confirmed_by
      WHERE d.month = ? AND d.code IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, month, JSON.stringify(items.map(i => i.code))),
  ]);
  const lineOf = new Map(recon.lines.map(l => [l.code, l]));
  const takenOf = new Map(taken.map(d => [d.code, d]));
  const problems: Record<string, string> = {};
  const work: { item: Item; line: Line }[] = [];
  for (const item of items) {
    const line = lineOf.get(item.code);
    const d = takenOf.get(item.code);
    if (!line) problems[item.code] = `${item.code} is not on the ${monthName(month)} list any more. Reload the page.`;
    else if (d) problems[item.code] = `${item.code} was already ${d.action === 'keep' ? 'kept as it is' : 'confirmed'}${d.confirmed_by ? ` by ${d.confirmed_by}` : ''}. Undo that first.`;
    else if (!line.needsConfirm) problems[item.code] = `${item.code} has nothing to confirm.`;
    else if (many && !bulkEligible(line)) problems[item.code] = `${item.code} changes a reservation or needs a look: confirm it on its own.`;
    else work.push({ item, line });
  }
  const ctx = await confirmContext(env, work.filter(w => w.item.decision === 'confirm').map(w => w.line));

  const at = nowIso();
  const actor = { actorId: session.userId, actorLabel: session.fullName };
  const decisions: { id: string; code: string; rule: string; action: string; note: string | null; applied: string | null }[] = [];
  const updates: { id: string; gross: number | null; state: string; before_gross: number | null; before_state: string }[] = [];
  const incomeRows: Record<string, unknown>[] = [];
  const adjustments: { id: string; owner_id: string; unit_id: string; kind: string; amount: number; description: string; occurred_on: string; reference: string }[] = [];
  const audits: AuditEntry[] = [];
  const regenerate = new Set<string>();
  // The units whose reservations this changes: a locked month of theirs needs its late difference posted (owner report close).
  const changedUnits = new Set<string>();
  let incomeSen = 0;

  for (const { item, line } of work) {
    const decisionId = `ard-${crypto.randomUUID()}`;
    if (item.decision === 'keep') {
      decisions.push({ id: decisionId, code: line.code, rule: line.rule, action: 'keep', note: item.note, applied: null });
      audits.push({ ...actor, action: 'airbnb_recon.keep', entityTable: 'airbnb_recon_decisions', entityId: decisionId, after: { month, code: line.code, rule: line.rule, note: item.note } });
      continue;
    }
    const plan = planWith(ctx, line, today, item.setAmount);
    if (!plan.ok) { problems[line.code] = plan.message; continue; }
    const picked: { typeId: string; subTypeId: string | null }[] = [];
    for (const i of line.income) {
      const pick = item.income.get(incomeKey(i)) ?? proposeIncomeType(types, i.kind, i.details);
      const ok = checkIncomeType(types, pick.typeId, pick.subTypeId);
      if (!ok.ok) { problems[line.code] = `${line.code}, ${rmText(i.amount)} company income: ${ok.message}`; break; }
      picked.push({ typeId: ok.typeId, subTypeId: ok.subTypeId });
    }
    if (problems[line.code]) continue;
    const action = setsAirbnbFigure(line, item.setAmount) ? 'set_amount' : line.action;

    for (const c of plan.changes) {
      updates.push({ id: c.id, gross: c.after.gross, state: c.after.state, before_gross: c.before.gross, before_state: c.before.state });
      c.openMonths.forEach(m => regenerate.add(m));
      changedUnits.add(c.unitId);
      audits.push({ ...actor, action: c.after.state === 'cancelled' ? 'reservation.status' : 'reservation.airbnb_amount', entityTable: 'reservations', entityId: c.id,
        before: { grossBookingValue: c.before.gross, state: c.before.state },
        after: { grossBookingValue: c.after.gross, state: c.after.state, source: 'airbnb_recon', month, code: line.code } });
    }
    const shares: Applied['shares'] = [];
    for (const s of plan.shares) {
      const owner = ctx.units.get(s.unitId);
      if (!owner) continue;
      const id = crypto.randomUUID(), kind = s.sen > 0 ? 'credit' : 'charge', occurredOn = `${s.onMonth}-01`;
      adjustments.push({ id, owner_id: owner.ownerId, unit_id: s.unitId, kind, amount: s.sen, description: adjustmentText(line.code, action, s.months), occurred_on: occurredOn, reference: line.code });
      shares.push({ ...s, adjustmentId: id });
      audits.push({ ...actor, action: 'owner_adjustment.create', entityTable: 'owner_adjustments', entityId: id,
        after: { ownerId: owner.ownerId, unitId: s.unitId, kind, amount: s.sen, occurredOn, state: 'open', source: 'airbnb_recon', code: line.code } });
    }
    // Company income is the company's (chew's point 6); the reservation is only where it came from.
    const from = line.stays.find(s => COUNTED.includes(s.state)) ?? line.stays[0] ?? null;
    const incomeIds: string[] = [];
    line.income.forEach((i, n) => {
      const id = `aci-${crypto.randomUUID()}`;
      incomeIds.push(id);
      incomeSen += i.amount;
      incomeRows.push({
        id, month, code: line.code, reservation_id: from?.id ?? null, unit_id: from?.unitId ?? null, amount: i.amount, occurred_on: i.date,
        transaction_ids: JSON.stringify(i.txnIds), note: i.note, type_id: picked[n]!.typeId, sub_type_id: picked[n]!.subTypeId, decision_id: decisionId,
      });
    });
    const applied: Applied = { changes: plan.changes, shares, incomeIds };
    decisions.push({ id: decisionId, code: line.code, rule: line.rule, action, note: item.note, applied: JSON.stringify(applied) });
    audits.push({ ...actor, action: 'airbnb_recon.confirm', entityTable: 'airbnb_recon_decisions', entityId: decisionId,
      after: { month, code: line.code, rule: line.rule, action, note: item.note, reservations: plan.changes.length,
        income: line.income.reduce((n, i) => n + i.amount, 0), ownerShares: shares.map(s => ({ unitId: s.unitId, sen: s.sen, onMonth: s.onMonth })) } });
  }

  const refused = Object.values(problems);
  if (refused.length) {
    const message = refused.length === 1 ? refused[0]! : `${refused.length} of these could not be confirmed, so none was. ${refused[0]}`;
    return fail('VALIDATION', message, 422, problems);
  }

  try {
    await transaction(env, async tx => {
      const added = await all<{ code: string }>(tx, `
        INSERT INTO airbnb_recon_decisions (id, month, code, rule, action, note, applied, confirmed_by, confirmed_at)
        SELECT x.id, ?, x.code, x.rule, x.action, x.note, x.applied, ?, ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, code text, rule text, action text, note text, applied text)
        ON CONFLICT (month, code) DO NOTHING RETURNING code`, month, session.userId, at, JSON.stringify(decisions));
      if (added.length !== decisions.length) throw new Refused(409, 'CONFLICT', 'Someone confirmed one of these a moment ago. Reload the page.');
      if (updates.length) {
        // Only from the figures the plan was made from: a reservation changed meanwhile stops the whole confirmation.
        const done = await all<{ id: string }>(tx, `
          UPDATE reservations r SET gross_booking_value = x.gross, state = x.state, updated_at = ?
          FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, gross integer, state text, before_gross integer, before_state text)
          WHERE r.id = x.id AND r.gross_booking_value = x.before_gross AND r.state = x.before_state RETURNING r.id`, at, JSON.stringify(updates));
        if (done.length !== updates.length) throw new Refused(409, 'CHANGED', 'A reservation changed a moment ago. Reload the page and look again.');
      }
      if (incomeRows.length) {
        await run(tx, `
          INSERT INTO airbnb_company_income (id, month, code, reservation_id, unit_id, amount, occurred_on, transaction_ids, note, type_id, sub_type_id, decision_id, created_by, created_at)
          SELECT x.id, x.month, x.code, x.reservation_id, x.unit_id, x.amount, x.occurred_on, x.transaction_ids, x.note, x.type_id, x.sub_type_id, x.decision_id, ?, ?
          FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, month text, code text, reservation_id text, unit_id text, amount integer, occurred_on text,
            transaction_ids text, note text, type_id text, sub_type_id text, decision_id text)`, session.userId, at, JSON.stringify(incomeRows));
      }
      if (adjustments.length) {
        await run(tx, `
          INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, created_by, created_at, updated_at)
          SELECT x.id, x.owner_id, x.unit_id, x.kind, x.amount, x.description, x.occurred_on, x.reference, 'open', 'airbnb_recon', ?, ?, ?
          FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, owner_id text, unit_id text, kind text, amount integer, description text, occurred_on text, reference text)`,
          session.userId, at, at, JSON.stringify(adjustments));
      }
      await auditMany(tx, audits);
    });
  } catch (e) {
    if (e instanceof Refused) return fail(e.code, e.message, e.status);
    throw e;
  }

  // The late difference of a locked month goes on the next open month: that statement is the one to generate again.
  if (changedUnits.size) (await syncLateIncome(env, { unitIds: [...changedUnits] })).months.forEach(m => regenerate.add(m));

  return json({
    ok: true, confirmed: decisions.filter(d => d.action !== 'keep').length, kept: decisions.filter(d => d.action === 'keep').length,
    reservations: updates.length, income: incomeSen, ownerShares: adjustments.map(a => ({ amount: a.amount, onMonth: a.occurred_on.slice(0, 7) })),
    // Open statements read the reservations when they are generated (again).
    regenerate: [...regenerate].sort(),
  });
};
