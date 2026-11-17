// Conts only (not part of Houzs's code): which payment vouchers pay a payment request. A voucher made for one request
// names it (payment_vouchers.payment_request_id, migration 0178); a voucher paying several requests and staff claims at
// once (chew, 16 Nov 2026; combined-voucher.ts) names each on its own lines (payment_voucher_lines.payment_request_id,
// migration 0330). Every reader that asks "what pays this request" asks here, so both kinds count alike.

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the modules it sits beside */
type Db = any;
export type PvRef = { id: string; pv_number: string; status: string; submitted_at: string | null; payment_request_id: string | null };
type PvLineRef = { pv_id: string; payment_request_id: string | null; amount_sen: number; project_id?: number | null };

const PV_COLS = 'id, pv_number, status, submitted_at, payment_request_id';
const CHUNK = 150;

async function inParts<T>(ids: string[], read: (part: string[]) => PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw new Error(String(error.message ?? error));
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/** The vouchers paying each request, and every line of them that pays it: on a voucher naming the request, its lines
 *  naming no other request; on any voucher, its lines naming the request. */
export async function requestPayments(sb: Db, requestIds: string[]): Promise<{
  vouchers: Map<string, PvRef[]>; lines: Map<string, Array<PvLineRef & { pv: PvRef }>>;
}> {
  const ids = [...new Set(requestIds)];
  const vouchers = new Map<string, PvRef[]>();
  const lines = new Map<string, Array<PvLineRef & { pv: PvRef }>>();
  if (ids.length === 0) return { vouchers, lines };
  const named = await inParts<PvRef>(ids, part => sb.from('payment_vouchers').select(PV_COLS).in('payment_request_id', part));
  const lineHits = await inParts<PvLineRef>(ids, part => sb.from('payment_voucher_lines').select('pv_id, payment_request_id, amount_sen, project_id').in('payment_request_id', part));
  const known = new Map(named.map(p => [p.id, p]));
  const missing = [...new Set(lineHits.map(l => l.pv_id))].filter(id => !known.has(id));
  for (const p of await inParts<PvRef>(missing, part => sb.from('payment_vouchers').select(PV_COLS).in('id', part))) known.set(p.id, p);
  /* A voucher naming one request: its lines naming no request are that request's (every voucher before 0330). */
  const ownLines = await inParts<PvLineRef>(named.map(p => p.id), part => sb.from('payment_voucher_lines').select('pv_id, payment_request_id, amount_sen, project_id').in('pv_id', part));
  const add = (q: string, l: PvLineRef, pv: PvRef) => {
    lines.set(q, [...(lines.get(q) ?? []), { ...l, pv }]);
    const vs = vouchers.get(q) ?? [];
    if (!vs.some(v => v.id === pv.id)) vouchers.set(q, [...vs, pv]);
  };
  for (const l of ownLines) {
    const pv = known.get(l.pv_id);
    if (!pv) continue;
    if (l.payment_request_id) continue; // counted below, by the request it names
    if (pv.payment_request_id) add(pv.payment_request_id, l, pv);
  }
  for (const l of lineHits) {
    const pv = known.get(l.pv_id);
    if (pv && l.payment_request_id) add(l.payment_request_id, l, pv);
  }
  /* A voucher naming the request with no lines read yet (none at all) still pays it. */
  for (const pv of named) {
    if (!pv.payment_request_id) continue;
    const vs = vouchers.get(pv.payment_request_id) ?? [];
    if (!vs.some(v => v.id === pv.id)) vouchers.set(pv.payment_request_id, [...vs, pv]);
  }
  return { vouchers, lines };
}

/** What each request's posted vouchers have paid it. */
export async function postedPaid(sb: Db, requestIds: string[]): Promise<Map<string, number>> {
  const { lines } = await requestPayments(sb, requestIds);
  const out = new Map<string, number>();
  for (const [q, ls] of lines) out.set(q, ls.filter(l => l.pv.status === 'POSTED').reduce((n, l) => n + Number(l.amount_sen), 0));
  return out;
}
