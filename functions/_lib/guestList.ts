/** The guest directory list: lifetime figures and today/tomorrow movement computed in SQL, so the
 *  screen can page and search thousands of guests without loading every stay. */

export const CONTACT_ROLES = ['management', 'operations_manager', 'operations_staff'];

export const FILTERS = ['all', 'arriving_today', 'departing_today', 'tomorrow'] as const;
export type GuestFilter = typeof FILTERS[number];

export const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function todayAndTomorrow() {
  const now = Date.now() + 8 * 3600e3;
  return { today: new Date(now).toISOString().slice(0, 10), tomorrow: new Date(now + 864e5).toISOString().slice(0, 10) };
}

export function guestTag(stays: number, bookings: number, latestChannel: string | null) {
  return stays >= 2 ? { label: 'Repeat guest', tone: 'success' }
    : latestChannel === 'direct' ? { label: 'Direct', tone: 'info' }
    : { label: bookings ? 'New' : 'No stays yet', tone: 'neutral' };
}

/** Per guest: the same figures the profile shows. A guest with a movement today is not also listed
 *  under tomorrow, and an arrival wins over a departure, matching the profile's single movement. */
export function statsCte(today: string, tomorrow: string) {
  const T = `'${today}'`, TM = `'${tomorrow}'`;
  const DONE = `r.state IN ('checked_out','checked_in')`;
  const ARRIVES = `r.state IN ('confirmed','pending','checked_in')`;
  const LEAVES = `r.state IN ('checked_in','checked_out')`;
  return `WITH s AS (
    SELECT r.guest_id,
           COUNT(*) AS bookings,
           COUNT(*) FILTER (WHERE ${DONE}) AS stays,
           COALESCE(SUM(GREATEST(1, r.check_out::date - r.check_in::date)) FILTER (WHERE ${DONE}), 0) AS nights,
           COALESCE(SUM(r.gross_booking_value) FILTER (WHERE ${DONE}), 0) AS value,
           MAX(r.check_in) AS last_check_in,
           (array_agg(r.channel ORDER BY r.check_in DESC))[1] AS channel,
           bool_or(${ARRIVES} AND r.check_in = ${T}) AS arr_today,
           bool_or(${LEAVES} AND r.check_out = ${T}) AS dep_today,
           bool_or((${ARRIVES} AND r.check_in = ${TM}) OR (${LEAVES} AND r.check_out = ${TM})) AS tmr
    FROM reservations r
    WHERE r.guest_id IS NOT NULL AND r.channel NOT IN ('maintenance_block','owner_stay') AND r.state <> 'cancelled'
    GROUP BY r.guest_id)`;
}

export const FILTER_WHERE: Record<GuestFilter, string> = {
  all: 'TRUE',
  arriving_today: 'COALESCE(s.arr_today, false)',
  departing_today: 'COALESCE(s.dep_today AND NOT s.arr_today, false)',
  tomorrow: 'COALESCE(s.tmr AND NOT s.arr_today AND NOT s.dep_today, false)',
};

export const SORTS: Record<string, string> = {
  name: 'lower(g.full_name) ASC, g.id',
  recent: 's.last_check_in DESC NULLS LAST, lower(g.full_name), g.id',
  value: 'COALESCE(s.value, 0) DESC, lower(g.full_name), g.id',
  stays: 'COALESCE(s.stays, 0) DESC, lower(g.full_name), g.id',
};
