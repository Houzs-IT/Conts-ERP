import { type Env, all, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const STATES = ['failed', 'pending', 'processing', 'paid'];
const CAP = 5000;

/** GET /api/payouts/export?state=&period=YYYY-MM&q=  or  ?ids=a,b,c (ticked rows)
 *  The payouts Excel for making the bank transfers: units, owner, bank, the FULL account number and amount.
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

  const where: string[] = [], args: unknown[] = [];
  if (ids.length) { where.push(`y.id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
  else {
    if (state) { where.push('y.state = ?'); args.push(state); }
    if (period) { where.push('s.period_start = ?'); args.push(`${period}-01`); }
    if (q) { where.push('o.display_name ILIKE ?'); args.push(`%${q.replace(/[%_\\]/g, m => '\\' + m)}%`); }
  }

  // Units on the statement the payout came from; imported statements have no lines, so then the owner's units.
  const rows = await all<{ units: string | null; display_name: string; bank_name: string | null; bank_account_number: string | null; amount: number }>(env, `
    SELECT COALESCE(
             (SELECT string_agg(DISTINCT p.name || ' ' || u.unit_number, ', ') FROM statement_lines l
                JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id WHERE l.statement_id = y.statement_id),
             (SELECT string_agg(p.name || ' ' || u.unit_number, ', ' ORDER BY p.name, u.unit_number) FROM units u
                JOIN properties p ON p.id = u.property_id WHERE u.owner_id = y.owner_id)) AS units,
           o.display_name, o.bank_name, o.bank_account_number, y.amount
    FROM payouts y JOIN owners o ON o.id = y.owner_id LEFT JOIN owner_statements s ON s.id = y.statement_id
    WHERE 1 = 1 ${where.length ? 'AND ' + where.join(' AND ') : ''}
    ORDER BY CASE y.state WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 WHEN 'processing' THEN 2 ELSE 3 END,
             CASE WHEN y.state = 'paid' THEN y.paid_at END DESC NULLS LAST, y.amount DESC, y.id
    LIMIT ?`, ...args, CAP + 1);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'payout.export',
    entityTable: 'payouts', entityId: 'export',
    after: { count: Math.min(rows.length, CAP), filter: ids.length ? { ticked: ids.length } : { state: state ?? 'all', period: period ?? 'all', q: q ?? '' } },
  });

  return json({
    capped: rows.length > CAP,
    data: rows.slice(0, CAP).map(r => ({
      units: r.units ?? '', ownerName: r.display_name, bankName: r.bank_name, accountNumber: r.bank_account_number ?? '', amount: Number(r.amount),
    })),
  });
};
