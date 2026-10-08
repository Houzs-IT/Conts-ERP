import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** POST /api/statements/generate { period: "2026-08" }
 *  Builds a provisional statement per owner from settled bookings and owner-charged expenses, with every line kept.
 *  Only provisional statements are rebuilt: one that is finalised is left exactly as it is. A period already sent is refused.
 *  The whole period is read in two queries and written in three, whatever the number of owners: one statement
 *  per call was ~1,600 round trips for a real month (38 s locally). */
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

  const [owners, existing, stays, costs] = await Promise.all([
    all<any>(env, `
      SELECT o.id, COALESCE(MAX(c.management_fee_pct), 25) AS fee_pct
      FROM owners o LEFT JOIN owner_contracts c ON c.owner_id = o.id GROUP BY o.id`),
    all<{ id: string; owner_id: string; state: string }>(env, 'SELECT id, owner_id, state FROM owner_statements WHERE period_start = ? AND period_end = ?', start, end),
    all<any>(env, `
      SELECT r.id, u.owner_id, r.check_in, r.check_out, r.collected_revenue, u.unit_number, p.name AS property_name, COALESCE(g.full_name, 'Guest') AS guest_name
      FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
      WHERE u.owner_id IS NOT NULL AND r.state IN ('confirmed','checked_in','checked_out') AND r.channel NOT IN ('maintenance_block','owner_stay')
        AND r.check_in BETWEEN ? AND ? AND r.collected_revenue > 0 ORDER BY r.check_in, r.id`, start, end),
    all<any>(env, `
      SELECT e.id, u.owner_id, e.unit_id, e.category, e.description, e.amount, e.incurred_on, e.reference, u.unit_number
      FROM expenses e JOIN units u ON u.id = e.unit_id
      WHERE u.owner_id IS NOT NULL AND e.charge_to = 'owner' AND e.incurred_on BETWEEN ? AND ? ORDER BY e.incurred_on, e.id`, start, end),
  ]);

  const group = <T extends { owner_id: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) { const l = m.get(x.owner_id) ?? []; l.push(x); m.set(x.owner_id, l); }
    return m;
  };
  const staysBy = group(stays), costsBy = group(costs);
  const existingBy = new Map(existing.map(s => [s.owner_id, s]));

  const now = nowIso();
  const statements: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  let count = 0, skipped = 0;
  for (const o of owners) {
    const ex = existingBy.get(o.id);
    if (ex && ex.state !== 'provisional') { skipped++; continue; }
    const mine = staysBy.get(o.id) ?? [], spent = costsBy.get(o.id) ?? [];
    const gross = mine.reduce((n, r) => n + Number(r.collected_revenue), 0);
    const expenses = spent.reduce((n, e) => n + Number(e.amount), 0);
    if (gross === 0 && expenses === 0) continue;

    // Integer sen throughout. The fee is rounded once, at the end.
    const fee = Math.round(gross * (Number(o.fee_pct) / 100));
    const id = ex?.id ?? crypto.randomUUID();
    statements.push({ id, owner_id: o.id, gross, fee, expenses, net: gross - fee - expenses });

    let order = 0;
    const line = (type: string, category: string | null, description: string, on: string, amount: number, extra: { unit?: string; reservation?: string; expense?: string; ref?: string | null } = {}) =>
      lines.push({
        id: crypto.randomUUID(), statement_id: id, unit_id: extra.unit ?? null, reservation_id: extra.reservation ?? null, expense_id: extra.expense ?? null,
        line_type: type, category, description, occurred_on: on, amount, reference: extra.ref ?? null, sort_order: order++,
      });
    for (const r of mine) line('gross', null, `${r.property_name} ${r.unit_number} · ${r.guest_name} · ${r.check_in} to ${r.check_out}`, r.check_in, Number(r.collected_revenue), { reservation: r.id });
    line('management_fee', null, `Management fee ${Number(o.fee_pct)}%`, end, -fee);
    for (const e of spent) line('expense', e.category, e.description || e.category, e.incurred_on, -Number(e.amount), { unit: e.unit_id, expense: e.id, ref: e.reference });
    count++;
  }

  if (statements.length) {
    // JSON lists go in as text then jsonb: Hyperdrive's driver sends a bare ?::jsonb parameter as a string scalar.
    await run(env, `
      INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, gross_booking_value, management_fee, expenses_total, net_payout, currency, generated_at, created_at)
      SELECT s.id, s.owner_id, ?, ?, 'provisional', s.gross, s.fee, s.expenses, s.net, 'MYR', ?, ?
      FROM jsonb_to_recordset(?::text::jsonb) AS s(id text, owner_id text, gross int, fee int, expenses int, net int)
      ON CONFLICT (owner_id, period_start, period_end) DO UPDATE SET
        gross_booking_value = excluded.gross_booking_value, management_fee = excluded.management_fee,
        expenses_total = excluded.expenses_total, net_payout = excluded.net_payout, generated_at = excluded.generated_at
      WHERE owner_statements.state = 'provisional'`, start, end, now, now, JSON.stringify(statements));
    const ids = JSON.stringify(statements.map(s => s.id));
    await run(env, 'DELETE FROM statement_lines WHERE statement_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', ids);
    await run(env, `
      INSERT INTO statement_lines (id, statement_id, unit_id, reservation_id, expense_id, line_type, category, description, occurred_on, amount, reference, sort_order)
      SELECT l.id, l.statement_id, l.unit_id, l.reservation_id, l.expense_id, l.line_type, l.category, l.description, l.occurred_on, l.amount, l.reference, l.sort_order
      FROM jsonb_to_recordset(?::text::jsonb) AS l(id text, statement_id text, unit_id text, reservation_id text, expense_id text, line_type text,
        category text, description text, occurred_on text, amount int, reference text, sort_order int)`, JSON.stringify(lines));
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'statement.generate', entityTable: 'owner_statements', entityId: period, after: { period, count, skipped } });
  return json({ period, count, skipped }, 202);
};
