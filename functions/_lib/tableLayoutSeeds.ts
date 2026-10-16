import { type Env, run, nowIso } from './db';
import type { Layout } from './tableLayouts';

/** Company views every desk account finds under Views on day one (owner, 11 Oct 2026), so the lists open on the
 *  questions people ask instead of an empty Views menu. Each is an ordinary company view (user_id NULL): management
 *  may rename, change or delete it like any other.
 *
 *  Created when missing, never overwritten: the id is fixed, so a seed someone edited or renamed is left as it is,
 *  and one someone deleted (its table_view.delete audit row) does not come back. Filter values are the list's own URL
 *  parameters; '@month_start' and the like are dates relative to today (src/lib/relativeDates.ts). */
interface Seed { id: string; name: string; layout: Layout }
const view = (table: string, slug: string, name: string, filters: Record<string, string>, sort: string | null = null): Seed =>
  ({ id: `seed.${table}.${slug}`, name, layout: { columns: [], sort, pageSize: null, filters } });

export const SEEDS: Record<string, Seed[]> = {
  bookings: [
    view('bookings', 'arriving-today', 'Arriving today', { todo: 'arriving' }),
    view('bookings', 'checking-out-today', 'Checking out today', { todo: 'departing' }),
    view('bookings', 'currently-hosting', 'Currently hosting', { view: 'inhouse' }),
    view('bookings', 'unpaid-direct', 'Unpaid direct reservations', { todo: 'unpaid' }),
    view('bookings', 'payout-pending', 'Channel payout pending', { todo: 'payout' }),
    // Reservations has no cancellation date of its own: "this month" is cancelled stays that fall in this month.
    view('bookings', 'cancelled-this-month', 'Cancelled this month', { view: 'cancelled', from: '@month_start', to: '@month_end' }),
    view('bookings', 'long-stays', 'Long stays (28+ nights)', { view: 'all', nightsMin: '28' }, 'stay:desc'),
  ],
  guests: [
    // The Missing ID filter already counts only guests with a stay coming up or under way (functions/_lib/guestList.ts).
    view('guests', 'missing-id', 'Missing ID with an upcoming stay', { filter: 'missing_id' }),
    view('guests', 'repeat', 'Repeat guests', { filter: 'repeat' }, 'stays:desc'),
    view('guests', 'vip', 'VIP', { filter: 'vip' }),
  ],
};

/** Tables already checked by this worker: after the first look the seeds are there (or were deleted on purpose). */
const done = new Set<string>();

export async function seedCompanyViews(env: Env, table: string): Promise<void> {
  const seeds = SEEDS[table];
  if (!seeds || done.has(table)) return;
  const now = nowIso();
  // One statement for the whole table; ON CONFLICT also covers a company view someone already saved under the same name.
  await run(env, `INSERT INTO table_layouts (id, table_key, user_id, name, is_default, layout, created_by, created_at, updated_at)
    SELECT s.id, ?, NULL, s.name, false, s.layout, 'system', ?, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS s(id text, name text, layout jsonb)
    WHERE NOT EXISTS (SELECT 1 FROM table_layouts t WHERE t.id = s.id)
      AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_table = 'table_layouts' AND a.entity_id = s.id AND a.action = 'table_view.delete')
    ON CONFLICT DO NOTHING`, table, now, now, JSON.stringify(seeds));
  done.add(table);
}
