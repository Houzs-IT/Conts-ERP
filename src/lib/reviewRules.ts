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
