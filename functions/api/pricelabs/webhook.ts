import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { syncRateIfLinked } from '../../_lib/channexSync';
import { mapPriceLabsPayload } from '../../_lib/pricelabs';
import { z } from 'zod';

/** POST /api/pricelabs/webhook — DRAFT, FEATURE-FLAGGED OFF.
 *
 *  Intake for PriceLabs dynamic pricing. PriceLabs is a market/dynamic-pricing engine that would
 *  SEND recommended nightly rates INTO Conts; we write them into channel_rates (channel 'web') and
 *  let the existing Channex push (syncRateIfLinked) publish them onward, exactly as the manual
 *  Pricing screen and /api/rates/bulk do.
 *
 *  OFF BY DEFAULT: like the Channex webhook there is no session — the caller is PriceLabs' server,
 *  not a browser — so it is verified by a shared secret echoed in a header. When
 *  env.PRICELABS_WEBHOOK_SECRET is UNSET the whole endpoint is disabled and answers 503, so this
 *  scaffold does nothing until an operator both adopts PriceLabs and sets the secret via Cloudflare
 *  env. When set but the header does not match, it answers 401.
 *
 *  UNTESTED end to end: there is no PriceLabs account or key wired here, so the live round-trip and
 *  the exact PriceLabs payload shape are unverified — see the PR notes. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = env.PRICELABS_WEBHOOK_SECRET;
  // The OFF-by-default flag: no secret configured => feature not adopted => disabled.
  if (!secret) return fail('NOT_CONFIGURED', 'PriceLabs intake not configured.', 503);
  if (request.headers.get('x-pricelabs-webhook-secret') !== secret) return fail('UNAUTHORIZED', 'Invalid webhook secret.', 401);

  const raw = await request.json<unknown>().catch(() => null);
  let updates;
  try {
    updates = mapPriceLabsPayload(raw);
  } catch (e) {
    if (e instanceof z.ZodError) return fail('VALIDATION', 'The PriceLabs payload is not in a shape we understand.', 422, { payload: e.issues[0]?.message ?? 'Invalid payload.' });
    return fail('VALIDATION', 'The PriceLabs payload could not be read.', 422);
  }
  if (!updates.length) return json({ ok: true, written: 0, skipped: 0 });

  const now = nowIso();
  // Cache listing_id -> unit_id so a payload with many nights for one listing is one lookup.
  const unitFor = new Map<string, string | null>();
  const resolve = async (listingId: string): Promise<string | null> => {
    if (unitFor.has(listingId)) return unitFor.get(listingId)!;
    const u = await one<{ id: string }>(env, 'SELECT id FROM units WHERE pricelabs_listing_id = ?', listingId);
    const id = u?.id ?? null;
    unitFor.set(listingId, id);
    return id;
  };

  let written = 0;
  const skippedListings = new Set<string>();
  for (const u of updates) {
    const unitId = await resolve(u.listingId);
    if (!unitId) { skippedListings.add(u.listingId); continue; } // unknown listing: not linked to any unit
    await run(env, `
      INSERT INTO channel_rates (unit_id, channel, rate_date, rate, updated_at) VALUES (?, 'web', ?, ?, ?)
      ON CONFLICT (unit_id, channel, rate_date) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
      unitId, u.date, u.rateSen, now);
    written++;
    // Publish onward through the existing Channex push, same as a manual web-rate save.
    await syncRateIfLinked(env, unitId, u.date, u.rateSen);
  }

  await audit(env, {
    actorId: null, actorLabel: 'PriceLabs intake', action: 'rate.pricelabs',
    entityTable: 'units', entityId: 'pricelabs', source: 'pricelabs',
    after: { written, skippedListings: [...skippedListings] },
  });
  return json({ ok: true, written, skipped: skippedListings.size });
};
