/** Moving off HostPlatform: maps its CSV exports, and the owner's own operations workbook, onto the
 *  Property OS tables. Pure functions only (no database, no Worker APIs) so the browser preview, the
 *  server and the test script all run the same mapping. The SQL lives in hostplatformImportDb.ts.
 *
 *  Every id is derived from the source (HostPlatform key, booking code, workbook unit id ...), so running
 *  the same file twice updates the rows the first run created instead of adding new ones. */

export type Row = Record<string, unknown>;
export interface RowError { row: number | string; reason: string }

/** Only these columns leave the browser. The exports also carry identity-card and card numbers. */
export const LISTING_COLUMNS = [
  'Key', 'Unit Name', 'Property Name', 'Room Type', 'Longitude', 'Latitude', 'Street', 'city', 'State', 'ZipCode',
  'Country Code', 'Owner', 'Parent Unit', 'Currency', 'Weekday Price', 'Weekend Price', 'Created At',
  'Electricity (Operation Cost per month)', 'Water (Operation Cost per month)', 'Internet (Operation Cost per month)',
  'Cleaning (Operation Cost per month)', 'Laundry (Operation Cost per month)', 'Service (Operation Cost per month)',
];
export const RESERVATION_COLUMNS = [
  'Booking Type', 'Property Name', 'Unit Name', 'Room Type', 'Capacity (Adults)', 'Room Size (sqft)', ' of Bed Rooms',
  ' of Bath Rooms', 'Check In Date', 'Check Out Date', 'Confirmation Code', 'Created At', 'Booking Source',
  'Booking Status', 'Number of pax', 'Remarks', 'Currency', 'Platform Fee', 'Total Price', 'First Name', 'Last Name',
  'Guest Name', '[].User Email[]', '[].Contact Number[]', 'Nationality', 'Payment Received',
];

/** Workbook sheets the import reads. Everything else in the file (including the login sheet) is never read. */
export const WORKBOOK_SHEETS = {
  units: 'Unit资料', splits: '分成', pool: '水池', airbnb: '订单数据', cleaning: '清洁记录', cleaningPrices: '清洁单价',
  water: '水费', electricity: '电费', internet: '网络费', sewerage: 'INDAH WATER', misc: '杂费扣款',
} as const;
/** Header row per sheet (1-based); 水池 has a title line above its header. */
export const WORKBOOK_HEADER_ROW: Record<string, number> = { '水池': 2 };
/** Workbook columns that are sent to the server, per sheet. */
export const WORKBOOK_COLUMNS: Record<string, string[]> = {
  'Unit资料': ['Listing名称', 'Unit编号', '房东/业主', '地址', '分成', 'IC', 'LONGTERM/PROFIT SHARING', 'PACKAGE', 'BANK AC', 'BANK NAME', 'BANK HOLDER NAME', 'GRR', '合约开始日期', '合约结束日期', '电费账号', '网络账号', 'INDAH WATER账号', 'DEBT AMOUNT'],
  '分成': ['UNIT', 'OWNER%', 'MANAGE PAYOUT%', 'AGENT%'],
  '水池': ['Unit', '每月最低拿到（保底）', '全年租金（GRR）', '合约开始', '合约结束'],
  '订单数据': ['确认码', '入住日期', '退房日期', '晚数', 'Listing名称', 'Unit编号', '金额(Amount)', '服务费(Service fee)', '总收入(Gross earnings)', '数据来源'],
  '清洁记录': ['Unit', '退房日期', '退房时间', '入住时间', '负责人', '清洁类型', '费用方', '备注'],
  '清洁单价': ['Unit', 'BC单价', 'DC单价'],
  '水费': ['Unit编号', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  '电费': ['Unit编号', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  '网络费': ['Unit编号', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  'INDAH WATER': ['Unit编号', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  '杂费扣款': ['日期', '类型', 'Unit编号', '项目描述', '金额(RM)', '备注'],
};
/** The year the workbook's JAN..DEC utility columns belong to. */
export const WORKBOOK_YEAR = 2026;

export const IMPORT_KINDS = ['listing', 'reservations', 'workbook_units', 'workbook_airbnb', 'workbook_cleaning', 'workbook_expenses'] as const;
export type ImportKind = typeof IMPORT_KINDS[number];
export const MAX_ROWS_PER_REQUEST = 600;

/* ------------------------------------------------------------------ */
/* Small value helpers                                                 */
/* ------------------------------------------------------------------ */

export const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
};
/** '-', 'N/A' and blanks are HostPlatform's and the workbook's ways of saying "nothing". */
export const opt = (v: unknown): string | null => {
  const s = str(v);
  return s === '' || s === '-' || /^n\/?a$/i.test(s) ? null : s;
};
export const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = opt(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, '').replace(/^RM\s*/i, ''));
  return Number.isFinite(n) ? n : null;
};
/** Ringgit to integer sen. */
export const sen = (v: unknown): number | null => { const n = num(v); return n === null ? null : Math.round(n * 100); };

export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

/** 64-bit FNV-1a, hex. Deterministic ids for rows that have no id of their own (guests, misc charges). */
export function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

/** A date as YYYY-MM-DD from an ISO string, a 'DD-Mon-YYYY' string or an Excel serial number. */
export function toDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = opt(v);
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return null;
}

/** HostPlatform's '08-Oct-2026 05:45 PM' (Kuala Lumpur time) as a UTC ISO timestamp. */
export function hpTimestamp(v: unknown): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(str(v));
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  let h = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'PM') h += 12;
  const utc = Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()] - 1, Number(m[1]), h - 8, Number(m[5]));
  return new Date(utc).toISOString();
}

/** An Excel time (fraction of a day) or a 'HH:MM' string as 'HH:MM'. Anything else ("Night", "4:30-5:30PM") is null. */
export function toTime(v: unknown): string | null {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(str(v));
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
}

/** Today's date in Kuala Lumpur (UTC+8, no daylight saving). */
export const todayInKL = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

/** Where a stay is today: past, in progress or ahead. Cancellations are decided by the caller. */
export function stayState(checkIn: string, checkOut: string, today: string): 'checked_out' | 'checked_in' | 'confirmed' {
  if (checkOut <= today) return 'checked_out';
  if (checkIn <= today) return 'checked_in';
  return 'confirmed';
}

const rowNo = (r: Row, i: number) => (typeof r._row === 'number' ? r._row : i + 2);

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** 'Skyline KL The Conts' -> 'Skyline KL'. Every HostPlatform property carries the company suffix. */
export const buildingName = (propertyName: unknown) => str(propertyName).replace(/\s+The Conts$/i, '').trim();

/** 'C35-03 2B2B' -> code 'C35-03', 2 bed, 2 bath. 'B17-05(A) 1B1B' -> 'B17-05 (A)'. Half baths round up. */
export function parseUnitName(name: unknown): { code: string; bedrooms: number | null; bathrooms: number | null } {
  const s = str(name);
  const m = /^(.*?)\s*(\d+)\s*B\s*(\d+(?:\.\d+)?)\s*B$/i.exec(s);
  const code = (m ? m[1] : s).replace(/\s*\(/g, ' (').replace(/\s+/g, ' ').trim();
  return { code, bedrooms: m ? Number(m[2]) : null, bathrooms: m ? Math.ceil(Number(m[3])) : null };
}

export const unitKey = (building: string, code: string) => `${building.toLowerCase()}|${code.toLowerCase()}`;

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export const PLACEHOLDER_OWNER = 'Owner to be confirmed';

export interface PropertyIn { id: string; name: string; addressLine: string; city: string; state: string; postcode: string | null; countryCode: string; latitude: number | null; longitude: number | null }
export interface UnitIn {
  id: string; row: number; building: string; propertyId: string; ownerName: string; unitNumber: string; unitCode: string;
  listingName: string; address: string | null; bedrooms: number; bathrooms: number; baseRate: number; parentName: string | null;
}
export interface UnitExpenseIn { id: string; unitId: string; category: string; amount: number; note: string; sortOrder: number }
export interface ListingPlan { properties: PropertyIn[]; owners: string[]; units: UnitIn[]; unitExpenses: UnitExpenseIn[]; errors: RowError[]; notes: string[] }

/** Monthly operation costs map onto the categories the unit form offers. Per-reservation and per-day
 *  costs are not monthly amounts and have no home in the schema, so they are left out. */
const MONTHLY_COSTS: [string, string][] = [
  ['Internet (Operation Cost per month)', 'internet'], ['Electricity (Operation Cost per month)', 'electricity'],
  ['Water (Operation Cost per month)', 'water'], ['Cleaning (Operation Cost per month)', 'cleaning'],
  ['Laundry (Operation Cost per month)', 'housekeeping'], ['Service (Operation Cost per month)', 'other'],
];

export function mapListing(rows: Row[]): ListingPlan {
  const errors: RowError[] = [], properties = new Map<string, PropertyIn>(), owners = new Set<string>();
  const units: UnitIn[] = [], unitExpenses: UnitExpenseIn[] = [], seen = new Set<string>();
  rows.forEach((r, i) => {
    const row = rowNo(r, i), key = str(r['Key']).toLowerCase(), building = buildingName(r['Property Name']);
    const { code, bedrooms, bathrooms } = parseUnitName(r['Unit Name']);
    if (!/^[0-9a-f]{6,40}$/.test(key)) return errors.push({ row, reason: 'No HostPlatform key on this row.' });
    if (!building) return errors.push({ row, reason: 'No property name.' });
    if (!code) return errors.push({ row, reason: 'No unit name.' });
    const k = unitKey(building, code);
    if (seen.has(k)) return errors.push({ row, reason: `${building} ${code} appears twice in the file; the first one was kept.` });
    seen.add(k);
    const pid = `hp-prop-${slug(building)}`;
    if (!properties.has(building.toLowerCase())) {
      properties.set(building.toLowerCase(), {
        id: pid, name: building, addressLine: str(r['Street']), city: str(r['city']).replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase()),
        state: str(r['State']), postcode: opt(r['ZipCode']), countryCode: opt(r['Country Code'])?.toUpperCase().slice(0, 2) ?? 'MY',
        latitude: num(r['Latitude']), longitude: num(r['Longitude']),
      });
    }
    const ownerName = opt(r['Owner']) ?? PLACEHOLDER_OWNER;
    owners.add(ownerName);
    const id = `hp-unit-${key}`;
    const parent = opt(r['Parent Unit']);
    units.push({
      id, row, building, propertyId: pid, ownerName, unitNumber: code, unitCode: code, listingName: str(r['Unit Name']),
      address: opt(r['Street']), bedrooms: bedrooms ?? 1, bathrooms: bathrooms ?? 1,
      baseRate: Math.max(0, sen(r['Weekday Price']) ?? 0), parentName: parent ? parseUnitName(parent).code : null,
    });
    let order = 0;
    for (const [col, category] of MONTHLY_COSTS) {
      const amount = sen(r[col]);
      if (amount && amount > 0) unitExpenses.push({ id: `hp-uexp-${key}-${category}`, unitId: id, category, amount, note: 'From HostPlatform', sortOrder: 100 + order++ });
    }
  });
  const notes: string[] = [];
  const differentWeekend = rows.filter(r => num(r['Weekend Price']) !== null && num(r['Weekend Price']) !== num(r['Weekday Price'])).length;
  if (differentWeekend) notes.push(`${differentWeekend} units have a different weekend price on HostPlatform. Property OS has no weekend rate yet; only the weekday price was imported.`);
  return { properties: [...properties.values()], owners: [...owners], units, unitExpenses, errors, notes };
}

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

export type Channel = 'airbnb' | 'booking_com' | 'agoda' | 'direct' | 'maintenance_block' | 'owner_stay';
export type State = 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';

export interface GuestIn { id: string; fullName: string; email: string | null; phone: string | null; countryCode: string | null }
export interface ReservationIn {
  id: string; row: number; code: string; building: string; unitNumber: string; channel: Channel; state: State; externalRef: string;
  checkIn: string; checkOut: string; guestsCount: number; gross: number; fee: number; collected: number; currency: string;
  notes: string; createdAt: string | null; guestId: string | null; maxGuests: number | null; sizeSqft: number | null;
}
export interface ReservationPlan { guests: GuestIn[]; reservations: ReservationIn[]; errors: RowError[] }

const COUNTRY: Record<string, string> = {
  malaysia: 'MY', singapore: 'SG', 'united kingdom': 'GB', australia: 'AU', germany: 'DE', maldives: 'MV', china: 'CN',
  indonesia: 'ID', thailand: 'TH', philippines: 'PH', 'united states': 'US', japan: 'JP', korea: 'KR', 'south korea': 'KR',
  india: 'IN', 'hong kong': 'HK', taiwan: 'TW', vietnam: 'VN', brunei: 'BN', france: 'FR', netherlands: 'NL', canada: 'CA',
  'saudi arabia': 'SA', 'united arab emirates': 'AE', 'new zealand': 'NZ',
};
export const countryCode = (v: unknown) => { const s = opt(v); return s ? (/^[A-Z]{2}$/.test(s) ? s : COUNTRY[s.toLowerCase()] ?? null) : null; };

export function channelFor(bookingType: unknown, source: unknown, remarks: unknown): Channel {
  const type = str(bookingType).toLowerCase(), src = str(source).toLowerCase().replace(/[^a-z]/g, '');
  if (type === 'blocked') return /owner\s*stay/i.test(str(remarks)) ? 'owner_stay' : 'maintenance_block';
  if (type === 'free stay') return 'owner_stay';
  if (type === 'social media' || type === 'walk in') return 'direct';
  if (src === 'airbnb') return 'airbnb';
  if (src === 'bookingcom') return 'booking_com';
  if (src === 'agoda') return 'agoda';
  return 'direct';
}

export const guestId = (name: string, phone: string | null, email: string | null) =>
  `hp-guest-${hash(`${name.toLowerCase()}|${(phone ?? '').replace(/[^0-9+]/g, '')}|${(email ?? '').toLowerCase()}`)}`;

const CHANNEL_LABEL: Record<Channel, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct', maintenance_block: 'Block', owner_stay: 'Owner stay' };

export function mapReservations(rows: Row[], today: string): ReservationPlan {
  const errors: RowError[] = [], guests = new Map<string, GuestIn>(), reservations: ReservationIn[] = [], codes = new Set<string>();
  rows.forEach((r, i) => {
    const row = rowNo(r, i);
    const conf = str(r['Confirmation Code']);
    const code = conf.split(' ')[0] ?? '';
    const ota = /\(([^)]+)\)/.exec(conf)?.[1]?.trim() || null;
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(code)) return errors.push({ row, reason: 'No HostPlatform confirmation code.' });
    if (codes.has(code)) return errors.push({ row, reason: `Booking ${code} appears twice; the first one was kept.` });
    const building = buildingName(r['Property Name']);
    const unitNumber = parseUnitName(r['Unit Name'] || r['Room Type']).code;
    const checkIn = toDate(r['Check In Date']), checkOut = toDate(r['Check Out Date']);
    if (!building || !unitNumber) return errors.push({ row, reason: 'No property or unit name.' });
    if (!checkIn || !checkOut) return errors.push({ row, reason: 'Check-in and check-out must be dates.' });
    if (checkOut <= checkIn) return errors.push({ row, reason: 'Check-out is not after check-in.' });
    codes.add(code);
    const channel = channelFor(r['Booking Type'], r['Booking Source'], r['Remarks']);
    const cancelled = /cancel/i.test(str(r['Booking Status']));
    const state: State = cancelled ? 'cancelled' : stayState(checkIn, checkOut, today);
    const total = sen(r['Total Price']) ?? 0, platformFee = Math.max(0, sen(r['Platform Fee']) ?? 0);
    // Airbnb's Total Price is the host payout; the fee comes on top (same rule as channexAmounts.ts).
    const gross = channel === 'airbnb' ? total + platformFee : total;
    const block = str(r['Booking Type']).toLowerCase() === 'blocked';
    let gid: string | null = null;
    if (!block) {
      const phone = opt(r['[].Contact Number[]']), email = opt(r['[].User Email[]'])?.toLowerCase() ?? null;
      const name = opt(r['Guest Name']) ?? ([opt(r['First Name']), opt(r['Last Name'])].filter(Boolean).join(' ') || `${CHANNEL_LABEL[channel]} guest`);
      gid = guestId(name, phone, email);
      if (!guests.has(gid)) guests.set(gid, { id: gid, fullName: name.slice(0, 200), email, phone, countryCode: countryCode(r['Nationality']) });
    }
    const remarks = opt(r['Remarks']);
    const showRemarks = remarks && channel !== 'airbnb' && channel !== 'booking_com' && channel !== 'agoda';
    reservations.push({
      id: `hp-res-${code}`, row, code, building, unitNumber, channel, state, externalRef: ota ?? code, checkIn, checkOut,
      guestsCount: Math.max(1, Math.round(num(r['Number of pax']) ?? 1)), gross: Math.max(0, gross), fee: platformFee,
      collected: Math.max(0, sen(r['Payment Received']) ?? 0), currency: (opt(r['Currency']) ?? 'MYR').toUpperCase().slice(0, 3),
      notes: `Imported from HostPlatform (${code})${showRemarks ? ` · ${remarks!.slice(0, 200)}` : ''}`,
      createdAt: hpTimestamp(r['Created At']), guestId: gid,
      maxGuests: num(r['Capacity (Adults)']) ? Math.round(num(r['Capacity (Adults)'])!) : null,
      sizeSqft: num(r['Room Size (sqft)']) ? Math.round(num(r['Room Size (sqft)'])!) : null,
    });
  });
  return { guests: [...guests.values()], reservations, errors };
}

/* ------------------------------------------------------------------ */
/* Matching workbook unit ids ('SKYLINE-A13A03') to units              */
/* ------------------------------------------------------------------ */

export interface KnownUnit { id: string; unitNumber: string; propertyId: string; propertyName: string; ownerId?: string; contractId?: string | null }
export interface KnownProperty { id: string; name: string }

const normCode = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
const normBuilding = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** 'SV2 TOWER C&D-D3002' -> prefix 'SV2 TOWER C&D', code 'D3002'. The prefix never contains a dash. */
export function splitWorkbookId(id: string): { prefix: string; code: string } {
  const s = str(id), at = s.indexOf('-');
  return at < 0 ? { prefix: '', code: s } : { prefix: s.slice(0, at).trim(), code: s.slice(at + 1).trim() };
}

export const buildingMatches = (propertyName: string, prefix: string) => {
  const b = normBuilding(propertyName), p = normBuilding(prefix);
  return !!p && !!b && (b.startsWith(p) || p.startsWith(b));
};

/** The unit a workbook id refers to, or null. 'AGILE-C1313A' = building starting AGILE + unit C13-13A.
 *  Tried in order, first unique answer wins: the exact code; the code with zeros dropped (the workbook
 *  writes 'UNO-806' and 'SKYLINE-A263A' for HostPlatform's '08-06' and 'A26-03A'); the code without a
 *  '(A)' / '(B)' room suffix (the workbook's 'THE ATRIUM-1103' is HostPlatform's '11-03 (A)' + '11-03 (B)').
 *  A 'room' match is only a fallback: when the workbook also lists the rooms themselves, the caller keeps
 *  the whole unit separate (importWorkbookUnits). */
export function matchWorkbookUnit(workbookId: string, units: KnownUnit[]): KnownUnit | null {
  return matchWorkbookUnitHow(workbookId, units)?.unit ?? null;
}

/** The same matching, for many ids against one unit list: units are grouped by building prefix once, so a
 *  500-row request does not rescan every unit for every row (Workers bill CPU time per request). */
export function workbookMatcher(units: KnownUnit[]) {
  const byPrefix = new Map<string, KnownUnit[]>();
  const cache = new Map<string, { unit: KnownUnit; how: 'code' | 'room' } | null>();
  return (workbookId: string) => {
    const key = str(workbookId).toUpperCase();
    if (cache.has(key)) return cache.get(key)!;
    const { prefix } = splitWorkbookId(key);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, units.filter(u => buildingMatches(u.propertyName, prefix)));
    const hit = matchWorkbookUnitHow(key, byPrefix.get(prefix)!);
    cache.set(key, hit);
    return hit;
  };
}

export function matchWorkbookUnitHow(workbookId: string, units: KnownUnit[]): { unit: KnownUnit; how: 'code' | 'room' } | null {
  const { prefix, code } = splitWorkbookId(workbookId);
  if (!code) return null;
  const inBuilding = units.filter(u => buildingMatches(u.propertyName, prefix));
  const pickOne = (hits: KnownUnit[]) =>
    // Two buildings can both match a prefix (Trion KL and Trion KL (2)); prefer the shorter name, then the first room.
    [...hits].sort((a, b) => a.propertyName.length - b.propertyName.length || a.unitNumber.localeCompare(b.unitNumber))[0];
  const exact = inBuilding.filter(u => normCode(u.unitNumber) === normCode(code));
  if (exact.length) return { unit: pickOne(exact), how: 'code' };
  const noZero = (s: string) => normCode(s).replace(/0/g, '');
  const loose = inBuilding.filter(u => noZero(u.unitNumber) === noZero(code));
  if (loose.length === 1) return { unit: loose[0], how: 'code' };
  if (/\(/.test(code)) return null;
  const base = inBuilding.filter(u => /\(/.test(u.unitNumber) && normCode(u.unitNumber.replace(/\s*\([^)]*\)\s*$/, '')) === normCode(code));
  return base.length ? { unit: pickOne(base), how: 'room' } : null;
}

/** The building a workbook-only unit goes under: an existing one matching the prefix, else a new one. */
export function buildingForPrefix(prefix: string, properties: KnownProperty[]): { id: string; name: string; isNew: boolean } {
  const hit = properties.filter(p => buildingMatches(p.name, prefix)).sort((a, b) => a.name.length - b.name.length)[0];
  if (hit) return { id: hit.id, name: hit.name, isNew: false };
  const name = prefix.split(/\s+/).map(w => (/^[A-Z]{4,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
  return { id: `wb-prop-${slug(prefix)}`, name, isNew: true };
}

/* ------------------------------------------------------------------ */
/* Workbook: units, owners, contracts                                  */
/* ------------------------------------------------------------------ */

export interface WorkbookUnitIn {
  row: number; workbookId: string; listingName: string | null; address: string | null;
  ownerName: string | null; ic: string | null; bankName: string | null; bankAccount: string | null; bankHolder: string | null;
  pkg: 'Package A' | 'Package B' | 'Package C' | null; packageD: boolean; term: 'Long term' | 'Short term' | null;
  split: 'Profit share' | 'GRR — guaranteed rent' | null; splitValue: number | null;
  contract: { model: 'management' | 'grr'; feePct: number; grrAmount: number; startsOn: string; endsOn: string | null } | null;
  utilityAccounts: number; debt: boolean;
}

const ownerPct = (v: unknown): number | null => {
  const n = num(v);
  if (n === null) return null;
  return Math.round((n <= 1 ? n * 100 : n) * 100) / 100;
};

/** One entry per workbook unit id. Duplicate ids keep the later row (reported). */
export function mapWorkbookUnits(rows: Row[], splits: Row[], pool: Row[]): { units: WorkbookUnitIn[]; errors: RowError[]; notes: string[] } {
  const errors: RowError[] = [], byId = new Map<string, WorkbookUnitIn>();
  const splitOf = new Map(splits.map(s => [str(s['UNIT']).toUpperCase(), s]));
  const poolOf = new Map(pool.map(p => [str(p['Unit']).toUpperCase(), p]));
  let dup = 0;
  rows.forEach((r, i) => {
    const row = rowNo(r, i), workbookId = str(r['Unit编号']).toUpperCase();
    if (!workbookId) return errors.push({ row, reason: 'No unit id (Unit编号).' });
    if (byId.has(workbookId)) dup++;
    const sp = splitOf.get(workbookId), pl = poolOf.get(workbookId);
    const kind = str(r['LONGTERM/PROFIT SHARING']).toUpperCase();
    const pkgLetter = str(r['PACKAGE']).toUpperCase().replace(/^PACKAGE\s*/, '');
    const owner = sp ? ownerPct(sp['OWNER%']) : null;
    const splitText = /^(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(str(r['分成']));
    const ownerShare = owner ?? (splitText ? Number(splitText[1]) : null);
    const grr = sen(r['GRR']);
    const minimum = pl ? sen(pl['每月最低拿到（保底）']) : null;
    const startsOn = toDate(r['合约开始日期']) ?? (pl ? toDate(pl['合约开始']) : null);
    const endsOn = toDate(r['合约结束日期']) ?? (pl ? toDate(pl['合约结束']) : null);
    const isGrr = kind === 'LT' && !!grr;
    const feePct = isGrr ? 0 : ownerShare !== null ? Math.max(0, Math.min(100, 100 - ownerShare)) : 25;
    const ic = opt(r['IC'])?.replace(/\s*\n\s*|\s{2,}/g, ' / ') ?? null;
    const account = opt(r['BANK AC']);
    byId.set(workbookId, {
      row, workbookId, listingName: opt(r['Listing名称']), address: opt(r['地址']),
      ownerName: opt(r['房东/业主']), ic, bankName: opt(r['BANK NAME']), bankAccount: account ? account.replace(/\s/g, '') : null, bankHolder: opt(r['BANK HOLDER NAME']),
      pkg: pkgLetter === 'A' || pkgLetter === 'B' || pkgLetter === 'C' ? (`Package ${pkgLetter}` as WorkbookUnitIn['pkg']) : null,
      packageD: pkgLetter === 'D',
      term: kind === 'LT' ? 'Long term' : kind === 'PS' || kind === 'MANAGE' ? 'Short term' : null,
      split: isGrr ? 'GRR — guaranteed rent' : ownerShare !== null ? 'Profit share' : null,
      splitValue: isGrr ? grr : ownerShare !== null ? Math.round(ownerShare) : null,
      contract: startsOn ? { model: isGrr ? 'grr' : 'management', feePct, grrAmount: isGrr ? grr! : Math.max(0, minimum ?? 0), startsOn, endsOn } : null,
      utilityAccounts: ['电费账号', '网络账号', 'INDAH WATER账号'].filter(c => opt(r[c])).length,
      debt: num(r['DEBT AMOUNT']) !== null && num(r['DEBT AMOUNT'])! > 0,
    });
  });
  const units = [...byId.values()];
  const notes: string[] = [];
  if (dup) notes.push(`${dup} unit ids appear more than once in Unit资料; the last row of each was used.`);
  const d = units.filter(u => u.packageD).length;
  if (d) notes.push(`${d} units are on Package D, which Property OS does not have yet (it allows A, B and C). Their package was left unchanged; the monthly minimum from 水池 is kept on the contract.`);
  const acc = units.reduce((n, u) => n + u.utilityAccounts, 0);
  if (acc) notes.push(`${acc} utility account numbers (electricity, internet, Indah Water) were not imported: Property OS has no field for them yet.`);
  const debt = units.filter(u => u.debt).length;
  if (debt) notes.push(`${debt} units have a DEBT AMOUNT; it was not imported (no field for it).`);
  const noContract = units.filter(u => !u.contract).length;
  if (noContract) notes.push(`${noContract} units have no contract start date, so no contract was created for them.`);
  return { units, errors, notes };
}

export interface OwnerIn { id: string; name: string; ic: string | null; bankName: string | null; bankAccount: string | null; bankHolder: string | null }
export const workbookOwnerId = (u: { ic: string | null; ownerName: string | null }) => `wb-owner-${slug(u.ic ?? u.ownerName ?? 'unknown')}`;

/* ------------------------------------------------------------------ */
/* Workbook: Airbnb earnings                                           */
/* ------------------------------------------------------------------ */

export interface AirbnbEarningIn {
  row: number; code: string; site: 'airbnb' | 'booking_com'; workbookId: string; checkIn: string; checkOut: string;
  gross: number | null; fee: number | null; amount: number | null; idSuffix: string;
}

/** The workbook's earnings lines: Airbnb (HM...) and a few Booking.com (10-digit) codes. 'OWNER' rows are
 *  owner stays logged there, not bookings, and are skipped. A code booked on two units (one booking, two listings) gets the unit in its new id. */
export function mapAirbnbEarnings(rows: Row[]): { earnings: AirbnbEarningIn[]; errors: RowError[]; skipped: RowError[] } {
  const errors: RowError[] = [], skipped: RowError[] = [], earnings: AirbnbEarningIn[] = [];
  const unitsPerCode = new Map<string, Set<string>>();
  for (const r of rows) {
    const code = str(r['确认码']).toUpperCase();
    if (!unitsPerCode.has(code)) unitsPerCode.set(code, new Set());
    unitsPerCode.get(code)!.add(str(r['Unit编号']).toUpperCase());
  }
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const row = rowNo(r, i), code = str(r['确认码']).toUpperCase(), workbookId = str(r['Unit编号']).toUpperCase();
    const site = /^HM[A-Z0-9]{6,}$/.test(code) ? 'airbnb' : /^\d{8,12}$/.test(code) ? 'booking_com' : null;
    if (!site) return skipped.push({ row, reason: code === 'OWNER' ? 'Owner stay line, not a booking.' : 'Not an Airbnb or Booking.com confirmation code.' });
    if (!workbookId) return errors.push({ row, reason: `${code}: no unit id.` });
    const checkIn = toDate(r['入住日期']), checkOut = toDate(r['退房日期']);
    if (!checkIn || !checkOut || checkOut <= checkIn) return errors.push({ row, reason: `${code}: dates are missing or check-out is not after check-in.` });
    const k = `${code}|${workbookId}`;
    if (seen.has(k)) return skipped.push({ row, reason: `${code} on ${workbookId} appears twice; the first line was used.` });
    seen.add(k);
    const amount = sen(r['金额(Amount)']), fee = sen(r['服务费(Service fee)']), grossRaw = sen(r['总收入(Gross earnings)']);
    const gross = grossRaw ?? (amount !== null ? amount + (fee ?? 0) : null);
    earnings.push({
      row, code, site, workbookId, checkIn, checkOut, gross: gross === null ? null : Math.max(0, gross), fee: fee === null ? null : Math.max(0, fee),
      amount: amount === null ? null : Math.max(0, amount), idSuffix: (unitsPerCode.get(code)?.size ?? 1) > 1 ? `-${slug(workbookId)}` : '',
    });
  });
  return { earnings, errors, skipped };
}

/* ------------------------------------------------------------------ */
/* Workbook: cleaning records                                          */
/* ------------------------------------------------------------------ */

export interface CleaningIn {
  row: number; id: string; workbookId: string; date: string; kind: 'turnover' | 'deep_clean'; title: string;
  instructions: string; dueTime: string | null; nextGuestTime: string | null; price: number | null; payer: string | null;
}

const CLEAN_KIND: Record<string, { kind: CleaningIn['kind']; title: string; priceCol: string; tag: string }> = {
  BC: { kind: 'turnover', title: 'Basic clean', priceCol: 'BC单价', tag: 'bc' },
  DC: { kind: 'deep_clean', title: 'Deep clean', priceCol: 'DC单价', tag: 'dc' },
  'MOVE OUT': { kind: 'deep_clean', title: 'Move-out clean', priceCol: 'DC单价', tag: 'mo' },
};

export function mapCleaning(rows: Row[], prices: Row[]): { cleanings: CleaningIn[]; errors: RowError[]; skipped: RowError[] } {
  const errors: RowError[] = [], skipped: RowError[] = [], cleanings: CleaningIn[] = [], seen = new Set<string>();
  const priceOf = new Map(prices.map(p => [str(p['Unit']).toUpperCase(), p]));
  rows.forEach((r, i) => {
    const row = rowNo(r, i), workbookId = str(r['Unit']).toUpperCase(), date = toDate(r['退房日期']);
    const type = CLEAN_KIND[str(r['清洁类型']).toUpperCase()];
    if (!workbookId || !date) return errors.push({ row, reason: 'No unit or date.' });
    if (!type) return skipped.push({ row, reason: `${workbookId} ${date}: no cleaning type (BC/DC).` });
    const id = `wb-clean-${slug(workbookId)}-${date.replace(/-/g, '')}-${type.tag}`;
    if (seen.has(id)) return skipped.push({ row, reason: `${workbookId} ${date} ${type.title} is listed twice; counted once.` });
    seen.add(id);
    const who = opt(r['负责人']), payer = opt(r['费用方']), remark = opt(r['备注']);
    const checkInText = opt(r['入住时间']);
    const instructions = [who && `Cleaner: ${who}`, payer && `Paid by: ${payer}`, checkInText && !toTime(r['入住时间']) && `Next check-in: ${checkInText}`, remark]
      .filter(Boolean).join(' · ');
    cleanings.push({
      row, id, workbookId, date, kind: type.kind, title: type.title, instructions: instructions.slice(0, 500),
      dueTime: toTime(r['退房时间']), nextGuestTime: toTime(r['入住时间']),
      price: sen(priceOf.get(workbookId)?.[type.priceCol]), payer,
    });
  });
  return { cleanings, errors, skipped };
}

/* ------------------------------------------------------------------ */
/* Workbook: utilities and misc charges                                */
/* ------------------------------------------------------------------ */

export interface ExpenseIn { row: number; id: string; workbookId: string; category: string; description: string; amount: number; incurredOn: string; reference: string | null }

const MONTH_COLS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const UTILITY: Record<string, { category: string; tag: string; label: string }> = {
  '水费': { category: 'water', tag: 'water', label: 'Water' },
  '电费': { category: 'electricity', tag: 'electricity', label: 'Electricity' },
  '网络费': { category: 'internet', tag: 'internet', label: 'Internet' },
  'INDAH WATER': { category: 'utilities', tag: 'sewerage', label: 'Indah Water (sewerage)' },
};

/** Rows carry `_sheet`: one of the four utility sheets or 杂费扣款. */
export function mapWorkbookExpenses(rows: Row[]): { expenses: ExpenseIn[]; errors: RowError[]; skipped: RowError[] } {
  const errors: RowError[] = [], skipped: RowError[] = [], expenses: ExpenseIn[] = [], seen = new Set<string>();
  rows.forEach((r, i) => {
    const row = rowNo(r, i), sheet = str(r._sheet);
    const workbookId = str(r['Unit编号']).toUpperCase();
    const where = `${sheet} row ${row}`;
    if (!workbookId) return errors.push({ row: where, reason: 'No unit id.' });
    const u = UTILITY[sheet];
    if (u) {
      MONTH_COLS.forEach((m, mi) => {
        const amount = sen(r[m]);
        if (!amount) return;
        if (amount < 0) return skipped.push({ row: where, reason: `${workbookId} ${m}: negative amount not imported.` });
        const yyyymm = `${WORKBOOK_YEAR}${pad(mi + 1)}`;
        expenses.push({
          row, id: `wb-exp-${slug(workbookId)}-${u.tag}-${yyyymm}`, workbookId, category: u.category,
          description: `${u.label} bill, ${m[0]}${m.slice(1).toLowerCase()} ${WORKBOOK_YEAR}`, amount, incurredOn: `${WORKBOOK_YEAR}-${pad(mi + 1)}-01`, reference: null,
        });
      });
      return;
    }
    if (sheet !== WORKBOOK_SHEETS.misc) return errors.push({ row: where, reason: 'Unknown sheet.' });
    const date = toDate(r['日期']), amount = sen(r['金额(RM)']), type = opt(r['类型']) ?? 'Charge', what = opt(r['项目描述']) ?? '';
    if (!date || amount === null) return errors.push({ row: where, reason: 'No date or amount.' });
    if (amount === 0) return;
    // expenses.amount must be zero or more; a negative line is money back to the owner, which is an adjustment, not an expense.
    if (amount < 0) return skipped.push({ row: where, reason: `${workbookId} ${date} ${type}: negative amount (RM ${(amount / 100).toFixed(2)}) is a credit, not an expense; not imported.` });
    const id = `wb-misc-${hash(`${workbookId}|${date}|${type}|${what}|${amount}`)}`;
    if (seen.has(id)) return skipped.push({ row: where, reason: 'Same charge listed twice; counted once.' });
    seen.add(id);
    expenses.push({ row, id, workbookId, category: 'other', description: `${type}: ${what}`.slice(0, 300), amount, incurredOn: date, reference: opt(r['备注'])?.slice(0, 200) ?? null });
  });
  return { expenses, errors, skipped };
}

/** Workbook Airbnb lines grouped so every line of one code lands in the same request. */
export function chunkByKey<T>(rows: T[], keyOf: (r: T) => string, size: number): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  const out: T[][] = []; let cur: T[] = [];
  for (const g of groups.values()) {
    if (cur.length && cur.length + g.length > size) { out.push(cur); cur = []; }
    cur.push(...g);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Keeps only the named columns (plus `_row` / `_sheet`), so nothing else in the export leaves the browser. */
export function pick(rows: Row[], columns: string[]): Row[] {
  return rows.map(r => {
    const o: Row = {};
    for (const c of columns) if (r[c] !== undefined && r[c] !== null && r[c] !== '') o[c] = r[c];
    if (r._row !== undefined) o._row = r._row;
    if (r._sheet !== undefined) o._sheet = r._sheet;
    return o;
  });
}
