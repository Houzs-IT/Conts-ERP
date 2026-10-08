import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** POST /api/statements/generate { period: "2026-08" }
 *  Builds a provisional statement per owner from settled bookings, owner-charged expenses and open owner adjustments
 *  (credits and charges outside bookings, e.g. imported from the owner workbook), with every line kept.
 *  Only provisional statements are rebuilt: one that is finalised is left exactly as it is. A period already sent is refused. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'You can view statements but cannot generate them. Ask a Finance Admin for access.', 403);

  const b = await request.json<{ period: string }>().catch(() => null);
  const period = b?.period ?? '';
  if (!/^\d{4}-\d{2}$/.test(period)) return fail('VALIDATION', 'Period must look like 2026-08.', 422);

  const start = `${period}-01`;
  const end = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const sent = await one<{ n: number }>(env, "SELECT COUNT(*) AS n FROM owner_statements WHERE period_start = ? AND state IN ('sent','paid')", start);
  if (sent && Number(sent.n) > 0) return fail('PERIOD_LOCKED', 'Statements for this period have already been sent and cannot be regenerated.', 409);

  const owners = await all<any>(env, `
    SELECT o.id, COALESCE(MAX(c.management_fee_pct), 25) AS fee_pct
    FROM owners o LEFT JOIN owner_contracts c ON c.owner_id = o.id GROUP BY o.id`);

  let count = 0, skipped = 0;
  for (const o of owners) {
    const existing = await one<{ id: string; state: string }>(env, 'SELECT id, state FROM owner_statements WHERE owner_id = ? AND period_start = ? AND period_end = ?', o.id, start, end);
    if (existing && existing.state !== 'provisional') { skipped++; continue; }

    const stays = await all<any>(env, `
      SELECT r.id, r.check_in, r.check_out, r.collected_revenue, u.unit_number, p.name AS property_name, COALESCE(g.full_name, 'Guest') AS guest_name
      FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
      WHERE u.owner_id = ? AND r.state IN ('confirmed','checked_in','checked_out') AND r.channel NOT IN ('maintenance_block','owner_stay')
        AND r.check_in BETWEEN ? AND ? AND r.collected_revenue > 0 ORDER BY r.check_in`, o.id, start, end);
    const costs = await all<any>(env, `
      SELECT e.id, e.unit_id, e.category, e.description, e.amount, e.incurred_on, e.reference, u.unit_number
      FROM expenses e JOIN units u ON u.id = e.unit_id
      WHERE u.owner_id = ? AND e.charge_to = 'owner' AND e.incurred_on BETWEEN ? AND ? ORDER BY e.incurred_on`, o.id, start, end);

    // Owner credits and charges not yet paid (owner_adjustments, e.g. bills the owner paid himself): every open one
    // dated up to this period's end, unless an earlier statement already carries it. A late one rolls into the next statement.
    const adjustments = await all<any>(env, `
      SELECT a.id, a.unit_id, a.kind, a.amount, a.description, a.occurred_on, a.reference
      FROM owner_adjustments a
      WHERE a.owner_id = ? AND a.state = 'open' AND a.occurred_on <= ?
        AND (a.statement_id IS NULL OR a.statement_id = ?) ORDER BY a.occurred_on, a.id`, o.id, end, existing?.id ?? '');

    const gross = stays.reduce((n, r) => n + Number(r.collected_revenue), 0);
    const expenses = costs.reduce((n, e) => n + Number(e.amount), 0);
    const adjustTotal = adjustments.reduce((n, a) => n + Number(a.amount), 0);
    if (gross === 0 && expenses === 0 && adjustments.length === 0) continue;

    // Integer sen throughout. The fee is rounded once, at the end.
    const fee = Math.round(gross * (Number(o.fee_pct) / 100));
    const net = gross - fee - expenses + adjustTotal;
    const now = nowIso();

    const id = existing?.id ?? crypto.randomUUID();
    await run(env, `
      INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, gross_booking_value, management_fee, expenses_total, adjustments_total, net_payout, currency, generated_at, created_at)
      VALUES (?, ?, ?, ?, 'provisional', ?, ?, ?, ?, ?, 'MYR', ?, ?)
      ON CONFLICT (owner_id, period_start, period_end) DO UPDATE SET
        gross_booking_value = excluded.gross_booking_value, management_fee = excluded.management_fee,
        expenses_total = excluded.expenses_total, adjustments_total = excluded.adjustments_total, net_payout = excluded.net_payout, generated_at = excluded.generated_at
      WHERE owner_statements.state = 'provisional'`, id, o.id, start, end, gross, fee, expenses, adjustTotal, net, now, now);
    // Rebuilding releases what this statement carried before; whatever is still due is attached again below.
    await run(env, "UPDATE owner_adjustments SET statement_id = NULL WHERE statement_id = ? AND state = 'open'", id);
    if (adjustments.length) {
      await run(env, 'UPDATE owner_adjustments SET statement_id = ?, updated_at = ? WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', id, now, JSON.stringify(adjustments.map(a => a.id)));
    }

    await run(env, 'DELETE FROM statement_lines WHERE statement_id = ?', id);
    let order = 0;
    const line = (type: string, category: string | null, description: string, on: string, amount: number, extra: { unit?: string; reservation?: string; expense?: string; ref?: string | null } = {}) =>
      run(env, `
        INSERT INTO statement_lines (id, statement_id, unit_id, reservation_id, expense_id, line_type, category, description, occurred_on, amount, reference, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), id, extra.unit ?? null, extra.reservation ?? null, extra.expense ?? null, type, category, description, on, amount, extra.ref ?? null, order++);
    for (const r of stays) await line('gross', null, `${r.property_name} ${r.unit_number} · ${r.guest_name} · ${r.check_in} to ${r.check_out}`, r.check_in, Number(r.collected_revenue), { reservation: r.id });
    await line('management_fee', null, `Management fee ${Number(o.fee_pct)}%`, end, -fee);
    for (const e of costs) await line('expense', e.category, e.description || e.category, e.incurred_on, -Number(e.amount), { unit: e.unit_id, expense: e.id, ref: e.reference });
    for (const a of adjustments) await line('adjustment', a.kind, a.description, a.occurred_on, Number(a.amount), { unit: a.unit_id ?? undefined, ref: a.reference });
    count++;
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'statement.generate', entityTable: 'owner_statements', entityId: period, after: { period, count, skipped } });
  return json({ period, count, skipped }, 202);
};
