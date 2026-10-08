import { type Env, one, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const period = url.searchParams.get('period') ?? new Date().toISOString().slice(0, 7);
  const start = `${period}-01`;
  const end = `${period}-31`;

  const rev = await one<{ collected: number; gross: number; nights: number }>(env, `
    SELECT COALESCE(SUM(collected_revenue),0) AS collected,
           COALESCE(SUM(gross_booking_value),0) AS gross,
           COALESCE(SUM(check_out::date - check_in::date),0) AS nights
    FROM reservations
    WHERE state IN ('confirmed','checked_in','checked_out')
      AND channel NOT IN ('maintenance_block','owner_stay')
      AND check_in BETWEEN ? AND ?`, start, end);

  const payout = await one<{ net: number }>(env, `SELECT COALESCE(SUM(net_payout), 0) AS net FROM owner_statements WHERE substr(period_start, 1, 7) = ?`, period);
  const units = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM units WHERE is_listed = 1');
  const daysInMonth = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
  const available = (units?.n ?? 0) * daysInMonth;
  const nights = rev?.nights ?? 0;
  const collected = rev?.collected ?? 0;

  // Occupancy, ADR and RevPAR use the definitions in tokens.json / the brand guide.
  const kpis = [
    { key: 'occupancy', value: available ? ((nights / available) * 100).toFixed(1) : '0.0', unit: 'percent' },
    ...(session.manage ? [
      { key: 'accommodation_revenue', value: collected, currency: 'MYR' },
      { key: 'adr', value: nights ? Math.round(collected / nights) : 0, currency: 'MYR' },
      { key: 'revpar', value: available ? Math.round(collected / available) : 0, currency: 'MYR' },
      { key: 'net_owner_payout', value: Number(payout?.net ?? 0), currency: 'MYR' },
    ] : []),
  ];

  return json({ generatedAt: new Date().toISOString(), period, kpis });
};
