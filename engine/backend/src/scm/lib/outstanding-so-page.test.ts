// One page of the PO-from-SO picker (lib/outstanding-so-page.ts). The fake below honours the keyset cursor, the row
// window and the search terms it is sent, so walking every page must give back every line exactly once, in the order
// of the whole list.
import { describe, expect, test } from 'vitest';

import {
  compareKeys, cleanSearch, decodeCursor, encodeCursor, parseOutstandingSoPageQuery, passesPageFilters,
  readOutstandingSoCandidates, type OutstandingSoPageQuery,
} from './outstanding-so-page';
import poRouterSrc from '../routes/mfg-purchase-orders.ts?raw';

type Line = {
  id: string; doc_no: string; item_code: string; description: string | null; item_group: string | null;
  line_delivery_date: string | null;
  so: { status: string; on_hold: boolean | null; so_date: string | null; processing_date: string | null; customer_delivery_date: string | null; debtor_name: string | null };
};

const unq = (v: string) => v.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

function fakeSb(lines: Line[], heads: Array<{ doc_no: string; debtor_name: string }>, log: string[]) {
  class Q {
    private table: string;
    private rows: Array<Record<string, unknown>>;
    private orFilter: string | null = null;
    private win: [number, number] = [0, 999];
    private counting = false;
    private eqs: Array<[string, unknown]> = [];
    constructor(table: string, rows: Array<Record<string, unknown>>) { this.table = table; this.rows = rows; }
    schema() { return this; }
    from(t: string) { return new Q(t, t === 'mfg_sales_orders' ? heads : t === 'projects' ? [] : (lines as never)); }
    select(_c: string, o?: { count?: string }) { this.counting = o?.count === 'exact'; return this; }
    eq(col: string, v: unknown) { this.eqs.push([col, v]); log.push(`${this.table}.eq ${col}`); return this; }
    not(col: string, op: string, v: unknown) { log.push(`${this.table}.not ${col} ${op} ${String(v)}`); return this; }
    gte(col: string) { log.push(`${this.table}.gte ${col}`); return this; }
    lte(col: string) { log.push(`${this.table}.lte ${col}`); return this; }
    or(f: string) { this.orFilter = f; log.push(`${this.table}.or ${f}`); return this; }
    order() { return this; }
    range(a: number, b: number) { this.win = [a, b]; return this; }
    private matches(r: Record<string, unknown>): boolean {
      for (const [col, v] of this.eqs) if (col === 'doc_no' && r[col] !== v) return false;
      const f = this.orFilter;
      if (!f) return true;
      const ks = /doc_no\.lt\.("(?:[^"\\]|\\.)*"),and\(doc_no\.eq\.("(?:[^"\\]|\\.)*"),id\.gt\.("(?:[^"\\]|\\.)*")\)/.exec(f);
      if (ks) {
        const d = unq(ks[1]); const i = unq(ks[3]);
        if (!(String(r.doc_no) < d || (r.doc_no === d && String(r.id) > i))) return false;
      }
      const like = /ilike\."\*([^*]*)\*"/.exec(f);
      if (like) {
        const t = like[1].toLowerCase();
        const docs = /doc_no\.in\.\(([^)]*)\)/.exec(f)?.[1].split(',').map(unq) ?? [];
        const cols = this.table === 'mfg_sales_orders' ? ['debtor_name'] : ['doc_no', 'item_code', 'description'];
        const hit = cols.some((c) => String(r[c] ?? '').toLowerCase().includes(t)) || docs.includes(String(r.doc_no));
        if (!hit) return false;
      }
      return true;
    }
    then<R>(ok: (v: { data: unknown[]; error: null; count: number | null }) => R) {
      const all = this.rows.filter((r) => this.matches(r))
        .sort((a, b) => compareKeys({ d: String(a.doc_no), i: String(a.id ?? '') }, { d: String(b.doc_no), i: String(b.id ?? '') }));
      return Promise.resolve(ok({ data: all.slice(this.win[0], this.win[1] + 1), error: null, count: this.counting ? all.length : null }));
    }
  }
  return new Q('root', []);
}

const so = (over: Partial<Line['so']> = {}): Line['so'] => ({
  status: 'CONFIRMED', on_hold: false, so_date: '2026-11-01', processing_date: null, customer_delivery_date: null, debtor_name: null, ...over,
});

function lines(n: number): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      doc_no: `SO-${String(Math.floor(i / 3)).padStart(4, '0')}`,      // three lines per document: ties on doc_no
      item_code: i % 5 === 0 ? 'CHAIR' : `CODE-${i}`,
      description: i === 7 ? 'Oak table' : null,
      item_group: i % 2 === 0 ? 'FURNITURE' : 'WORKS',
      line_delivery_date: i % 4 === 0 ? '2026-12-01' : null,
      so: so({ customer_delivery_date: '2026-11-20' }),
    });
  }
  return out;
}

const pageOf = (over: Partial<OutstandingSoPageQuery> = {}): OutstandingSoPageQuery => ({
  limit: 10, cursor: null, q: '', category: null, dateField: 'soDate', dateFrom: null, dateTo: null,
  supplier: null, location: null, docNo: null, ...over,
});

async function walk(all: Line[], over: Partial<OutstandingSoPageQuery>, heads: Array<{ doc_no: string; debtor_name: string }> = []) {
  const seen: string[] = [];
  let cursor: OutstandingSoPageQuery['cursor'] = null;
  let total: number | null = null;
  for (let n = 0; n < 100; n++) {
    const res: Awaited<ReturnType<typeof readOutstandingSoCandidates<Line>>> = await readOutstandingSoCandidates<Line>(fakeSb(all, heads, []), (q) => q, 1, pageOf({ ...over, cursor }));
    expect(res.error).toBeNull();
    if (n === 0) total = res.total;
    seen.push(...res.rows.map((r) => r.id));
    if (!res.nextCursor) return { seen, total, pages: n + 1 };
    cursor = res.nextCursor;
  }
  throw new Error('did not finish');
}

describe('paging', () => {
  test('every line comes back exactly once, in the whole list order, with the first page counting them', async () => {
    const all = lines(47);
    const { seen, total, pages } = await walk(all, {});
    const expected = [...all].sort((a, b) => compareKeys({ d: a.doc_no, i: a.id }, { d: b.doc_no, i: b.id })).map((r) => r.id);
    expect(seen).toEqual(expected);
    expect(total).toBe(47);
    expect(pages).toBe(5);
  });

  test('a JavaScript-only filter (category, delivery date) still walks every matching line', async () => {
    const all = lines(47);
    const { seen } = await walk(all, { category: 'FURNITURE', dateField: 'delivery', dateFrom: '2026-11-25' });
    const expected = all.filter((r) => r.item_group === 'FURNITURE' && (r.line_delivery_date ?? r.so.customer_delivery_date)! >= '2026-11-25')
      .sort((a, b) => compareKeys({ d: a.doc_no, i: a.id }, { d: b.doc_no, i: b.id })).map((r) => r.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(seen).toEqual(expected);
  });

  test('search matches line columns and the customer on the SO header', async () => {
    const all = lines(30);
    const heads = [{ doc_no: 'SO-0002', debtor_name: 'Oakley Sdn Bhd' }];
    const { seen } = await walk(all, { q: 'oak' }, heads);
    const expected = all.filter((r) => r.description === 'Oak table' || r.doc_no === 'SO-0002')
      .sort((a, b) => compareKeys({ d: a.doc_no, i: a.id }, { d: b.doc_no, i: b.id })).map((r) => r.id);
    expect(seen).toEqual(expected);
    expect(seen.length).toBe(3);   // line 7 is on SO-0002 too, so one document's three lines
  });

  test('the status and hold gates go to the database, not after a cap', async () => {
    const log: string[] = [];
    await readOutstandingSoCandidates<Line>(fakeSb(lines(5), [], log), (q) => q, 1, pageOf({ dateFrom: '2026-01-01' }));
    expect(log).toContain('mfg_sales_order_items.eq cancelled');
    expect(log).toContain('mfg_sales_order_items.not so.status in (CANCELLED,DRAFT,ON_HOLD)');
    expect(log).toContain('mfg_sales_order_items.not so.on_hold is true');
    expect(log).toContain('mfg_sales_order_items.gte so.so_date');
  });
});

describe('parameters', () => {
  test('no limit means the whole list, unchanged', () => {
    expect(parseOutstandingSoPageQuery({})).toEqual({ ok: true, page: null });
  });
  test('limit is capped, a forged cursor is refused, a good one round-trips', () => {
    const r = parseOutstandingSoPageQuery({ limit: '5000', cursor: encodeCursor({ d: 'SO-"1"', i: 'x' }), category: 'all', dateFrom: 'nope' });
    expect(r.ok && r.page?.limit).toBe(200);
    expect(r.ok && r.page?.cursor).toEqual({ d: 'SO-"1"', i: 'x' });
    expect(r.ok && r.page?.category).toBeNull();
    expect(r.ok && r.page?.dateFrom).toBeNull();
    expect(parseOutstandingSoPageQuery({ limit: '10', cursor: '%%%' }).ok).toBe(false);
    expect(decodeCursor(encodeCursor({ d: 'ü', i: '1' }))).toEqual({ d: 'ü', i: '1' });
  });
  test('search text cannot inject PostgREST syntax', () => {
    expect(cleanSearch(' a*b%"c\\d  ')).toBe('a b c d');
  });
  test('the date filter reads the field the screen picked', () => {
    const r = lines(1)[0];
    expect(passesPageFilters(r, pageOf({ dateField: 'delivery', dateTo: '2026-11-30' }))).toBe(false);   // line date 12-01 wins
    expect(passesPageFilters(r, pageOf({ dateField: 'processing', dateFrom: '2026-01-01' }))).toBe(false); // no processing date
  });
});

describe('wiring', () => {
  test('the route offers the paged mode and limits the stock check to the page codes', () => {
    expect(poRouterSrc).toContain('readOutstandingSoCandidates');
    expect(poRouterSrc).toContain('startPickerMrp(c, codes, cand.rows.map((r) => r.id))');
    expect(poRouterSrc).toContain('startPickerMrp(c, null)');
  });
});
