import { type Env, all, one, run, fail, nowIso } from './db';
import { newDemoId } from './demo';
import { todayMyt } from './ops';

/** Sample owners for the sample owner portal (Owner B; migration 0199). A sample owner gets sample copies of real units
 *  (their building, layout and nightly price; never their owner, contract, bank account or channel links), and, when
 *  asked, sample reservations and reviews over the last three months so the portal has something to show. All of it
 *  is in schema demo and goes with Clear demo. */

/** Unit columns a sample copy never takes: links to real contracts, accounts, channels and other units. */
const NOT_COPIED = new Set(['id', 'owner_id', 'unit_number', 'contract_id', 'bank_account_id', 'bank_account_chosen', 'parent_unit_id', 'unit_code', 'shadow_of', 'demo_by', 'demo_at']);

const GUESTS = ['Aisyah Rahman', 'Daniel Lim', 'Priya Nair', 'Kenji Watanabe', 'Sophie Martin', 'Hafiz Ismail', 'Mei Ling Tan', 'Arjun Mehta', 'Chloe Wong', 'Lucas Silva', 'Nurul Izzah', 'Ethan Brooks'];
const COMMENTS = ['Spotless and exactly as described.', 'Great location and a very comfortable bed.', 'Check-in was easy and the host answered quickly.', 'Lovely view, we would stay again.', 'Clean, quiet and well equipped kitchen.'];
const CHANNELS = ['airbnb', 'booking_com', 'airbnb', 'agoda', 'direct'];

/** A small seeded generator, so the same sample owner always gets the same stays. */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export interface NewSampleOwner { name?: unknown; unitIds?: unknown; fill?: unknown; sharePct?: unknown }

export async function createSampleOwner(env: Env, b: NewSampleOwner, actor: string): Promise<Response | { id: string; units: number; reservations: number; reviews: number }> {
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  const unitIds = Array.isArray(b.unitIds) ? [...new Set(b.unitIds.filter((x): x is string => typeof x === 'string' && !!x))] : [];
  const share = b.sharePct === undefined ? 25 : Number(b.sharePct);
  const fields: Record<string, string> = {};
  if (!name) fields.name = 'Enter the sample owner\'s name.';
  if (!unitIds.length || unitIds.length > 6) fields.unitIds = 'Pick between one and six units to copy.';
  if (!Number.isFinite(share) || share < 0 || share > 100) fields.sharePct = 'Enter a share from 0 to 100.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Some fields need attention.', 422, fields);

  const real = await all<{ id: string; unit_number: string; base_rate: number }>(env,
    'SELECT id, unit_number, base_rate FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(unitIds));
  if (real.length !== unitIds.length) return fail('VALIDATION', 'A unit picked no longer exists.', 422, { unitIds: 'Pick the units again.' });

  const at = nowIso(), ownerId = newDemoId('o');
  await run(env, `INSERT INTO demo.owners (id, display_name, email, default_management_fee_pct, created_at, updated_at, demo_by, demo_at)
    VALUES (?, ?, 'sample-owner@example.com', ?, ?, ?, ?, ?)`, ownerId, name, share, at, at, actor, at);

  // The columns both tables have, so a later column on units comes along by itself (demo.sync keeps them level).
  const cols = (await all<{ c: string }>(env, `SELECT a.column_name AS c FROM information_schema.columns a
    JOIN information_schema.columns b ON b.table_schema = 'demo' AND b.table_name = 'units' AND b.column_name = a.column_name
    WHERE a.table_schema = 'pos' AND a.table_name = 'units' ORDER BY a.ordinal_position`)).map(r => r.c)
    .filter(c => !NOT_COPIED.has(c) && !c.startsWith('channex_'));
  const list = cols.map(c => `"${c}"`).join(', ');
  const copies = real.map(u => ({ id: newDemoId('u'), from: u.id, unit_number: `${u.unit_number} (sample)`, base_rate: Number(u.base_rate) }));
  /* Guaranteed rent is no longer offered and the units table refuses a new GRR unit, so a GRR unit is shown to a prospect
     as profit share, the model sold today (11 Nov 2026: the copy failed on a GRR unit and left a sample owner with none). */
  const pick = (c: string) => c === 'split_kind' ? `CASE WHEN p."split_kind" = 'GRR — guaranteed rent' THEN 'Profit share' ELSE p."split_kind" END` : `p."${c}"`;
  let reservations = 0, reviews = 0;
  try {
  await run(env, `INSERT INTO demo.units (id, owner_id, unit_number, demo_by, demo_at, ${list})
    SELECT x.id, ?, x.unit_number, ?, ?, ${cols.map(pick).join(', ')}
    FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, "from" text, unit_number text) JOIN units p ON p.id = x."from"`,
    ownerId, actor, at, JSON.stringify(copies));

  if (b.fill !== false) {
    const made = sampleStays(ownerId, copies);
    if (made.guests.length) {
      await run(env, `INSERT INTO demo.guests (id, full_name, created_at, demo_by, demo_at)
        SELECT x.id, x.name, ?, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, name text)`, at, actor, at, JSON.stringify(made.guests));
      await run(env, `INSERT INTO demo.reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count,
          gross_booking_value, collected_revenue, created_at, updated_at, demo_by, demo_at)
        SELECT x.id, x.unit_id, x.guest_id, x.channel, x.ref, x.state, x.check_in, x.check_out, x.guests, x.gross, x.gross, ?, ?, ?, ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, guest_id text, channel text, ref text, state text, check_in text, check_out text, guests int, gross bigint)`,
        at, at, actor, at, JSON.stringify(made.stays));
    }
    if (made.reviews.length) {
      await run(env, `INSERT INTO demo.reviews (id, unit_id, reservation_id, channel, rating, comment, reviewed_at, demo_by, demo_at)
        SELECT x.id, x.unit_id, x.reservation_id, x.channel, x.rating, x.comment, x.reviewed_at, ?, ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, reservation_id text, channel text, rating float8, comment text, reviewed_at text)`,
        actor, at, JSON.stringify(made.reviews));
    }
    reservations = made.stays.length; reviews = made.reviews.length;
  }
  } catch (e) {
    /* Never leave half a sample owner behind: the list would show one with no units and nothing to open. */
    await removeSampleOwner(env, ownerId).catch(() => undefined);
    throw e;
  }
  return { id: ownerId, units: copies.length, reservations, reviews };
}

/** Three months of sample stays per unit, up to two weeks ahead, about four nights in five booked, at around the
 *  unit's nightly price; about two past stays in three leave a four- or five-star review. */
function sampleStays(ownerId: string, units: { id: string; base_rate: number }[]) {
  const today = todayMyt();
  const start = `${addDays(today, -95).slice(0, 7)}-01`, end = addDays(today, 14);
  const guests: { id: string; name: string }[] = [];
  const stays: { id: string; unit_id: string; guest_id: string; channel: string; ref: string; state: string; check_in: string; check_out: string; guests: number; gross: number }[] = [];
  const reviews: { id: string; unit_id: string; reservation_id: string; channel: string; rating: number; comment: string; reviewed_at: string }[] = [];
  for (const u of units) {
    const rnd = seeded(`${ownerId}:${u.id}`);
    const nightly = u.base_rate > 0 ? u.base_rate : 25000;
    let day = addDays(start, Math.floor(rnd() * 3));
    while (day < end) {
      const nights = 2 + Math.floor(rnd() * 4);
      const out = addDays(day, nights);
      const guestId = newDemoId('g'), id = newDemoId('r');
      const channel = CHANNELS[Math.floor(rnd() * CHANNELS.length)];
      const state = out <= today ? 'checked_out' : day <= today ? 'checked_in' : 'confirmed';
      guests.push({ id: guestId, name: GUESTS[Math.floor(rnd() * GUESTS.length)] });
      stays.push({ id, unit_id: u.id, guest_id: guestId, channel, ref: `DEMO-${id.slice(-6).toUpperCase()}`, state, check_in: day, check_out: out,
        guests: 1 + Math.floor(rnd() * 4), gross: Math.round(nightly * nights * (0.9 + rnd() * 0.4) / 100) * 100 });
      if (state === 'checked_out' && rnd() < 0.66) {
        reviews.push({ id: newDemoId('v'), unit_id: u.id, reservation_id: id, channel, rating: rnd() < 0.8 ? 5 : 4,
          comment: COMMENTS[Math.floor(rnd() * COMMENTS.length)], reviewed_at: addDays(out, 1 + Math.floor(rnd() * 4)) });
      }
      day = addDays(out, Math.floor(rnd() * 3));
    }
  }
  return { guests, stays, reviews };
}

/** Removes a sample owner with its sample units and everything on them. */
export async function removeSampleOwner(env: Env, id: string): Promise<Response | { removed: string }> {
  if (!id.startsWith('demo-')) return fail('NOT_FOUND', 'That sample owner no longer exists.', 404);
  const o = await one<{ id: string }>(env, 'SELECT id FROM demo.owners WHERE id = ? AND shadow_of IS NULL', id);
  if (!o) return fail('NOT_FOUND', 'That sample owner no longer exists.', 404);
  const units = `SELECT id FROM demo.units WHERE owner_id = ?`;
  await run(env, `DELETE FROM demo.reviews WHERE unit_id IN (${units})`, id);
  await run(env, `WITH gone AS (DELETE FROM demo.reservations WHERE unit_id IN (${units}) RETURNING guest_id)
    DELETE FROM demo.guests WHERE id IN (SELECT guest_id FROM gone) AND id LIKE 'demo-g-%'`, id);
  await run(env, 'DELETE FROM demo.units WHERE owner_id = ?', id);
  await run(env, 'DELETE FROM demo.owners WHERE id = ?', id);
  return { removed: id };
}

export async function listSampleOwners(env: Env) {
  return all<{ id: string; display_name: string; default_management_fee_pct: number | null; units: number; reservations: number; created_at: string }>(env, `
    SELECT o.id, o.display_name, o.default_management_fee_pct, o.created_at,
      (SELECT count(*)::int FROM demo.units u WHERE u.owner_id = o.id) AS units,
      (SELECT count(*)::int FROM demo.v_reservations r JOIN demo.units u ON u.id = r.unit_id WHERE u.owner_id = o.id) AS reservations
    FROM demo.owners o WHERE o.shadow_of IS NULL ORDER BY o.created_at DESC`);
}
