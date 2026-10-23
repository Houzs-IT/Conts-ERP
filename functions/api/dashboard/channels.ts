import { type Env, json, fail, mytToday } from '../../_lib/db';
import { stayMonths, monthEndExclusive, toDate } from '../../_lib/revenue';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { CHANNEL_LABEL } from '../../_lib/hostplatformImport';

/** Where the month's reservations come from: each channel's share of gross value, split by night into the month to
 *  date, the same rows and rule as the KPI tiles (functions/_lib/revenue.ts). Shares are of value, not of count. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  // Money by channel is management's, like the money KPI tiles; others get the card empty rather than an error.
  if (!(session.manage || can(session, 'finance', 'view'))) return json({ generatedAt: new Date().toISOString(), channels: [] });

  const url = new URL(request.url);
  const period = url.searchParams.get('period') ?? mytToday().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return fail('VALIDATION', 'Period must look like 2026-08.', 422);

  const { toExclusive } = toDate(`${period}-01`, monthEndExclusive(period), mytToday());
  const rows = await stayMonths(env, `${period}-01`, toExclusive);
  const byChannel = new Map<string, number>();
  for (const r of rows) byChannel.set(r.channel, (byChannel.get(r.channel) ?? 0) + r.gross);
  const total = [...byChannel.values()].reduce((a, b) => a + b, 0);

  const channels = [...byChannel.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, v]) => ({
      key,
      label: CHANNEL_LABEL[key as keyof typeof CHANNEL_LABEL] ?? key,
      share: total ? Math.round((v / total) * 100) : 0,
      revenue: Math.round(v),
    }));

  return json({ generatedAt: new Date().toISOString(), period, channels });
};
