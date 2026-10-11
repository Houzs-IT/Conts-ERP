import { type Env, all, one, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { PLACEHOLDER_OWNER } from '../../_lib/hostplatformImport';
import { loadInputs, computeMonth, statementSettings, hasActivity, type UnitMonth, type Query } from '../../_lib/ownerStatement';
import { monthEndExclusive } from '../../_lib/revenue';
import { auditMany } from '../../_lib/history';
import { notifyUsers } from '../../_lib/notify';

/** POST /api/statements/generate { period: "2026-09", ownerIds?: string[] }
 *  One provisional statement per owner, built by the owner workbook's rules (functions/_lib/ownerStatement.ts):
 *  income split by night into the month, cleaning / bills / additional deductions / miscellaneous charges, the
 *  contract split (share, management fee, Package D minimum, fixed rent), then open owner adjustments (O2).
 *  Every line is kept and points at its booking, expense or adjustment; statement_units keeps each unit's figures.
 *  Only provisional statements are rebuilt: a finalised one is left exactly as it is. A period already sent is refused.
 *  With ownerIds (the owner page's "Generate owner report"), only those owners' statements are built or rebuilt, and
 *  only one of theirs already sent refuses it; every other owner's statement is left untouched.
 *  The whole month is read in four queries and written in a handful, so all owners take well under two seconds. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'You can view statements but cannot generate them. Ask a Finance Admin for access.', 403);

  const b = await request.json<{ period: string; ownerIds?: unknown }>().catch(() => null);
  const period = b?.period ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail('VALIDATION', 'Period must look like 2026-08.', 422);
  if (b?.ownerIds !== undefined && (!Array.isArray(b.ownerIds) || b.ownerIds.length > 500 || b.ownerIds.some(x => typeof x !== 'string'))) {
    return fail('VALIDATION', 'Owners must be a list of owner ids.', 422);
  }
  // An empty list (the statements screen sends one) means every owner.
  const ownerIds = Array.isArray(b?.ownerIds) && b.ownerIds.length ? b.ownerIds as string[] : null;

  const start = `${period}-01`, endEx = monthEndExclusive(period);
  const end = new Date(Date.parse(`${endEx}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

  // One transaction, one period at a time: a second click while the first was still writing failed half-way through
  // (11 Oct 2026), and a finalise landing between the reads and the writes would have had its lines rebuilt.
  const built = await transaction(env, async tx => {
    await one(tx, 'SELECT 1 AS x FROM (SELECT pg_advisory_xact_lock(hashtext(?::text))) l', `statements:${period}`);
    const existing = await all<{ id: string; owner_id: string; state: string }>(tx, 'SELECT id, owner_id, state FROM owner_statements WHERE period_start = ? AND period_end = ? FOR UPDATE', start, end);
    if (existing.some(s => (!ownerIds || ownerIds.includes(s.owner_id)) && (s.state === 'sent' || s.state === 'paid'))) return { locked: true as const };
    const existingOf = new Map(existing.map(s => [s.owner_id, s]));

    const q: Query = (sql, ...args) => all(tx, sql, ...args);
    const [settings, inputs] = await Promise.all([statementSettings(q), loadInputs(q, start, endEx, ownerIds ? { ownerIds } : {})]);
    // A unit still waiting for its owner's name has nobody to send a statement to.
    const units = inputs.units.filter(u => u.owner_name.toLowerCase() !== PLACEHOLDER_OWNER.toLowerCase());
    const ids = new Map<string, string>();
    const idOf = (ownerId: string) => {
      if (!ids.has(ownerId)) ids.set(ownerId, existingOf.get(ownerId)?.id ?? crypto.randomUUID());
      return ids.get(ownerId)!;
    };
    const months = computeMonth(period, { ...inputs, units }, settings, 'open', idOf).filter(hasActivity);

    const byOwner = new Map<string, UnitMonth[]>();
    for (const m of months) { const l = byOwner.get(m.ownerId); if (l) l.push(m); else byOwner.set(m.ownerId, [m]); }

    const now = nowIso();
    const statements: Record<string, unknown>[] = [], lines: Record<string, unknown>[] = [], unitRows: Record<string, unknown>[] = [], attach: { id: string; statement_id: string }[] = [];
    let skipped = 0;
    for (const [ownerId, list] of byOwner) {
      const cur = existingOf.get(ownerId);
      if (cur && cur.state !== 'provisional') { skipped++; continue; }
      const id = idOf(ownerId);
      let gross = 0, fee = 0, costs = 0, adjust = 0, order = 0;
      for (const m of list) {
        for (const l of m.lines) {
          if (l.type === 'gross') gross += l.amount; else if (l.type === 'expense') costs -= l.amount; else if (l.type === 'management_fee') fee -= l.amount; else adjust += l.amount;
          lines.push({
            id: crypto.randomUUID(), statement_id: id, unit_id: l.unitId, reservation_id: l.reservationId ?? null, expense_id: l.expenseId ?? null,
            line_type: l.type, category: l.category, description: l.description.slice(0, 500), occurred_on: l.occurredOn, amount: l.amount,
            reference: l.reference ?? null, sort_order: order++, quantity: l.quantity, adjustment_id: l.adjustmentId ?? null,
          });
        }
        for (const a of m.adjustmentIds) attach.push({ id: a, statement_id: id });
        unitRows.push({
          // A master lease has nothing to split (basis 'none'); it reaches a statement only through owner credits or charges.
          id: crypto.randomUUID(), statement_id: id, unit_id: m.unitId, basis: m.terms.basis === 'none' ? 'fixed_rent' : m.terms.basis, revenue_model: m.terms.model,
          terms_source: m.terms.source, nights: m.nights, days: m.days,
          gross_income: m.gross, deductions: m.deductions, net_income: m.net, owner_pct: m.ownerPct, operator_share: m.operatorShare, guarantee: m.guarantee,
          top_up: m.topUp, fixed_rent: m.fixedRent, payout_before_adjustments: m.payoutBeforeAdjustments, adjustments_total: m.adjustmentsTotal, net_payout: m.netPayout, notes: m.warnings.length ? JSON.stringify(m.warnings) : null, created_at: now,
        });
      }
      statements.push({ id, owner_id: ownerId, period_start: start, period_end: end, gross_booking_value: gross, management_fee: fee, expenses_total: costs,
        adjustments_total: adjust, net_payout: gross - fee - costs + adjust, generated_at: now, created_at: now });
    }

    if (statements.length) {
      const sids = JSON.stringify(statements.map(s => s.id));
      await run(tx, `
        INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, gross_booking_value, management_fee, expenses_total, adjustments_total, net_payout, currency, generated_at, created_at, source)
        SELECT x.id, x.owner_id, x.period_start, x.period_end, 'provisional', x.gross_booking_value, x.management_fee, x.expenses_total, x.adjustments_total, x.net_payout, 'MYR', x.generated_at, x.created_at, 'generated'
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, owner_id text, period_start text, period_end text, gross_booking_value int, management_fee int, expenses_total int,
          adjustments_total int, net_payout int, generated_at text, created_at text)
        ON CONFLICT (owner_id, period_start, period_end) DO UPDATE SET
          gross_booking_value = excluded.gross_booking_value, management_fee = excluded.management_fee, expenses_total = excluded.expenses_total,
          adjustments_total = excluded.adjustments_total, net_payout = excluded.net_payout, generated_at = excluded.generated_at
        WHERE owner_statements.state = 'provisional'`, JSON.stringify(statements));
      await run(tx, 'DELETE FROM statement_lines WHERE statement_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', sids);
      await run(tx, 'DELETE FROM statement_units WHERE statement_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', sids);
      // Rebuilding releases what these statements carried before; whatever is still due is attached again.
      await run(tx, "UPDATE owner_adjustments SET statement_id = NULL, updated_at = ? WHERE statement_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND state = 'open'", now, sids);
      if (attach.length) await run(tx, `UPDATE owner_adjustments a SET statement_id = x.statement_id, updated_at = ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, statement_id text) WHERE a.id = x.id AND a.state = 'open'`, now, JSON.stringify(attach));
      for (let i = 0; i < lines.length; i += 2000) {
        await run(tx, `
          INSERT INTO statement_lines (id, statement_id, unit_id, reservation_id, expense_id, line_type, category, description, occurred_on, amount, reference, sort_order, quantity, adjustment_id)
          SELECT x.id, x.statement_id, x.unit_id, x.reservation_id, x.expense_id, x.line_type, x.category, x.description, x.occurred_on, x.amount, x.reference, x.sort_order, x.quantity, x.adjustment_id
          FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, statement_id text, unit_id text, reservation_id text, expense_id text, line_type text, category text,
            description text, occurred_on text, amount int, reference text, sort_order int, quantity float8, adjustment_id text)`, JSON.stringify(lines.slice(i, i + 2000)));
      }
      await run(tx, `
        INSERT INTO statement_units (id, statement_id, unit_id, basis, revenue_model, terms_source, nights, days, gross_income, deductions, net_income, owner_pct, operator_share, guarantee,
          top_up, fixed_rent, payout_before_adjustments, adjustments_total, net_payout, notes, created_at)
        SELECT x.id, x.statement_id, x.unit_id, x.basis, x.revenue_model, x.terms_source, x.nights, x.days, x.gross_income, x.deductions, x.net_income, x.owner_pct, x.operator_share, x.guarantee,
          x.top_up, x.fixed_rent, x.payout_before_adjustments, x.adjustments_total, x.net_payout, x.notes, x.created_at
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, statement_id text, unit_id text, basis text, revenue_model text, terms_source text, nights int, days int, gross_income int, deductions int,
          net_income int, owner_pct float8, operator_share int, guarantee int, top_up int, fixed_rent int, payout_before_adjustments int, adjustments_total int, net_payout int, notes text, created_at text)`,
        JSON.stringify(unitRows));
    }

    return { locked: false as const, statements, existingOf, skipped, months };
  });
  if (built.locked) return fail('PERIOD_LOCKED', ownerIds ? "This owner's statement for that month has already been sent and cannot be regenerated." : 'Statements for this period have already been sent and cannot be regenerated.', 409);
  const { statements, existingOf, skipped, months } = built;
  const count = statements.length;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'statement.generate', entityTable: 'owner_statements', entityId: period, after: { period, count, skipped } });
  // Each statement's own History shows when it was (re)built and its figures at that point.
  await auditMany(env, statements.map(s => ({
    actorId: session.userId, actorLabel: session.fullName, action: 'statement.generate', entityTable: 'owner_statements', entityId: String(s.id),
    before: existingOf.has(String(s.owner_id)) ? { state: 'provisional' } : undefined,
    after: { period, state: 'provisional', grossBookingValue: s.gross_booking_value, managementFee: s.management_fee, expensesTotal: s.expenses_total, adjustmentsTotal: s.adjustments_total, netPayout: s.net_payout },
  })));
  if (count) {
    await notifyUsers(env, 'finance', {
      kind: 'statement.generated', title: `Owner statements for ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)} generated`,
      body: `${count} provisional ${count === 1 ? 'statement is' : 'statements are'} ready to check${skipped ? `; ${skipped} already final were left as they are` : ''}.`,
      link: '/finance/statements', entityTable: 'owner_statements', entityId: period, except: session.userId,
    });
  }
  return json({ period, count, skipped, warnings: months.reduce((n, m) => n + m.warnings.length, 0), statements: statements.map(s => ({ ownerId: s.owner_id, id: s.id })) }, 202);
};
