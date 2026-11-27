// One page of the PO-from-SO picker (lib/outstanding-so-page.ts): the light list, the column funnels, the sort and
// the funnel counts. Walking every page must give back every matching line exactly once, in the chosen order.
import { describe, expect, test } from 'vitest';

import {
  buildPickerGroups, buildPickerPage, cleanSearch, compareKeys, decodeCursor, encodeCursor, facetValue, parseOutstandingSoPageQuery,
  passesTopBar, readPickerLines, type OutstandingSoPageQuery, type PickerLine, type PickerSort,
} from './outstanding-so-page';
import poRouterSrc from '../routes/mfg-purchase-orders.ts?raw';

const line = (i: number, over: Partial<PickerLine> = {}): PickerLine => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  docNo: `SO-${String(Math.floor(i / 3)).padStart(4, '0')}`,      // three lines per document: ties on doc_no
  itemCode: `CODE-${i}`, description: i === 7 ? 'Oak table' : null, itemGroup: i % 2 === 0 ? 'FURNITURE' : 'CURTAIN',
  qty: (i % 4) + 1, poQtyPicked: 0,
  soDate: '2026-11-01', processingDate: null, deliveryDate: i % 4 === 0 ? '2026-12-01' : '2026-11-20',
  debtorName: `Customer ${i % 3}`, ref: null, customerSoNo: null,
  projectCode: `P${i % 6}`, projectName: i % 6 === 5 ? null : `Project ${i % 6}`,
  mainSupplierCode: i % 2 === 0 ? 'SUP-A' : null, mainSupplierName: i % 2 === 0 ? 'Supplier A' : null,
  ...over,
});
const lines = (n: number): PickerLine[] => Array.from({ length: n }, (_, i) => line(i));

const pageOf = (over: Partial<OutstandingSoPageQuery> = {}): OutstandingSoPageQuery => ({
  groups: false, limit: 10, cursor: null, q: '', category: null, dateField: 'soDate', dateFrom: null, dateTo: null,
  supplier: null, location: null, docNo: null, colFilters: {}, sort: null, ...over,
});

function walk(all: PickerLine[], over: Partial<OutstandingSoPageQuery>) {
  const seen: string[] = [];
  let cursor: OutstandingSoPageQuery['cursor'] = null;
  let first: ReturnType<typeof buildPickerPage> | null = null;
  for (let n = 0; n < 100; n++) {
    // Through the wire format, as the screen sends it back.
    const res = buildPickerPage(all, pageOf({ ...over, cursor: cursor ? decodeCursor(encodeCursor(cursor)) : null }));
    first ??= res;
    if (n > 0) expect(res.facets).toBeNull();
    seen.push(...res.ids);
    if (!res.nextCursor) return { seen, first, pages: n + 1 };
    cursor = res.nextCursor;
  }
  throw new Error('did not finish');
}

const byId = (all: PickerLine[]) => new Map(all.map((l) => [l.id, l]));

describe('paging', () => {
  test('every line comes back once, in the whole list order, and the first page counts them all', () => {
    const all = lines(47);
    const { seen, first, pages } = walk(all, {});
    const expected = [...all].sort((a, b) => compareKeys({ d: a.docNo, i: a.id }, { d: b.docNo, i: b.id })).map((l) => l.id);
    expect(seen).toEqual(expected);
    expect(first?.total).toBe(47);
    expect(pages).toBe(5);
  });

  test.each<PickerSort>([
    { key: 'project', dir: 'asc' }, { key: 'project', dir: 'desc' }, { key: 'qty', dir: 'desc' }, { key: 'mainSupplier', dir: 'asc' },
  ])('sorted by $key $dir, every line still comes back once, in that order', (sort) => {
    const all = lines(47);
    const { seen } = walk(all, { sort });
    expect(seen).toHaveLength(47);
    expect(new Set(seen).size).toBe(47);
    const m = byId(all);
    const val = (id: string): string | number => {
      const l = m.get(id)!;
      if (sort.key === 'qty') return l.qty;
      if (sort.key === 'project') return l.projectName ?? l.projectCode ?? '';
      return l.mainSupplierName ?? '';
    };
    for (let k = 1; k < seen.length; k++) {
      const a = val(seen[k - 1]); const b = val(seen[k]);
      const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
      expect(sort.dir === 'asc' ? c <= 0 : c >= 0).toBe(true);
    }
  });

  test('a line converted between two scrolls does not shift the next page', () => {
    const all = lines(30);
    const p1 = buildPickerPage(all, pageOf());
    const gone = new Set(p1.ids.slice(-2));
    const p2 = buildPickerPage(all.filter((l) => !gone.has(l.id)), pageOf({ cursor: p1.nextCursor }));
    const full = walk(all, {}).seen;
    expect(p2.ids).toEqual(full.slice(10, 20));
  });
});

describe('project groups', () => {
  test('one group per project and customer, with matching and total counts, in heading order', () => {
    const all = lines(60);
    const res = buildPickerGroups(all, pageOf());
    expect(res.groups.reduce((n, g) => n + g.total, 0)).toBe(60);
    expect(res.groups.every((g) => g.matching === g.total)).toBe(true);
    const headings = res.groups.map((g) => g.heading);
    expect(headings).toEqual([...headings].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(headings).toContain('Project 0 - Customer 0');
    expect(headings).toContain('P5 - Customer 2');
  });

  test("a group's two funnel texts read exactly its lines from the page endpoint", () => {
    const all = lines(60);
    for (const g of buildPickerGroups(all, pageOf()).groups) {
      const page = buildPickerPage(all, pageOf({ limit: 200, colFilters: { project: [g.project], debtorName: [g.customer] } }));
      expect(page.total).toBe(g.total);
    }
  });

  test('filters narrow matching, keep total, and drop empty groups', () => {
    const all = lines(60);
    const res = buildPickerGroups(all, pageOf({ category: 'FURNITURE' }));
    expect(res.groups.every((g) => g.matching <= g.total)).toBe(true);
    expect(res.groups.reduce((n, g) => n + g.matching, 0)).toBe(30);
    expect(buildPickerGroups(all, pageOf({ q: 'nothing at all' })).groups).toEqual([]);
  });

  test('supplier and category choices ignore their own filter', () => {
    const all = lines(60);
    const bySupplier = buildPickerGroups(all, pageOf({ supplier: 'SUP-A' }));
    expect(bySupplier.suppliers).toEqual([['SUP-A', 'Supplier A', 30]]);
    expect(bySupplier.categories).toEqual([['FURNITURE', 30]]);
    const byCategory = buildPickerGroups(all, pageOf({ category: 'CURTAIN' }));
    expect(byCategory.categories).toEqual([['CURTAIN', 30], ['FURNITURE', 30]]);
    expect(byCategory.suppliers).toEqual([]);
  });

  test('groups=1 asks for groups without a limit; no limit and no groups is still the whole list', () => {
    const r = parseOutstandingSoPageQuery({ groups: '1', category: 'SOFA' });
    expect(r.ok && r.page?.groups).toBe(true);
    expect(r.ok && r.page?.category).toBe('SOFA');
    expect(parseOutstandingSoPageQuery({})).toEqual({ ok: true, page: null });
  });
});

describe('column funnels run over every line, not the loaded page', () => {
  test('a project that sits on the last page is offered and filtered from the first request', () => {
    const all = lines(300);
    const last = { ...line(999), docNo: 'SO-0000', projectName: 'Far Away' };   // sorts last
    const res = buildPickerPage([...all, last], pageOf({ colFilters: { project: ['Far Away'] } }));
    expect(res.ids).toEqual([last.id]);
    expect(res.total).toBe(1);
    const open = buildPickerPage([...all, last], pageOf());
    expect(open.facets?.project).toContainEqual(['Far Away', 1]);
  });

  test("each funnel counts under the others' filters, never its own", () => {
    const all = lines(60);
    const res = buildPickerPage(all, pageOf({ colFilters: { project: ['Project 0'] } }));
    // Project's own funnel still lists every project, so a second one can be ticked.
    expect(res.facets?.project.map(([v]) => v)).toEqual(['P5', 'Project 0', 'Project 1', 'Project 2', 'Project 3', 'Project 4']);
    // Supplier's funnel only counts Project 0's lines (i % 6 === 0: all even, all Supplier A).
    expect(res.facets?.mainSupplier).toEqual([['Supplier A', 10]]);
    expect(res.total).toBe(10);
  });

  test('counts respect the search and the top-bar filters', () => {
    const res = buildPickerPage(lines(60), pageOf({ category: 'FURNITURE' }));
    expect(res.facets?.itemGroup).toEqual([['FURNITURE', 30]]);
    expect(res.total).toBe(30);
  });

  test('a funnel value is the text the grid filters on, blanks included', () => {
    const blank = line(1, {
      projectName: null, projectCode: null, debtorName: null, itemGroup: null, description: '',
      mainSupplierCode: null, mainSupplierName: null, ref: null, customerSoNo: '  C-9 ',
    });
    expect(facetValue(blank, 'project')).toBe('(none)');
    expect(facetValue(blank, 'debtorName')).toBe('(none)');
    expect(facetValue({ ...blank, debtorName: '' }, 'debtorName')).toBe('—');
    expect(facetValue(blank, 'itemGroup')).toBe('(NONE)');
    expect(facetValue({ ...blank, itemGroup: 'sofa' }, 'itemGroup')).toBe('SOFA');
    expect(facetValue(blank, 'mainSupplier')).toBe('(none)');
    expect(facetValue({ ...blank, mainSupplierCode: 'S1' }, 'mainSupplier')).toBe('S1');
    expect(facetValue(blank, 'description')).toBe('—');
    expect(facetValue(blank, 'soRef')).toBe('C-9');
    expect(facetValue({ ...blank, customerSoNo: null }, 'soRef')).toBe('—');
    expect(facetValue({ ...blank, projectCode: ' P9 ' }, 'project')).toBe('P9');
  });
});

describe('top bar', () => {
  test('search reads the line, the customer, the ref and the project', () => {
    const l = line(4, { ref: 'REF-77', projectName: 'Aster Hill' });
    expect(passesTopBar(l, pageOf({ q: 'aster' }))).toBe(true);
    expect(passesTopBar(l, pageOf({ q: 'ref-77' }))).toBe(true);
    expect(passesTopBar(l, pageOf({ q: 'customer 1' }))).toBe(true);
    expect(passesTopBar(l, pageOf({ q: 'nothing' }))).toBe(false);
  });
  test('the date filter reads the field the screen picked', () => {
    const l = line(0);
    expect(passesTopBar(l, pageOf({ dateField: 'delivery', dateTo: '2026-11-30' }))).toBe(false);   // line date 12-01
    expect(passesTopBar(l, pageOf({ dateField: 'processing', dateFrom: '2026-01-01' }))).toBe(false); // no processing date
    expect(passesTopBar(l, pageOf({ dateField: 'soDate', dateFrom: '2026-11-01', dateTo: '2026-11-01' }))).toBe(true);
  });
});

describe('parameters', () => {
  test('no limit means the whole list, unchanged', () => {
    expect(parseOutstandingSoPageQuery({})).toEqual({ ok: true, page: null });
  });
  test('limit is capped, a forged cursor is refused, a good one round-trips', () => {
    const r = parseOutstandingSoPageQuery({ limit: '5000', cursor: encodeCursor({ d: 'SO-"1"', i: 'x', s: 'Aster' }), category: 'all', dateFrom: 'nope' });
    expect(r.ok && r.page?.limit).toBe(200);
    expect(r.ok && r.page?.cursor).toEqual({ d: 'SO-"1"', i: 'x', s: 'Aster' });
    expect(r.ok && r.page?.category).toBeNull();
    expect(r.ok && r.page?.dateFrom).toBeNull();
    expect(parseOutstandingSoPageQuery({ limit: '10', cursor: '%%%' }).ok).toBe(false);
    expect(decodeCursor(encodeCursor({ d: 'ü', i: '1' }))).toEqual({ d: 'ü', i: '1' });
  });
  test('column funnels and sort are read; unknown columns and condition tokens are left to the grid', () => {
    const r = parseOutstandingSoPageQuery({
      limit: '10', sort: 'project:desc',
      cols: JSON.stringify({ project: ['A', '\u0001gt:3'], lineStatus: ['x'], debtorName: [] }),
    });
    expect(r.ok && r.page?.colFilters).toEqual({ project: ['A'] });
    expect(r.ok && r.page?.sort).toEqual({ key: 'project', dir: 'desc' });
    const bad = parseOutstandingSoPageQuery({ limit: '10', sort: 'lineValue:asc' });
    expect(bad.ok && bad.page?.sort).toBeNull();
    expect(parseOutstandingSoPageQuery({ limit: '10', cols: '[1]' }).ok).toBe(false);
    expect(parseOutstandingSoPageQuery({ limit: '10', cols: '{' }).ok).toBe(false);
  });
  test('search text cannot inject PostgREST syntax', () => {
    expect(cleanSearch(' a*b%"c\\d  ')).toBe('a b c d');
  });
});

describe('readPickerLines', () => {
  type Row = Record<string, unknown>;
  function fakeSb(tables: Record<string, Row[]>, log: string[]) {
    class Q {
      constructor(private table: string) {}
      schema() { return this; }
      from(t: string) { return new Q(t); }
      select() { return this; }
      eq(col: string) { log.push(`${this.table}.eq ${col}`); return this; }
      not(col: string, op: string, v: unknown) { log.push(`${this.table}.not ${col} ${op} ${String(v)}`); return this; }
      gte(col: string) { log.push(`${this.table}.gte ${col}`); return this; }
      lte(col: string) { log.push(`${this.table}.lte ${col}`); return this; }
      in() { return this; }
      filter() { return this; }
      order() { return this; }
      range() { return this; }
      then<R>(ok: (v: { data: Row[]; error: null }) => R) { return Promise.resolve(ok({ data: tables[this.table] ?? [], error: null })); }
    }
    return new Q('root');
  }
  const head = { debtor_name: 'Ann', so_date: '2026-11-01', customer_delivery_date: '2026-11-20', processing_date: null, ref: null, customer_so_no: null };

  test('joins the project and the main supplier, and drops lines the picker never offers', async () => {
    const log: string[] = [];
    const sb = fakeSb({
      mfg_sales_order_items: [
        { id: 'a', doc_no: 'SO-1', item_code: 'TV', description: null, item_group: 'APPLIANCE', qty: '2', po_qty_picked: null, line_delivery_date: null, so: { ...head, project_id: 9 } },
        { id: 'b', doc_no: 'SO-1', item_code: 'RENO-PAINT', description: null, item_group: 'WORKS', qty: 1, po_qty_picked: 0, line_delivery_date: null, so: { ...head, project_id: null } },
      ],
      projects: [{ id: 9, code: 'KL48', name: 'KL 48 B-2' }],
      supplier_material_bindings: [{ item_code: 'TV', supplier: { code: 'S1', name: 'Hisense' } }],
    }, log);
    const res = await readPickerLines(sb, (q) => q, 1, { ...pageOf(), dateFrom: '2026-11-01' });
    expect(res.error).toBeNull();
    expect(res.lines).toEqual([expect.objectContaining({
      id: 'a', qty: 2, poQtyPicked: 0, projectName: 'KL 48 B-2', mainSupplierCode: 'S1', mainSupplierName: 'Hisense', deliveryDate: '2026-11-20',
    })]);
    expect(log).toContain('mfg_sales_order_items.not so.status in (CANCELLED,DRAFT,ON_HOLD)');
    expect(log).toContain('mfg_sales_order_items.not so.on_hold is true');
    expect(log).toContain('mfg_sales_order_items.gte so.so_date');
  });
});

describe('wiring', () => {
  test('the route builds the page from the light list and limits the stock check to the page', () => {
    expect(poRouterSrc).toContain('readPickerLines');
    expect(poRouterSrc).toContain('buildPickerPage(index.lines, page)');
    expect(poRouterSrc).toContain('startPickerMrp(c, codes, picked.ids)');
    expect(poRouterSrc).toContain('startPickerMrp(c, null)');
    expect(poRouterSrc).toContain('facets: picked.facets');
  });
});
