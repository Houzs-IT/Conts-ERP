/** What a booking is worth and what the booking site keeps, from a Channex booking revision.
 *
 *  Channex's `amount` is not the same thing on every site. For Airbnb it is the host's payout: the
 *  first live booking (8 Oct 2026) came as amount 104.07 for a night sold at 125.00, with the split only
 *  in the free-text notes ("Listing Base Price: 125.00", "Listing Cancellation Host Fee: 20.93",
 *  "Listing Cancellation Payout: 104.07"). Recording 104.07 as the booking value understates revenue
 *  and hides the fee, so the fee is added back: booking value = payout + the site's fee.
 *
 *  The fee is taken from `ota_commission` when Channex sends one, else from the "Host Fee" line of an
 *  Airbnb note. With neither, the amount is kept as it came and the fee is 0, as before. */
export interface BookingAmounts { grossSen: number; feeSen: number; source: 'commission' | 'notes' | 'amount' }

const sen = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

export function bookingAmounts(a: { amount?: unknown; ota_commission?: unknown; ota_name?: unknown; notes?: unknown }, roomAmount?: unknown): BookingAmounts {
  const amountSen = sen(a.amount ?? roomAmount ?? 0);
  const commissionSen = sen(a.ota_commission);
  const airbnb = /airbnb/i.test(String(a.ota_name ?? ''));
  // Airbnb's amount is the payout, so its fee comes on top; another site's amount already includes it.
  if (commissionSen > 0) return { grossSen: airbnb ? amountSen + commissionSen : amountSen, feeSen: commissionSen, source: 'commission' };
  if (airbnb) {
    const fee = /Host Fee:\s*(-?\d+(?:\.\d+)?)/i.exec(String(a.notes ?? ''));
    const feeSen = fee ? Math.abs(sen(fee[1])) : 0;
    if (feeSen > 0) return { grossSen: amountSen + feeSen, feeSen, source: 'notes' };
  }
  return { grossSen: amountSen, feeSen: 0, source: 'amount' };
}
