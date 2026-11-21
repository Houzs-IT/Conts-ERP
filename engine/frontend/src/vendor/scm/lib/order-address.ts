// ----------------------------------------------------------------------------
// order-address — a Sales Order's customer address as its printed documents
// show it (ported from Houzs ERP, where the Deposit Invoice printed off an
// order reads the same lines as the order's own print).
//
// The ship-to block wins when one was typed; otherwise Address line 1 and 2,
// then ONE locality line "postcode city state" where city = city ?? address3
// and postcode = postcode ?? address4 (the POS column mapping — the page never
// renders address3/address4 as raw lines). POS-composed rows already carry the
// postcode/city/state INSIDE the address lines, so each locality part is
// appended ONLY when it does not appear above, the parts are deduped against
// each other (city == state on KL), and exact-duplicate lines drop.
// ----------------------------------------------------------------------------

export type OrderAddressFields = {
  ship_to_address?: string | null;
  address1?: string | null;
  address2?: string | null;
  address3?: string | null;
  address4?: string | null;
  postcode?: string | null;
  city?: string | null;
  customer_state?: string | null;
};

/* The spellings one state goes by (Houzs localities-queries.ts sameState). */
const STATE_ALIAS: Record<string, string> = {
  PENANG: 'PULAU PINANG', 'P PINANG': 'PULAU PINANG',
  KL: 'KUALA LUMPUR', 'WP KUALA LUMPUR': 'KUALA LUMPUR', 'W P KUALA LUMPUR': 'KUALA LUMPUR',
  'WILAYAH PERSEKUTUAN KUALA LUMPUR': 'KUALA LUMPUR',
  'WP LABUAN': 'LABUAN', 'W P LABUAN': 'LABUAN', 'WILAYAH PERSEKUTUAN LABUAN': 'LABUAN',
  'WP PUTRAJAYA': 'PUTRAJAYA', 'W P PUTRAJAYA': 'PUTRAJAYA', 'WILAYAH PERSEKUTUAN PUTRAJAYA': 'PUTRAJAYA',
  NS: 'NEGERI SEMBILAN', 'N S': 'NEGERI SEMBILAN', 'N SEMBILAN': 'NEGERI SEMBILAN',
  MALACCA: 'MELAKA', TRENGGANU: 'TERENGGANU',
};
const stateKey = (state: string): string => {
  const k = state.trim().toUpperCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  return STATE_ALIAS[k] ?? k;
};
const sameState = (a: string, b: string): boolean => stateKey(a) === stateKey(b);

/**
 * address3 / address4 when they carry the street on past line 2 rather than a
 * town line (the POS sends the whole address as address1 and the save spills
 * it there). Display only.
 */
export function soStreetTail(h: OrderAddressFields): string[] {
  const state = (h.customer_state ?? '').trim();
  if (!(h.postcode ?? '').trim() || !state) return [];
  const lines = [h.address1, h.address2, h.address3, h.address4].map((s) => (s ?? '').trim());
  if (lines.some((l) => /\b\d{5,6}\b/.test(l))) return [];
  const tail = [lines[2], lines[3]].filter((l): l is string => Boolean(l));
  return tail.some((l) => sameState(l, state)) ? [] : tail;
}

export function orderAddressLines(h: OrderAddressFields): string[] {
  const baseAddressLines = (h.ship_to_address ?? '').trim()
    ? (h.ship_to_address as string).split('\n').map((s) => s.trim()).filter(Boolean)
    : [h.address1, h.address2]
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .concat(soStreetTail(h));
  const addressHaystack = baseAddressLines.join(' ').toLowerCase();
  const localityParts: string[] = [];
  for (const part of [
    (h.postcode ?? h.address4 ?? '').trim(),
    (h.city ?? h.address3 ?? '').trim(),
    (h.customer_state ?? '').trim(),
  ]) {
    if (!part) continue;
    if (addressHaystack.includes(part.toLowerCase())) continue;   // already inside an address line
    if (localityParts.some((p) => p.toLowerCase() === part.toLowerCase())) continue; // e.g. city == state (KL)
    localityParts.push(part);
  }
  const seenAddressLines = new Set<string>();
  return [...baseAddressLines, localityParts.join(' ')].filter((l) => {
    if (!l) return false;
    const k = l.toLowerCase();
    if (seenAddressLines.has(k)) return false;
    seenAddressLines.add(k);
    return true;
  });
}
