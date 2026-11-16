/* Which page of a scanned PDF to read next, and which are skipped (chew, 16 Nov 2026: a Unifi bill's 5 pages, only the
   first is to be read). A bill prints its page ("Page 1 of 5", TNB's "ms 1 / 2"); once its first page is read, its other pages are
   not read at all. So a page of a PDF waits until the page before it is read; different PDFs are still read side by
   side. Pure, so node --test runs it. */

export interface ScanPage { key: string; file: unknown; pageNo: number; state: string }

/** The next page to read: the first waiting one whose earlier pages in the same PDF are all read (or skipped). */
export function nextToRead<R extends ScanPage>(rows: R[]): R | undefined {
  return rows.find(r => r.state === 'waiting'
    && !rows.some(o => o.file === r.file && o.pageNo < r.pageNo && (o.state === 'waiting' || o.state === 'reading')));
}

/** The pages not to record or read after `row` was read: the row itself when it is a later page of a bill ("Page 3 of
 *  5"), else, when it is page 1 of a bill of several, that bill's other pages in the same PDF. */
export function pagesToSkip<R extends ScanPage>(row: R, read: { pageNo?: number | null; pageCount?: number | null }, rows: R[]): string[] {
  if (read.pageNo != null && read.pageNo > 1) return [row.key];
  if (read.pageNo === 1 && read.pageCount != null && read.pageCount > 1) {
    const last = row.pageNo + read.pageCount - 1;
    return rows.filter(o => o.file === row.file && o.pageNo > row.pageNo && o.pageNo <= last && o.state !== 'recorded').map(o => o.key);
  }
  return [];
}
