/** Pure (no imports) so the server's CSV export reads the same words as the screens. */
const todayMyt = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export type StayPhase = 'upcoming' | 'arriving' | 'hosting' | 'checking_out' | 'past' | 'cancelled' | 'no_show' | 'inquiry' | 'pending';

/**
 * The one status a reservation shows (owner vocabulary: Upcoming / Arriving soon / Currently hosting / Checking out /
 * Past / Cancelled), from the stored state and the dates. A confirmed stay whose checkout has passed is Past even if
 * nobody pressed Check out. Same rule as the calendar bars and functions/api/units/stays.ts (PHASE) and
 * functions/_lib/bookingList.ts (phaseLabelSql). Read it with <StatusBadge entity="stay" value={stayPhase(r)} />.
 */
export function stayPhase(r: { state: string; checkIn: string; checkOut: string }, today: string = todayMyt()): StayPhase {
  if (r.state === 'cancelled' || r.state === 'no_show' || r.state === 'inquiry' || r.state === 'pending') return r.state;
  if (r.state === 'checked_out' || r.checkOut < today) return 'past';
  if (r.checkOut === today && (r.state === 'checked_in' || r.checkIn < today)) return 'checking_out';
  if (r.state === 'checked_in' || r.checkIn < today) return 'hosting';
  if (r.checkIn <= addDay(today)) return 'arriving';
  return 'upcoming';
}
const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** The words, for exports and sentences; the pill reads them from lib/status.ts (entity "stay"). */
export const STAY_LABEL: Record<StayPhase, string> = {
  upcoming: 'Upcoming', arriving: 'Arriving soon', hosting: 'Currently hosting', checking_out: 'Checking out', past: 'Past',
  cancelled: 'Cancelled', no_show: 'No-show', inquiry: 'Inquiry', pending: 'Pending',
};
