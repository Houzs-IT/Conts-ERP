import { describe, expect, it } from 'vitest';
import { DOC_BATCH, distinctCapped, docSearchOr, parseDocPageQuery, readDocPage, takeWholeDocs, type DocBatch } from './doc-batch-page';
import { makeDocBatchReader } from './purchase-picker-docs';

describe('parseDocPageQuery', () => {
  it('no limit = the whole list as before', () => {
    expect(parseDocPageQuery({})).toBeNull();
    expect(parseDocPageQuery({ limit: '' })).toBeNull();
  });
  it('caps the limit, cleans the search, keeps the cursor', () => {
    expect(parseDocPageQuery({ limit: '999', cursor: ' PO-0100 ', q: ' a*b ' })).toEqual({ limit: 200, cursor: 'PO-0100', q: 'a b' });
  });
  it('a nonsense limit falls back to the default page', () => {
    expect(parseDocPageQuery({ limit: 'x' })?.limit).toBe(100);
  });
});

describe('docSearchOr', () => {
  it('number text, supplier ids and line-matched ids in one or()', () => {
    expect(docSearchOr('po_number', 'sofa', ['s1'], ['p1', 'p2']))
      .toBe('po_number.ilike.%sofa%,supplier_id.in.(s1),id.in.(p1,p2)');
  });
  it('reserved characters cannot break the filter grammar', () => {
    expect(docSearchOr('grn_number', 'A(1),B', [], [])).toBe('grn_number.ilike.%A_1__B%');
  });
});

describe('distinctCapped', () => {
  it('keeps first-seen order, drops blanks and repeats, stops at the cap', () => {
    expect(distinctCapped(['a', null, 'b', 'a', '', 'c', 'd'], 3)).toEqual(['a', 'b', 'c']);
  });
});

describe('takeWholeDocs: a page holds whole documents', () => {
  const l = (doc: string, id: string) => ({ doc, id });
  it('stops after the document that fills the page, never inside one', () => {
    const r = takeWholeDocs(['P3', 'P2', 'P1'], [l('P3', 'a'), l('P3', 'b'), l('P2', 'c'), l('P2', 'd'), l('P1', 'e')], (x) => x.doc, 3);
    expect(r.lines.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.lastDoc).toBe('P2');
    expect(r.more).toBe(true);
  });
  it('a document with nothing left still moves the cursor past it', () => {
    const r = takeWholeDocs(['P3', 'P2'], [l('P2', 'c')], (x) => x.doc, 5);
    expect(r).toEqual({ lines: [l('P2', 'c')], lastDoc: 'P2', more: false });
  });
});

/** A fake list of documents, newest first, each with `lines` lines left. */
function fakeDocs(n: number, linesEach: (i: number) => number) {
  const docs = Array.from({ length: n }, (_, i) => `D${String(n - i).padStart(4, '0')}`);
  const lineCount = new Map(docs.map((d, i) => [d, linesEach(i)]));
  const reads: Array<string | null> = [];
  const readBatch = async (after: string | null, size: number): Promise<DocBatch> => {
    reads.push(after);
    const rest = after ? docs.filter((d) => d < after) : docs;
    const batch = rest.slice(0, size);
    return { docs: batch, more: batch.length >= size, error: null };
  };
  const linesFor = async (batch: string[]) => ({
    lines: batch.flatMap((d) => Array.from({ length: lineCount.get(d) ?? 0 }, (_, k) => ({ doc: d, k }))),
    error: null,
  });
  return { docs, readBatch, linesFor, reads };
}

describe('readDocPage', () => {
  it('walks every document exactly once across pages, newest first', async () => {
    const f = fakeDocs(130, (i) => (i % 3 === 0 ? 0 : 2));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof readDocPage<{ doc: string; k: number }>>> =
        await readDocPage({ limit: 20, cursor, readBatch: f.readBatch, linesFor: f.linesFor, docOf: (l) => l.doc });
      expect(page.error).toBeNull();
      seen.push(...page.lines.map((l) => `${l.doc}/${l.k}`));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 100);
    const expected = f.docs.flatMap((d, i) => (i % 3 === 0 ? [] : [`${d}/0`, `${d}/1`]));
    expect(seen).toEqual(expected);
  });

  it('reads at most two batches per request, and a short page still says there is more', async () => {
    const f = fakeDocs(200, () => 0);
    const page = await readDocPage({ limit: 50, cursor: null, readBatch: f.readBatch, linesFor: f.linesFor, docOf: (l: { doc: string }) => l.doc });
    expect(f.reads.length).toBe(2);
    expect(page.lines).toEqual([]);
    expect(page.nextCursor).toBe(f.docs[DOC_BATCH * 2 - 1]);
  });

  it('the end of the list answers no cursor', async () => {
    const f = fakeDocs(3, () => 1);
    const page = await readDocPage({ limit: 50, cursor: null, readBatch: f.readBatch, linesFor: f.linesFor, docOf: (l: { doc: string }) => l.doc });
    expect(page.lines.length).toBe(3);
    expect(page.nextCursor).toBeNull();
  });

  it('a failed read is reported, not answered as an empty page', async () => {
    const page = await readDocPage({
      limit: 10, cursor: null,
      readBatch: async () => ({ docs: [], more: false, error: 'boom' }),
      linesFor: async () => ({ lines: [], error: null }),
      docOf: (l: { doc: string }) => l.doc,
    });
    expect(page).toEqual({ lines: [], nextCursor: null, error: 'boom' });
  });
});

describe('makeDocBatchReader', () => {
  /** Records the PostgREST calls a read makes. */
  function fakeBase(rows: Array<{ id: string; po_number: string }>) {
    const calls: Array<[string, unknown[]]> = [];
    const q: Record<string, unknown> = {};
    for (const m of ['or', 'lt', 'order']) q[m] = (...a: unknown[]) => { calls.push([m, a]); return q; };
    q.limit = async (n: number) => { calls.push(['limit', [n]]); return { data: rows.slice(0, n), error: null }; };
    return { base: () => q, calls };
  }

  it('reads below the cursor, newest first, and maps numbers to ids', async () => {
    const f = fakeBase([{ id: 'u2', po_number: 'PO-2' }, { id: 'u1', po_number: 'PO-1' }]);
    const r = makeDocBatchReader({ base: f.base, numberCol: 'po_number', q: '', matches: null });
    const batch = await r.read('PO-3', 2);
    expect(batch).toEqual({ docs: ['PO-2', 'PO-1'], more: true, error: null });
    expect(r.idOf.get('PO-1')).toBe('u1');
    expect(f.calls).toEqual([['lt', ['po_number', 'PO-3']], ['order', ['po_number', { ascending: false }]], ['limit', [2]]]);
  });

  it('a search filters the header read by number, supplier and line matches', async () => {
    const f = fakeBase([{ id: 'u1', po_number: 'PO-1' }]);
    const r = makeDocBatchReader({ base: f.base, numberCol: 'po_number', q: 'PO', matches: { supplierIds: ['s1'], docIds: ['u9'], error: null } });
    expect((await r.read(null, 5)).docs).toEqual(['PO-1']);
    expect(f.calls[0]).toEqual(['or', ['po_number.ilike.%PO%,supplier_id.in.(s1),id.in.(u9)']]);
  });
});
