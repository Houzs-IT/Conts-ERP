/** How many days after checkout a guest can still leave a review on each channel. After that the channel closes it, so
 *  a stay with no review is "Window closed", not something to chase. Airbnb closes reviews 14 days after checkout
 *  (owner, 2 Nov 2026). Booking.com publishes 28 days for its guest reviews; it is kept at the owner's 14 here so a stay
 *  that late is not chased, and can be raised to 28 in this one place. Agoda and direct stays have no window we track. */
export const REVIEW_WINDOW_DAYS: Readonly<Record<string, number>> = { airbnb: 14, booking_com: 14 };

export const reviewWindowDays = (channel: string | null | undefined): number | null =>
  (channel && REVIEW_WINDOW_DAYS[channel]) || null;

/** Whole days from a checkout date (yyyy-mm-dd) to today (yyyy-mm-dd). */
export const daysSince = (checkOut: string, today: string): number =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checkOut.slice(0, 10)}T00:00:00Z`)) / 864e5);

export const windowClosed = (channel: string | null | undefined, checkOut: string, today: string): boolean => {
  const days = reviewWindowDays(channel);
  return days !== null && daysSince(checkOut, today) > days;
};

/** A bad review: this many stars out of 5 or fewer (owner, 2 Nov 2026). Channex scores out of 10 are halved first. */
export const BAD_REVIEW_MAX = 3;
export const isBadReview = (rating: number): boolean => rating <= BAD_REVIEW_MAX;

/* ---- Native scales and categories (owner, 3 Nov 2026) ----
 * Channex gives every score out of 10. Airbnb guests rate 1-5 stars, so an Airbnb score is shown halved, as stars;
 * Booking.com guests rate out of 10 and are shown as they gave it. The stored `rating` (0-5) is only for averages
 * across both channels, and every screen that shows it says so. */
export type Scale = { value: number; max: 5 | 10 };
/** A review's overall score on its channel's own scale, from the stored 0-5 rating. */
export const nativeOverall = (channel: string | null | undefined, rating: number): Scale =>
  channel === 'booking_com' ? { value: Math.round(rating * 20) / 10, max: 10 } : { value: Math.round(rating * 100) / 100, max: 5 };
/** A category score (stored out of 10, as Channex gives it) on its channel's own scale. */
export const nativeCategory = (channel: string | null | undefined, score10: number): Scale =>
  channel === 'booking_com' ? { value: score10, max: 10 } : { value: Math.round(score10 * 5) / 10, max: 5 };
export const scaleText = (s: Scale): string => `${Number.isInteger(s.value) ? s.value : s.value.toFixed(1)} / ${s.max}`;

/** Category names as we keep them. Channex calls Airbnb's cleanliness "clean"; Booking.com sends "value for money"
 *  in older pulls; Airbnb's check-in comes as "checkin". */
const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  clean: 'cleanliness', cleanliness: 'cleanliness', 'value for money': 'value', value_for_money: 'value', value: 'value',
  checkin: 'checkin', 'check in': 'checkin', 'check-in': 'checkin', check_in: 'checkin',
  accuracy: 'accuracy', communication: 'communication', location: 'location', facilities: 'facilities',
  staff: 'staff', comfort: 'comfort', services: 'services',
};
export const categoryKey = (raw: string): string => {
  const k = String(raw ?? '').trim().toLowerCase();
  return CATEGORY_ALIASES[k] ?? CATEGORY_ALIASES[k.replace(/_/g, ' ')] ?? k.replace(/\s+/g, '_');
};
/** The same mapping in SQL, for a category read out of the stored JSON (`expr` is the raw name). */
export const categoryKeySql = (expr: string): string =>
  `(CASE lower(trim(${expr})) ${Object.entries(CATEGORY_ALIASES).map(([a, k]) => `WHEN '${a}' THEN '${k}'`).join(' ')} ELSE replace(lower(trim(${expr})), ' ', '_') END)`;

/** Airbnb's six categories, in Airbnb's order. Cleanliness, location and value are rated on Booking.com too. */
export const AIRBNB_CATEGORIES = ['cleanliness', 'accuracy', 'communication', 'checkin', 'location', 'value'] as const;
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  cleanliness: 'Cleanliness', accuracy: 'Accuracy', communication: 'Communication', checkin: 'Check-in', location: 'Location',
  value: 'Value', facilities: 'Facilities', staff: 'Staff', comfort: 'Comfort', services: 'Services',
};
export const categoryLabel = (key: string): string => CATEGORY_LABELS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '));

/** A category whose average (out of 5, both channels) falls below this is flagged on the unit and building
 *  (owner, 3 Nov 2026: cleanliness under 4.7). Add a category here to flag it too. */
export const CATEGORY_FLAG_BELOW: Readonly<Record<string, number>> = { cleanliness: 4.7 };
export const categoryFlagged = (key: string, avg5: number | null | undefined): boolean =>
  avg5 != null && CATEGORY_FLAG_BELOW[key] != null && avg5 < CATEGORY_FLAG_BELOW[key];
/** One review's cleanliness this low (out of 5) links it to the clean before the stay and its cleaner(s). */
export const LOW_CLEANLINESS_BELOW = 4.7;

/** Airbnb review tags as words: "guest_review_host_negative_dirty_or_dusty" is "Dirty or dusty". */
export function tagInfo(code: string): { code: string; label: string; tone: 'positive' | 'negative' | 'other' } {
  const c = String(code ?? '');
  const m = /^(?:guest_review_host|host_review_guest)_(positive|negative)_(.+)$/.exec(c);
  const rest = (m ? m[2] : c).replace(/_/g, ' ').trim();
  return { code: c, label: rest.charAt(0).toUpperCase() + rest.slice(1), tone: m ? (m[1] as 'positive' | 'negative') : 'other' };
}

/* ---- The host's review of the guest (Airbnb only) ---- */
/** Airbnb gives the host this many days after checkout to review the guest (both sides, owner 3 Nov 2026). */
export const GUEST_REVIEW_WINDOW_DAYS = 14;
/** A guest marked "Bad guest": their review is held and sent on this day after checkout, just before the window
 *  closes, so the guest cannot answer it with a review of their own (owner, 3 Nov 2026). */
export const BAD_GUEST_SEND_DAY = 13;
/** The three categories the host rates the guest on, 1-5. */
export const GUEST_REVIEW_CATEGORIES = ['cleanliness', 'communication', 'respect_house_rules'] as const;
export type GuestReviewCategory = typeof GUEST_REVIEW_CATEGORIES[number];
export const GUEST_CATEGORY_LABELS: Readonly<Record<GuestReviewCategory, string>> = {
  cleanliness: 'Cleanliness', communication: 'Communication', respect_house_rules: 'Respect for house rules',
};
/** Airbnb's tags for a host's review of a guest (Channex reviews collection, 3 Nov 2026). */
export const GUEST_REVIEW_TAGS: Readonly<Record<GuestReviewCategory, { positive: string[]; negative: string[] }>> = {
  cleanliness: {
    positive: ['host_review_guest_positive_neat_and_tidy', 'host_review_guest_positive_kept_in_good_condition', 'host_review_guest_positive_took_care_of_garbage'],
    negative: ['host_review_guest_negative_ignored_checkout_directions', 'host_review_guest_negative_garbage', 'host_review_guest_negative_messy_kitchen', 'host_review_guest_negative_damage', 'host_review_guest_negative_ruined_bed_linens'],
  },
  respect_house_rules: {
    positive: [],
    negative: ['host_review_guest_negative_arrived_early', 'host_review_guest_negative_stayed_past_checkout', 'host_review_guest_negative_unapproved_guests', 'host_review_guest_negative_unapproved_pet', 'host_review_guest_negative_did_not_respect_quiet_hours', 'host_review_guest_negative_unapproved_filming', 'host_review_guest_negative_unapproved_event', 'host_review_guest_negative_smoking'],
  },
  communication: {
    positive: ['host_review_guest_positive_helpful_messages', 'host_review_guest_positive_respectful', 'host_review_guest_positive_always_responded'],
    negative: ['host_review_guest_negative_unhelpful_messages', 'host_review_guest_negative_disrespectful', 'host_review_guest_negative_unreachable', 'host_review_guest_negative_slow_responses'],
  },
};
export const ALL_GUEST_REVIEW_TAGS: readonly string[] = Object.values(GUEST_REVIEW_TAGS).flatMap(t => [...t.positive, ...t.negative]);

const DAY_MS = 864e5;
const at = (checkOut: string, checkOutTime: string | null | undefined, days: number): string =>
  new Date(Date.parse(`${checkOut.slice(0, 10)}T${checkOutTime && /^\d{2}:\d{2}$/.test(checkOutTime) ? checkOutTime : '11:00'}:00+08:00`) + days * DAY_MS).toISOString();
/** When the host can no longer review the guest: GUEST_REVIEW_WINDOW_DAYS after the checkout time (Malaysia time). */
export const guestReviewDeadline = (checkOut: string, checkOutTime?: string | null): string => at(checkOut, checkOutTime, GUEST_REVIEW_WINDOW_DAYS);
/** When a Bad guest's review goes out: day BAD_GUEST_SEND_DAY after checkout, at the checkout time. */
export const badGuestSendAt = (checkOut: string, checkOutTime?: string | null): string => at(checkOut, checkOutTime, BAD_GUEST_SEND_DAY);
/** Time left before `deadline`, as "3 days 4 h left", "5 h left" or "Window closed". */
export function timeLeft(deadline: string, now = Date.now()): { ms: number; text: string; closed: boolean } {
  const ms = Date.parse(deadline) - now;
  if (!(ms > 0)) return { ms: 0, text: 'Window closed', closed: true };
  const h = Math.floor(ms / 36e5), d = Math.floor(h / 24), rh = h % 24;
  const text = d > 0 ? `${d} ${d === 1 ? 'day' : 'days'}${rh ? ` ${rh} h` : ''} left` : h > 0 ? `${h} h left` : `${Math.max(1, Math.floor(ms / 6e4))} min left`;
  return { ms, text, closed: false };
}

/** Fills a guest review template: {guest} is the guest's first name, {unit} the unit. */
export const fillTemplate = (body: string, v: { guest?: string | null; unit?: string | null }): string =>
  body.replace(/\{guest\}/gi, (v.guest ?? '').trim().split(/\s+/)[0] || 'our guest').replace(/\{unit\}/gi, (v.unit ?? '').trim() || 'the unit');
