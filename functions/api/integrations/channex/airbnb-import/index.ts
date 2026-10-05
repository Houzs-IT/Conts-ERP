import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { channexAirbnbListings, channexCreateMapping, channexDeleteMapping, channexActivateChannel, channexLoadFutureReservations, channexDeleteProperty } from '../../../../_lib/channex';
import { importGate, airbnbChannelId } from '../../../../_lib/airbnbImport';
import { channexRefused } from '../../../../_lib/channexChannels';
import { setUpUnitInChannex } from '../../../../_lib/channexSetup';
import { ensureOtaRatePlans } from '../../../../_lib/channexSync';
import { queueFullSync } from '../../../../_lib/channexQueue';

/** GET /api/integrations/channex/airbnb-import — the connected Airbnb account's listings, each marked with
 *  the unit it is already linked to, plus the buildings, owners and not-yet-linked units to match them with. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await importGate(request, env);
  if ('response' in gate) return gate.response;

  const channelId = await airbnbChannelId(env);
  const buildings = await all<{ id: string; name: string }>(env, 'SELECT id, name FROM properties ORDER BY name');
  const owners = await all<{ id: string; display_name: string }>(env, 'SELECT id, display_name FROM owners ORDER BY display_name');
  const units = await all<{ id: string; unit_number: string; property_name: string }>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id
    WHERE NOT EXISTS (SELECT 1 FROM channex_channels c WHERE c.unit_id = u.id AND c.ota = 'airbnb')
    ORDER BY p.name, u.unit_number`);
  const base = {
    buildings, owners: owners.map(o => ({ id: o.id, name: o.display_name })),
    units: units.map(u => ({ id: u.id, label: `${u.property_name} ${u.unit_number}` })),
  };
  if (!channelId) return json({ channelId: null, listings: [], ...base });

  const r = await channexAirbnbListings(env, channelId);
  if (!r.ok) return channexRefused('read the Airbnb listings', r.status, r.body);
  const taken = await all<{ external_id: string; unit_number: string; property_name: string }>(env, `
    SELECT c.external_id, u.unit_number, p.name AS property_name FROM channex_channels c
    JOIN units u ON u.id = c.unit_id JOIN properties p ON p.id = u.property_id WHERE c.ota = 'airbnb'`);
  const takenBy = new Map(taken.map(t => [t.external_id, `${t.property_name} ${t.unit_number}`]));
  return json({
    channelId, ...base,
    listings: (r.body?.data?.listing_id_dictionary?.values ?? []).map(l => ({
      id: String(l.id), title: l.title, type: l.type, city: l.city, maxGuests: Math.max(0, ...(l.occupancies ?? [0])), linkedTo: takenBy.get(String(l.id)) ?? null,
    })),
  });
};

const sen = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

/** POST /api/integrations/channex/airbnb-import — brings ONE listing in; the screen calls it once per listing
 *  so each stays inside Channex's limits and reports its own result.
 *  { listingId, title, unitId } links an existing unit, or { listingId, title, buildingId, unitCode?, ownerId }
 *  creates the unit. Both carry { baseRate, weekendRate?, minStay?, maxGuests? } in sen, taken from Airbnb.
 *  The unit is priced exactly as the listing is today (no Airbnb uplift, weekend rate as given), set up in
 *  Channex, the listing mapped and its bookings loaded. A unit this call created is removed again if any
 *  later step is refused, so a failed listing can simply be retried. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await importGate(request, env);
  if ('response' in gate) return gate.response;
  const { session } = gate;

  const b = await request.json<any>().catch(() => null);
  const listingId = String(b?.listingId ?? '').trim(), title = String(b?.title ?? '').trim().slice(0, 200);
  const baseRate = sen(b?.baseRate), weekendRate = b?.weekendRate == null ? null : sen(b.weekendRate);
  const minStay = b?.minStay == null ? 1 : Number(b.minStay), maxGuests = Math.min(30, Math.max(1, Math.round(Number(b?.maxGuests) || 2)));
  if (!listingId) return fail('VALIDATION', 'Which listing?', 422);
  if (!baseRate) return fail('VALIDATION', 'Enter the nightly price. Prices on Airbnb follow Conts once the listing is linked.', 422, { baseRate: 'Enter a price above RM 0.00.' });
  if (b?.weekendRate != null && !weekendRate) return fail('VALIDATION', 'Enter a weekend price above RM 0.00, or leave it empty.', 422, { weekendRate: 'Enter a price above RM 0.00.' });
  if (!Number.isInteger(minStay) || minStay < 1 || minStay > 60) return fail('VALIDATION', 'Minimum nights must be 1 to 60.', 422, { minStay: '1 to 60 nights.' });

  const channelId = await airbnbChannelId(env);
  if (!channelId) return fail('NOT_CONNECTED', 'Sign in to Airbnb first.', 409);
  const taken = await one<{ unit_number: string }>(env, `SELECT u.unit_number FROM channex_channels c JOIN units u ON u.id = c.unit_id WHERE c.ota = 'airbnb' AND c.external_id = ?`, listingId);
  if (taken) return fail('CONFLICT', `That listing is already linked to ${taken.unit_number}.`, 409);

  const now = nowIso();
  let unitId: string, created = false;
  if (b?.unitId) {
    const u = await one<{ id: string }>(env, 'SELECT id FROM units WHERE id = ?', String(b.unitId));
    if (!u) return fail('NOT_FOUND', 'That unit does not exist.', 404);
    if (await one(env, "SELECT 1 AS x FROM channex_channels WHERE unit_id = ? AND ota = 'airbnb'", u.id)) return fail('CONFLICT', 'That unit is already connected to an Airbnb listing.', 409);
    unitId = u.id;
  } else {
    if (!b?.buildingId || !(await one(env, 'SELECT 1 AS x FROM properties WHERE id = ?', String(b.buildingId)))) return fail('VALIDATION', 'Pick a building.', 422, { buildingId: 'Pick a building.' });
    if (!b?.ownerId || !(await one(env, 'SELECT 1 AS x FROM owners WHERE id = ?', String(b.ownerId)))) return fail('VALIDATION', 'Pick an owner.', 422, { ownerId: 'Pick an owner.' });
    unitId = crypto.randomUUID();
    const code = String(b?.unitCode ?? '').trim(), number = code || `NEW-${unitId.slice(0, 6).toUpperCase()}`;
    if (await one(env, 'SELECT 1 AS x FROM units WHERE property_id = ? AND lower(unit_number) = lower(?)', String(b.buildingId), number)) {
      return fail('CONFLICT', 'That building already has a unit with this code.', 409, { unitCode: 'This code is already used in the building.' });
    }
    await run(env, `
      INSERT INTO units (id, property_id, owner_id, unit_number, unit_code, listing_name, package, term, split_kind, guarantee_period, readiness, base_rate, is_listed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Package C', 'Long term', 'Not set', 'month', 'ready', 0, 0, ?, ?)`,
      unitId, String(b.buildingId), String(b.ownerId), number, code || null, title || null, now, now);
    created = true;
  }

  // Undo for a unit this call created: it exists only for this import and nothing else points at it yet.
  let channexPropertyId: string | null = null;
  const refuse = async (res: Response) => {
    if (created) {
      try {
        if (channexPropertyId) await channexDeleteProperty(env, channexPropertyId);
        await run(env, 'DELETE FROM channel_uplifts WHERE unit_id = ?', unitId);
        await run(env, 'DELETE FROM units WHERE id = ?', unitId);
        await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.import_undone', entityTable: 'units', entityId: unitId, after: { listingId, status: res.status } });
      } catch (e) {
        await audit(env, { actorId: null, actorLabel: 'Airbnb import', action: 'unit.import_undo_failed', entityTable: 'units', entityId: unitId, after: { listingId, error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
      }
    }
    return res;
  };

  try {
    // Priced exactly as the listing is on Airbnb today: its price is the base, with no Airbnb uplift on top,
    // and the weekend rate pinned (to the same price when Airbnb has no separate weekend price).
    await run(env, 'UPDATE units SET base_rate = ?, weekend_rate = ?, min_stay = ?, max_guests = ?, is_listed = 1, updated_at = ? WHERE id = ?',
      baseRate, weekendRate ?? baseRate, minStay, maxGuests, now, unitId);
    await run(env, `INSERT INTO channel_uplifts (unit_id, channel, uplift, updated_at) VALUES (?, 'airbnb', 0, ?)
      ON CONFLICT (unit_id, channel) DO UPDATE SET uplift = 0, updated_at = excluded.updated_at`, unitId, now);

    const linked = await one<{ channex_property_id: string | null }>(env, 'SELECT channex_property_id FROM units WHERE id = ?', unitId);
    if (linked?.channex_property_id) {
      await queueFullSync(env, [unitId]);
    } else {
      const s = await setUpUnitInChannex(env, unitId, session);
      if (!s.ok) return await refuse(fail(s.code, s.message, s.status, s.detail ? { detail: s.detail } : undefined));
      channexPropertyId = s.propertyId;
    }

    const ratePlanId = (await ensureOtaRatePlans(env, unitId))?.ratePlans.airbnb;
    if (!ratePlanId) return await refuse(fail('CHANNEX_REFUSED', 'Channex did not create the Airbnb price list for this unit.', 502));

    const m = await channexCreateMapping(env, channelId, ratePlanId, { listing_id: listingId });
    const mappingId = m.body?.data?.id;
    if (!m.ok || !mappingId) return await refuse(channexRefused('link the Airbnb listing', m.status, m.body));
    const act = await channexActivateChannel(env, channelId);
    if (!act.ok) { await channexDeleteMapping(env, channelId, mappingId); return await refuse(channexRefused('switch the Airbnb connection on', act.status, act.body)); }
    const load = await channexLoadFutureReservations(env, channelId, listingId);

    const id = crypto.randomUUID();
    await run(env, `INSERT INTO channex_channels (id, unit_id, ota, channex_channel_id, channex_mapping_id, external_id, title, created_by, created_at)
      VALUES (?, ?, 'airbnb', ?, ?, ?, ?, ?, ?)`, id, unitId, channelId, mappingId, listingId, title || `Airbnb listing ${listingId}`, session.userId, nowIso());
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'channel.import', entityTable: 'units', entityId: unitId,
      after: { ota: 'airbnb', listingId, channelId, mappingId, unitCreated: created, baseRate, weekendRate: weekendRate ?? baseRate, minStay, bookingsLoadRequested: load.ok } });
    return json({ id, unitId, unitCreated: created, bookingsLoadRequested: load.ok }, 201);
  } catch (e) {
    return await refuse(fail('IMPORT_FAILED', e instanceof Error ? e.message : 'The listing could not be brought in.', 500));
  }
};
