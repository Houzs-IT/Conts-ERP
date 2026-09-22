/** DRAFT — PriceLabs dynamic-pricing intake, feature-flagged OFF (see functions/api/pricelabs/webhook.ts).
 *
 *  Pure, side-effect-free payload parsing and money conversion for the PriceLabs webhook, kept
 *  here so it can be unit-tested without a database or a live request. The webhook endpoint does
 *  the DB work (listing_id -> unit lookup, upsert, onward Channex push); this file only shapes and
 *  validates what PriceLabs sends.
 *
 *  MONEY: PriceLabs sends `price` as a decimal in the listing's own currency (major units, e.g.
 *  199 or 199.50), the same way its dashboard shows it. Conts stores every rate as INTEGER SEN
 *  (1/100), so we multiply by 100 and round. This assumption is UNVERIFIED against a live PriceLabs
 *  account — see the PR notes. If PriceLabs is ever found to send minor units already, drop the *100. */
import { z } from 'zod';

/** One recommended nightly price for one listing on one date, as PriceLabs sends it.
 *  We accept `listing_id` (PriceLabs' own id, mapped to a unit via units.pricelabs_listing_id). */
const priceLabsItemSchema = z.object({
  listing_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  price: z.number().finite().nonnegative(),
});

/** PriceLabs posts either a bare array of items, or an object wrapping them under `data`.
 *  We accept both so the intake is not brittle about which shape their webhook uses. */
export const priceLabsPayloadSchema = z.union([
  z.array(priceLabsItemSchema),
  z.object({ data: z.array(priceLabsItemSchema) }),
]);

export type PriceLabsPayload = z.infer<typeof priceLabsPayloadSchema>;

/** A normalized rate update, money already converted to integer sen and ready to upsert
 *  into channel_rates (channel is decided by the caller — currently 'web', the rate Conts
 *  publishes onward through Channex). */
export interface RateUpdate {
  listingId: string;
  date: string;   // YYYY-MM-DD
  rateSen: number; // integer sen
}

/** Convert one PriceLabs price (major currency units) to integer sen. Pure. */
export function priceToSen(price: number): number {
  return Math.round(price * 100);
}

/** Parse + validate a raw PriceLabs webhook body and map it to normalized rate updates.
 *  Throws a ZodError if the payload is not a shape we understand; the endpoint turns that
 *  into the project's standard 422 error envelope. Pure: no DB, no I/O. */
export function mapPriceLabsPayload(raw: unknown): RateUpdate[] {
  const parsed = priceLabsPayloadSchema.parse(raw);
  const items = Array.isArray(parsed) ? parsed : parsed.data;
  return items.map((it) => ({
    listingId: it.listing_id,
    date: it.date,
    rateSen: priceToSen(it.price),
  }));
}
