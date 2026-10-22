/**
 * Table exports: CSV and Excel (.xlsx) written in the browser, no library. The .xlsx is the smallest file
 * Excel, Numbers and Google Sheets all open: one sheet, a bold frozen header with filter arrows, money as
 * real numbers shown as "RM 1,234.50", dates as real dates. The zip is stored, not compressed, which keeps
 * the writer short; a 5,000-row export is still only a few megabytes.
 */

export type ExportKind = 'text' | 'money' | 'number' | 'date' | 'datetime';
export interface ExportColumn { label: string; kind: ExportKind }
/** One cell: text, a number (money in sen), or an ISO date / timestamp string, matching the column kind. */
export type ExportCell = string | number | null | undefined;

/** A text cell a spreadsheet would run as a formula (=, +, -, @, tab or carriage return first) gets a leading apostrophe,
 *  so a guest named =HYPERLINK(...) shows as text instead of running when the file is opened. Plain numbers and phone
 *  numbers (+60 12-345 6789) are left alone. The .xlsx writer needs no guard: its text cells are never formulas. */
export const csvSafe = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^[+-]?[\d\s().,-]+$/.test(v) ? `'${v}` : v);

const csvEsc = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function csvCell(kind: ExportKind, v: ExportCell): string {
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'money') return typeof v === 'number' ? (v / 100).toFixed(2) : String(v);
  if (kind === 'number') return String(v);
  if (kind === 'date') return String(v).slice(0, 10);
  if (kind === 'datetime') return isoToMyt(String(v));
  return csvSafe(String(v));
}

/** The header names the unit once, so the cells can be plain numbers a spreadsheet adds up. */
const headLabel = (c: ExportColumn) => (c.kind === 'money' ? `${c.label} (RM)` : c.label);

export function toCsv(cols: ExportColumn[], rows: ExportCell[][]): string {
  const lines = [cols.map(c => csvEsc(csvSafe(headLabel(c)))).join(',')];
  for (const r of rows) lines.push(cols.map((c, i) => csvEsc(csvCell(c.kind, r[i]))).join(','));
  // The BOM makes Excel read the file as UTF-8, so names in other scripts survive.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** A timestamp as Malaysian local time, "2026-10-10 14:05". */
function isoToMyt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
}

/* ------------------------------------------------------------------ */
/* xlsx                                                                */
/* ------------------------------------------------------------------ */

const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const xmlEsc = (s: string) => s.replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const EPOCH = Date.UTC(1899, 11, 30);
/** Excel's day number for a calendar date (and the fraction of the day for a time), Malaysian time. */
function serial(kind: 'date' | 'datetime', v: string): number | null {
  if (kind === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 864e5 : null;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? (t + 8 * 3600e3 - EPOCH) / 864e5 : null;
}

// Style indexes into cellXfs below.
const S_HEAD = 1, S_MONEY = 2, S_DATE = 3, S_INT = 4, S_DATETIME = 5, S_NUM = 6;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;RM &quot;#,##0.00"/><numFmt numFmtId="165" formatCode="d mmm yyyy"/><numFmt numFmtId="166" formatCode="#,##0"/><numFmt numFmtId="167" formatCode="d mmm yyyy hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F0EA"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(cols: ExportColumn[], rows: ExportCell[][]): string {
  const out: string[] = [];
  const last = colName(Math.max(0, cols.length - 1));
  const lastRow = rows.length + 1;
  // Width from the longest of the header and the first few hundred cells, clamped to something readable.
  const widths = cols.map((c, i) => {
    let w = headLabel(c).length;
    if (c.kind === 'money') w = Math.max(w, 14);
    else if (c.kind === 'date') w = Math.max(w, 12);
    else if (c.kind === 'datetime') w = Math.max(w, 17);
    for (let r = 0; r < Math.min(rows.length, 300); r++) { const v = rows[r][i]; if (typeof v === 'string' && c.kind === 'text') w = Math.max(w, v.length); }
    return Math.min(60, Math.max(8, w + 2));
  });
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  out.push(`<dimension ref="A1:${last}${lastRow}"/>`);
  out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  out.push('<sheetFormatPr defaultRowHeight="15"/>');
  out.push(`<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`);
  out.push('<sheetData>');
  out.push(`<row r="1">${cols.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="${S_HEAD}"><is><t>${xmlEsc(headLabel(c))}</t></is></c>`).join('')}</row>`);
  rows.forEach((row, ri) => {
    const r = ri + 2;
    const cells: string[] = [];
    cols.forEach((c, i) => {
      const v = row[i];
      if (v === null || v === undefined || v === '') return;
      const ref = `${colName(i)}${r}`;
      if (c.kind === 'money' && typeof v === 'number') cells.push(`<c r="${ref}" s="${S_MONEY}"><v>${(v / 100).toFixed(2)}</v></c>`);
      else if (c.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) cells.push(`<c r="${ref}" s="${Number.isInteger(v) ? S_INT : S_NUM}"><v>${v}</v></c>`);
      else if ((c.kind === 'date' || c.kind === 'datetime') && typeof v === 'string' && serial(c.kind, v) !== null) {
        cells.push(`<c r="${ref}" s="${c.kind === 'date' ? S_DATE : S_DATETIME}"><v>${serial(c.kind, v)}</v></c>`);
      } else cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`);
    });
    out.push(`<row r="${r}">${cells.join('')}</row>`);
  });
  out.push('</sheetData>');
  if (cols.length) out.push(`<autoFilter ref="A1:${last}${lastRow}"/>`);
  out.push('</worksheet>');
  return out.join('');
}

const sheetTitle = (s: string) => (s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet1');

export function toXlsx(cols: ExportColumn[], rows: ExportCell[][], sheetName = 'Sheet1'): Uint8Array {
  const name = sheetTitle(sheetName);
  const last = colName(Math.max(0, cols.length - 1));
  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(name)}</dc:title><dc:creator>The Conts</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${xmlEsc(name)}" sheetId="1" r:id="rId1"/></sheets>${cols.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xmlEsc(name.replace(/'/g, "''"))}'!$A$1:$${last}$${rows.length + 1}</definedName></definedNames>` : ''}</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(cols, rows)],
  ];
  const enc = new TextEncoder();
  return zipStore(files.map(([n, s]) => [n, enc.encode(s)]));
}

/* ------------------------------------------------------------------ */
/* zip (stored)                                                        */
/* ------------------------------------------------------------------ */

let CRC: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function zipStore(files: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, day, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, day, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true);
    c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
  e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/* ------------------------------------------------------------------ */
/* saving                                                              */
/* ------------------------------------------------------------------ */

export function saveBlob(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "bookings-2026-10-10" style file names, Malaysian date. */
export function exportFileName(stem: string, ext: 'csv' | 'xlsx') {
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  return `${stem.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export'}-${day}.${ext}`;
}

export function downloadTable(format: 'csv' | 'xlsx', stem: string, sheet: string, cols: ExportColumn[], rows: ExportCell[][]) {
  if (format === 'csv') saveBlob(toCsv(cols, rows), exportFileName(stem, 'csv'), 'text/csv;charset=utf-8');
  else saveBlob(toXlsx(cols, rows, sheet) as BlobPart, exportFileName(stem, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/**
 * Every row of a server-paged list, for an export: asks the list endpoint for big pages (export=1 lifts its
 * page-size limit to 1,000) until it has them all or reaches the cap, reporting progress as it goes.
 */
export async function fetchAllPages<R>(fetchPage: (page: number, size: number) => Promise<{ rows: R[]; total: number }>,
  opts: { size?: number; cap?: number; onProgress?: (got: number, total: number) => void } = {}): Promise<{ rows: R[]; total: number; capped: boolean }> {
  const size = opts.size ?? 1000, cap = opts.cap ?? 25000;
  const out: R[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const r = await fetchPage(page, size);
    total = r.total;
    out.push(...r.rows);
    opts.onProgress?.(out.length, total);
    if (!r.rows.length || out.length >= total || out.length >= cap) break;
  }
  return { rows: out.slice(0, cap), total, capped: total > cap };
}
