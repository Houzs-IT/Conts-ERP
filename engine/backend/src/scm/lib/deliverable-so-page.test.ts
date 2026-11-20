import { describe, expect, it } from 'vitest';
import { BROWSE_SKIP_STATUSES, mergeCandidateDocs, parseDeliverablePageQuery, readCandidateDocs, takeWholeOrders } from './deliverable-so-page';

describe('parseDeliverablePageQuery', () => {
  it('no limit = the whole list as before', () => {
    expect(parseDeliverablePageQuery({})).toBeNull();
  });
  it('limit is capped, the search cleaned, the cursor kept', () => {
    expect(parseDeliverablePageQuery({ limit: '999', cursor: 'SO-0100', q: ' a*b ' })).toEqual({ limit: 200, cursor: 'SO-0100', q: 'a b' });
  });
});

describe('takeWholeOrders: a page holds whole orders', () => {
  const l = (docNo: string, id: string) => ({ docNo, soItemId: id });
  it('stops after the order that fills the page, never in the middle of one', () => {
    const lines = [l('SO-3', 'a'), l('SO-3', 'b'), l('SO-2', 'c'), l('SO-2', 'd'), l('SO-1', 'e')];
    const r = takeWholeOrders(['SO-3', 'SO-2', 'SO-1'], lines, 3);
    expect(r.lines.map((x) => x.soItemId)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.lastDoc).toBe('SO-2');
    expect(r.more).toBe(true);
  });
  it('an order with nothing left adds no line but still moves the cursor', () => {
    const r = takeWholeOrders(['SO-3', 'SO-2'], [l('SO-2', 'c')], 10);
    expect(r).toEqual({ lines: [l('SO-2', 'c')], lastDoc: 'SO-2', more: false });
  });
});

describe('mergeCandidateDocs: header and line matches merged by keyset', () => {
  it('cuts at the highest floor so no doc between two kept ones can be missing', () => {
    const r = mergeCandidateDocs([
      { docs: ['SO-9', 'SO-7', 'SO-5'], floor: 'SO-5' },
      { docs: ['SO-8', 'SO-6', 'SO-3'], floor: 'SO-4' },
    ], 10);
    expect(r.docs).toEqual(['SO-9', 'SO-8', 'SO-7', 'SO-6', 'SO-5']);
    expect(r.more).toBe(true);
    expect(r.scannedTo).toBe('SO-5');
  });
  it('no source read to its limit: everything is in, nothing more', () => {
    expect(mergeCandidateDocs([{ docs: ['SO-2'], floor: null }, { docs: ['SO-1'], floor: null }], 10))
      .toEqual({ docs: ['SO-2', 'SO-1'], more: false, scannedTo: 'SO-1' });
  });
  it('a line read whose orders all failed the header check still moves the scan on', () => {
    expect(mergeCandidateDocs([{ docs: [], floor: null }, { docs: [], floor: 'SO-4' }], 10))
      .toEqual({ docs: [], more: true, scannedTo: 'SO-4' });
  });
  it('more than n: the first n, and the scan stops at the nth', () => {
    expect(mergeCandidateDocs([{ docs: ['SO-3', 'SO-2', 'SO-1'], floor: null }], 2))
      .toEqual({ docs: ['SO-3', 'SO-2'], more: true, scannedTo: 'SO-2' });
  });
});

/* A recording stand-in for the PostgREST builder: every call is logged, and the read answers `rows[table]`. */
function fakeSb(rows: Record<string, Array<{ doc_no: string }>>) {
  const log: string[] = [];
  const builder = (table: string): unknown => {
    const b: unknown = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: (v: unknown) => void) => res({ data: rows[table] ?? [], error: null });
        return (...args: unknown[]) => { log.push(`${table}.${prop}(${args.map((a) => JSON.stringify(a)).join(',')})`); return b; };
      },
    });
    return b;
  };
  return { sb: { from: (t: string) => builder(t) }, log };
}

const noCompany = { get: () => undefined } as never;

describe('readCandidateDocs', () => {
  it('the browse skips orders whose status says nothing is left, newest first after the cursor', async () => {
    const { sb, log } = fakeSb({ mfg_sales_orders: [{ doc_no: 'SO-5' }, { doc_no: 'SO-4' }] });
    const r = await readCandidateDocs(sb, noCompany, { after: 'SO-6', q: '', n: 2 });
    expect(r.docs).toEqual(['SO-5', 'SO-4']);
    expect(r.more).toBe(true);
    expect(log).toContain(`mfg_sales_orders.not("status","in","(${BROWSE_SKIP_STATUSES.join(',')})")`);
    expect(log).toContain('mfg_sales_orders.lt("doc_no","SO-6")');
    expect(log).toContain('mfg_sales_orders.order("doc_no",{"ascending":false})');
  });
  it('a search skips only cancelled orders and also matches lines', async () => {
    const { sb, log } = fakeSb({ mfg_sales_orders: [{ doc_no: 'SO-2' }], mfg_sales_order_items: [{ doc_no: 'SO-2' }] });
    const r = await readCandidateDocs(sb, noCompany, { after: null, q: 'MAT', n: 25 });
    expect(r.docs).toEqual(['SO-2']);
    expect(r.more).toBe(false);
    expect(log).toContain('mfg_sales_orders.neq("status","CANCELLED")');
    expect(log.some((x) => x.startsWith('mfg_sales_order_items.or(') && x.includes('item_code.ilike.%MAT%'))).toBe(true);
  });
});
