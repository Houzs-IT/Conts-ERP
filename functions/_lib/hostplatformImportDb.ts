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
  type ListingPlan, type ReservationPlan, type WorkbookUnitIn, type AirbnbEarningIn, type CleaningIn, type ExpenseIn, type CreditIn,
  type PayoutMonthIn, type KnownUnit, type KnownProperty, type RowError,
  PLACEHOLDER_OWNER, RESERVATION_MONEY_COLUMNS, CHANNEL_LABEL, placeholderGuestName, guestId as guestIdFor, type Channel, normaliseLocation, canonicalState, canonicalCity, slug, hash, unitKey, workbookMatcher, matchWorkbookUnitHow, buildingForPrefix, splitWorkbookId, workbookOwnerId, listingOwnerId, stayState,
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
const MONEY_TEXT = new Set<string>(['payment_method', 'rate_plan', 'guest_nationality']);
const WORKBOOK_OWNED = new Set<string>(['guest_cleaning_fee', 'ota_tax']);
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
    SELECT ${cols} FROM jsonb_to_recordset(?::text::jsonb) AS x(${defs.map(d => `${d[0]} ${d[1]}`).join(', ')})
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
    const id = hit?.id ?? await listingOwnerId(name);
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
    await db.run(`UPDATE units u SET parent_unit_id = x.parent_unit_id FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, parent_unit_id text) WHERE u.id = x.id`, JSON.stringify(parents));
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
    WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) OR external_ref IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
    JSON.stringify(ids), JSON.stringify(refs)) : [];
  const byId = new Set(existing.map(e => e.id));
  // A booking the workbook step created first (run out of order) is taken over, by reference or by unit and dates.
  const keyed = plan.reservations.map(r => ({ unit_id: unitOf.get(unitKey(r.building, r.unitNumber)) ?? '', check_in: r.checkIn, check_out: r.checkOut }));
  const workbookStays = plan.reservations.length ? await db.all<{ id: string; unit_id: string; check_in: string; check_out: string; channel: string }>(`
    SELECT r.id, r.unit_id, r.check_in, r.check_out, r.channel FROM reservations r
    JOIN jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, check_in text, check_out text)
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
      notes: r.notes, created_at: r.createdAt ?? now, updated_at: now, ...r.money,
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
     ['guests_count', 'int'], ['gross_booking_value', 'int'], ['channel_fee', 'int'], ['collected_revenue', 'int'], ['currency', 'text'], ['notes', 'text'], ['created_at', 'text'], ['updated_at', 'text'],
     ...RESERVATION_MONEY_COLUMNS.map(c => [c, MONEY_TEXT.has(c) ? 'text' : 'int'] as [string, string])],
    keep, `DO UPDATE SET unit_id = EXCLUDED.unit_id, guest_id = EXCLUDED.guest_id, channel = EXCLUDED.channel, external_ref = EXCLUDED.external_ref,
      ${RESERVATION_MONEY_COLUMNS.map(c => WORKBOOK_OWNED.has(c)
        // The Airbnb earnings report is the better source for these two; once it has set a booking's money, HostPlatform does not overwrite them.
        ? `${c} = CASE WHEN ${wb} THEN reservations.${c} ELSE EXCLUDED.${c} END`
        : `${c} = EXCLUDED.${c}`).join(', ')},
      state = EXCLUDED.state, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out, guests_count = EXCLUDED.guests_count,
      gross_booking_value = CASE WHEN ${wb} THEN reservations.gross_booking_value ELSE EXCLUDED.gross_booking_value END,
      channel_fee = CASE WHEN ${wb} THEN reservations.channel_fee ELSE EXCLUDED.channel_fee END,
      collected_revenue = CASE WHEN ${wb} THEN reservations.collected_revenue ELSE EXCLUDED.collected_revenue END,
      currency = EXCLUDED.currency,
      notes = CASE WHEN ${wb} THEN reservations.notes ELSE EXCLUDED.notes END,
      updated_at = EXCLUDED.updated_at`));

  // A guest someone merged into another (Guests > Merge) stays merged: the bookings that name the old id follow the merge.
  if (keep.length && await hasColumn(db, 'guests', 'merged_into')) {
    await db.run(`UPDATE reservations r SET guest_id = g.merged_into FROM guests g
      WHERE r.guest_id = g.id AND g.merged_into IS NOT NULL AND r.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(keep.map(k => String(k.id))));
  }

  const facts = [...unitFacts.entries()].map(([id, f]) => ({ id, max_guests: f.max, size_sqft: f.size }));
  if (facts.length) {
    await db.run(`UPDATE units u SET max_guests = COALESCE(x.max_guests, u.max_guests), size_sqft = COALESCE(x.size_sqft, u.size_sqft)
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, max_guests int, size_sqft int) WHERE u.id = x.id`, JSON.stringify(facts));
  }
  return finish(res, 'reservations');
}

/* ------------------------------------------------------------------ */
/* Workbook: units, owners, contracts                                  */
/* ------------------------------------------------------------------ */

export async function importWorkbookUnits(db: Db, units: WorkbookUnitIn[], now: string, today = now.slice(0, 10)): Promise<ImportResult> {
  const res = empty();
  const snap = await snapshot(db);
  const placeholder = await placeholderOwner(db, snap.owners, now);
  const newProps: Record<string, unknown>[] = [], ownerRows = new Map<string, Record<string, unknown>>();
  const newUnits: Record<string, unknown>[] = [], updates: Record<string, unknown>[] = [], contracts: Record<string, unknown>[] = [], links: Record<string, unknown>[] = [];
  const matchedIds = new Set<string>(), contractIds = new Set<string>();
  const accounts: Record<string, unknown>[] = [], debts: Record<string, unknown>[] = [], poolMonths: Record<string, unknown>[] = [];
  const accountIds = new Set<string>(), poolIds = new Set<string>();
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
      ownerId = hit ? hit.id : await workbookOwnerId(w);
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
        package: w.pkg, term: w.term, split_kind: w.split, split_value: w.splitValue, misc_charges: w.miscCharges ? 1 : 0, updated_at: now,
      });
    } else {
      workbookOnly++;
      const { prefix, code } = splitWorkbookId(w.workbookId);
      const b = buildingForPrefix(prefix || w.workbookId, snap.properties);
      if (b.isNew) {
        snap.properties.push({ id: b.id, name: b.name });
        const loc = normaliseLocation({ address: w.address });
        newProps.push({ id: b.id, name: b.name, address_line: w.address ?? '', city: loc.city ?? '', state: loc.state ?? '', postcode: loc.postcode, country_code: 'MY', created_at: now, updated_at: now });
      }
      unitId = `wb-unit-${slug(w.workbookId)}`; unitOurs = true; contractId = null;
      newUnits.push({
        id: unitId, property_id: b.id, owner_id: ownerId ?? placeholder, unit_number: code || w.workbookId, unit_code: code || w.workbookId,
        listing_name: w.listingName, address: w.address, base_rate: 0, is_listed: 0, package: w.pkg ?? 'Package C', term: w.term ?? 'Long term',
        split_kind: w.split ?? 'Not set', split_value: w.splitValue, misc_charges: w.miscCharges ? 1 : 0, created_at: now, updated_at: now,
      });
      snap.units.push({ id: unitId, unitNumber: code || w.workbookId, propertyId: b.id, propertyName: b.name, ownerName: '' });
    }

    // Utility accounts and pool months belong to the unit; the first workbook row that lands on a unit wins.
    for (const a of w.utilityAccounts) {
      const id = `wb-uacct-${slug(unitId)}-${a.kind}`;
      if (accountIds.has(id)) continue;
      accountIds.add(id);
      accounts.push({ id, unit_id: unitId, kind: a.kind, account_no: a.accountNo, provider: a.provider, note: 'From owner workbook (Unit资料)', created_at: now, updated_at: now });
    }
    for (const m of w.poolMonths) {
      const id = `wb-pool-${slug(unitId)}-${m.month.replace('-', '')}`;
      if (poolIds.has(id)) continue;
      poolIds.add(id);
      poolMonths.push({ id, unit_id: unitId, month: m.month, pool_balance: m.poolBalance, paid_from_pool: m.paidFromPool, company_top_up: m.companyTopUp, created_at: now, updated_at: now });
    }
    // Debt the owner carries over: recorded against the owner, held until someone decides when to deduct it.
    const debtOwner = ownerId ?? hit?.ownerId ?? null;
    if (w.debt && debtOwner && debtOwner !== placeholder) {
      debts.push({ id: `wb-debt-${slug(w.workbookId)}`, owner_id: debtOwner, unit_id: unitId, kind: 'opening_debt', amount: -w.debt,
        description: `Debt carried over from the owner workbook (${w.workbookId})`, occurred_on: today, reference: null, state: 'held', source: 'owner_workbook', created_at: now, updated_at: now });
    } else if (w.debt) res.skippedRows.push({ row: w.row, reason: `${w.workbookId}: DEBT AMOUNT not recorded because the unit has no named owner.` });

    // Contract: created or refreshed by the import, unless the unit already has one made in Property OS.
    if (w.contract && (!contractId || contractId.startsWith('wb-'))) {
      const id = contractId ?? `wb-contract-${slug(w.workbookId)}`;
      if (contractIds.has(id)) continue;
      contractIds.add(id);
      contracts.push({
        id, owner_id: ownerId ?? (hit?.ownerId || placeholder), management_fee_pct: w.contract.feePct, model: w.contract.model, grr_amount: w.contract.grrAmount,
        starts_on: w.contract.startsOn, ends_on: w.contract.endsOn, created_at: now,
        agent_fee_pct: w.contract.agentPct, minimum_guarantee: w.contract.minimumGuarantee, minimum_guarantee_annual: w.contract.minimumGuaranteeAnnual,
        guarantee_starts_on: w.contract.guaranteeStartsOn, guarantee_ends_on: w.contract.guaranteeEndsOn,
        agreement_file: w.contract.agreementFile, misc_charges: w.contract.miscCharges ? 1 : 0,
      });
      if (!contractId) links.push({ id: unitId, contract_id: id });
    }
  }

  add(res, 'properties', await upsert(db, 'properties',
    [['id', 'text'], ['name', 'text'], ['address_line', 'text'], ['city', 'text'], ['state', 'text'], ['postcode', 'text'], ['country_code', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    newProps, 'DO NOTHING'));
  add(res, 'owners', await upsert(db, 'owners',
    [['id', 'text'], ['display_name', 'text'], ['email', 'text'], ['ic_number', 'text'], ['bank_name', 'text'], ['bank_account_number', 'text'], ['bank_account_last4', 'text'], ['bank_account_holder', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    [...ownerRows.values()], `DO UPDATE SET ${['ic_number', 'bank_name', 'bank_account_number', 'bank_account_last4', 'bank_account_holder'].map(c =>
      `${c} = CASE WHEN ${ours('owners')} THEN COALESCE(EXCLUDED.${c}, owners.${c}) ELSE COALESCE(NULLIF(owners.${c}, ''), EXCLUDED.${c}) END`).join(', ')},
      display_name = CASE WHEN owners.id LIKE 'wb-%' THEN EXCLUDED.display_name ELSE owners.display_name END, updated_at = EXCLUDED.updated_at`));
  add(res, 'units', await upsert(db, 'units',
    [['id', 'text'], ['property_id', 'text'], ['owner_id', 'text'], ['unit_number', 'text'], ['unit_code', 'text'], ['listing_name', 'text'], ['address', 'text'], ['base_rate', 'int'],
     ['is_listed', 'int'], ['package', 'text'], ['term', 'text'], ['split_kind', 'text'], ['split_value', 'int'], ['misc_charges', 'int'], ['created_at', 'text'], ['updated_at', 'text']],
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
        misc_charges = x.misc_charges,
        updated_at = x.updated_at
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, ours boolean, owner_id text, listing_name text, address text, package text, term text, split_kind text, split_value int, misc_charges int, updated_at text)
      WHERE u.id = x.id RETURNING u.id`, JSON.stringify(updates));
    add(res, 'units', { created: 0, updated: out.length });
  }
  add(res, 'owner_contracts', await upsert(db, 'owner_contracts',
    [['id', 'text'], ['owner_id', 'text'], ['management_fee_pct', 'float8'], ['model', 'text'], ['grr_amount', 'int'], ['starts_on', 'text'], ['ends_on', 'text'], ['created_at', 'text'],
     ['agent_fee_pct', 'float8'], ['minimum_guarantee', 'int'], ['minimum_guarantee_annual', 'int'], ['guarantee_starts_on', 'text'], ['guarantee_ends_on', 'text'],
     ['agreement_file', 'text'], ['misc_charges', 'int']],
    contracts, `DO UPDATE SET owner_id = EXCLUDED.owner_id, management_fee_pct = EXCLUDED.management_fee_pct, model = EXCLUDED.model,
      grr_amount = EXCLUDED.grr_amount, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on,
      agent_fee_pct = EXCLUDED.agent_fee_pct, minimum_guarantee = EXCLUDED.minimum_guarantee, minimum_guarantee_annual = EXCLUDED.minimum_guarantee_annual,
      guarantee_starts_on = EXCLUDED.guarantee_starts_on, guarantee_ends_on = EXCLUDED.guarantee_ends_on,
      agreement_file = EXCLUDED.agreement_file, misc_charges = EXCLUDED.misc_charges,
      revenue_model = CASE WHEN owner_contracts.revenue_model IN ('master_lease','long_term') THEN owner_contracts.revenue_model ELSE NULL END`));
  // revenue_model NULL reads from model / minimum guarantee / package (revenueModel.ts), so a re-import that changes those
  // is never contradicted by an older choice; the two models the workbook cannot express are kept.
  if (links.length) {
    await db.run(`UPDATE units u SET contract_id = x.contract_id FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, contract_id text) WHERE u.id = x.id AND u.contract_id IS NULL`, JSON.stringify(links));
    await db.run(`UPDATE owner_contracts c SET unit_id = x.id FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, contract_id text) WHERE c.id = x.contract_id AND c.unit_id IS NULL`, JSON.stringify(links));
  }

  add(res, 'unit_utility_accounts', await upsert(db, 'unit_utility_accounts',
    [['id', 'text'], ['unit_id', 'text'], ['kind', 'text'], ['account_no', 'text'], ['provider', 'text'], ['note', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    accounts, 'DO UPDATE SET unit_id = EXCLUDED.unit_id, account_no = EXCLUDED.account_no, provider = EXCLUDED.provider, updated_at = EXCLUDED.updated_at'));
  add(res, 'guarantee_pool_months', await upsert(db, 'guarantee_pool_months',
    [['id', 'text'], ['unit_id', 'text'], ['month', 'text'], ['pool_balance', 'int'], ['paid_from_pool', 'int'], ['company_top_up', 'int'], ['created_at', 'text'], ['updated_at', 'text']],
    poolMonths, 'DO UPDATE SET pool_balance = EXCLUDED.pool_balance, paid_from_pool = EXCLUDED.paid_from_pool, company_top_up = EXCLUDED.company_top_up, updated_at = EXCLUDED.updated_at'));
  add(res, 'owner_adjustments', await upsertAdjustments(db, debts));

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
    WHERE external_ref IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(codes)) : [];

  const match = workbookMatcher(snap.units);
  const resolved = earnings.map(e => ({ e, unit: match(e.workbookId)?.unit ?? null }));
  // HostPlatform keeps Booking.com bookings under its own reference, so those are also recognised by unit
  // and exact dates. Airbnb codes are the same on both sides and are matched by code only: the workbook has
  // a few pairs of different Airbnb codes on the same unit and dates, and a date match would merge them.
  const stays = resolved.some(r => r.unit) ? await db.all<{ id: string; unit_id: string; channel: string; check_in: string; check_out: string }>(`
    SELECT r.id, r.unit_id, r.channel, r.check_in, r.check_out FROM reservations r
    JOIN jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, check_in text, check_out text)
      ON x.unit_id = r.unit_id AND x.check_in = r.check_in AND x.check_out = r.check_out
    WHERE r.state <> 'cancelled'`, JSON.stringify(resolved.filter(r => r.unit).map(r => ({ unit_id: r.unit!.id, check_in: r.e.checkIn, check_out: r.e.checkOut })))) : [];
  const taken = new Set<string>();

  const money: Record<string, unknown>[] = [], fresh: Record<string, unknown>[] = [], lines: Record<string, unknown>[] = [];
  const instalments = (e: AirbnbEarningIn, reservationId: string) => {
    for (const x of e.instalments) lines.push({
      id: `wb-pay-${x.key}`, reservation_id: reservationId, amount: x.amount, received_on: x.received ? x.paidOutOn : null,
      status: x.received ? 'received' : 'expected', reference: e.code, note: `Payout line for ${x.checkIn} to ${x.checkOut}`, created_at: now,
    });
  };
  for (const { e, unit } of resolved) {
    if (!unit) { res.errors.push({ row: e.row, reason: `${e.code}: unit ${e.workbookId} is not in Property OS. Import the workbook units first.` }); continue; }
    const same = existing.filter(x => x.external_ref === e.code && !FROM_WORKBOOK.test(x.id));
    const match = same.find(x => x.unit_id === unit.id) ?? (same.length === 1 && !e.idSuffix ? same[0] : undefined)
      ?? stays.find(x => e.site === 'booking_com' && x.unit_id === unit.id && x.channel === e.site && x.check_in === e.checkIn && x.check_out === e.checkOut && !FROM_WORKBOOK.test(x.id) && !taken.has(x.id));
    if (match) taken.add(match.id);
    if (match) {
      if (!match.id.startsWith('hp-res-')) { res.skippedRows.push({ row: e.row, reason: `${e.code} is managed by Channex; its amounts were left as they are.` }); continue; }
      if (e.gross === null && e.amount === null) { res.skippedRows.push({ row: e.row, reason: `${e.code}: no amounts in the workbook; HostPlatform amounts kept.` }); continue; }
      money.push({ id: match.id, gross: e.gross ?? 0, fee: e.fee ?? 0, amount: e.amount ?? 0, updated_at: now,
        cleaning: e.cleaningFee, tax: e.tax, fast_pay: e.fastPay, payout: e.amount, paid_on: e.paidOutOn });
      instalments(e, match.id);
      continue;
    }
    // Not on HostPlatform (e.g. stays before May): recorded as a booking from the workbook.
    const freshId = `hp-res-${e.site === 'airbnb' ? 'ab' : 'bc'}-${e.code}${e.idSuffix}`;
    instalments(e, freshId);
    fresh.push({
      id: freshId, unit_id: unit.id, channel: e.site, external_ref: e.code, state: stayState(e.checkIn, e.checkOut, today),
      check_in: e.checkIn, check_out: e.checkOut, guests_count: 1, gross_booking_value: e.gross ?? 0, channel_fee: e.fee ?? 0, collected_revenue: e.amount ?? 0,
      currency: 'MYR', notes: `Imported from owner workbook (earnings sheet, ${WORKBOOK_MONEY_MARK})`, created_at: now, updated_at: now,
      guest_cleaning_fee: e.cleaningFee, ota_tax: e.tax, payment_processing_fee: e.fastPay, payout_amount: e.amount, payout_date: e.paidOutOn,
    });
  }
  if (money.length) {
    const out = await db.all(`
      UPDATE reservations r SET gross_booking_value = x.gross, channel_fee = x.fee, collected_revenue = x.amount,
        guest_cleaning_fee = COALESCE(x.cleaning, r.guest_cleaning_fee), ota_tax = COALESCE(x.tax, r.ota_tax),
        payment_processing_fee = x.fast_pay, payout_amount = x.payout, payout_date = x.paid_on,
        notes = CASE WHEN COALESCE(r.notes, '') LIKE '%${WORKBOOK_MONEY_MARK}%' THEN r.notes ELSE COALESCE(r.notes || ' · ', '') || '${WORKBOOK_MONEY_MARK}' END,
        updated_at = x.updated_at
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, gross int, fee int, amount int, updated_at text, cleaning int, tax int, fast_pay int, payout int, paid_on text)
      WHERE r.id = x.id RETURNING r.id`, JSON.stringify(money));
    add(res, 'reservations', { created: 0, updated: out.length });
  }
  add(res, 'reservations', await upsert(db, 'reservations',
    [['id', 'text'], ['unit_id', 'text'], ['channel', 'text'], ['external_ref', 'text'], ['state', 'text'], ['check_in', 'text'], ['check_out', 'text'], ['guests_count', 'int'],
     ['gross_booking_value', 'int'], ['channel_fee', 'int'], ['collected_revenue', 'int'], ['currency', 'text'], ['notes', 'text'], ['created_at', 'text'], ['updated_at', 'text'],
     ['guest_cleaning_fee', 'int'], ['ota_tax', 'int'], ['payment_processing_fee', 'int'], ['payout_amount', 'int'], ['payout_date', 'text']],
    fresh, `DO UPDATE SET unit_id = EXCLUDED.unit_id, state = EXCLUDED.state, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
      gross_booking_value = EXCLUDED.gross_booking_value, channel_fee = EXCLUDED.channel_fee, collected_revenue = EXCLUDED.collected_revenue,
      guest_cleaning_fee = EXCLUDED.guest_cleaning_fee, ota_tax = EXCLUDED.ota_tax, payment_processing_fee = EXCLUDED.payment_processing_fee,
      payout_amount = EXCLUDED.payout_amount, payout_date = EXCLUDED.payout_date, updated_at = EXCLUDED.updated_at`));
  await writeInstalments(db, res, lines, [...money, ...fresh].map(x => String(x.id)));
  res.stats = { matchedHostPlatform: money.length, createdFromWorkbook: fresh.length, payoutLines: lines.length };
  return finish(res, 'reservations');
}

async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  const r = await db.all<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = ? AND column_name = ? AND table_schema = ANY(current_schemas(false))`, table, column);
  return Number(r[0]?.n) > 0;
}

/* ------------------------------------------------------------------ */
/* One-off: split the collapsed "Airbnb guest" records                 */
/* ------------------------------------------------------------------ */

const COLLAPSED_SQL = `'^(Airbnb|Booking\\.com|Agoda|Direct|OTA) guest$'`;

/** Before 10 Oct 2026 a booking with no guest name was given the guest "Airbnb guest" (or "Booking.com guest" ...),
 *  and every such booking hashed to the same record: 23 stays under one guest. This gives each of those bookings its
 *  own guest, named like the import now names them ("Airbnb guest HM...") and with the id the import would give, so a
 *  later re-import finds the same record. The emptied placeholder is deleted once nothing points at it. Runs from
 *  the import page; a second run finds nothing to do. */
export async function splitCollapsedGuests(db: Db, now: string): Promise<ImportResult> {
  const res = empty();
  const rows = await db.all<{ rid: string; external_ref: string | null; channel: string; gid: string; email: string | null; phone: string | null; country_code: string | null }>(`
    SELECT r.id AS rid, r.external_ref, r.channel, g.id AS gid, g.email, g.phone, g.country_code
    FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE g.full_name ~ ${COLLAPSED_SQL}`);
  const guests = new Map<string, Record<string, unknown>>(), moves: { rid: string; gid: string }[] = [];
  for (const r of rows) {
    const ref = r.external_ref?.trim() || r.rid.slice(-8);
    const name = placeholderGuestName(CHANNEL_LABEL[r.channel as Channel] ?? 'OTA', ref);
    const id = isOurs(r.gid) ? guestIdFor(name, r.phone, r.email) : `${r.gid}-${slug(ref)}`;
    guests.set(id, { id, full_name: name, email: r.email, phone: r.phone, country_code: r.country_code, created_at: now });
    moves.push({ rid: r.rid, gid: id });
  }
  add(res, 'guests', await upsert(db, 'guests',
    [['id', 'text'], ['full_name', 'text'], ['email', 'text'], ['phone', 'text'], ['country_code', 'text'], ['created_at', 'text']],
    [...guests.values()], 'DO UPDATE SET full_name = EXCLUDED.full_name'));
  if (moves.length) {
    const out = await db.all(`UPDATE reservations r SET guest_id = x.gid, updated_at = ? FROM jsonb_to_recordset(?::text::jsonb) AS x(rid text, gid text)
      WHERE r.id = x.rid RETURNING r.id`, now, JSON.stringify(moves));
    add(res, 'reservations', { created: 0, updated: out.length });
    await db.run(`UPDATE message_threads t SET guest_id = x.gid FROM jsonb_to_recordset(?::text::jsonb) AS x(rid text, gid text) WHERE t.reservation_id = x.rid`, JSON.stringify(moves));
  }
  const removed = await db.all(`DELETE FROM guests g WHERE g.full_name ~ ${COLLAPSED_SQL}
    AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = g.id) AND NOT EXISTS (SELECT 1 FROM message_threads t WHERE t.guest_id = g.id)
    RETURNING g.id`);
  res.stats = { bookingsGivenTheirOwnGuest: moves.length, placeholderGuestsRemoved: removed.length };
  if (!moves.length && !removed.length) res.notes.push('Nothing to split: no booking is under a nameless placeholder guest.');
  return finish(res, 'guests');
}

/** Each payout line of a booking becomes a booking_payments row (source owner_workbook), so the booking shows every
 *  monthly instalment of a long Airbnb stay and what is still to come. Lines the workbook no longer has are removed;
 *  rows people typed in (source manual) are never touched. Before migration 0091 there is no table: skipped with a note. */
async function writeInstalments(db: Db, res: ImportResult, lines: Record<string, unknown>[], reservationIds: string[]) {
  if (!reservationIds.length) return;
  const has = await db.all<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'booking_payments' AND table_schema = ANY(current_schemas(false))`);
  if (!Number(has[0]?.n)) { res.notes.push('Payout lines were not stored: the payments table (migration 0091) is not on this database yet.'); return; }
  add(res, 'booking_payments', await upsert(db, 'booking_payments',
    [['id', 'text'], ['reservation_id', 'text'], ['amount', 'int'], ['received_on', 'text'], ['status', 'text'], ['reference', 'text'], ['note', 'text'],
     ['kind', 'text'], ['source', 'text'], ['created_at', 'text']],
    lines.map(l => ({ ...l, kind: 'ota_payout', source: 'owner_workbook' })),
    `DO UPDATE SET reservation_id = EXCLUDED.reservation_id, amount = EXCLUDED.amount, received_on = EXCLUDED.received_on, status = EXCLUDED.status,
      reference = EXCLUDED.reference, note = EXCLUDED.note
      WHERE booking_payments.source = 'owner_workbook'`));
  await db.run(`DELETE FROM booking_payments WHERE source = 'owner_workbook'
    AND reservation_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
    AND id NOT IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(reservationIds), JSON.stringify(lines.map(l => String(l.id))));
}

/* ------------------------------------------------------------------ */
/* Workbook: cleaning records and expenses                             */
/* ------------------------------------------------------------------ */

export async function importCleaning(db: Db, cleanings: CleaningIn[], today: string, now: string): Promise<ImportResult> {
  const res = empty();
  const snap = await snapshot(db);
  const tasks: Record<string, unknown>[] = [], costs: Record<string, unknown>[] = [];
  const match = workbookMatcher(snap.units);

  // The person in 负责人 joins the cleaner roster (an entry with the same name is reused). The workbook does not
  // say whether they are staff or a contractor: a name that reads like a company is 'outsourced', the rest 'internal'.
  const names = [...new Set(cleanings.map(c => c.cleaner).filter((x): x is string => !!x))];
  const roster = names.length ? await db.all<{ id: string; full_name: string }>('SELECT id, full_name FROM cleaners') : [];
  const cleanerId = new Map<string, string>(), newCleaners: Record<string, unknown>[] = [];
  for (const name of names) {
    const hit = roster.find(c => c.full_name.trim().toLowerCase() === name.toLowerCase());
    const id = hit?.id ?? `wb-cleaner-${slug(name)}`;
    cleanerId.set(name, id);
    if (hit) continue;
    const company = /\b(sdn\.?\s*bhd|bhd|enterprise|services?|plt|company|trading|cleaning)\b/i.test(name);
    newCleaners.push({ id, full_name: name, employment_type: company ? 'outsourced' : 'internal', vendor_name: company ? name : null, is_active: 1, created_at: now, updated_at: now });
  }
  add(res, 'cleaners', await upsert(db, 'cleaners',
    [['id', 'text'], ['full_name', 'text'], ['employment_type', 'text'], ['vendor_name', 'text'], ['is_active', 'int'], ['created_at', 'text'], ['updated_at', 'text']],
    newCleaners, 'DO NOTHING'));

  for (const c of cleanings) {
    const unit = match(c.workbookId)?.unit;
    if (!unit) { res.errors.push({ row: c.row, reason: `Unit ${c.workbookId} is not in Property OS.` }); continue; }
    const due = `${c.date}T${c.dueTime ?? '12:00'}:00+08:00`;
    const done = c.date < today;
    tasks.push({
      id: c.id, unit_id: unit.id, kind: c.kind, state: done ? 'resolved' : 'open', title: c.title, instructions: c.instructions || null,
      scheduled_for: due, due_at: due, next_guest_at: c.nextGuestTime ? `${c.date}T${c.nextGuestTime}:00+08:00` : null,
      completed_at: done ? due : null, requires_photo: 0, cleaner_id: c.cleaner ? cleanerId.get(c.cleaner) ?? null : null, created_at: now, updated_at: now,
    });
    // The owner is charged the unit's cleaning price unless the sheet says the tenant or the company pays.
    if (c.price && c.price > 0 && !c.payer) {
      costs.push({ id: c.id.replace('wb-clean-', 'wb-cleanexp-'), unit_id: unit.id, task_id: c.id, category: 'cleaning', description: c.title, amount: c.price, incurred_on: c.date, reference: null, created_at: now });
    }
  }
  add(res, 'tasks', await upsert(db, 'tasks',
    [['id', 'text'], ['unit_id', 'text'], ['kind', 'text'], ['state', 'text'], ['title', 'text'], ['instructions', 'text'], ['scheduled_for', 'text'], ['due_at', 'text'],
     ['next_guest_at', 'text'], ['completed_at', 'text'], ['requires_photo', 'int'], ['cleaner_id', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    tasks, `DO UPDATE SET unit_id = EXCLUDED.unit_id, kind = EXCLUDED.kind, title = EXCLUDED.title, instructions = EXCLUDED.instructions, scheduled_for = EXCLUDED.scheduled_for,
      due_at = EXCLUDED.due_at, next_guest_at = EXCLUDED.next_guest_at,
      cleaner_id = COALESCE(tasks.cleaner_id, EXCLUDED.cleaner_id),
      state = CASE WHEN tasks.state = 'resolved' THEN tasks.state ELSE EXCLUDED.state END,
      completed_at = COALESCE(tasks.completed_at, EXCLUDED.completed_at), updated_at = EXCLUDED.updated_at`));
  if (tasks.length) {
    // Tie each clean to the stay that checked out that day, when there is one.
    await db.run(`UPDATE tasks t SET reservation_id = (
        SELECT r.id FROM reservations r WHERE r.unit_id = t.unit_id AND r.check_out = substr(t.due_at, 1, 10) AND r.state <> 'cancelled' ORDER BY r.id LIMIT 1)
      WHERE t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND t.reservation_id IS NULL`, JSON.stringify(tasks.map(t => t.id)));
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

export async function importExpenses(db: Db, expenses: ExpenseIn[], now: string, credits: CreditIn[] = []): Promise<ImportResult> {
  const res = empty();
  const snap = await snapshot(db);
  const rows: Record<string, unknown>[] = [], adjustments: Record<string, unknown>[] = [];
  const match = workbookMatcher(snap.units);
  for (const e of expenses) {
    const unit = match(e.workbookId)?.unit;
    if (!unit) { res.errors.push({ row: e.row, reason: `Unit ${e.workbookId} is not in Property OS.` }); continue; }
    rows.push({ id: e.id, unit_id: unit.id, category: e.category, description: e.description, amount: e.amount, incurred_on: e.incurredOn, reference: e.reference, created_at: now });
  }
  const placeholder = snap.owners.find(o => o.name.toLowerCase() === PLACEHOLDER_OWNER.toLowerCase())?.id;
  for (const c of credits) {
    const unit = match(c.workbookId)?.unit;
    if (!unit) { res.errors.push({ row: c.row, reason: `Unit ${c.workbookId} is not in Property OS.` }); continue; }
    if (!unit.ownerId || unit.ownerId === placeholder) { res.errors.push({ row: c.row, reason: `${c.workbookId}: credit not recorded because the unit has no named owner. Import the workbook units first.` }); continue; }
    adjustments.push({ id: c.id, owner_id: unit.ownerId, unit_id: unit.id, kind: c.amount > 0 ? 'credit' : 'charge', amount: c.amount, description: c.description, occurred_on: c.occurredOn,
      reference: c.reference, state: 'open', source: 'owner_workbook', created_at: now, updated_at: now });
  }
  add(res, 'expenses', await upsertExpenses(db, rows));
  add(res, 'owner_adjustments', await upsertAdjustments(db, adjustments));
  return finish(res, 'expenses');
}

/** Owner credits and debts from the workbook. Re-running refreshes what the file says but never undoes what has
 *  happened since: the state, the statement the row went on, and a debt's first-recorded date. Once a row is on a
 *  statement or settled, its owner and amount stay as they were paid. */
async function upsertAdjustments(db: Db, rows: Record<string, unknown>[]) {
  const frozen = `(owner_adjustments.statement_id IS NOT NULL OR owner_adjustments.state = 'settled')`;
  return upsert(db, 'owner_adjustments',
    [['id', 'text'], ['owner_id', 'text'], ['unit_id', 'text'], ['kind', 'text'], ['amount', 'int'], ['description', 'text'], ['occurred_on', 'text'], ['reference', 'text'],
     ['state', 'text'], ['source', 'text'], ['created_at', 'text'], ['updated_at', 'text']],
    rows, `DO UPDATE SET
      owner_id = CASE WHEN ${frozen} THEN owner_adjustments.owner_id ELSE EXCLUDED.owner_id END,
      amount = CASE WHEN ${frozen} THEN owner_adjustments.amount ELSE EXCLUDED.amount END,
      unit_id = EXCLUDED.unit_id, description = EXCLUDED.description, reference = EXCLUDED.reference,
      occurred_on = CASE WHEN owner_adjustments.kind = 'opening_debt' THEN owner_adjustments.occurred_on ELSE EXCLUDED.occurred_on END,
      updated_at = EXCLUDED.updated_at`);
}

/* ------------------------------------------------------------------ */
/* Workbook: owner payout history                                      */
/* ------------------------------------------------------------------ */

export const HISTORY_STATEMENT = 'wb-stmt-';

/** One paid statement per owner and past month from OWNER PAYOUT, with a paid payout when the month's net is
 *  above zero. Lines are per unit: the 整体报告 month gets revenue, deductions and the company's share; other
 *  months get the payout as one line, because that is all the workbook says. They are marked source
 *  'owner_workbook'. A period that already has a statement made in Property OS for that owner is left alone.
 *  Statement generation refuses periods holding a paid statement, so these months are never regenerated.
 *  All rows of the sheet must come in one request: an owner's units are summed into one statement.
 *
 *  Workbook credits and charges (O2 and negative 杂费扣款 lines) dated in or before the last month of this history were already in
 *  those payouts (the report's O2 column), so they are marked settled, never paid a second time; later ones stay
 *  open for the next generated statement. */
export async function importPayoutHistory(db: Db, months: PayoutMonthIn[], now: string): Promise<ImportResult> {
  const res = empty();
  const snap = await snapshot(db);
  const match = workbookMatcher(snap.units);
  const placeholder = snap.owners.find(o => o.name.toLowerCase() === PLACEHOLDER_OWNER.toLowerCase())?.id;
  const label = new Map(snap.units.map(u => [u.id, `${u.propertyName} ${u.unitNumber}`]));

  type Group = { ownerId: string; month: string; lines: { unitId: string; m: PayoutMonthIn }[] };
  const groups = new Map<string, Group>(), usedUnitMonth = new Set<string>();
  for (const m of months) {
    const unit = match(m.workbookId)?.unit;
    if (!unit) { res.errors.push({ row: m.row, reason: `${m.workbookId}: unit is not in Property OS. Import the workbook units first.` }); continue; }
    if (!unit.ownerId || unit.ownerId === placeholder) { res.errors.push({ row: m.row, reason: `${m.workbookId} ${m.month}: the unit has no named owner, so there is no statement to put this payout on.` }); continue; }
    const um = `${unit.id}|${m.month}`;
    if (usedUnitMonth.has(um)) { res.skippedRows.push({ row: m.row, reason: `${m.workbookId} ${m.month}: another workbook row already gave this unit's payout for the month.` }); continue; }
    usedUnitMonth.add(um);
    const k = `${unit.ownerId}|${m.month}`;
    if (!groups.has(k)) groups.set(k, { ownerId: unit.ownerId, month: m.month, lines: [] });
    groups.get(k)!.lines.push({ unitId: unit.id, m });
  }

  const periods = [...new Set([...groups.values()].map(g => `${g.month}-01`))];
  const existing = periods.length ? await db.all<{ id: string; owner_id: string; period_start: string }>(
    'SELECT id, owner_id, period_start FROM owner_statements WHERE period_start IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(periods)) : [];
  const bank = new Map((await db.all<{ id: string; bank_account_last4: string | null }>('SELECT id, bank_account_last4 FROM owners')).map(o => [o.id, o.bank_account_last4]));

  const statements: Record<string, unknown>[] = [], lines: Record<string, unknown>[] = [], payouts: Record<string, unknown>[] = [];
  for (const g of groups.values()) {
    const start = `${g.month}-01`;
    const end = new Date(Date.UTC(Number(g.month.slice(0, 4)), Number(g.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const id = `${HISTORY_STATEMENT}${hash(g.ownerId)}-${g.month.replace('-', '')}`;
    const clash = existing.find(e => e.owner_id === g.ownerId && e.period_start === start && e.id !== id);
    if (clash) { res.skippedRows.push({ row: g.month, reason: `An owner already has a ${g.month} statement made in Property OS; the workbook payout for that month was left out.` }); continue; }
    let gross = 0, fee = 0, costs = 0, adjust = 0, net = 0, order = 0;
    const line = (unitId: string, type: string, category: string | null, description: string, amount: number) => {
      lines.push({ id: `${id}-${order}`, statement_id: id, unit_id: unitId, line_type: type, category, description, occurred_on: end, amount, reference: 'Owner workbook', sort_order: order });
      order++;
    };
    for (const { unitId, m } of g.lines.sort((a, b) => (label.get(a.unitId) ?? '').localeCompare(label.get(b.unitId) ?? ''))) {
      const name = label.get(unitId) ?? m.workbookId;
      net += m.amount;
      const b = m.breakdown;
      if (!b) { adjust += m.amount; line(unitId, 'adjustment', 'workbook_payout', `${name}: owner payout for ${g.month} (owner workbook, no breakdown)`, m.amount); continue; }
      gross += b.revenue;
      line(unitId, 'gross', null, `${name}: total revenue for ${g.month} (owner workbook)`, b.revenue);
      const deductions: [string, string, number][] = [['cleaning', 'Cleaning', b.cleaning], ['utilities', 'Utilities', b.utilities], ['other', 'Additional deductions', b.additional], ['other', 'Miscellaneous charges', b.misc]];
      for (const [cat, what, amt] of deductions) if (amt) { costs += amt; line(unitId, 'expense', cat, `${name}: ${what} (owner workbook)`, -amt); }
      // What is left between the unit's profit and what the owner was paid: the company's (and agent's) share,
      // or, on a guaranteed rent, what the company added to reach it.
      const rest = m.amount - (b.revenue - b.cleaning - b.utilities - b.additional - b.misc);
      if (rest < 0) { fee += -rest; line(unitId, 'management_fee', null, `${name}: company and agent share (owner workbook)`, rest); }
      if (rest > 0) { adjust += rest; line(unitId, 'adjustment', 'workbook_payout', `${name}: guaranteed rent top-up (owner workbook)`, rest); }
    }
    statements.push({ id, owner_id: g.ownerId, period_start: start, period_end: end, state: 'paid', gross_booking_value: gross, management_fee: fee, expenses_total: costs,
      adjustments_total: adjust, net_payout: net, currency: 'MYR', generated_at: now, created_at: now, source: 'owner_workbook' });
    // The workbook says what was paid, not when: paid_at stays empty; created_at is the end of the month so the history sorts by month.
    if (net > 0) payouts.push({ id: id.replace(HISTORY_STATEMENT, 'wb-payout-'), statement_id: id, owner_id: g.ownerId, amount: net, currency: 'MYR', state: 'paid', method: 'bank_transfer',
      bank_last4: bank.get(g.ownerId) ?? null, created_at: `${end}T15:59:59.000Z`, source: 'owner_workbook' });
  }

  add(res, 'owner_statements', await upsert(db, 'owner_statements',
    [['id', 'text'], ['owner_id', 'text'], ['period_start', 'text'], ['period_end', 'text'], ['state', 'text'], ['gross_booking_value', 'int'], ['management_fee', 'int'], ['expenses_total', 'int'],
     ['adjustments_total', 'int'], ['net_payout', 'int'], ['currency', 'text'], ['generated_at', 'text'], ['created_at', 'text'], ['source', 'text']],
    statements, `DO UPDATE SET gross_booking_value = EXCLUDED.gross_booking_value, management_fee = EXCLUDED.management_fee, expenses_total = EXCLUDED.expenses_total,
      adjustments_total = EXCLUDED.adjustments_total, net_payout = EXCLUDED.net_payout`));
  if (statements.length) {
    // Lines from an earlier run that this run no longer writes (a unit moved owner, a breakdown changed).
    await db.run(`DELETE FROM statement_lines WHERE statement_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND id NOT IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
      JSON.stringify(statements.map(s => s.id)), JSON.stringify(lines.map(l => l.id)));
  }
  add(res, 'statement_lines', await upsert(db, 'statement_lines',
    [['id', 'text'], ['statement_id', 'text'], ['unit_id', 'text'], ['line_type', 'text'], ['category', 'text'], ['description', 'text'], ['occurred_on', 'text'], ['amount', 'int'], ['reference', 'text'], ['sort_order', 'int']],
    lines, `DO UPDATE SET unit_id = EXCLUDED.unit_id, line_type = EXCLUDED.line_type, category = EXCLUDED.category, description = EXCLUDED.description,
      occurred_on = EXCLUDED.occurred_on, amount = EXCLUDED.amount, sort_order = EXCLUDED.sort_order`));
  add(res, 'payouts', await upsert(db, 'payouts',
    [['id', 'text'], ['statement_id', 'text'], ['owner_id', 'text'], ['amount', 'int'], ['currency', 'text'], ['state', 'text'], ['method', 'text'], ['bank_last4', 'text'], ['created_at', 'text'], ['source', 'text']],
    payouts, `DO UPDATE SET amount = EXCLUDED.amount, bank_last4 = COALESCE(EXCLUDED.bank_last4, payouts.bank_last4)`));

  // Credits up to the last month of this history were inside those payouts.
  const last = [...groups.values()].reduce((m, g) => (g.month > m ? g.month : m), '');
  let settled = 0;
  if (last) {
    const lastDay = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const out = await db.all(`
      UPDATE owner_adjustments a SET state = 'settled', updated_at = ?,
        statement_id = (SELECT s.id FROM owner_statements s WHERE s.owner_id = a.owner_id AND s.period_start = substr(a.occurred_on, 1, 7) || '-01' AND s.id LIKE '${HISTORY_STATEMENT}%'),
        settled_note = 'Included in the owner workbook payout for ' || substr(a.occurred_on, 1, 7)
      WHERE a.source = 'owner_workbook' AND a.kind IN ('credit','charge') AND a.state = 'open' AND a.statement_id IS NULL AND a.occurred_on <= ?
      RETURNING a.id`, now, lastDay);
    settled = out.length;
    add(res, 'owner_adjustments', { created: 0, updated: settled });
  }
  res.stats = { statements: statements.length, unitMonths: usedUnitMonth.size, payouts: payouts.length, creditsSettled: settled };
  return finish(res, 'owner_statements');
}

/* ------------------------------------------------------------------ */
/* One-off fix: building state and city                                */
/* ------------------------------------------------------------------ */

/** Rewrites the state and city of existing buildings to their canonical names ('W.P Kuala Lumpur' and 'WP' ->
 *  'Kuala Lumpur', 'KUALA LUMPUR' -> 'Kuala Lumpur'), and fills a blank one from the postcode or the address
 *  (the building's own, else one of its units'). Only a blank or a recognised variant is changed: a state the
 *  list does not know is left as typed. Running it again changes nothing. */
export async function fixLocations(db: Db, now: string): Promise<ImportResult> {
  const res = empty();
  const rows = await db.all<{ id: string; name: string; state: string | null; city: string | null; postcode: string | null; address_line: string | null; unit_address: string | null }>(`
    SELECT p.id, p.name, p.state, p.city, p.postcode, p.address_line,
      (SELECT u.address FROM units u WHERE u.property_id = p.id AND COALESCE(u.address, '') <> '' ORDER BY u.id LIMIT 1) AS unit_address
    FROM properties p`);
  const distinct = (xs: (string | null)[]) => new Set(xs.map(x => (x ?? '').trim())).size;
  const before = { states: distinct(rows.map(r => r.state)), cities: distinct(rows.map(r => r.city)) };
  const changes: Record<string, unknown>[] = [];
  const after = rows.map(r => {
    const state = (r.state ?? '').trim(), city = (r.city ?? '').trim();
    const knownState = canonicalState(state), knownCity = canonicalCity(city);
    const loc = normaliseLocation({ state: knownState, city: knownCity, postcode: r.postcode, address: [r.address_line, r.unit_address].filter(Boolean).join(', ') });
    // A state is only replaced when blank or a recognised spelling; a city only when blank or differing in case / short form.
    const nextState = !state || knownState ? loc.state ?? state : state;
    const nextCity = !city || knownCity ? loc.city ?? city : city;
    const nextPostcode = (r.postcode ?? '').trim() || loc.postcode;
    if (nextState !== state || nextCity !== city || (nextPostcode ?? '') !== (r.postcode ?? '').trim()) {
      changes.push({ id: r.id, state: nextState, city: nextCity, postcode: nextPostcode, updated_at: now });
    }
    if (!nextState) res.skippedRows.push({ row: r.name, reason: 'No state, and none could be worked out from its postcode or address.' });
    return { state: nextState, city: nextCity };
  });
  if (changes.length) {
    const out = await db.all(`UPDATE properties p SET state = x.state, city = x.city, postcode = x.postcode, updated_at = x.updated_at
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, state text, city text, postcode text, updated_at text) WHERE p.id = x.id RETURNING p.id`, JSON.stringify(changes));
    add(res, 'properties', { created: 0, updated: out.length });
  } else add(res, 'properties', { created: 0, updated: 0 });
  res.stats = { statesBefore: before.states, statesAfter: distinct(after.map(a => a.state)), citiesBefore: before.cities, citiesAfter: distinct(after.map(a => a.city)) };
  return finish(res, 'properties');
}
