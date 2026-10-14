/* Customer and property information shared by a renovation sales order and its
   project (owner, 14 Oct 2026; migration 0112). Pure: no I/O. The browser keeps a
   byte-identical copy in frontend/src/vendor/shared (renovation-shared.canonical.test.ts).

   THE TWO-WAY RULE (the simplest one that keeps both sides equal):
   - The project is the master record of the shared fields: customer name, phone,
     email, site address, building, unit, property type, layout (label + bedrooms +
     bathrooms) and built-up sq ft.
   - Saving a sales order that names a project writes the SO's values of those
     fields onto the project (a blank email on the SO never wipes the project's).
   - Saving a project copies its values onto every linked sales order that is
     still OPEN: a standard order in DRAFT or CONFIRMED that has not been proceeded
     (no processing date). A proceeded, delivered or cancelled order and every
     renovation contract (signed) keep what they were printed with.
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
  /** One free-text site / delivery address, lines separated by "\n". */
  siteAddress: string;
  building: string;
  unitNo: string;
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
    customer name, phone, delivery address, property type, layout (with its counts), sq ft. */
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
  need(f.address1.trim() !== '', 'Delivery address');
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
