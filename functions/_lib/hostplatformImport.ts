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
  'Guest Name', '[].User Email[]', '[].Contact Number[]', 'Nationality', 'Payment Received', 'Rate Name',
  'Room Rate', 'Cleaning Fee', 'Sales Service Tax', 'Sales Tax', 'Tourism Tax', 'Heritage Tax', 'OTA Tax',
  'Deposit Collected', 'Deposit Refunded', 'Payment Method',
  'Extra Guest Fee', 'Early Check-in Fee', 'Late Check-out Fee', 'Shuttle Fee', 'Transportation Fee', 'Breakfast Fee', 'Lunch Fee', 'Dinner Fee', 'Other Fee', 'Add-ons', 'Total Service Fee',
];
export const EXTRA_FEE_COLUMNS = ['Extra Guest Fee', 'Early Check-in Fee', 'Late Check-out Fee', 'Shuttle Fee', 'Transportation Fee', 'Breakfast Fee', 'Lunch Fee', 'Dinner Fee', 'Other Fee', 'Add-ons', 'Total Service Fee'];
/** reservations columns from migration 0052 that the HostPlatform export fills. */
export const RESERVATION_MONEY_COLUMNS = [
  'room_revenue', 'guest_cleaning_fee', 'extra_fees', 'sst_amount', 'tourism_tax', 'ota_tax', 'deposit_collected', 'deposit_refunded',
  'payment_method', 'rate_plan', 'guest_nationality',
] as const;

/** Workbook sheets the import reads. Everything else in the file (including the login sheet) is never read. */
export const WORKBOOK_SHEETS = {
  units: 'Unit资料', splits: '分成', pool: '水池', airbnb: '订单数据', cleaning: '清洁记录', cleaningPrices: '清洁单价',
  water: '水费', electricity: '电费', internet: '网络费', sewerage: 'INDAH WATER', misc: '杂费扣款',
  payouts: 'OWNER PAYOUT', report: '整体报告',
} as const;
/** Header row per sheet (1-based); 水池 has a title line above its header. */
export const WORKBOOK_HEADER_ROW: Record<string, number> = { '水池': 2 };
/** Workbook columns that are sent to the server, per sheet. */
export const WORKBOOK_COLUMNS: Record<string, string[]> = {
  'Unit资料': ['Listing名称', 'Unit编号', '房东/业主', '地址', '分成', 'IC', 'LONGTERM/PROFIT SHARING', 'PACKAGE', 'BANK AC', 'BANK NAME', 'BANK HOLDER NAME', 'GRR', '合约开始日期', '合约结束日期', '电费账号', '网络账号', 'INDAH WATER账号', 'DEBT AMOUNT', 'CONTRACT', 'SALES ORDER', 'STAMPING', 'Miscellaneous Charges'],
  '分成': ['UNIT', 'OWNER%', 'MANAGE PAYOUT%', 'AGENT%'],
  // 水池 holds four tables one under the other; poolSheetRows() splits them and keys the month tables by JAN..DEC.
  '水池': ['Unit', '每月最低拿到（保底）', '全年租金（GRR）', '合约开始', '合约结束', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  '订单数据': ['确认码', '入住日期', '退房日期', '晚数', 'Listing名称', 'Unit编号', '金额(Amount)', '服务费(Service fee)', '总收入(Gross earnings)', '数据来源',
    '已支付(Paid out)', '快速支付费(Fast pay)', '清洁费(Cleaning fee)', 'Airbnb税费(Tax)'],
  '清洁记录': ['Unit', '退房日期', '退房时间', '入住时间', '负责人', '清洁类型', '费用方', '备注'],
  '清洁单价': ['Unit', 'BC单价', 'DC单价'],
  '水费': ['Unit编号', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  '电费': ['Unit编号', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  '网络费': ['Unit编号', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  'INDAH WATER': ['Unit编号', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  '杂费扣款': ['日期', '类型', 'Unit编号', '项目描述', '金额(RM)', '备注'],
  'OWNER PAYOUT': ['UNIT', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  '整体报告': ['LONG TERM', 'TOTAL REVENUE', 'ALL CLEANING TOTAL', 'UTILITIES', 'ADDITIONAL DEDUCTION', 'MISCELLANEOUS CHARGES', 'TOTAL DEDUCTION', 'GP', 'OWNER PAYOUT'],
};
/** The year the workbook's JAN..DEC utility columns belong to. */
export const WORKBOOK_YEAR = 2026;

export const IMPORT_KINDS = ['listing', 'reservations', 'workbook_units', 'workbook_airbnb', 'workbook_cleaning', 'workbook_expenses', 'workbook_payouts', 'fix_locations', 'fix_guests'] as const;
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
/** Sen, never below zero; null when blank. */
const nonNeg = (v: unknown): number | null => { const n = sen(v); return n === null ? null : Math.max(0, n); };
/** The sum of several money columns in sen; null only when every one of them is blank. */
const sumSen = (r: Row, cols: string[]): number | null => {
  const vals = cols.map(c => nonNeg(r[c])).filter((x): x is number => x !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

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
const MONTH_COLS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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
/* Building state and city                                             */
/* ------------------------------------------------------------------ */

/** The 16 Malaysian states and federal territories, as Property OS writes them. */
export const MY_STATES = ['Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis', 'Sabah', 'Sarawak',
  'Selangor', 'Terengganu', 'Kuala Lumpur', 'Putrajaya', 'Labuan'] as const;
const STATE_ALIASES: Record<string, string> = {
  'wp': 'Kuala Lumpur', 'w.p': 'Kuala Lumpur', 'w.p.': 'Kuala Lumpur', 'kl': 'Kuala Lumpur', 'wpkl': 'Kuala Lumpur', 'w.p.k.l': 'Kuala Lumpur',
  'federal territory': 'Kuala Lumpur', 'wilayah persekutuan': 'Kuala Lumpur',
  'pulau pinang': 'Penang', 'p. pinang': 'Penang', 'malacca': 'Melaka', 'n. sembilan': 'Negeri Sembilan', 'n sembilan': 'Negeri Sembilan', 'johore': 'Johor',
};
/** A state as written anywhere ('W.P Kuala Lumpur', 'WP', 'WILAYAH PERSEKUTUAN KUALA LUMPUR', 'Pulau Pinang') to its canonical name, or null. */
export function canonicalState(v: unknown): string | null {
  const s = str(v).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (STATE_ALIASES[s]) return STATE_ALIASES[s];
  // Drop the federal-territory prefix in any spelling: 'W.P Kuala Lumpur', 'WP Putrajaya', 'Wilayah Persekutuan Labuan'.
  const bare = s.replace(/^(w\.?\s?p\.?|wilayah persekutuan|federal territory( of)?)\s*/, '').trim();
  return MY_STATES.find(x => x.toLowerCase() === bare) ?? STATE_ALIASES[bare] ?? null;
}
/** The state a Malaysian postcode belongs to (Pos Malaysia ranges). */
export function stateForPostcode(postcode: unknown): string | null {
  const m = /\b(\d{5})\b/.exec(str(postcode));
  if (!m) return null;
  const p = Number(m[1]);
  const ranges: [number, number, string][] = [
    [1000, 2999, 'Perlis'], [5000, 9999, 'Kedah'], [10000, 14999, 'Penang'], [15000, 18999, 'Kelantan'], [20000, 24999, 'Terengganu'],
    [25000, 28999, 'Pahang'], [30000, 36999, 'Perak'], [39000, 39999, 'Pahang'], [40000, 48999, 'Selangor'], [49000, 49999, 'Pahang'],
    [50000, 60999, 'Kuala Lumpur'], [62000, 62999, 'Putrajaya'], [63000, 68999, 'Selangor'], [69000, 69999, 'Pahang'], [70000, 73999, 'Negeri Sembilan'],
    [75000, 78999, 'Melaka'], [79000, 86999, 'Johor'], [87000, 87999, 'Labuan'], [88000, 91999, 'Sabah'], [93000, 98999, 'Sarawak'],
  ];
  return ranges.find(([a, b]) => p >= a && p <= b)?.[2] ?? null;
}
const CITY_ALIASES: Record<string, string> = { 'kl': 'Kuala Lumpur', 'k.l': 'Kuala Lumpur', 'k.l.': 'Kuala Lumpur', 'pj': 'Petaling Jaya', 'p.j': 'Petaling Jaya', 'p.j.': 'Petaling Jaya' };
/** Towns recognised in a free-text address when a building has no city. Longest names first. */
const TOWNS = ['Kuala Lumpur', 'Petaling Jaya', 'Shah Alam', 'Subang Jaya', 'Ampang Jaya', 'Cyberjaya', 'Putrajaya', 'Puchong', 'Cheras', 'Ampang', 'Bangsar', 'Mont Kiara', 'Kajang', 'Klang', 'Seri Kembangan'];
/** A city in title case with known short forms spelled out ('KUALA LUMPUR' -> 'Kuala Lumpur', 'PJ' -> 'Petaling Jaya'). Blank stays null. */
export function canonicalCity(v: unknown): string | null {
  const s = str(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const alias = CITY_ALIASES[s.toLowerCase()];
  if (alias) return alias;
  const known = TOWNS.find(t => t.toLowerCase() === s.toLowerCase());
  if (known) return known;
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
/** State and city for a building: what it says, cleaned; when blank, worked out from the postcode, then the address text. */
export function normaliseLocation(x: { state?: unknown; city?: unknown; postcode?: unknown; address?: unknown }): { state: string | null; city: string | null; postcode: string | null } {
  const address = str(x.address).replace(/\s+/g, ' ');
  const postcode = /\b(\d{5})\b/.exec(str(x.postcode))?.[1] ?? [...address.matchAll(/\b(\d{5})\b/g)].pop()?.[1] ?? null;
  const upper = address.toUpperCase();
  const state = canonicalState(x.state) ?? stateForPostcode(postcode)
    ?? (/KUALA LUMPUR|WILAYAH PERSEKUTUAN/.test(upper) ? 'Kuala Lumpur' : MY_STATES.find(s => upper.includes(s.toUpperCase())) ?? null);
  const town = TOWNS.find(t => upper.includes(t.toUpperCase()));
  const city = canonicalCity(x.city) ?? (town ?? (state === 'Kuala Lumpur' ? 'Kuala Lumpur' : state === 'Putrajaya' ? 'Putrajaya' : null));
  return { state, city, postcode };
}

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
      const loc = normaliseLocation({ state: r['State'], city: r['city'], postcode: r['ZipCode'], address: r['Street'] });
      properties.set(building.toLowerCase(), {
        id: pid, name: building, addressLine: str(r['Street']), city: loc.city ?? '',
        state: loc.state ?? '', postcode: opt(r['ZipCode']) ?? loc.postcode, countryCode: opt(r['Country Code'])?.toUpperCase().slice(0, 2) ?? 'MY',
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
  /** The reservations money-breakdown columns (migration 0052), by column name. Sen; null = the export left it blank. */
  money: Record<typeof RESERVATION_MONEY_COLUMNS[number], number | string | null>;
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

/** The name a guest record gets when the source has none: the channel and the booking's reference. */
export const placeholderGuestName = (channelLabel: string, ref: string) => `${channelLabel} guest ${ref}`;

export const CHANNEL_LABEL: Record<Channel, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct', maintenance_block: 'Block', owner_stay: 'Owner stay' };

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
      // A booking with no name gets its reference in the placeholder: without it every nameless Airbnb booking
      // hashed to the same guest id and 23 stays collapsed into one "Airbnb guest" (fixed 10 Oct 2026).
      const name = opt(r['Guest Name']) ?? ([opt(r['First Name']), opt(r['Last Name'])].filter(Boolean).join(' ') || placeholderGuestName(CHANNEL_LABEL[channel], ota ?? code));
      gid = guestId(name, phone, email);
      if (!guests.has(gid)) guests.set(gid, { id: gid, fullName: name.slice(0, 200), email, phone, countryCode: countryCode(r['Nationality']) });
    }
    const remarks = opt(r['Remarks']), rateName = opt(r['Rate Name']);
    const showRemarks = remarks && channel !== 'airbnb' && channel !== 'booking_com' && channel !== 'agoda';
    reservations.push({
      id: `hp-res-${code}`, row, code, building, unitNumber, channel, state, externalRef: ota ?? code, checkIn, checkOut,
      guestsCount: Math.max(1, Math.round(num(r['Number of pax']) ?? 1)), gross: Math.max(0, gross), fee: platformFee,
      collected: Math.max(0, sen(r['Payment Received']) ?? 0), currency: (opt(r['Currency']) ?? 'MYR').toUpperCase().slice(0, 3),
      notes: `Imported from HostPlatform (${code})${showRemarks ? ` · ${remarks!.slice(0, 200)}` : ''}`,
      createdAt: hpTimestamp(r['Created At']), guestId: gid,
      maxGuests: num(r['Capacity (Adults)']) ? Math.round(num(r['Capacity (Adults)'])!) : null,
      sizeSqft: num(r['Room Size (sqft)']) ? Math.round(num(r['Room Size (sqft)'])!) : null,
      money: {
        room_revenue: nonNeg(r['Room Rate']), guest_cleaning_fee: nonNeg(r['Cleaning Fee']), extra_fees: sumSen(r, EXTRA_FEE_COLUMNS),
        sst_amount: sumSen(r, ['Sales Service Tax', 'Sales Tax']), tourism_tax: sumSen(r, ['Tourism Tax', 'Heritage Tax']), ota_tax: nonNeg(r['OTA Tax']),
        deposit_collected: nonNeg(r['Deposit Collected']), deposit_refunded: nonNeg(r['Deposit Refunded']),
        payment_method: opt(r['Payment Method'])?.slice(0, 60) ?? null, rate_plan: rateName?.slice(0, 120) ?? null,
        guest_nationality: opt(r['Nationality'])?.slice(0, 60) ?? null,
      },
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

export type Package = 'Package A' | 'Package B' | 'Package C' | 'Package D';
export interface UtilityAccountIn { kind: 'electricity' | 'internet' | 'sewerage'; accountNo: string; provider: string | null }
export interface PoolMonthIn { month: string; poolBalance: number | null; paidFromPool: number | null; companyTopUp: number | null }

export interface WorkbookUnitIn {
  row: number; workbookId: string; listingName: string | null; address: string | null;
  ownerName: string | null; ic: string | null; bankName: string | null; bankAccount: string | null; bankHolder: string | null;
  pkg: Package | null; packageD: boolean; term: 'Long term' | 'Short term' | null;
  split: 'Profit share' | 'GRR — guaranteed rent' | null; splitValue: number | null;
  /** Unit资料 'Miscellaneous Charges', kept on the unit too: a row without a contract start date has no contract to hold it. */
  miscCharges: boolean;
  contract: {
    model: 'management' | 'grr'; feePct: number; grrAmount: number; startsOn: string; endsOn: string | null;
    agentPct: number | null; minimumGuarantee: number; minimumGuaranteeAnnual: number | null;
    guaranteeStartsOn: string | null; guaranteeEndsOn: string | null; agreementFile: string | null; miscCharges: boolean;
  } | null;
  utilityAccounts: UtilityAccountIn[]; debt: number | null; poolMonths: PoolMonthIn[];
}

const ownerPct = (v: unknown): number | null => {
  const n = num(v);
  if (n === null) return null;
  return Math.round((n <= 1 ? n * 100 : n) * 100) / 100;
};

/** 水池 is four tables stacked in one sheet, each under a title line and its own 'Unit' header: the Package D
 *  minimums, then the pool's month-end balance, what the pool paid owners, and what the company added. Rows come
 *  back keyed by that table's own header, with `_section` set. Anything above the first header is ignored. */
export function poolSheetRows(raw: { row: number; cells: unknown[] }[]): Row[] {
  const out: Row[] = [];
  let header: string[] | null = null, section: string | null = null, title = '';
  for (const r of [...raw].sort((a, b) => a.row - b.row)) {
    const first = str(r.cells[0]);
    if (first === 'Unit') {
      header = Array.from(r.cells, c => str(c));
      section = /保底一览/.test(title) ? 'guarantee' : /水池余额/.test(title) ? 'balance' : /从水池补给/.test(title) ? 'from_pool' : /公司新补/.test(title) ? 'company' : null;
      continue;
    }
    // A title line is the only kind of row with Chinese in its first cell ('PACKAGE D 保底一览（2026）...'); unit ids have none.
    if (/[㐀-鿿]/.test(first)) { title = first; header = null; section = null; continue; }
    if (!header || !section || !first) continue;
    const o: Row = { _row: r.row, _sheet: WORKBOOK_SHEETS.pool, _section: section };
    header.forEach((h, i) => { if (h && o[h] === undefined) o[h] = r.cells[i] ?? null; });
    out.push(o);
  }
  return out;
}

/** '505936231124 TIME' -> account and provider. '- (included in ...)' and text without a digit are not account numbers. */
function utilityAccount(kind: UtilityAccountIn['kind'], v: unknown): UtilityAccountIn | null {
  const s = typeof v === 'number' ? String(Math.round(v)) : opt(v);
  if (!s || s.startsWith('-') || !/\d/.test(s)) return null;
  const m = /^([0-9][0-9 ]*[0-9])\s+([A-Za-z][A-Za-z &]*)$/.exec(s);
  const accountNo = (m ? m[1] : s).replace(/\s+/g, ' ').slice(0, 60);
  const provider = m ? m[2].trim().toUpperCase() : kind === 'electricity' ? 'TNB' : kind === 'sewerage' ? 'Indah Water' : null;
  return { kind, accountNo, provider };
}

/** One entry per workbook unit id. Duplicate ids keep the later row (reported). Pool months are only taken up
 *  to the month before `today` (later months are the sheet's projection, not history). */
export function mapWorkbookUnits(rows: Row[], splits: Row[], pool: Row[], today = todayInKL()): { units: WorkbookUnitIn[]; errors: RowError[]; notes: string[] } {
  const errors: RowError[] = [], byId = new Map<string, WorkbookUnitIn>();
  const splitOf = new Map(splits.map(s => [str(s['UNIT']).toUpperCase(), s]));
  // Older callers send the guarantee table without `_section`. The first row of a unit wins.
  const poolOf = new Map<string, Row>();
  for (const p of pool) if (!p._section || p._section === 'guarantee') { const k = str(p['Unit']).toUpperCase(); if (k && !poolOf.has(k)) poolOf.set(k, p); }
  const months = new Map<string, Map<string, PoolMonthIn>>();
  const thisMonth = today.slice(0, 7);
  for (const p of pool) {
    const field = p._section === 'balance' ? 'poolBalance' : p._section === 'from_pool' ? 'paidFromPool' : p._section === 'company' ? 'companyTopUp' : null;
    if (!field) continue;
    const k = str(p['Unit']).toUpperCase();
    MONTH_COLS.forEach((m, mi) => {
      const v = sen(p[m]), month = `${WORKBOOK_YEAR}-${pad(mi + 1)}`;
      if (v === null || month >= thisMonth) return;
      if (!months.has(k)) months.set(k, new Map());
      const byMonth = months.get(k)!;
      const cur = byMonth.get(month) ?? { month, poolBalance: null, paidFromPool: null, companyTopUp: null };
      if (cur[field] === null) cur[field] = v;
      byMonth.set(month, cur);
    });
  }
  let dup = 0;
  rows.forEach((r, i) => {
    const row = rowNo(r, i), workbookId = str(r['Unit编号']).toUpperCase();
    if (!workbookId) return errors.push({ row, reason: 'No unit id (Unit编号).' });
    if (byId.has(workbookId)) dup++;
    const sp = splitOf.get(workbookId), pl = poolOf.get(workbookId);
    const kind = str(r['LONGTERM/PROFIT SHARING']).toUpperCase();
    const pkgLetter = str(r['PACKAGE']).toUpperCase().replace(/^PACKAGE\s*/, '');
    const owner = sp ? ownerPct(sp['OWNER%']) : null;
    const agent = sp ? ownerPct(sp['AGENT%']) : null;
    const splitText = /^(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(str(r['分成']));
    const ownerShare = owner ?? (splitText ? Number(splitText[1]) : null);
    const grr = sen(r['GRR']);
    // The owner's floor on a profit share (整体报告 PROFIT SHARING 'GRR' column): on Package D it is the annual rent
    // over 12 (水池: 每月最低 = 全年租金 ÷ 12), from the contract start; on other packages Unit资料 GRR is the monthly floor itself.
    const isD = pkgLetter === 'D';
    const grrFloor = kind !== 'LT' ? sen(r['GRR']) : null;
    const minimum = pl ? sen(pl['每月最低拿到（保底）']) : isD ? (grrFloor ? Math.round(grrFloor / 12) : null) : grrFloor;
    const annual = pl ? sen(pl['全年租金（GRR）']) : isD ? grrFloor : null;
    const startsOn = toDate(r['合约开始日期']) ?? (pl ? toDate(pl['合约开始']) : null);
    const endsOn = toDate(r['合约结束日期']) ?? (pl ? toDate(pl['合约结束']) : null);
    const isGrr = kind === 'LT' && !!grr;
    const feePct = isGrr ? 0 : ownerShare !== null ? Math.max(0, Math.min(100, 100 - ownerShare)) : 25;
    const miscCharges = r['Miscellaneous Charges'] === true || /^(true|yes|y|1)$/i.test(str(r['Miscellaneous Charges']));
    const ic = opt(r['IC'])?.replace(/\s*\n\s*|\s{2,}/g, ' / ') ?? null;
    const account = opt(r['BANK AC']);
    const debt = sen(r['DEBT AMOUNT']);
    const accounts = [utilityAccount('electricity', r['电费账号']), utilityAccount('internet', r['网络账号']), utilityAccount('sewerage', r['INDAH WATER账号'])]
      .filter((a): a is UtilityAccountIn => !!a);
    byId.set(workbookId, {
      row, workbookId, listingName: opt(r['Listing名称']), address: opt(r['地址']),
      ownerName: opt(r['房东/业主']), ic, bankName: opt(r['BANK NAME']), bankAccount: account ? account.replace(/\s/g, '') : null, bankHolder: opt(r['BANK HOLDER NAME']),
      pkg: /^[ABCD]$/.test(pkgLetter) ? (`Package ${pkgLetter}` as Package) : null,
      packageD: pkgLetter === 'D',
      term: kind === 'LT' ? 'Long term' : kind === 'PS' || kind === 'MANAGE' ? 'Short term' : null,
      split: isGrr ? 'GRR — guaranteed rent' : ownerShare !== null ? 'Profit share' : null,
      splitValue: isGrr ? grr : ownerShare !== null ? Math.round(ownerShare) : null,
      contract: startsOn ? {
        model: isGrr ? 'grr' : 'management', feePct, grrAmount: isGrr ? grr! : 0, startsOn, endsOn,
        agentPct: agent !== null && agent > 0 ? Math.min(agent, feePct) : null,
        minimumGuarantee: Math.max(0, minimum ?? 0), minimumGuaranteeAnnual: annual !== null && annual > 0 ? annual : null,
        // Package D's floor applies from the contract start (prorated by day in its first month); another package's applies throughout.
        guaranteeStartsOn: isD ? (pl ? toDate(pl['合约开始']) : null) ?? startsOn : null, guaranteeEndsOn: isD ? (pl ? toDate(pl['合约结束']) : null) ?? endsOn : null,
        agreementFile: opt(r['CONTRACT'])?.slice(0, 200) ?? null,
        miscCharges,
      } : null,
      miscCharges,
      utilityAccounts: accounts, debt: debt !== null && debt > 0 ? debt : null,
      poolMonths: [...(months.get(workbookId)?.values() ?? [])],
    });
  });
  const units = [...byId.values()];
  const notes: string[] = [];
  if (dup) notes.push(`${dup} unit ids appear more than once in Unit资料; the last row of each was used.`);
  const d = units.filter(u => u.packageD).length;
  if (d) notes.push(`${d} units are on Package D; ${units.filter(u => u.packageD && u.contract?.minimumGuarantee).length} of them have a monthly minimum from 水池, kept on their contract.`);
  const acc = units.reduce((n, u) => n + u.utilityAccounts.length, 0);
  if (acc) notes.push(`${acc} utility account numbers (electricity, internet, Indah Water) are kept on their units.`);
  const debt = units.filter(u => u.debt);
  if (debt.length) notes.push(`${debt.length} units carry a DEBT AMOUNT (RM ${(debt.reduce((n, u) => n + u.debt!, 0) / 100).toFixed(2)} in all). It is recorded against the owner but held: it is not deducted from a statement until someone releases it.`);
  const agents = units.filter(u => u.contract?.agentPct).length;
  if (agents) notes.push(`${agents} contracts have an agent share (分成 AGENT%).`);
  const noContract = units.filter(u => !u.contract);
  if (noContract.length) notes.push(`${noContract.length} units have no contract start date. Their owner, package and split are set, but no contract is created: a contract needs a start date.`);
  const pm = units.reduce((n, u) => n + u.poolMonths.length, 0);
  if (pm) notes.push(`${pm} unit-months of the Package D guarantee pool (水池) are kept, up to last month.`);
  return { units, errors, notes };
}

export interface OwnerIn { id: string; name: string; ic: string | null; bankName: string | null; bankAccount: string | null; bankHolder: string | null }
/* Owner ids are opaque: they once embedded the IC number ('wb-owner-<ic>'), which then showed in URLs and the audit
 * log. Now 'wb-owner-' / 'hp-owner-' + the first 16 hex characters of sha256('conts-owner:' + key), where the key is
 * the IC with everything but letters and digits removed, lower-cased, or, with no IC, the name with runs of spaces,
 * tabs and line breaks made one space, trimmed, lower-cased. Migration 0052 computes exactly this in SQL to re-key
 * the owners imported before; scripts/api-checks/owner-rekey.mjs checks the two agree. Re-runs still find an owner
 * by IC or name first, so the id only matters for an owner seen for the first time. */
export const ownerKeyFromIc = (ic: string | null | undefined) => (ic ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
export const ownerKeyFromName = (name: string | null | undefined) => (name ?? '').replace(/[ \t\r\n]+/g, ' ').replace(/^ +| +$/g, '').toLowerCase();
export async function opaqueOwnerId(prefix: 'wb-owner-' | 'hp-owner-', key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`conts-owner:${key}`)));
  return prefix + [...bytes.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** A workbook owner: keyed by IC when there is one, else by name. */
export const workbookOwnerId = (u: { ic: string | null; ownerName: string | null }) =>
  opaqueOwnerId('wb-owner-', ownerKeyFromIc(u.ic) || ownerKeyFromName(u.ownerName ?? 'unknown'));
/** An owner named in the HostPlatform listing (a name only). */
export const listingOwnerId = (name: string) => opaqueOwnerId('hp-owner-', ownerKeyFromName(name));

/* ------------------------------------------------------------------ */
/* Workbook: Airbnb earnings                                           */
/* ------------------------------------------------------------------ */

export interface AirbnbInstalmentIn {
  /** Deterministic: the booking's code and unit, the line's dates, and a counter for lines with the same dates. */
  key: string; row: number; checkIn: string; checkOut: string; amount: number; paidOutOn: string | null;
  /** 数据来源 已完成: Airbnb paid it out. 待处理: listed, not paid out yet. */
  received: boolean;
}
export interface AirbnbEarningIn {
  row: number; code: string; site: 'airbnb' | 'booking_com'; workbookId: string; checkIn: string; checkOut: string;
  gross: number | null; fee: number | null; amount: number | null; idSuffix: string;
  /** Sen; null = blank. paidOutOn is the latest date 已支付 holds (today it holds blanks and zeros). */
  cleaningFee: number | null; tax: number | null; fastPay: number | null; paidOutOn: string | null;
  /** Every payout line of the booking. A stay of 28 nights or more is paid by Airbnb in monthly instalments, one
   *  line each; the import used to keep the first and drop the rest. */
  instalments: AirbnbInstalmentIn[];
}

/** The workbook's earnings lines: Airbnb (HM...) and a few Booking.com (10-digit) codes. 'OWNER' rows are
 *  owner stays logged there, not bookings, and are skipped. A code booked on two units (one booking, two listings) gets the unit in its new id.
 *  All lines of one code on one unit are one booking: their money is summed, its stay runs from the first line's
 *  check-in to the last line's check-out, and each line is kept as an instalment. The caller must send all of a
 *  code's lines in one request (the screen's chunkByKey does). */
export function mapAirbnbEarnings(rows: Row[]): { earnings: AirbnbEarningIn[]; errors: RowError[]; skipped: RowError[] } {
  const errors: RowError[] = [], skipped: RowError[] = [];
  const unitsPerCode = new Map<string, Set<string>>();
  for (const r of rows) {
    const code = str(r['确认码']).toUpperCase();
    if (!unitsPerCode.has(code)) unitsPerCode.set(code, new Set());
    unitsPerCode.get(code)!.add(str(r['Unit编号']).toUpperCase());
  }
  const groups = new Map<string, AirbnbEarningIn>();
  const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  rows.forEach((r, i) => {
    const row = rowNo(r, i), code = str(r['确认码']).toUpperCase(), workbookId = str(r['Unit编号']).toUpperCase();
    const site = /^HM[A-Z0-9]{6,}$/.test(code) ? 'airbnb' : /^\d{8,12}$/.test(code) ? 'booking_com' : null;
    if (!site) return skipped.push({ row, reason: code === 'OWNER' ? 'Owner stay line, not a booking.' : 'Not an Airbnb or Booking.com confirmation code.' });
    if (!workbookId) return errors.push({ row, reason: `${code}: no unit id.` });
    const checkIn = toDate(r['入住日期']), checkOut = toDate(r['退房日期']);
    if (!checkIn || !checkOut || checkOut <= checkIn) return errors.push({ row, reason: `${code}: dates are missing or check-out is not after check-in.` });
    const amountRaw = sen(r['金额(Amount)']), fee = sen(r['服务费(Service fee)']), grossRaw = sen(r['总收入(Gross earnings)']);
    const gross = grossRaw ?? (amountRaw !== null ? amountRaw + (fee ?? 0) : null);
    const amount = amountRaw === null ? null : Math.max(0, amountRaw);
    // An Excel date serial is > 20000; the 0s in this column are not dates.
    const paidOutOn = typeof r['已支付(Paid out)'] === 'number' && (r['已支付(Paid out)'] as number) < 20000 ? null : toDate(r['已支付(Paid out)']);
    const k = `${code}|${workbookId}`;
    let g = groups.get(k);
    if (!g) {
      g = { row, code, site, workbookId, checkIn, checkOut, gross: null, fee: null, amount: null,
        idSuffix: (unitsPerCode.get(code)?.size ?? 1) > 1 ? `-${slug(workbookId)}` : '',
        cleaningFee: null, tax: null, fastPay: null, paidOutOn: null, instalments: [] };
      groups.set(k, g);
    }
    if (checkIn < g.checkIn) g.checkIn = checkIn;
    if (checkOut > g.checkOut) g.checkOut = checkOut;
    g.gross = add(g.gross, gross === null ? null : Math.max(0, gross));
    g.fee = add(g.fee, fee === null ? null : Math.max(0, fee));
    g.amount = add(g.amount, amount);
    g.cleaningFee = add(g.cleaningFee, nonNeg(r['清洁费(Cleaning fee)']));
    g.tax = add(g.tax, nonNeg(r['Airbnb税费(Tax)']));
    g.fastPay = add(g.fastPay, nonNeg(r['快速支付费(Fast pay)']));
    if (paidOutOn && (!g.paidOutOn || paidOutOn > g.paidOutOn)) g.paidOutOn = paidOutOn;
    if (amount) {
      const base = `${code}${g.idSuffix}-${checkIn}-${checkOut}`;
      const n = g.instalments.filter(x => x.key.startsWith(base)).length;
      g.instalments.push({ key: n ? `${base}-${n + 1}` : base, row, checkIn, checkOut, amount, paidOutOn, received: str(r['数据来源']) !== '待处理' });
    }
  });
  return { earnings: [...groups.values()], errors, skipped };
}

/* ------------------------------------------------------------------ */
/* Workbook: cleaning records                                          */
/* ------------------------------------------------------------------ */

export interface CleaningIn {
  row: number; id: string; workbookId: string; date: string; kind: 'turnover' | 'deep_clean'; title: string;
  instructions: string; dueTime: string | null; nextGuestTime: string | null; price: number | null; payer: string | null;
  cleaner: string | null;
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
    const instructions = [payer && `Paid by: ${payer}`, checkInText && !toTime(r['入住时间']) && `Next check-in: ${checkInText}`, remark]
      .filter(Boolean).join(' · ');
    cleanings.push({
      row, id, workbookId, date, kind: type.kind, title: type.title, instructions: instructions.slice(0, 500),
      dueTime: toTime(r['退房时间']), nextGuestTime: toTime(r['入住时间']),
      price: sen(priceOf.get(workbookId)?.[type.priceCol]), payer, cleaner: who ? who.slice(0, 100) : null,
    });
  });
  return { cleanings, errors, skipped };
}

/* ------------------------------------------------------------------ */
/* Workbook: utilities and misc charges                                */
/* ------------------------------------------------------------------ */

export interface ExpenseIn { row: number; id: string; workbookId: string; category: string; description: string; amount: number; incurredOn: string; reference: string | null }
/** Money for or against the owner after the split (owner_adjustments). amount is signed sen: positive adds to the
 *  owner's payout, negative deducts. An 'O2' 杂费扣款 line is exactly this, sign included (the workbook adds the O2
 *  column to the owner's share); a negative 'Additional Deduction' line is money back to the owner. */
export interface CreditIn { row: number | string; id: string; workbookId: string; description: string; amount: number; occurredOn: string; reference: string | null }

const UTILITY: Record<string, { category: string; tag: string; label: string }> = {
  '水费': { category: 'water', tag: 'water', label: 'Water' },
  '电费': { category: 'electricity', tag: 'electricity', label: 'Electricity' },
  '网络费': { category: 'internet', tag: 'internet', label: 'Internet' },
  'INDAH WATER': { category: 'utilities', tag: 'sewerage', label: 'Indah Water (sewerage)' },
};

/** Rows carry `_sheet`: one of the four utility sheets or 杂费扣款. 杂费扣款 has two kinds of line, and the workbook
 *  treats them differently (整体报告):
 *   - 'Additional Deduction' is a cost taken off the income BEFORE the owner/company split: an expense. A negative
 *     one is money back to the owner and becomes an owner credit.
 *   - 'O2' is added to the owner's share AFTER the split, sign as written: -423.94 'MAINTENANCE FEE' is paid by the
 *     company for the owner and taken off his payout; +1,038.05 'TNB' is a bill the owner paid himself, given back.
 *     Every O2 line becomes an owner adjustment with that signed amount. */
export function mapWorkbookExpenses(rows: Row[]): { expenses: ExpenseIn[]; credits: CreditIn[]; errors: RowError[]; skipped: RowError[] } {
  const errors: RowError[] = [], skipped: RowError[] = [], expenses: ExpenseIn[] = [], credits: CreditIn[] = [], seen = new Set<string>();
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
    const afterSplit = /^O2$/i.test(type);
    const key = hash(`${workbookId}|${date}|${type}|${what}|${amount}`);
    const id = afterSplit ? `wb-o2-${key}` : `wb-${amount < 0 ? 'credit' : 'misc'}-${key}`;
    if (seen.has(id)) return skipped.push({ row: where, reason: 'Same charge listed twice; counted once.' });
    seen.add(id);
    const description = `${type}: ${what}`.slice(0, 300), reference = opt(r['备注'])?.slice(0, 200) ?? null;
    if (afterSplit) credits.push({ row: where, id, workbookId, description, amount, occurredOn: date, reference });
    else if (amount < 0) credits.push({ row: where, id, workbookId, description, amount: -amount, occurredOn: date, reference });
    else expenses.push({ row, id, workbookId, category: 'other', description, amount, incurredOn: date, reference });
  });
  return { expenses, credits, errors, skipped };
}

/* ------------------------------------------------------------------ */
/* Workbook: owner payout history                                      */
/* ------------------------------------------------------------------ */

/** The 整体报告 figures for one unit, sen. revenue - deductions = gp; the owner was paid `payout`. */
export interface PayoutBreakdown { revenue: number; cleaning: number; utilities: number; additional: number; misc: number; payout: number }
/** What one unit's owner was paid for one month (OWNER PAYOUT sheet), sen. Can be negative (the month cost more than it made). */
export interface PayoutMonthIn { row: number; workbookId: string; month: string; amount: number; breakdown: PayoutBreakdown | null }

/** OWNER PAYOUT: one row per unit, JAN..DEC of WORKBOOK_YEAR. Only months before the current one are history;
 *  the current and later months are never turned into statements. 整体报告 is one month's breakdown per unit with
 *  no month written on it: its month is the one whose OWNER PAYOUT column agrees with the report's OWNER PAYOUT
 *  for most units, and a unit's breakdown is used only when its own two figures agree. */
export function mapPayoutHistory(rows: Row[], report: Row[], today: string): { months: PayoutMonthIn[]; reportMonth: string | null; errors: RowError[]; skipped: RowError[]; notes: string[] } {
  const errors: RowError[] = [], skipped: RowError[] = [], notes: string[] = [];
  const thisMonth = today.slice(0, 7);
  const byUnit = new Map<string, { row: number; amounts: Map<string, number> }>();
  let dup = 0, future = 0;
  rows.forEach((r, i) => {
    const row = rowNo(r, i), workbookId = str(r['UNIT']).toUpperCase();
    if (!workbookId || /^\d+$/.test(workbookId)) return;
    if (byUnit.has(workbookId)) dup++;
    const amounts = new Map<string, number>();
    MONTH_COLS.forEach((m, mi) => {
      const v = sen(r[m]), month = `${WORKBOOK_YEAR}-${pad(mi + 1)}`;
      if (!v) return;
      if (month >= thisMonth) { future++; return; }
      amounts.set(month, v);
    });
    byUnit.set(workbookId, { row, amounts });
  });
  if (dup) notes.push(dup === 1 ? '1 unit appears twice in OWNER PAYOUT; its last row was used.' : `${dup} units appear twice in OWNER PAYOUT; the last row of each was used.`);
  if (future) skipped.push({ row: 'OWNER PAYOUT', reason: `${future} amounts are for this month or later; statements are only made for past months.` });

  // Which month 整体报告 describes.
  const rep = report.map(r => ({ id: str(r['LONG TERM']).toUpperCase(), payout: sen(r['OWNER PAYOUT']), r })).filter(x => x.id && x.payout !== null);
  const votes = new Map<string, number>();
  for (const x of rep) for (const [m, v] of byUnit.get(x.id)?.amounts ?? []) if (v === x.payout) votes.set(m, (votes.get(m) ?? 0) + 1);
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const reportMonth = best && best[1] * 2 >= rep.length ? best[0] : null;
  const breakdown = new Map<string, PayoutBreakdown>();
  if (reportMonth) {
    for (const x of rep) {
      if (byUnit.get(x.id)?.amounts.get(reportMonth) !== x.payout) continue;
      const v = (c: string) => sen(x.r[c]) ?? 0;
      breakdown.set(x.id, { revenue: v('TOTAL REVENUE'), cleaning: v('ALL CLEANING TOTAL'), utilities: v('UTILITIES'), additional: v('ADDITIONAL DEDUCTION'), misc: v('MISCELLANEOUS CHARGES'), payout: x.payout! });
    }
    notes.push(`整体报告 is the ${reportMonth} report: ${breakdown.size} units get its revenue and deductions on their ${reportMonth} statement; every other month shows the payout only.`);
  } else if (rep.length) notes.push('整体报告 could not be tied to a month of OWNER PAYOUT, so no statement shows its breakdown.');

  const months: PayoutMonthIn[] = [];
  for (const [workbookId, u] of byUnit) {
    for (const [month, amount] of u.amounts) months.push({ row: u.row, workbookId, month, amount, breakdown: month === reportMonth ? breakdown.get(workbookId) ?? null : null });
  }
  return { months, reportMonth, errors, skipped, notes };
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

/** Keeps only the named columns (plus `_row` / `_sheet` / `_section`), so nothing else in the export leaves the browser. */
export function pick(rows: Row[], columns: string[]): Row[] {
  return rows.map(r => {
    const o: Row = {};
    for (const c of columns) if (r[c] !== undefined && r[c] !== null && r[c] !== '') o[c] = r[c];
    if (r._row !== undefined) o._row = r._row;
    if (r._sheet !== undefined) o._sheet = r._sheet;
    if (r._section !== undefined) o._section = r._section;
    return o;
  });
}
