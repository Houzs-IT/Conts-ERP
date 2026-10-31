/* Customer and property information shared by a renovation sales order and its
   project (owner, 14 Oct 2026; migration 0112). Pure: no I/O. The browser keeps a
   byte-identical copy in frontend/src/vendor/shared (renovation-shared.canonical.test.ts).

   THE SAME FIELDS ON BOTH (owner, 14 Oct 2026, migration 0115): the SO and the
   project ask for exactly the fields in SHARED_FIELDS below, in that order, with
   the same labels and the same required ones (REQUIRED_FIELDS).

   THE TWO-WAY RULE (every field in SHARED_FIELDS, nothing else):
   - The project is the master record of the shared fields.
   - Saving a sales order that names a project writes the SO's values onto the
     project; an empty SO value never clears a project field.
   - Saving a project copies its values onto every linked sales order that is
     still OPEN: a standard order in DRAFT or CONFIRMED that has not been proceeded
     (no processing date); an empty project value never clears an SO field. A
     proceeded, delivered or cancelled order and every renovation contract
     (signed) keep what they were printed with, except the customer's phone and
     email, which reach every order that is not cancelled (owner, 1 Nov 2026).
   - Linking an existing SO from the project copies the SO into the project the
     same way as saving the SO.
   - A new SO opened from a project starts from the project's values. */

export interface PropertyValue {
  propertyType: string;
  layoutLabel: string;
  bedrooms: number | null;
  bathrooms: number | null;
  builtUpSqft: number | null;
}

export interface SharedCustomerProperty extends PropertyValue {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  /** The salesperson: an employee id (scm.staff), '' when none. */
  salespersonId: string;
  address1: string;
  address2: string;
  state: string;
  city: string;
  postcode: string;
  country: string;
  salesLocation: string;
  /** The joined address, kept for whatever still reads the project's single address column. */
  siteAddress: string;
  building: string;
  unitNo: string;
}

export type SharedFieldKey = Exclude<keyof SharedCustomerProperty, 'siteAddress'>;
export type SharedFieldKind = 'text' | 'uuid' | 'int' | 'numeric';

/** Every field the SO and the project share, in form order, with where each side stores it. The two-way rule
    reads this list, so a field added here is synced both ways and a field not listed is not. */
export const SHARED_FIELDS: ReadonlyArray<{ key: SharedFieldKey; project: string; so: string; kind: SharedFieldKind }> = [
  { key: 'customerName', project: 'customer_name', so: 'debtor_name', kind: 'text' },
  { key: 'customerPhone', project: 'customer_phone', so: 'phone', kind: 'text' },
  { key: 'customerEmail', project: 'customer_email', so: 'email', kind: 'text' },
  { key: 'salespersonId', project: 'salesperson_staff_id', so: 'salesperson_id', kind: 'uuid' },
  { key: 'address1', project: 'address1', so: 'address1', kind: 'text' },
  { key: 'address2', project: 'address2', so: 'address2', kind: 'text' },
  { key: 'state', project: 'state', so: 'customer_state', kind: 'text' },
  { key: 'city', project: 'city', so: 'city', kind: 'text' },
  { key: 'postcode', project: 'postcode', so: 'postcode', kind: 'text' },
  { key: 'country', project: 'country', so: 'customer_country', kind: 'text' },
  { key: 'salesLocation', project: 'sales_location', so: 'sales_location', kind: 'text' },
  { key: 'building', project: 'building', so: 'building', kind: 'text' },
  { key: 'unitNo', project: 'unit_no', so: 'unit_no', kind: 'text' },
  { key: 'propertyType', project: 'property_type', so: 'property_type', kind: 'text' },
  { key: 'layoutLabel', project: 'layout_label', so: 'layout_label', kind: 'text' },
  { key: 'bedrooms', project: 'bedrooms', so: 'bedrooms', kind: 'int' },
  { key: 'bathrooms', project: 'bathrooms', so: 'bathrooms', kind: 'int' },
  { key: 'builtUpSqft', project: 'built_up_sqft', so: 'built_up_sqft', kind: 'numeric' },
];

/** The project columns migration 0115 adds (the rest were there before). */
export const STRUCTURED_PROJECT_COLUMNS: readonly string[] = ['salesperson_staff_id', 'address1', 'address2', 'state', 'city', 'postcode', 'country', 'sales_location'];

/** The same required fields on the SO and the project, by their form label. */
export const REQUIRED_FIELDS: readonly string[] = ['Customer name', 'Phone number', 'Address line 1', 'Property type', 'Layout', 'Built-up sq ft'];

/** The project's single address text from the structured address: the lines, "postcode city", then the state. */
export function siteAddressFromParts(a: { address1?: string; address2?: string; postcode?: string; city?: string; state?: string }): string {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return [t(a.address1), t(a.address2), [t(a.postcode), t(a.city)].filter(Boolean).join(' '), t(a.state)].filter(Boolean).join('\n');
}

export interface PropertyProblem { code: string; message: string; field: string }

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** A whole count 0..20, or null when blank; NaN when typed but not a valid count. */
export function parseCount(v: unknown): number | null {
  const s = text(v);
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? n : Number.NaN;
}

/** Square feet > 0 with at most 2 decimals (commas allowed), null when blank, NaN when invalid. */
export function parseSqft(v: unknown): number | null {
  const s = text(v).replace(/,/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const n = Number(s);
  return n > 0 && n < 100_000_000 ? n : Number.NaN;
}

/** Read the property fields from a request body; problems name every invalid value. */
export function readPropertyInput(raw: Record<string, unknown> | null | undefined): { value: PropertyValue; problems: PropertyProblem[] } {
  const b = raw ?? {};
  const problems: PropertyProblem[] = [];
  const bedrooms = parseCount(b.bedrooms);
  const bathrooms = parseCount(b.bathrooms);
  const builtUpSqft = parseSqft(b.builtUpSqft);
  if (Number.isNaN(bedrooms)) problems.push({ code: 'bedrooms_invalid', message: 'Bedrooms must be a whole number from 0 to 20.', field: 'Bedrooms' });
  if (Number.isNaN(bathrooms)) problems.push({ code: 'bathrooms_invalid', message: 'Bathrooms must be a whole number from 0 to 20.', field: 'Bathrooms' });
  if (Number.isNaN(builtUpSqft)) problems.push({ code: 'sqft_invalid', message: 'Built-up area must be a number of square feet above 0.', field: 'Built-up sq ft' });
  return {
    value: {
      propertyType: text(b.propertyType).slice(0, 80),
      layoutLabel: text(b.layoutLabel).slice(0, 80),
      bedrooms: Number.isNaN(bedrooms) ? null : bedrooms,
      bathrooms: Number.isNaN(bathrooms) ? null : bathrooms,
      builtUpSqft: Number.isNaN(builtUpSqft) ? null : builtUpSqft,
    },
    problems,
  };
}

/** What a renovation sales order must carry before it is saved (not a draft):
    customer name, phone, address line 1, property type, layout (with its counts), sq ft. The project asks the same. */
export function renoSoRequiredProblems(f: {
  customerName: string;
  phone: string;
  address1: string;
  property: PropertyValue;
}): PropertyProblem[] {
  const out: PropertyProblem[] = [];
  const need = (ok: boolean, field: string) => { if (!ok) out.push({ code: 'required_field', message: `${field} is required.`, field }); };
  need(f.customerName.trim() !== '', 'Customer name');
  need(f.phone.trim() !== '', 'Phone number');
  need(f.address1.trim() !== '', 'Address line 1');
  need(f.property.propertyType.trim() !== '', 'Property type');
  /* The layout (from the Project Maintenance list) brings the bedroom and bathroom counts with it. */
  need(f.property.layoutLabel.trim() !== '' && f.property.bedrooms !== null && f.property.bathrooms !== null, 'Layout');
  need(f.property.builtUpSqft !== null, 'Built-up sq ft');
  return out;
}

/** The project's one-text site address from the SO's two address lines. */
export function siteAddressFromSo(address1: string | null | undefined, address2: string | null | undefined): string {
  return [text(address1), text(address2)].filter(Boolean).join('\n');
}

/** The SO's two address lines from the project's site address (first line, then the rest). */
export function soAddressFromSite(site: string | null | undefined): { address1: string; address2: string } {
  const lines = text(site).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { address1: lines[0] ?? '', address2: lines.slice(1).join(', ') };
}

/** True when editing the project may still change this sales order (see the rule above). */
export function soOpenForProjectSync(so: { so_kind?: string | null; status: string; processing_date?: string | null; proceeded_at?: string | null }): boolean {
  if ((so.so_kind ?? 'STANDARD') !== 'STANDARD') return false;
  if (so.status !== 'DRAFT' && so.status !== 'CONFIRMED') return false;
  return !so.processing_date && !so.proceeded_at;
}

/** Room sections a layout gives, in order: Living hall, Bedroom 1..N, Bathroom 1..M, Common area. */
export function roomSectionHeadings(bedrooms: number, bathrooms: number): string[] {
  const n = (x: number) => (Number.isInteger(x) && x > 0 ? Math.min(x, 20) : 0);
  return [
    'Living hall',
    ...Array.from({ length: n(bedrooms) }, (_, i) => `Bedroom ${i + 1}`),
    ...Array.from({ length: n(bathrooms) }, (_, i) => `Bathroom ${i + 1}`),
    'Common area',
  ];
}

/** The room headings still missing from a document (compared without case or extra spaces), in layout order. */
export function missingRoomSections(existingHeadings: readonly string[], bedrooms: number, bathrooms: number): string[] {
  const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const have = new Set(existingHeadings.map(key));
  return roomSectionHeadings(bedrooms, bathrooms).filter((h) => !have.has(key(h)));
}

/** A renovation project's name (owner, 14 Oct 2026): Building + Unit ("Vista Harmoni B-8-2"), whichever is
    filled; the customer name when both are empty. The project code (RN-YYMM-NNN) stays the unique id. */
export function projectNameFrom(building: unknown, unitNo: unknown, customerName: unknown): string {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
  return [t(building), t(unitNo)].filter(Boolean).join(' ') || t(customerName);
}

/** One room name as stored: trimmed, single spaces, at most 80 characters ('' when blank). */
export function cleanRoomName(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
}

/** An SO's ordered room list as stored: names cleaned, blanks and repeats (any case) dropped, at most 60. */
export function cleanRoomSections(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    const name = cleanRoomName(x);
    const k = name.toLowerCase();
    if (!name || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
    if (out.length === 60) break;
  }
  return out;
}

/** The room list after the lines are placed: every room a line names is in the list (appended in line order). */
export function roomsWithLineRooms(sections: readonly string[], lineRooms: readonly string[]): string[] {
  return cleanRoomSections([...sections, ...lineRooms]);
}
