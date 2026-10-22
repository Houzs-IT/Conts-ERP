import { type Env, all, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const STATES = ['failed', 'pending', 'processing', 'paid'];
const CAP = 5000;

/** GET /api/payouts/export?state=&period=YYYY-MM&q=  or  ?ids=a,b,c (ticked rows)
 *  The payouts Excel for making the bank transfers: units, owner, bank, the FULL account number and amount.
 *  One row per owner (so per bank account), adding up their payouts under the filter. A statement month is
 *  required unless rows are ticked, so past months already paid never land in one transfer line (owner, 22 Oct 2026).
 *  Management-side roles only, and every export is written to the audit log (who, how many, which filter, never
 *  the numbers), the same as the owner profile's reveal (owner, 22 Oct 2026). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management and finance can export payouts with bank account numbers.', 403);

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const period = url.searchParams.get('period');
  const q = url.searchParams.get('q')?.trim() || null;
  const ids = (url.searchParams.get('ids') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (state && !STATES.includes(state)) return fail('VALIDATION', 'Unknown payout state.', 422);
  if (period && !/^\d{4}-\d{2}$/.test(period)) return fail('VALIDATION', 'Period must look like 2026-08.', 422);
  if (ids.length > 500) return fail('VALIDATION', 'Tick 500 payouts at most.', 422);
  if (!ids.length && !period) return fail('VALIDATION', 'Pick a statement month first, or tick the payouts to export.', 422);

  const where: string[] = [], args: unknown[] = [];
  if (ids.length) { where.push(`y.id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
  else {
    if (state) { where.push('y.state = ?'); args.push(state); }
    if (period) { where.push('s.period_start = ?'); args.push(`${period}-01`); }
    if (q) { where.push('o.display_name ILIKE ?'); args.push(`%${q.replace(/[%_\\]/g, m => '\\' + m)}%`); }
  }

  // The bank account sits on the owner, so one row per owner is one row per account.
  // Units on the statements the payouts came from; imported statements have no lines, so then the owner's units.
  const rows = await all<{ units: string | null; display_name: string; bank_name: string | null; bank_account_number: string | null; amount: number; payouts: number }>(env, `
    WITH y AS (
      SELECT y.owner_id, y.statement_id, y.amount
      FROM payouts y JOIN owners o ON o.id = y.owner_id LEFT JOIN owner_statements s ON s.id = y.statement_id
      WHERE 1 = 1 ${where.length ? 'AND ' + where.join(' AND ') : ''}
    ), names AS (
      SELECT y.owner_id, p.name || ' ' || u.unit_number AS unit FROM y
        JOIN statement_lines l ON l.statement_id = y.statement_id JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
      UNION
      SELECT y.owner_id, p.name || ' ' || u.unit_number FROM y
        JOIN units u ON u.owner_id = y.owner_id JOIN properties p ON p.id = u.property_id
       WHERE NOT EXISTS (SELECT 1 FROM statement_lines l WHERE l.statement_id = y.statement_id)
    )
    SELECT (SELECT string_agg(n.unit, ', ' ORDER BY n.unit) FROM names n WHERE n.owner_id = o.id) AS units,
           o.display_name, o.bank_name, o.bank_account_number, SUM(y.amount) AS amount, COUNT(*)::int AS payouts
    FROM y JOIN owners o ON o.id = y.owner_id
    GROUP BY o.id
    ORDER BY amount DESC, o.display_name
    LIMIT ?`, ...args, CAP + 1);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'payout.export',
    entityTable: 'payouts', entityId: 'export',
    after: { count: rows.slice(0, CAP).reduce((n, r) => n + r.payouts, 0), owners: Math.min(rows.length, CAP), filter: ids.length ? { ticked: ids.length } : { state: state ?? 'all', period: period ?? 'all', q: q ?? '' } },
  });

  return json({
    capped: rows.length > CAP,
    data: rows.slice(0, CAP).map(r => ({
      units: r.units ?? '', ownerName: r.display_name, bankName: r.bank_name, accountNumber: r.bank_account_number ?? '', amount: Number(r.amount), payouts: r.payouts,
    })),
  });
};
