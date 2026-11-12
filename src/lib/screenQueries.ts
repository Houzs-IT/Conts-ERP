/** The list reads of Reservations and Guests, built from the address. The screens and lib/routePrefetch.ts both build
 *  them here, so a read started while the screen's code downloads is the very path the screen then asks for. */

/** Searches the server reads. The column searches are kept for links from global search (?ref=, ?guest=). */
export const BOOKING_SEARCH_PARAMS = ['q', 'ref', 'guest', 'unit', 'channel', 'stay', 'gross', 'status'];
export const BOOKING_FILTER_PARAMS = ['ch', 'building', 'country', 'from', 'to', 'cancelledFrom', 'cancelledTo', 'grossMin', 'grossMax', 'nightsMin', 'nightsMax'];
/** URL parameters the server reads. The drawer's `open` stays out so opening a booking does not refetch the list. */
export const BOOKING_API_PARAMS = ['view', 'todo', 'sort', 'page', 'size', ...BOOKING_SEARCH_PARAMS, ...BOOKING_FILTER_PARAMS];

/** Reservations' list read for these address parameters. */
export function bookingsPath(params: URLSearchParams): string {
  const p = new URLSearchParams();
  for (const k of BOOKING_API_PARAMS) { const v = params.get(k); if (v) p.set(k, v); }
  const q = p.toString();
  return `/reservations${q ? `?${q}` : ''}`;
}

/** Guests' list read for these address parameters. */
export function guestsListPath(params: URLSearchParams): string {
  const p = new URLSearchParams();
  for (const k of ['q', 'filter', 'country', 'page', 'size']) { const v = params.get(k); if (v) p.set(k, v); }
  p.set('sort', params.get('sort') ?? 'recent');
  return `/guests?${p.toString()}`;
}
