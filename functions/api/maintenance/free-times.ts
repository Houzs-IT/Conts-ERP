import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { mytToday } from '../../_lib/cleaning';

const DAY_START = '09:00', DAY_END = '18:00', MIN_MINUTES = 60;
const at = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+08:00`);
const iso = (ms: number) => `${new Date(ms + 8 * 3600e3).toISOString().slice(0, 16)}:00+08:00`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** GET /api/maintenance/free-times?unitId=&days=14 — when a technician can get into the unit with no guest in it, in
 *  working hours (09:00 to 18:00 Malaysia time), from now over the next days: the gap after a guest checks out and
 *  before the next checks in, or whole days the unit is empty. Slots shorter than an hour are left out. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const sp = new URL(request.url).searchParams;
  const unitId = sp.get('unitId') ?? '';
  const days = Math.min(31, Math.max(1, Math.floor(Number(sp.get('days')) || 14)));
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', unitId))) return fail('NOT_FOUND', 'Pick a unit that exists.', 404, { unitId: 'Pick a unit.' });

  const today = mytToday(), last = addDays(today, days);
  const stays = await all<{ check_in: string; check_out: string; cin: string; cout: string; guest: string }>(env, `
    SELECT r.check_in, r.check_out, COALESCE(NULLIF(r.check_in_time, ''), '15:00') AS cin, COALESCE(NULLIF(r.check_out_time, ''), '11:00') AS cout,
           COALESCE(NULLIF(g.full_name, ''), 'Guest') AS guest
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.unit_id = ? AND r.state IN ('pending','confirmed','checked_in') AND r.channel != 'maintenance_block'
      AND r.check_out >= ? AND r.check_in <= ? ORDER BY r.check_in`, unitId, today, last);
  const busy = stays.map(s => ({ from: at(s.check_in, s.cin), to: at(s.check_out, s.cout), outDay: s.check_out, inDay: s.check_in, guest: s.guest }));

  const now = Date.now();
  const slots: { startsAt: string; endsAt: string; label: string }[] = [];
  for (let i = 0; i < days && slots.length < 30; i++) {
    const day = addDays(today, i);
    let from = Math.max(at(day, DAY_START), Math.ceil(now / 18e5) * 18e5);
    const end = at(day, DAY_END);
    if (from >= end) continue;
    const today_ = busy.filter(b => b.from < end && b.to > from).sort((a, b) => a.from - b.from);
    const pieces: [number, number][] = [];
    for (const b of today_) {
      if (b.from > from) pieces.push([from, Math.min(b.from, end)]);
      from = Math.max(from, b.to);
    }
    if (from < end) pieces.push([from, end]);
    for (const [a, b] of pieces) {
      if (b - a < MIN_MINUTES * 60e3) continue;
      const leaving = busy.some(s => s.outDay === day && Math.abs(s.to - a) < 60e3);
      const arriving = busy.some(s => s.inDay === day && Math.abs(s.from - b) < 60e3);
      slots.push({ startsAt: iso(a), endsAt: iso(b), label: leaving && arriving ? 'Between guests' : leaving ? 'After check-out' : arriving ? 'Before check-in' : 'Unit empty' });
    }
  }
  return json({ unitId, from: today, days, slots });
};
