/** Reading spreadsheet exports in the browser, with no library: CSV (RFC 4180) and .xlsx (a zip of XML).
 *  Used by the HostPlatform import screen and by scripts/api-checks/hostplatform-import.mjs. */

export type SheetRow = Record<string, unknown> & { _row?: number; _sheet?: string };

/** RFC 4180: quoted fields may hold commas, tabs, quotes ("") and line breaks. A leading UTF-8 BOM is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], val = '', inQ = false, any = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { val += '"'; i++; } else inQ = false; }
      else val += c;
      continue;
    }
    if (c === '"') { inQ = true; any = true; }
    else if (c === ',') { cur.push(val); val = ''; any = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      cur.push(val); rows.push(cur); cur = []; val = ''; any = false;
    } else { val += c; any = true; }
  }
  if (any || cur.length) { cur.push(val); rows.push(cur); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** CSV text to one object per record, keyed by the header. `_row` is the record's number counting the header as 1. */
export function csvObjects(text: string): { header: string[]; rows: SheetRow[] } {
  const grid = parseCsv(text);
  // Headers are kept exactly as exported: HostPlatform's ' of Bed Rooms' really starts with a space.
  const header = grid[0] ?? [];
  const rows = grid.slice(1).map((cols, i) => {
    const o: SheetRow = { _row: i + 2 };
    header.forEach((h, j) => { o[h] = cols[j] ?? ''; });
    return o;
  });
  return { header, rows };
}

/* ------------------------------------------------------------------ */
/* xlsx                                                                */
/* ------------------------------------------------------------------ */

interface ZipEntry { name: string; method: number; size: number; offset: number }

function zipEntries(buf: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not an .xlsx workbook.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The workbook file is damaged.');
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.set(name.replace(/^\//, ''), { name, method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function unzip(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const data = buf.subarray(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error('The workbook uses a compression this screen cannot read.');
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&')
  .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** Text of an <si> or <is>: every <t> run, without phonetic hints. */
const runs = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');

const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

/** Reads only the named sheets of an .xlsx: { sheetName: rows }, each row a sparse array with its 1-based row number.
 *  Numbers stay numbers (dates are Excel serial numbers; the mapping converts the columns it knows are dates). */
export async function readXlsx(data: ArrayBuffer | Uint8Array, wanted: string[]): Promise<{ sheets: Record<string, { row: number; cells: unknown[] }[]>; names: string[] }> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zip = zipEntries(buf);
  const read = async (path: string) => { const e = zip.get(path); return e ? unzip(buf, e) : ''; };
  const book = await read('xl/workbook.xml');
  if (!book) throw new Error('This file is not an .xlsx workbook.');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const target = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
  const sheetsInBook = [...book.matchAll(/<sheet\b([^>]*)\/?>/g)].map(m => ({ name: decode(attr(m[1], 'name') ?? ''), rid: attr(m[1], 'r:id') }));
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => runs(m[1]));

  const sheets: Record<string, { row: number; cells: unknown[] }[]> = {};
  for (const s of sheetsInBook) {
    if (!wanted.includes(s.name)) continue;
    const t = target.get(s.rid) ?? '';
    const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    const xml = await read(path);
    const out: { row: number; cells: unknown[] }[] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNo = Number(attr(rm[1], 'r') ?? out.length + 1);
      const cells: unknown[] = [];
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r'), type = attr(cm[1], 't') ?? 'n', body = cm[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: unknown = null;
        if (type === 's') value = v !== undefined ? shared[Number(v)] ?? null : null;
        else if (type === 'inlineStr') value = runs(body);
        else if (type === 'str' || type === 'd') value = v !== undefined ? decode(v) : null;
        else if (type === 'b') value = v === '1';
        else if (type === 'e') value = null;
        else value = v !== undefined && v !== '' ? Number(v) : null;
        cells[ref ? colIndex(ref) : cells.length] = value;
      }
      out.push({ row: rowNo, cells });
    }
    sheets[s.name] = out;
  }
  return { sheets, names: sheetsInBook.map(s => s.name) };
}

/** Sheet rows to objects keyed by the header row. Blank rows are dropped; `_row` is the sheet row number. */
export function sheetObjects(rows: { row: number; cells: unknown[] }[], headerRow = 1, sheet?: string): SheetRow[] {
  const head = rows.find(r => r.row === headerRow);
  if (!head) return [];
  const header = Array.from(head.cells, c => (c === null || c === undefined ? '' : String(c).trim()));
  return rows.filter(r => r.row > headerRow && r.cells.some(c => c !== null && c !== undefined && String(c).trim() !== ''))
    .map(r => {
      const o: SheetRow = { _row: r.row };
      if (sheet) o._sheet = sheet;
      header.forEach((h, i) => { if (h && o[h] === undefined) o[h] = r.cells[i] ?? null; });
      return o;
    });
}
