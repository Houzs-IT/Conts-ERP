import { type Env, all, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const STATES = ['failed', 'pending', 'processing', 'paid'];
const CAP = 5000;

/** GET /api/payouts/export?state=&period=YYYY-MM&q=  or  ?ids=a,b,c (ticked rows)
 *  The payouts Excel for making the bank transfers: units, owner, bank, the FULL account number and amount.
 *  One row per owner per building, adding up their payouts under the filter (owner, 22 Oct 2026: buildings are
 *  transferred separately; an owner's units in one building, e.g. Continew B16-05 (A) and (B), or Skyline KL A40-05 and
 *  D47-13, stay one row). A statement month is
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

  // A payout is split by building through its statement's lines: each line names its unit, and the lines add up to the
  // payout. A payout whose lines do not add up, or that would leave a building at zero or below (repairs bigger than
  // that building's income), stays whole under all the owner's units, so every row is one real, positive transfer.
  const rows = await all<{ units: string | null; display_name: string; bank_name: string | null; bank_account_number: string | null; amount: number; payouts: number }>(env, `
    WITH y AS (
      SELECT y.id, y.owner_id, y.statement_id, y.amount
      FROM payouts y JOIN owners o ON o.id = y.owner_id LEFT JOIN owner_statements s ON s.id = y.statement_id
      WHERE 1 = 1 ${where.length ? 'AND ' + where.join(' AND ') : ''}
    ), lines AS (
      SELECT y.id AS payout_id, l.unit_id, SUM(l.amount) AS amount
      FROM y JOIN statement_lines l ON l.statement_id = y.statement_id GROUP BY y.id, l.unit_id
    ), buildings AS (
      SELECT x.payout_id, u.property_id, SUM(x.amount) AS amount
      FROM lines x JOIN units u ON u.id = x.unit_id GROUP BY x.payout_id, u.property_id
    ), split AS (
      SELECT y.id FROM y
      WHERE (SELECT SUM(x.amount) FROM lines x WHERE x.payout_id = y.id) = y.amount
        AND NOT EXISTS (SELECT 1 FROM lines x WHERE x.payout_id = y.id AND x.unit_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.payout_id = y.id AND b.amount <= 0)
    ), pieces AS (
      SELECT y.id, y.owner_id, u.property_id::text AS building, p.name || ' ' || u.unit_number AS unit, x.amount
      FROM y JOIN split USING (id) JOIN lines x ON x.payout_id = y.id JOIN units u ON u.id = x.unit_id JOIN properties p ON p.id = u.property_id
      UNION ALL
      SELECT y.id, y.owner_id, 'whole:' || y.id, (SELECT string_agg(p.name || ' ' || u.unit_number, ', ' ORDER BY p.name, u.unit_number)
        FROM units u JOIN properties p ON p.id = u.property_id WHERE u.owner_id = y.owner_id), y.amount
      FROM y WHERE y.id NOT IN (SELECT id FROM split)
    )
    SELECT string_agg(DISTINCT x.unit, ', ' ORDER BY x.unit) AS units,
           o.display_name, o.bank_name, o.bank_account_number, SUM(x.amount) AS amount, COUNT(DISTINCT x.id)::int AS payouts
    FROM pieces x JOIN owners o ON o.id = x.owner_id
    GROUP BY o.id, x.building
    ORDER BY amount DESC, o.display_name, units
    LIMIT ?`, ...args, CAP + 1);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'payout.export',
    entityTable: 'payouts', entityId: 'export',
    after: { rows: Math.min(rows.length, CAP), filter: ids.length ? { ticked: ids.length } : { state: state ?? 'all', period: period ?? 'all', q: q ?? '' } },
  });

  return json({
    capped: rows.length > CAP,
    data: rows.slice(0, CAP).map(r => ({
      units: r.units ?? '', ownerName: r.display_name, bankName: r.bank_name, accountNumber: r.bank_account_number ?? '', amount: Number(r.amount), payouts: r.payouts,
    })),
  });
};
