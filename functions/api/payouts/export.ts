import { type Env, all, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { bankAccountsReady } from '../../_lib/ownerBank';

const STATES = ['failed', 'pending', 'processing', 'paid', 'cancelled'];
const CAP = 5000;
const HAND_NOTE = 'Could not split this payout by account. It is the whole payout under the main account, but some units of this owner pay to other accounts. Check each unit.';
const UNIT_NOTE = "Could not split this payout by unit: a unit's share is zero or below. It is the whole payout in one transfer.";
/** How the file groups an owner's payout into transfers (chew, 13 Nov 2026: chosen at each download, "每次下载时选"):
 *  building, as before (one per owner, building and account); owner (one per owner and account, whatever the building);
 *  unit (one per unit and account). A transfer always goes to one account, so every grouping splits by account. */
const GROUPS = ['building', 'owner', 'unit'] as const;
type Group = typeof GROUPS[number];

/** GET /api/payouts/export?state=&period=YYYY-MM&q=  or  ?ids=a,b,c (ticked rows)
 *  The payouts Excel for making the bank transfers: units, owner, bank, the FULL account number and amount.
 *  One row per owner per building per bank account, adding up their payouts under the filter (owner, 22 Oct 2026:
 *  buildings are transferred separately; an owner's units in one building and on one account, e.g. Continew B16-05 (A)
 *  and (B), stay one row; units on different accounts get a row each). Each row has checkByHand (and a note saying why)
 *  when the payout could not be split and the owner has units on other accounts. A statement month is
 *  required unless rows are ticked, so past months already paid never land in one transfer line (owner, 22 Oct 2026).
 *  ?group=building|owner|unit picks how an owner's payout is split into transfers (default building, as before).
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
  const asked = url.searchParams.get('group') ?? 'building';
  if (!(GROUPS as readonly string[]).includes(asked)) return fail('VALIDATION', 'Group the transfers by building, owner or unit.', 422);
  const group = asked as Group;

  // A cancelled payout (its statement was unlocked before it was paid) is never transferred (review C2).
  const where: string[] = ["y.state <> 'cancelled'"], args: unknown[] = [];
  if (ids.length) { where.push(`y.id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
  else {
    if (state) { where.push('y.state = ?'); args.push(state); }
    if (period) { where.push('s.period_start = ?'); args.push(`${period}-01`); }
    if (q) { where.push('o.display_name ILIKE ?'); args.push(`%${q.replace(/[%_\\]/g, m => '\\' + m)}%`); }
  }

  // A payout is split by the chosen grouping (building, owner or unit) and bank account through its statement's lines:
  // each line names its unit, and the lines add up to the payout. A unit pays to the account chosen for it (0180), else
  // the owner's main account. A payout whose lines do not add up, or that would leave a group and account at zero or
  // below (repairs bigger than that income), stays whole under the owner's main account, so every row is one real,
  // positive transfer. If that owner has any unit on another account, or the file was asked by unit and the payout
  // covers several units, the whole row is flagged for a hand check instead of being paid silently.
  const ready = await bankAccountsReady(env);
  const acct = ready ? "COALESCE(u.bank_account_id, '')" : "''";
  const byHand = ready ? 'EXISTS (SELECT 1 FROM units k WHERE k.owner_id = y.owner_id AND k.bank_account_id IS NOT NULL)' : 'false';
  // The group a unit's share falls in: its building, nothing (the owner's whole payout), or the unit itself.
  const bucket = group === 'building' ? 'u.property_id::text' : group === 'unit' ? 'u.id' : "''";
  const bucketBy = group === 'owner' ? '' : `, ${bucket}`;
  const unitHand = group === 'unit' ? '(SELECT count(DISTINCT x.unit_id) FROM lines x WHERE x.payout_id = y.id) > 1' : 'false';
  const pick = (own: string, extra: string) => (ready ? `CASE WHEN a.id IS NULL THEN o.${own} ELSE a.${extra} END` : `o.${own}`);
  const rows = await all<{ units: string | null; display_name: string; bank_name: string | null; bank_account_number: string | null; amount: number; payouts: number; check_by_hand: boolean; unsplit_unit: boolean }>(env, `
    WITH y AS (
      SELECT y.id, y.owner_id, y.statement_id, y.amount
      FROM payouts y JOIN owners o ON o.id = y.owner_id LEFT JOIN owner_statements s ON s.id = y.statement_id
      WHERE 1 = 1 ${where.length ? 'AND ' + where.join(' AND ') : ''}
    ), lines AS (
      SELECT y.id AS payout_id, l.unit_id, SUM(l.amount) AS amount
      FROM y JOIN statement_lines l ON l.statement_id = y.statement_id GROUP BY y.id, l.unit_id
    ), buckets AS (
      SELECT x.payout_id, ${bucket} AS bucket, ${acct} AS acct, SUM(x.amount) AS amount
      FROM lines x JOIN units u ON u.id = x.unit_id GROUP BY x.payout_id${bucketBy}${ready ? ', ' + acct : ''}
    ), split AS (
      SELECT y.id FROM y
      WHERE (SELECT SUM(x.amount) FROM lines x WHERE x.payout_id = y.id) = y.amount
        AND NOT EXISTS (SELECT 1 FROM lines x WHERE x.payout_id = y.id AND x.unit_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM buckets b WHERE b.payout_id = y.id AND b.amount <= 0)
    ), pieces AS (
      SELECT y.id, y.owner_id, ${bucket} AS bucket, ${acct} AS acct, p.name || ' ' || u.unit_number AS unit, x.amount, false AS by_hand, false AS by_unit
      FROM y JOIN split USING (id) JOIN lines x ON x.payout_id = y.id JOIN units u ON u.id = x.unit_id JOIN properties p ON p.id = u.property_id
      UNION ALL
      SELECT y.id, y.owner_id, 'whole:' || y.id, '', (SELECT string_agg(p.name || ' ' || u.unit_number, ', ' ORDER BY p.name, u.unit_number)
        FROM units u JOIN properties p ON p.id = u.property_id WHERE u.owner_id = y.owner_id), y.amount, ${byHand}, ${unitHand}
      FROM y WHERE y.id NOT IN (SELECT id FROM split)
    ), paid AS (
      SELECT x.id, x.owner_id, x.bucket, x.unit, x.amount, x.by_hand, x.by_unit, o.display_name,
             ${pick('bank_name', 'bank_name')} AS bank_name, ${pick('bank_account_number', 'account_number')} AS account_number
      FROM pieces x JOIN owners o ON o.id = x.owner_id ${ready ? "LEFT JOIN owner_bank_accounts a ON a.id = NULLIF(x.acct, '') AND a.owner_id = x.owner_id" : ''}
    )
    SELECT string_agg(DISTINCT x.unit, ', ' ORDER BY x.unit) AS units,
           x.display_name, MIN(x.bank_name) AS bank_name, x.account_number AS bank_account_number, SUM(x.amount) AS amount, COUNT(DISTINCT x.id)::int AS payouts,
           bool_or(x.by_hand) AS check_by_hand, bool_or(x.by_unit) AS unsplit_unit
    FROM paid x
    GROUP BY x.owner_id, x.display_name, x.bucket, x.account_number
    ORDER BY amount DESC, x.display_name, units
    LIMIT ?`, ...args, CAP + 1);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'payout.export',
    entityTable: 'payouts', entityId: 'export',
    after: { rows: Math.min(rows.length, CAP), group, filter: ids.length ? { ticked: ids.length } : { state: state ?? 'all', period: period ?? 'all', q: q ?? '' } },
  });

  return json({
    capped: rows.length > CAP,
    data: rows.slice(0, CAP).map(r => {
      const notes = [r.unsplit_unit === true ? UNIT_NOTE : '', r.check_by_hand === true ? HAND_NOTE : ''].filter(Boolean);
      return {
        units: r.units ?? '', ownerName: r.display_name, bankName: r.bank_name, accountNumber: r.bank_account_number ?? '', amount: Number(r.amount), payouts: r.payouts,
        checkByHand: notes.length > 0, ...(notes.length ? { note: notes.join(' ') } : {}),
      };
    }),
  });
};
