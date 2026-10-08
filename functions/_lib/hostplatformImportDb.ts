/** Writes the HostPlatform / owner-workbook import plans (hostplatformImport.ts) to Postgres.
 *
 *  Each table is written with one INSERT ... SELECT FROM jsonb_to_recordset(...) ON CONFLICT (id) DO UPDATE,
 *  so a request of 500 rows is a handful of statements and each statement is all-or-nothing.
 *
 *  Ownership rule, everywhere: rows this import created (ids starting 'hp-' or 'wb-') are refreshed from
 *  the files on every run; rows that already existed (the Channex pilot unit, 'Regalia', owners typed in
 *  by hand) are only filled where empty, and their Channex mapping, listing flag and contract are never
 *  touched. Nothing here calls Channex: these bookings already live on the booking sites. */
import {
  type ListingPlan, type ReservationPlan, type WorkbookUnitIn, type AirbnbEarningIn, type CleaningIn, type ExpenseIn,
  type KnownUnit, type KnownProperty, type RowError,
  PLACEHOLDER_OWNER, slug, unitKey, workbookMatcher, matchWorkbookUnitHow, buildingForPrefix, splitWorkbookId, workbookOwnerId, stayState,
} from './hostplatformImport';

/** The three helpers of db.ts, bound to an environment. Lets the test script run the same SQL on PGlite. */
export interface Db {
  all<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T[]>;
  run(sql: string, ...args: unknown[]): Promise<void>;
}

export interface Tally { created: number; updated: number }
export interface ImportResult {
  created: number; updated: number; skipped: number; errors: RowError[]; skippedRows: RowError[];
  tables: Record<string, Tally>; notes: string[]; stats?: Record<string, number>;
}

export const WORKBOOK_MONEY_MARK = 'amounts from owner workbook';
/** Bookings the workbook created because HostPlatform did not have them: 'hp-res-ab-<HM code>', 'hp-res-bc-<Booking.com number>'. */
const FROM_WORKBOOK = /^hp-res-(ab|bc)-/;
const ours = (t: string) => `(${t}.id LIKE 'hp-%' OR ${t}.id LIKE 'wb-%')`;
const isOurs = (id: string) => id.startsWith('hp-') || id.startsWith('wb-');

/** INSERT ... SELECT FROM jsonb_to_recordset ... ON CONFLICT (id) <onConflict>. Counts inserted vs updated rows. */
async function upsert(db: Db, table: string, defs: [string, string][], rows: Record<string, unknown>[], onConflict: string): Promise<Tally> {
  if (!rows.length) return { created: 0, updated: 0 };
  const ids = rows.map(r => String(r.id));
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`${table}: ${dup} would be written twice in one request.`);
  const cols = defs.map(d => d[0]).join(', ');
  const out = await db.all<{ inserted: boolean }>(`
    INSERT INTO ${table} (${cols})
    SELECT ${cols} FROM jsonb_to_recordset(?::jsonb) AS x(${defs.map(d => `${d[0]} ${d[1]}`).join(', ')})
    ON CONFLICT (id) ${onConflict}
    RETURNING (xmax = 0) AS inserted`, JSON.stringify(rows));
  const created = out.filter(r => r.inserted === true || (r.inserted as unknown) === 't').length;
  return { created, updated: out.length - created };
}

/** `col = EXCLUDED.col` for our own rows, fill-only-if-empty for rows that were already there. */
const refresh = (table: string, cols: string[]) => cols.map(c =>
  `${c} = CASE WHEN ${ours(table)} THEN EXCLUDED.${c} ELSE COALESCE(NULLIF(${table}.${c}::text, ''), EXCLUDED.${c}::text)::${c === 'latitude' || c === 'longitude' ? 'double precision' : 'text'} END`).join(', ');

interface Snapshot { units: (KnownUnit & { ownerName: string })[]; properties: KnownProperty[]; owners: { id: string; name: string; ic: string | null }[] }

async function snapshot(db: Db): Promise<Snapshot> {
  const units = await db.all<any>(`
    SELECT u.id, u.unit_number, u.property_id, u.owner_id, u.contract_id, p.name AS property_name, o.display_name AS owner_name
    FROM units u JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id`);
  const properties = await db.all<any>('SELECT id, name FROM properties');
  const owners = await db.all<any>('SELECT id, display_name, ic_number FROM owners');
  return {
    units: units.map(u => ({ id: u.id, unitNumber: u.unit_number, propertyId: u.property_id, propertyName: u.property_name, ownerId: u.owner_id, contractId: u.contract_id, ownerName: u.owner_name })),
    properties: properties.map(p => ({ id: p.id, name: p.name })),
    owners: owners.map(o => ({ id: o.id, name: o.display_name, ic: o.ic_number })),
  };
}

const empty = (): ImportResult => ({ created: 0, updated: 0, skipped: 0, errors: [], skippedRows: [], tables: {}, notes: [] });
function add(res: ImportResult, table: string, t: Tally) {
  const cur = res.tables[table] ?? { created: 0, updated: 0 };
  res.tables[table] = { created: cur.created + t.created, updated: cur.updated + t.updated };
}
function finish(res: ImportResult, main: string): ImportResult {
  res.created = res.tables[main]?.created ?? 0;
  res.updated = res.tables[main]?.updated ?? 0;
  res.skipped = res.skippedRows.length + res.errors.length;
  return res;
}

/** The placeholder owner units go under until the workbook names the real one. Reused by name if it exists. */
async function placeholderOwner(db: Db, owners: Snapshot['owners'], now: string): Promise<string> {
  const hit = owners.find(o => o.name.toLowerCase() === PLACEHOLDER_OWNER.toLowerCase());
  if (hit) return hit.id;
  const id = 'hp-owner-to-be-confirmed';
  await upsert(db, 'owners', [['id', 'text'], ['display_name', 'text'], ['email', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    [{ id, display_name: PLACEHOLDER_OWNER, email: '', created_at: now, updated_at: now }], 'DO NOTHING');
  owners.push({ id, name: PLACEHOLDER_OWNER, ic: null });
  return id;
}

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export async function importListing(db: Db, plan: ListingPlan, now: string): Promise<ImportResult> {
  const res = empty();
  res.errors.push(...plan.errors);
  res.notes.push(...plan.notes);
  const snap = await snapshot(db);

  // Buildings: an existing building with the same name (e.g. 'Regalia') is used, not duplicated.
  const propId = new Map<string, string>();
  const props = plan.properties.map(p => {
    const hit = snap.properties.find(x => x.id === p.id) ?? snap.properties.find(x => x.name.toLowerCase() === p.name.toLowerCase());
    const id = hit?.id ?? p.id;
    propId.set(p.name.toLowerCase(), id);
    return { id, name: p.name, address_line: p.addressLine, city: p.city, state: p.state, postcode: p.postcode, country_code: p.countryCode, latitude: p.latitude, longitude: p.longitude, created_at: now, updated_at: now };
  });
  add(res, 'properties', await upsert(db, 'properties',
    [['id', 'text'], ['name', 'text'], ['address_line', 'text'], ['city', 'text'], ['state', 'text'], ['postcode', 'text'], ['country_code', 'text'], ['latitude', 'float8'], ['longitude', 'float8'], ['created_at', 'text'], ['updated_at', 'text']],
    props, `DO UPDATE SET ${refresh('properties', ['address_line', 'city', 'state', 'postcode', 'country_code', 'latitude', 'longitude'])}, updated_at = EXCLUDED.updated_at`));
  for (const p of props) if (!snap.properties.some(x => x.id === p.id)) snap.properties.push({ id: p.id, name: p.name });

  // Owners: the listing names 3; everyone else goes under the placeholder until the workbook says who.
  const ownerId = new Map<string, string>();
  const newOwners: Record<string, unknown>[] = [];
  for (const name of plan.owners) {
    if (name === PLACEHOLDER_OWNER) { ownerId.set(name, await placeholderOwner(db, snap.owners, now)); continue; }
    const hit = snap.owners.find(o => o.name.toLowerCase() === name.toLowerCase());
    const id = hit?.id ?? `hp-owner-${slug(name)}`;
    ownerId.set(name, id);
    if (!hit) { newOwners.push({ id, display_name: name, email: '', created_at: now, updated_at: now }); snap.owners.push({ id, name, ic: null }); }
  }
  add(res, 'owners', await upsert(db, 'owners', [['id', 'text'], ['display_name', 'text'], ['email', 'text'], ['created_at', 'text'], ['updated_at', 'text']], newOwners, 'DO NOTHING'));

  // Units: the HostPlatform key decides the id, unless the building already has a unit with that number
  // (the Channex pilot unit): then that unit is updated instead and keeps its own id.
  const target = new Map<string, string>(); // unitKey -> id
  const unitRows = plan.units.map(u => {
    const pid = propId.get(u.building.toLowerCase())!;
    const hit = snap.units.find(x => x.id === u.id)
      ?? snap.units.find(x => x.propertyId === pid && x.unitNumber.toLowerCase() === u.unitNumber.toLowerCase());
    const id = hit?.id ?? u.id;
    target.set(unitKey(u.building, u.unitNumber), id);
    return {
      id, property_id: pid, owner_id: ownerId.get(u.ownerName)!, unit_number: u.unitNumber, unit_code: u.unitCode, listing_name: u.listingName,
      address: u.address, bedrooms: u.bedrooms, bathrooms: u.bathrooms, base_rate: u.baseRate, is_listed: 1, listed_at: now, created_at: now, updated_at: now,
    };
  });
  add(res, 'units', await upsert(db, 'units',
    [['id', 'text'], ['property_id', 'text'], ['owner_id', 'text'], ['unit_number', 'text'], ['unit_code', 'text'], ['listing_name', 'text'], ['address', 'text'],
     ['bedrooms', 'int'], ['bathrooms', 'int'], ['base_rate', 'int'], ['is_listed', 'int'], ['listed_at', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    unitRows, `DO UPDATE SET
      unit_code = CASE WHEN ${ours('units')} THEN EXCLUDED.unit_code ELSE COALESCE(units.unit_code, EXCLUDED.unit_code) END,
      listing_name = COALESCE(units.listing_name, EXCLUDED.listing_name),
      address = COALESCE(units.address, EXCLUDED.address),
      bedrooms = CASE WHEN ${ours('units')} THEN EXCLUDED.bedrooms ELSE units.bedrooms END,
      bathrooms = CASE WHEN ${ours('units')} THEN EXCLUDED.bathrooms ELSE units.bathrooms END,
      base_rate = CASE WHEN ${ours('units')} THEN EXCLUDED.base_rate ELSE units.base_rate END,
      updated_at = EXCLUDED.updated_at`));

  // Sub-units ('11-03 (B)' under '11-03 (A)'): resolved after every unit of the file exists.
  const parents: Record<string, unknown>[] = [];
  for (const u of plan.units) {
    if (!u.parentName) continue;
    const child = target.get(unitKey(u.building, u.unitNumber))!;
    const pid = propId.get(u.building.toLowerCase())!;
    const parent = target.get(unitKey(u.building, u.parentName))
      ?? snap.units.find(x => x.propertyId === pid && x.unitNumber.toLowerCase() === u.parentName!.toLowerCase())?.id;
    if (!parent) { res.skippedRows.push({ row: u.row, reason: `Parent unit ${u.parentName} not found; ${u.unitNumber} left as a top-level unit.` }); continue; }
    if (parent !== child && isOurs(child)) parents.push({ id: child, parent_unit_id: parent });
  }
  if (parents.length) {
    await db.run(`UPDATE units u SET parent_unit_id = x.parent_unit_id FROM jsonb_to_recordset(?::jsonb) AS x(id text, parent_unit_id text) WHERE u.id = x.id`, JSON.stringify(parents));
  }

  // Monthly running costs, only on units this import owns (the pilot unit's own costs stay as they are).
  const written = new Set(target.values());
  const exp = plan.unitExpenses.filter(e => written.has(e.unitId))
    .map(e => ({ id: e.id, unit_id: e.unitId, category: e.category, amount: e.amount, note: e.note, sort_order: e.sortOrder }));
  add(res, 'unit_expenses', await upsert(db, 'unit_expenses',
    [['id', 'text'], ['unit_id', 'text'], ['category', 'text'], ['amount', 'int'], ['note', 'text'], ['sort_order', 'int']],
    exp, 'DO UPDATE SET category = EXCLUDED.category, amount = EXCLUDED.amount'));
  return finish(res, 'units');
}

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

export async function importReservations(db: Db, plan: ReservationPlan, now: string): Promise<ImportResult> {
  const res = empty();
  res.errors.push(...plan.errors);
  const snap = await snapshot(db);
  const unitOf = new Map(snap.units.map(u => [unitKey(u.propertyName, u.unitNumber), u.id]));

  const ids = plan.reservations.map(r => r.id), refs = plan.reservations.map(r => r.externalRef);
  const existing = plan.reservations.length ? await db.all<{ id: string; external_ref: string | null; unit_id: string }>(`
    SELECT id, external_ref, unit_id FROM reservations
    WHERE id IN (SELECT jsonb_array_elements_text(?::jsonb)) OR external_ref IN (SELECT jsonb_array_elements_text(?::jsonb))`,
    JSON.stringify(ids), JSON.stringify(refs)) : [];
  const byId = new Set(existing.map(e => e.id));
  // A booking the workbook step created first (run out of order) is taken over, by reference or by unit and dates.
  const keyed = plan.reservations.map(r => ({ unit_id: unitOf.get(unitKey(r.building, r.unitNumber)) ?? '', check_in: r.checkIn, check_out: r.checkOut }));
  const workbookStays = plan.reservations.length ? await db.all<{ id: string; unit_id: string; check_in: string; check_out: string; channel: string }>(`
    SELECT r.id, r.unit_id, r.check_in, r.check_out, r.channel FROM reservations r
    JOIN jsonb_to_recordset(?::jsonb) AS x(unit_id text, check_in text, check_out text)
      ON x.unit_id = r.unit_id AND x.check_in = r.check_in AND x.check_out = r.check_out
    WHERE r.id ~ '^hp-res-(ab|bc)-'`, JSON.stringify(keyed)) : [];
  const taken = new Set<string>();

  const keep: Record<string, unknown>[] = [], usedGuests = new Set<string>(), unitFacts = new Map<string, { max: number | null; size: number | null; at: string }>();
  for (const r of plan.reservations) {
    const unitId = unitOf.get(unitKey(r.building, r.unitNumber));
    if (!unitId) { res.errors.push({ row: r.row, reason: `${r.building} ${r.unitNumber} is not in Property OS. Import the HostPlatform listing first.` }); continue; }
    let id = r.id;
    if (!byId.has(id)) {
      const same = existing.filter(e => e.external_ref === r.externalRef);
      const fromWorkbook = same.find(e => FROM_WORKBOOK.test(e.id) && !taken.has(e.id))
        ?? workbookStays.find(w => w.unit_id === unitId && w.check_in === r.checkIn && w.check_out === r.checkOut && w.channel === r.channel && !taken.has(w.id));
      const fromChannex = same.find(e => !isOurs(e.id) && e.unit_id === unitId);
      if (fromWorkbook) { id = fromWorkbook.id; taken.add(id); }
      else if (fromChannex) { res.skippedRows.push({ row: r.row, reason: `${r.code} is already in Property OS from Channex; left as it is.` }); continue; }
    }
    if (r.guestId) usedGuests.add(r.guestId);
    keep.push({
      id, unit_id: unitId, guest_id: r.guestId, channel: r.channel, external_ref: r.externalRef, state: r.state, check_in: r.checkIn, check_out: r.checkOut,
      guests_count: r.guestsCount, gross_booking_value: r.gross, channel_fee: r.fee, collected_revenue: r.collected, currency: r.currency,
      notes: r.notes, created_at: r.createdAt ?? now, updated_at: now,
    });
    if (isOurs(unitId) && (r.maxGuests || r.sizeSqft)) {
      const cur = unitFacts.get(unitId);
      if (!cur || r.checkIn > cur.at) unitFacts.set(unitId, { max: r.maxGuests, size: r.sizeSqft, at: r.checkIn });
    }
  }

  const guests = plan.guests.filter(g => usedGuests.has(g.id)).map(g => ({ id: g.id, full_name: g.fullName, email: g.email, phone: g.phone, country_code: g.countryCode, created_at: now }));
  add(res, 'guests', await upsert(db, 'guests',
    [['id', 'text'], ['full_name', 'text'], ['email', 'text'], ['phone', 'text'], ['country_code', 'text'], ['created_at', 'text']],
    guests, 'DO UPDATE SET full_name = EXCLUDED.full_name, email = COALESCE(EXCLUDED.email, guests.email), phone = COALESCE(EXCLUDED.phone, guests.phone), country_code = COALESCE(EXCLUDED.country_code, guests.country_code)'));

  // Once the owner workbook has set a booking's money, a later HostPlatform run leaves the money alone.
  const wb = `reservations.notes LIKE '%${WORKBOOK_MONEY_MARK}%'`;
  add(res, 'reservations', await upsert(db, 'reservations',
    [['id', 'text'], ['unit_id', 'text'], ['guest_id', 'text'], ['channel', 'text'], ['external_ref', 'text'], ['state', 'text'], ['check_in', 'text'], ['check_out', 'text'],
     ['guests_count', 'int'], ['gross_booking_value', 'int'], ['channel_fee', 'int'], ['collected_revenue', 'int'], ['currency', 'text'], ['notes', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    keep, `DO UPDATE SET unit_id = EXCLUDED.unit_id, guest_id = EXCLUDED.guest_id, channel = EXCLUDED.channel, external_ref = EXCLUDED.external_ref,
      state = EXCLUDED.state, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out, guests_count = EXCLUDED.guests_count,
      gross_booking_value = CASE WHEN ${wb} THEN reservations.gross_booking_value ELSE EXCLUDED.gross_booking_value END,
      channel_fee = CASE WHEN ${wb} THEN reservations.channel_fee ELSE EXCLUDED.channel_fee END,
      collected_revenue = CASE WHEN ${wb} THEN reservations.collected_revenue ELSE EXCLUDED.collected_revenue END,
      currency = EXCLUDED.currency,
      notes = CASE WHEN ${wb} THEN reservations.notes ELSE EXCLUDED.notes END,
      updated_at = EXCLUDED.updated_at`));

  const facts = [...unitFacts.entries()].map(([id, f]) => ({ id, max_guests: f.max, size_sqft: f.size }));
  if (facts.length) {
    await db.run(`UPDATE units u SET max_guests = COALESCE(x.max_guests, u.max_guests), size_sqft = COALESCE(x.size_sqft, u.size_sqft)
      FROM jsonb_to_recordset(?::jsonb) AS x(id text, max_guests int, size_sqft int) WHERE u.id = x.id`, JSON.stringify(facts));
  }
  return finish(res, 'reservations');
}

/* ------------------------------------------------------------------ */
/* Workbook: units, owners, contracts                                  */
/* ------------------------------------------------------------------ */

export async function importWorkbookUnits(db: Db, units: WorkbookUnitIn[], now: string): Promise<ImportResult> {
  const res = empty();
  const snap = await snapshot(db);
  const placeholder = await placeholderOwner(db, snap.owners, now);
  const newProps: Record<string, unknown>[] = [], ownerRows = new Map<string, Record<string, unknown>>();
  const newUnits: Record<string, unknown>[] = [], updates: Record<string, unknown>[] = [], contracts: Record<string, unknown>[] = [], links: Record<string, unknown>[] = [];
  const matchedIds = new Set<string>(), contractIds = new Set<string>();
  let matched = 0, workbookOnly = 0;
  // A unit matched by its own code is taken first; the whole-unit row of a split unit ('TRION-B6106' next to
  // 'TRION-B6106(A)' and '(B)') then does not borrow room (A), and becomes a unit of its own.
  const firstHits = new Map(units.map(w => [w.workbookId, matchWorkbookUnitHow(w.workbookId, snap.units)]));
  const claimed = new Set([...firstHits.values()].filter(h => h?.how === 'code').map(h => h!.unit.id));

  for (const w of units) {
    // Owner: same IC number first, then same name, else a new owner.
    let ownerId: string | null = null;
    if (w.ownerName || w.ic) {
      const hit = (w.ic ? snap.owners.find(o => o.ic && o.ic === w.ic) : undefined)
        ?? (w.ownerName ? snap.owners.find(o => o.name.toLowerCase() === w.ownerName!.toLowerCase()) : undefined);
      ownerId = hit ? hit.id : workbookOwnerId(w);
      if (!hit) snap.owners.push({ id: ownerId, name: w.ownerName ?? w.ic!, ic: w.ic });
      if (!ownerRows.has(ownerId)) {
        ownerRows.set(ownerId, {
          id: ownerId, display_name: w.ownerName ?? hit?.name ?? 'Owner', email: '', ic_number: w.ic, bank_name: w.bankName, bank_account_number: w.bankAccount,
          bank_account_last4: w.bankAccount ? w.bankAccount.slice(-4) : null, bank_account_holder: w.bankHolder, created_at: now, updated_at: now,
        });
      }
    }

    const first = firstHits.get(w.workbookId);
    const hit = first && (first.how === 'code' || !claimed.has(first.unit.id)) ? (snap.units.find(u => u.id === first.unit.id) as typeof snap.units[number]) : null;
    if (hit && first?.how === 'room') claimed.add(hit.id);
    let unitId: string, unitOurs: boolean, contractId: string | null | undefined;
    if (hit) {
      matched++;
      matchedIds.add(hit.id);
      unitId = hit.id; unitOurs = isOurs(hit.id); contractId = hit.contractId;
      const takeOwner = ownerId && (unitOurs || hit.ownerName === PLACEHOLDER_OWNER);
      updates.push({
        id: unitId, ours: unitOurs, owner_id: takeOwner ? ownerId : null, listing_name: w.listingName, address: w.address,
        package: w.pkg, term: w.term, split_kind: w.split, split_value: w.splitValue, updated_at: now,
      });
    } else {
      workbookOnly++;
      const { prefix, code } = splitWorkbookId(w.workbookId);
      const b = buildingForPrefix(prefix || w.workbookId, snap.properties);
      if (b.isNew) {
        snap.properties.push({ id: b.id, name: b.name });
        newProps.push({ id: b.id, name: b.name, address_line: w.address ?? '', city: '', state: '', country_code: 'MY', created_at: now, updated_at: now });
      }
      unitId = `wb-unit-${slug(w.workbookId)}`; unitOurs = true; contractId = null;
      newUnits.push({
        id: unitId, property_id: b.id, owner_id: ownerId ?? placeholder, unit_number: code || w.workbookId, unit_code: code || w.workbookId,
        listing_name: w.listingName, address: w.address, base_rate: 0, is_listed: 0, package: w.pkg ?? 'Package C', term: w.term ?? 'Long term',
        split_kind: w.split ?? 'Not set', split_value: w.splitValue, created_at: now, updated_at: now,
      });
      snap.units.push({ id: unitId, unitNumber: code || w.workbookId, propertyId: b.id, propertyName: b.name, ownerName: '' });
    }

    // Contract: created or refreshed by the import, unless the unit already has one made in Property OS.
    if (w.contract && (!contractId || contractId.startsWith('wb-'))) {
      const id = contractId ?? `wb-contract-${slug(w.workbookId)}`;
      if (contractIds.has(id)) continue;
      contractIds.add(id);
      contracts.push({
        id, owner_id: ownerId ?? (hit?.ownerId || placeholder), management_fee_pct: w.contract.feePct, model: w.contract.model, grr_amount: w.contract.grrAmount,
        starts_on: w.contract.startsOn, ends_on: w.contract.endsOn, created_at: now,
      });
      if (!contractId) links.push({ id: unitId, contract_id: id });
    }
  }

  add(res, 'properties', await upsert(db, 'properties',
    [['id', 'text'], ['name', 'text'], ['address_line', 'text'], ['city', 'text'], ['state', 'text'], ['country_code', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    newProps, 'DO NOTHING'));
  add(res, 'owners', await upsert(db, 'owners',
    [['id', 'text'], ['display_name', 'text'], ['email', 'text'], ['ic_number', 'text'], ['bank_name', 'text'], ['bank_account_number', 'text'], ['bank_account_last4', 'text'], ['bank_account_holder', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    [...ownerRows.values()], `DO UPDATE SET ${['ic_number', 'bank_name', 'bank_account_number', 'bank_account_last4', 'bank_account_holder'].map(c =>
      `${c} = CASE WHEN ${ours('owners')} THEN COALESCE(EXCLUDED.${c}, owners.${c}) ELSE COALESCE(NULLIF(owners.${c}, ''), EXCLUDED.${c}) END`).join(', ')},
      display_name = CASE WHEN owners.id LIKE 'wb-%' THEN EXCLUDED.display_name ELSE owners.display_name END, updated_at = EXCLUDED.updated_at`));
  add(res, 'units', await upsert(db, 'units',
    [['id', 'text'], ['property_id', 'text'], ['owner_id', 'text'], ['unit_number', 'text'], ['unit_code', 'text'], ['listing_name', 'text'], ['address', 'text'], ['base_rate', 'int'],
     ['is_listed', 'int'], ['package', 'text'], ['term', 'text'], ['split_kind', 'text'], ['split_value', 'int'], ['created_at', 'text'], ['updated_at', 'text']],
    newUnits, 'DO NOTHING'));
  if (updates.length) {
    const out = await db.all(`
      UPDATE units u SET
        owner_id = COALESCE(x.owner_id, u.owner_id),
        listing_name = CASE WHEN x.ours THEN COALESCE(x.listing_name, u.listing_name) ELSE COALESCE(u.listing_name, x.listing_name) END,
        address = CASE WHEN x.ours THEN COALESCE(x.address, u.address) ELSE COALESCE(u.address, x.address) END,
        package = CASE WHEN x.ours AND x.package IS NOT NULL THEN x.package ELSE u.package END,
        term = CASE WHEN x.ours AND x.term IS NOT NULL THEN x.term ELSE u.term END,
        split_kind = CASE WHEN x.ours AND x.split_kind IS NOT NULL THEN x.split_kind ELSE u.split_kind END,
        split_value = CASE WHEN x.ours AND x.split_kind IS NOT NULL THEN x.split_value ELSE u.split_value END,
        guarantee_period = CASE WHEN x.ours AND x.split_kind IS NOT NULL THEN 'month' ELSE u.guarantee_period END,
        updated_at = x.updated_at
      FROM jsonb_to_recordset(?::jsonb) AS x(id text, ours boolean, owner_id text, listing_name text, address text, package text, term text, split_kind text, split_value int, updated_at text)
      WHERE u.id = x.id RETURNING u.id`, JSON.stringify(updates));
    add(res, 'units', { created: 0, updated: out.length });
  }
  add(res, 'owner_contracts', await upsert(db, 'owner_contracts',
    [['id', 'text'], ['owner_id', 'text'], ['management_fee_pct', 'float8'], ['model', 'text'], ['grr_amount', 'int'], ['starts_on', 'text'], ['ends_on', 'text'], ['created_at', 'text']],
    contracts, `DO UPDATE SET owner_id = EXCLUDED.owner_id, management_fee_pct = EXCLUDED.management_fee_pct, model = EXCLUDED.model,
      grr_amount = EXCLUDED.grr_amount, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on`));
  if (links.length) await db.run(`UPDATE units u SET contract_id = x.contract_id FROM jsonb_to_recordset(?::jsonb) AS x(id text, contract_id text) WHERE u.id = x.id AND u.contract_id IS NULL`, JSON.stringify(links));

  const hostPlatformOnly = snap.units.filter(u => u.id.startsWith('hp-unit-') && !matchedIds.has(u.id)).length;
  res.stats = { matched, workbookOnly, hostPlatformOnly };
  return finish(res, 'units');
}

/* ------------------------------------------------------------------ */
/* Workbook: Airbnb earnings                                           */
/* ------------------------------------------------------------------ */

export async function importAirbnbEarnings(db: Db, earnings: AirbnbEarningIn[], today: string, now: string): Promise<ImportResult> {
  const res = empty();
  const snap = await snapshot(db);
  const codes = [...new Set(earnings.map(e => e.code))];
  const existing = codes.length ? await db.all<{ id: string; external_ref: string; unit_id: string }>(`
    SELECT id, external_ref, unit_id FROM reservations
    WHERE external_ref IN (SELECT jsonb_array_elements_text(?::jsonb))`, JSON.stringify(codes)) : [];

  const match = workbookMatcher(snap.units);
  const resolved = earnings.map(e => ({ e, unit: match(e.workbookId)?.unit ?? null }));
  // HostPlatform keeps Booking.com bookings under its own reference, so those are also recognised by unit
  // and exact dates. Airbnb codes are the same on both sides and are matched by code only: the workbook has
  // a few pairs of different Airbnb codes on the same unit and dates, and a date match would merge them.
  const stays = resolved.some(r => r.unit) ? await db.all<{ id: string; unit_id: string; channel: string; check_in: string; check_out: string }>(`
    SELECT r.id, r.unit_id, r.channel, r.check_in, r.check_out FROM reservations r
    JOIN jsonb_to_recordset(?::jsonb) AS x(unit_id text, check_in text, check_out text)
      ON x.unit_id = r.unit_id AND x.check_in = r.check_in AND x.check_out = r.check_out
    WHERE r.state <> 'cancelled'`, JSON.stringify(resolved.filter(r => r.unit).map(r => ({ unit_id: r.unit!.id, check_in: r.e.checkIn, check_out: r.e.checkOut })))) : [];
  const taken = new Set<string>();

  const money: Record<string, unknown>[] = [], fresh: Record<string, unknown>[] = [];
  for (const { e, unit } of resolved) {
    if (!unit) { res.errors.push({ row: e.row, reason: `${e.code}: unit ${e.workbookId} is not in Property OS. Import the workbook units first.` }); continue; }
    const same = existing.filter(x => x.external_ref === e.code && !FROM_WORKBOOK.test(x.id));
    const match = same.find(x => x.unit_id === unit.id) ?? (same.length === 1 && !e.idSuffix ? same[0] : undefined)
      ?? stays.find(x => e.site === 'booking_com' && x.unit_id === unit.id && x.channel === e.site && x.check_in === e.checkIn && x.check_out === e.checkOut && !FROM_WORKBOOK.test(x.id) && !taken.has(x.id));
    if (match) taken.add(match.id);
    if (match) {
      if (!match.id.startsWith('hp-res-')) { res.skippedRows.push({ row: e.row, reason: `${e.code} is managed by Channex; its amounts were left as they are.` }); continue; }
      if (e.gross === null && e.amount === null) { res.skippedRows.push({ row: e.row, reason: `${e.code}: no amounts in the workbook; HostPlatform amounts kept.` }); continue; }
      money.push({ id: match.id, gross: e.gross ?? 0, fee: e.fee ?? 0, amount: e.amount ?? 0, updated_at: now });
      continue;
    }
    // Not on HostPlatform (e.g. stays before May): recorded as a booking from the workbook.
    fresh.push({
      id: `hp-res-${e.site === 'airbnb' ? 'ab' : 'bc'}-${e.code}${e.idSuffix}`, unit_id: unit.id, channel: e.site, external_ref: e.code, state: stayState(e.checkIn, e.checkOut, today),
      check_in: e.checkIn, check_out: e.checkOut, guests_count: 1, gross_booking_value: e.gross ?? 0, channel_fee: e.fee ?? 0, collected_revenue: e.amount ?? 0,
      currency: 'MYR', notes: `Imported from owner workbook (earnings sheet, ${WORKBOOK_MONEY_MARK})`, created_at: now, updated_at: now,
    });
  }
  if (money.length) {
    const out = await db.all(`
      UPDATE reservations r SET gross_booking_value = x.gross, channel_fee = x.fee, collected_revenue = x.amount,
        notes = CASE WHEN COALESCE(r.notes, '') LIKE '%${WORKBOOK_MONEY_MARK}%' THEN r.notes ELSE COALESCE(r.notes || ' · ', '') || '${WORKBOOK_MONEY_MARK}' END,
        updated_at = x.updated_at
      FROM jsonb_to_recordset(?::jsonb) AS x(id text, gross int, fee int, amount int, updated_at text) WHERE r.id = x.id RETURNING r.id`, JSON.stringify(money));
    add(res, 'reservations', { created: 0, updated: out.length });
  }
  add(res, 'reservations', await upsert(db, 'reservations',
    [['id', 'text'], ['unit_id', 'text'], ['channel', 'text'], ['external_ref', 'text'], ['state', 'text'], ['check_in', 'text'], ['check_out', 'text'], ['guests_count', 'int'],
     ['gross_booking_value', 'int'], ['channel_fee', 'int'], ['collected_revenue', 'int'], ['currency', 'text'], ['notes', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    fresh, `DO UPDATE SET unit_id = EXCLUDED.unit_id, state = EXCLUDED.state, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
      gross_booking_value = EXCLUDED.gross_booking_value, channel_fee = EXCLUDED.channel_fee, collected_revenue = EXCLUDED.collected_revenue, updated_at = EXCLUDED.updated_at`));
  res.stats = { matchedHostPlatform: money.length, createdFromWorkbook: fresh.length };
  return finish(res, 'reservations');
}

/* ------------------------------------------------------------------ */
/* Workbook: cleaning records and expenses                             */
/* ------------------------------------------------------------------ */

export async function importCleaning(db: Db, cleanings: CleaningIn[], today: string, now: string): Promise<ImportResult> {
  const res = empty();
  const snap = await snapshot(db);
  const tasks: Record<string, unknown>[] = [], costs: Record<string, unknown>[] = [];
  const match = workbookMatcher(snap.units);
  for (const c of cleanings) {
    const unit = match(c.workbookId)?.unit;
    if (!unit) { res.errors.push({ row: c.row, reason: `Unit ${c.workbookId} is not in Property OS.` }); continue; }
    const due = `${c.date}T${c.dueTime ?? '12:00'}:00+08:00`;
    const done = c.date < today;
    tasks.push({
      id: c.id, unit_id: unit.id, kind: c.kind, state: done ? 'resolved' : 'open', title: c.title, instructions: c.instructions || null,
      scheduled_for: due, due_at: due, next_guest_at: c.nextGuestTime ? `${c.date}T${c.nextGuestTime}:00+08:00` : null,
      completed_at: done ? due : null, requires_photo: 0, created_at: now, updated_at: now,
    });
    // The owner is charged the unit's cleaning price unless the sheet says the tenant or the company pays.
    if (c.price && c.price > 0 && !c.payer) {
      costs.push({ id: c.id.replace('wb-clean-', 'wb-cleanexp-'), unit_id: unit.id, task_id: c.id, category: 'cleaning', description: c.title, amount: c.price, incurred_on: c.date, reference: null, created_at: now });
    }
  }
  add(res, 'tasks', await upsert(db, 'tasks',
    [['id', 'text'], ['unit_id', 'text'], ['kind', 'text'], ['state', 'text'], ['title', 'text'], ['instructions', 'text'], ['scheduled_for', 'text'], ['due_at', 'text'],
     ['next_guest_at', 'text'], ['completed_at', 'text'], ['requires_photo', 'int'], ['created_at', 'text'], ['updated_at', 'text']],
    tasks, `DO UPDATE SET unit_id = EXCLUDED.unit_id, kind = EXCLUDED.kind, title = EXCLUDED.title, instructions = EXCLUDED.instructions, scheduled_for = EXCLUDED.scheduled_for,
      due_at = EXCLUDED.due_at, next_guest_at = EXCLUDED.next_guest_at,
      state = CASE WHEN tasks.state = 'resolved' THEN tasks.state ELSE EXCLUDED.state END,
      completed_at = COALESCE(tasks.completed_at, EXCLUDED.completed_at), updated_at = EXCLUDED.updated_at`));
  if (tasks.length) {
    // Tie each clean to the stay that checked out that day, when there is one.
    await db.run(`UPDATE tasks t SET reservation_id = (
        SELECT r.id FROM reservations r WHERE r.unit_id = t.unit_id AND r.check_out = substr(t.due_at, 1, 10) AND r.state <> 'cancelled' ORDER BY r.id LIMIT 1)
      WHERE t.id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND t.reservation_id IS NULL`, JSON.stringify(tasks.map(t => t.id)));
  }
  add(res, 'expenses', await upsertExpenses(db, costs));
  return finish(res, 'tasks');
}

async function upsertExpenses(db: Db, rows: Record<string, unknown>[]) {
  return upsert(db, 'expenses',
    [['id', 'text'], ['unit_id', 'text'], ['task_id', 'text'], ['category', 'text'], ['description', 'text'], ['amount', 'int'], ['incurred_on', 'text'], ['reference', 'text'], ['created_at', 'text']],
    rows.map(r => ({ task_id: null, ...r })), `DO UPDATE SET unit_id = EXCLUDED.unit_id, category = EXCLUDED.category, description = EXCLUDED.description,
      amount = EXCLUDED.amount, incurred_on = EXCLUDED.incurred_on, reference = EXCLUDED.reference`);
}

export async function importExpenses(db: Db, expenses: ExpenseIn[], now: string): Promise<ImportResult> {
  const res = empty();
  const snap = await snapshot(db);
  const rows: Record<string, unknown>[] = [];
  const match = workbookMatcher(snap.units);
  for (const e of expenses) {
    const unit = match(e.workbookId)?.unit;
    if (!unit) { res.errors.push({ row: e.row, reason: `Unit ${e.workbookId} is not in Property OS.` }); continue; }
    rows.push({ id: e.id, unit_id: unit.id, category: e.category, description: e.description, amount: e.amount, incurred_on: e.incurredOn, reference: e.reference, created_at: now });
  }
  add(res, 'expenses', await upsertExpenses(db, rows));
  return finish(res, 'expenses');
}
