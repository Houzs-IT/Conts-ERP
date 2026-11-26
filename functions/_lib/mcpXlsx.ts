/**
 * A minimal .xlsx writer for the AI Connector's export_excel (owner, 26 Nov 2026). No xlsx library is in the repo and
 * the heavy ones (SheetJS, ExcelJS) do not belong in a Worker, so this builds the few XML parts a workbook needs and
 * zips them by hand: one sheet, a bold frozen header row, column widths from the content, numbers as numbers, money
 * columns in RM with two decimals. Strings are inline (no shared-string table), which Excel, Numbers, LibreOffice and
 * Google Sheets all open.
 *
 * Entries are deflated with the platform's CompressionStream('deflate-raw') when it exists (Workers and Node 22 do),
 * else stored. Pure apart from that stream, so it is unit-tested (src/lib/mcpMore.test.mjs).
 */

export type XlsxColumn = { header: string; money?: boolean };
export type XlsxCell = string | number | null;

const enc = new TextEncoder();

/** Text safe inside XML: escaped, and without the control characters XML 1.0 forbids. */
export function xmlText(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Width in characters: the longest of the header and the first 500 values, between 8 and 60. */
export function columnWidths(cols: XlsxColumn[], rows: XlsxCell[][]): number[] {
  return cols.map((c, i) => {
    let w = c.header.length + 2;
    for (const r of rows.slice(0, 500)) {
      const v = r[i];
      const len = v === null || v === undefined ? 0 : typeof v === 'number' && c.money ? v.toFixed(2).length + 3 : String(v).length;
      if (len + 2 > w) w = len + 2;
    }
    return Math.max(8, Math.min(60, w));
  });
}

/** One cell. Text is an inline string, which Excel never evaluates, so a value starting with "=" stays text. */
function cellXml(ref: string, v: XlsxCell, style: number): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
  const t = xmlText(String(v)).slice(0, 32_000);
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${t}</t></is></c>`;
}

export function sheetXml(cols: XlsxColumn[], rows: XlsxCell[][]): string {
  const widths = columnWidths(cols, rows);
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`,
    '<sheetData>',
    `<row r="1">${cols.map((c, i) => cellXml(`${colName(i)}1`, c.header, 1)).join('')}</row>`,
  ];
  rows.forEach((r, ri) => {
    parts.push(`<row r="${ri + 2}">${cols.map((c, i) => cellXml(`${colName(i)}${ri + 2}`, r[i] ?? null, c.money ? 2 : 0)).join('')}</row>`);
  });
  parts.push('</sheetData>');
  if (cols.length) parts.push(`<autoFilter ref="A1:${colName(cols.length - 1)}${rows.length + 1}"/>`);
  parts.push('</worksheet>');
  return parts.join('');
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/** Sheet names: at most 31 characters, none of []:*?/\ . */
export const sheetName = (s: string) => (s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet1');

export function workbookParts(name: string, cols: XlsxColumn[], rows: XlsxCell[][]): [string, string][] {
  return [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${xmlText(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets>`
      + (cols.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xmlText(sheetName(name)).replace(/'/g, "''")}'!$A$1:$${colName(cols.length - 1)}$${rows.length + 1}</definedName></definedNames>` : '')
      + '</workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml(cols, rows)],
  ];
}

/* ---------- zip ---------- */

let CRC_TABLE: Uint32Array | null = null;
export function crc32(b: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).CompressionStream;
  if (!CS) return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CS('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

/** A zip of the given files (deflated when the platform can, else stored). */
export async function zip(files: [string, Uint8Array][], compress = true): Promise<Uint8Array> {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // 1980-01-01 00:00, the zip epoch: the files carry no meaningful time.
  const time = 0, date = (0 << 9) | (1 << 5) | 1;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const deflated = compress ? await deflateRaw(data) : null;
    const useDeflate = !!deflated && deflated.length < data.length;
    const body = useDeflate ? deflated! : data;
    const method = useDeflate ? 8 : 0;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameBytes.length, true); h.setUint16(28, 0, true);
    local.push(new Uint8Array(h.buffer), nameBytes, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nameBytes.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const all = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/** The .xlsx file. */
export async function buildXlsx(name: string, cols: XlsxColumn[], rows: XlsxCell[][], compress = true): Promise<Uint8Array> {
  return zip(workbookParts(name, cols, rows).map(([n, x]) => [n, enc.encode(x)] as [string, Uint8Array]), compress);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
