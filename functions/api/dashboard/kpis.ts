import { type Env, all, one, json, fail, mytToday } from '../../_lib/db';
import { stayMonths, metrics, monthEndExclusive, toDate } from '../../_lib/revenue';
import { requireSession } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const period = url.searchParams.get('period') ?? mytToday().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail('VALIDATION', 'Period must look like 2026-08.', 422);

  // functions/_lib/revenue.ts: gross value and nights split by night into the month, to date like Portfolio (the
  // month in progress stops at today). Occupancy, ADR and RevPAR are over listed units (the nights that could be
  // sold); revenue counts every unit.
  const { toExclusive, days } = toDate(`${period}-01`, monthEndExclusive(period), mytToday());
  const rows = await stayMonths(env, `${period}-01`, toExclusive);
  const listedIds = new Set((await all<{ id: string }>(env, 'SELECT id FROM units WHERE is_listed = 1')).map(u => u.id));
  const listed = metrics(rows.filter(r => listedIds.has(r.unit_id)), listedIds.size * days);
  const everything = metrics(rows, 0);
  const payout = await one<{ net: number }>(env, `SELECT COALESCE(SUM(net_payout), 0) AS net FROM owner_statements WHERE substr(period_start, 1, 7) = ?`, period);

  const kpis = [
    { key: 'occupancy', value: listed.occupancy.toFixed(1), unit: 'percent' },
    ...(session.manage ? [
      { key: 'accommodation_revenue', value: everything.gross, currency: 'MYR' },
      { key: 'adr', value: listed.adr, currency: 'MYR' },
      { key: 'revpar', value: listed.revpar, currency: 'MYR' },
      { key: 'net_owner_payout', value: Number(payout?.net ?? 0), currency: 'MYR' },
    ] : []),
  ];

  return json({ generatedAt: new Date().toISOString(), period, kpis });
};
