import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { Report, Unit } from '../pages/OwnerIncomeReportPage';

/**
 * One owner statement as a real PDF file, drawn page for page like the Owner Income Report on screen
 * (src/pages/OwnerIncomeReportPage.tsx): the owner's all-units month and year to date when they have more than one
 * unit, then each unit's month and year to date. Used by the Owners list's "Owner statements (.zip)" export.
 * Keep the two in step: a row added to the screen report has to be drawn here too.
 * No imports beyond pdf-lib and types, so `node --test src/lib/statementPdf.test.mjs` runs it as it is.
 */

export interface StatementPdfOptions {
  /** The company logo as PNG bytes; left out, the letterhead has no logo. */
  logo?: Uint8Array | null;
  /** How a phone number prints (the screen report writes Malaysian numbers as dialled at home). */
  phone?: (raw: string | null) => string;
}

const MM = 72 / 25.4;
const PAGE_W = 210 * MM, PAGE_H = 297 * MM;
const LEFT = 14 * MM, RIGHT = PAGE_W - 14 * MM, WIDTH = RIGHT - LEFT;
const BLACK = rgb(0, 0, 0), HEAD_FILL = rgb(0xdc / 255, 0xe9 / 255, 0xf5 / 255), DRAFT = rgb(0.6, 0.35, 0.05);

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MON_TITLE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MODEL_NAME: Record<string, string> = {
  management: 'Profit share', management_guarantee: 'Profit share, minimum guarantee', management_yearly_guarantee: 'Profit share, yearly guarantee', grr: 'Guaranteed rent', master_lease: 'Master lease', long_term: 'Long-term let',
};

/** 4,998.81; a deduction in brackets (397.12); nothing as '-'. Same rules as the screen report. */
const money = (sen: number | null, opts: { brackets?: boolean; dash?: boolean } = {}) => {
  if (sen === null || (sen === 0 && opts.dash !== false)) return '-';
  const v = (Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sen < 0 || opts.brackets ? `(${v})` : v;
};
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const dayMonYear = (iso: string) => `${iso.slice(8, 10)}-${MON_TITLE[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;

// ponytail: the built-in Times font only has Western European letters, so a Chinese name prints as "?". Embed a
// Unicode TTF through @pdf-lib/fontkit when an owner's name or the company address needs other scripts.
export const safe = (s: string) => s.replace(/[\t\r\n]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

interface Ctx { doc: PDFDocument; font: PDFFont; bold: PDFFont; logo: PDFImage | null; r: Report; phone: (raw: string | null) => string }
/** One A4 sheet being drawn, `y` the top of the next thing, in points from the bottom. */
interface Sheet { page: PDFPage; y: number }

type Align = 'l' | 'c' | 'r';
interface Cell { t: string; bold?: boolean; u?: boolean; align?: Align; indent?: boolean }
interface Row { cells: (string | Cell)[]; gap?: boolean }
const row = (...cells: (string | Cell)[]): Row => ({ cells });
const gapRow = (...cells: (string | Cell)[]): Row => ({ cells, gap: true });
const b = (t: string, more: Partial<Cell> = {}): Cell => ({ t, bold: true, ...more });

function text(s: Sheet, ctx: Ctx, str: string, x: number, baseline: number, o: { size?: number; bold?: boolean; align?: Align; width?: number; color?: typeof BLACK } = {}) {
  const size = o.size ?? 9, font = o.bold ? ctx.bold : ctx.font, t = safe(str);
  const w = font.widthOfTextAtSize(t, size);
  const at = o.align === 'r' ? x + (o.width ?? 0) - w : o.align === 'c' ? x + ((o.width ?? 0) - w) / 2 : x;
  s.page.drawText(t, { x: at, y: baseline, size, font, color: o.color ?? BLACK });
  return w;
}

/** Words onto lines no wider than `max`; a single word longer than that stays whole. */
function wrap(str: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of str.split('\n')) {
    let cur = '';
    for (const word of safe(para).split(' ').filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && font.widthOfTextAtSize(next, size) > max) { out.push(cur); cur = word; } else cur = next;
    }
    if (cur) out.push(cur);
  }
  return out;
}

const hline = (s: Sheet, y: number, x1 = LEFT, x2 = RIGHT, thickness = 1.1) => s.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: BLACK });
const vline = (s: Sheet, x: number, y1: number, y2: number) => s.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 1.1, color: BLACK });

/** A new sheet with the letterhead (company left, logo right, a rule under) and the title. */
function sheet(ctx: Ctx, title: string): Sheet {
  const s: Sheet = { page: ctx.doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - 11 * MM };
  const c = ctx.r.settings.company;
  let y = s.y;
  text(s, ctx, c.legalName.toUpperCase(), LEFT, y - 15, { size: 16.5, bold: true }); y -= 19;
  if (c.companyNumber) { text(s, ctx, `Company No: ${c.companyNumber}`, LEFT, y - 8, { size: 8 }); y -= 11; }
  for (const l of wrap(c.address.toUpperCase().replace(/\bNO\.?\s+(?=\d)/g, m => m.replace(/\s+/, ' ')), ctx.bold, 9, 89.5 * MM)) { text(s, ctx, l, LEFT, y - 9, { bold: true }); y -= 11.5; }
  const contact = [c.phone && `TEL: ${ctx.phone(c.phone)}`, c.email && `EMAIL: ${c.email}`].filter(Boolean).join(' | ');
  if (contact) { text(s, ctx, contact, LEFT, y - 9, { bold: true }); y -= 11.5; }
  if (ctx.logo) {
    const w = 28 * MM, h = w * ctx.logo.height / ctx.logo.width;
    s.page.drawImage(ctx.logo, { x: RIGHT - 1 * MM - w, y: s.y - 1 * MM - h, width: w, height: h });
    y = Math.min(y, s.y - 1 * MM - h);
  }
  y -= 4;
  hline(s, y, LEFT, RIGHT, 1.5);
  y -= 2.5 * MM;
  text(s, ctx, title, LEFT, y - 11, { size: 11, bold: true, align: 'c', width: WIDTH }); y -= 11 + 2 * MM;
  // The screen shows "Draft" only in its toolbar, which never prints; a draft sent on paper must say so itself.
  if (ctx.r.state === 'provisional') {
    text(s, ctx, 'DRAFT: these figures are not final and can still change.', LEFT, y - 9, { size: 9, bold: true, align: 'c', width: WIDTH, color: DRAFT }); y -= 9 + 2 * MM;
  }
  s.y = y;
  return s;
}

type Pair = [string, string] | null;
/** The owner's details left, the report's right, row for row; TEL and EMAIL stand a little apart, as printed. */
function parties(s: Sheet, ctx: Ctx, left: [string, string][], right: Pair[]) {
  const size = 9.5, rightX = LEFT + WIDTH * 0.625;
  left.forEach(([k, v], i) => {
    if (k === 'TEL' || k === 'EMAIL') s.y -= 2.6 * MM - 1.1 * MM;
    const lines = wrap(v, ctx.font, size, rightX - (LEFT + 20 * MM) - 6 * MM);
    text(s, ctx, k, LEFT, s.y - size, { size, bold: true });
    (lines.length ? lines : ['']).forEach((l, j) => text(s, ctx, `${j === 0 ? ': ' : '  '}${l}`, LEFT + 20 * MM, s.y - size - j * 11.5, { size }));
    const rv = right[i];
    if (rv) {
      const kw = text(s, ctx, rv[0], rightX, s.y - size, { size, bold: true });
      text(s, ctx, `: ${rv[1]}`, rightX + Math.max(15.2 * MM, kw + 3), s.y - size, { size });
    }
    s.y -= size + 2 + 1.1 * MM + (Math.max(1, lines.length) - 1) * 11.5;
  });
  s.y -= 3 * MM;
}

/** A bordered table: a shaded header, then rows. `grid` rules every row (the year tables); otherwise only the
 *  columns are ruled, as on the monthly page. Column widths are fractions of the page's text width. */
function table(s: Sheet, ctx: Ctx, cols: { w: number; align: Align }[], head: string[], rows: Row[], grid: boolean) {
  const xs: number[] = [LEFT];
  for (const c of cols) xs.push(xs[xs.length - 1] + c.w * WIDTH);
  const top = s.y, size = 9, pad = 1.5 * MM;
  const heads = head.map((h, i) => wrap(h, ctx.bold, size, xs[i + 1] - xs[i] - 2 * pad));
  const headH = Math.max(...heads.map(l => l.length)) * 10 + 2 * MM;
  s.page.drawRectangle({ x: LEFT, y: top - headH, width: WIDTH, height: headH, color: HEAD_FILL });
  heads.forEach((lines, i) => {
    const first = top - headH / 2 + (lines.length * 10) / 2 - 8;
    lines.forEach((l, j) => text(s, ctx, l, xs[i], first - j * 10, { size, bold: true, align: 'c', width: xs[i + 1] - xs[i] }));
  });
  hline(s, top - headH);
  let y = top - headH;
  const rowH = grid ? 5.5 * MM : 4.6 * MM;
  for (const r of rows) {
    if (r.gap) y -= 1.8 * MM;
    r.cells.forEach((raw, i) => {
      const c: Cell = typeof raw === 'string' ? { t: raw } : raw;
      if (!c.t) return;
      const x = xs[i] + pad + (c.indent ? 3 * MM : 0), w = xs[i + 1] - xs[i] - 2 * pad - (c.indent ? 3 * MM : 0);
      const align = c.align ?? cols[i].align, base = y - rowH + (rowH - size) / 2 + 1.5;
      const tw = text(s, ctx, c.t, x, base, { size, bold: c.bold, align, width: w });
      if (c.u) hline(s, base - 1.2, x, x + tw, 0.6);
    });
    y -= rowH;
    if (grid) hline(s, y);
  }
  s.page.drawRectangle({ x: LEFT, y, width: WIDTH, height: top - y, borderColor: BLACK, borderWidth: 1.5 });
  for (const x of xs.slice(1, -1)) vline(s, x, top, y);
  s.y = y - 2 * MM;
}

function note(s: Sheet, ctx: Ctx, str: string) {
  for (const l of wrap(str, ctx.font, 9, WIDTH)) { text(s, ctx, l, LEFT, s.y - 9); s.y -= 11; }
}

function termsAndSignatures(s: Sheet, ctx: Ctx, items: string[]) {
  if (items.length) {
    s.y -= 3 * MM;
    const w = text(s, ctx, 'Term & Conditions:-', LEFT, s.y - 9, { bold: true });
    hline(s, s.y - 10.2, LEFT, LEFT + w, 0.6);
    s.y -= 9 + 1.5 * MM;
    items.forEach((t, i) => {
      text(s, ctx, `${i + 1}.`, LEFT + 4 * MM, s.y - 9);
      for (const l of wrap(t, ctx.font, 9, WIDTH - 10.5 * MM)) { text(s, ctx, l, LEFT + 10.5 * MM, s.y - 9); s.y -= 11; }
      s.y -= 1.2 * MM;
    });
  }
  s.y -= 10 * MM;
  for (const [x, label] of [[LEFT, 'Authorised Signature'], [RIGHT - 53 * MM, 'Acknowledge By']] as const) {
    hline(s, s.y, x, x + 53 * MM, 1.5);
    text(s, ctx, label, x, s.y - 1.5 * MM - 10, { size: 10 });
  }
}

const ownerLeft = (ctx: Ctx, u: Unit): [string, string][] => [
  ['OWNER', ctx.r.owner.name.toUpperCase()], ['BUILDING', u.code], ['UNIT', (u.address ?? `${u.propertyName} ${u.unitNumber}`).toUpperCase()],
  ['TEL', ctx.phone(ctx.r.owner.phone)], ['EMAIL', ctx.r.owner.email ?? ''],
];

function monthPage(ctx: Ctx, u: Unit) {
  const { r } = ctx;
  const s = sheet(ctx, 'OWNER INCOME REPORT');
  parties(s, ctx, ownerLeft(ctx, u), [['REF. NO.', u.refNo], null, ['DATE', dayMonYear(r.periodEnd)], ['MONTHS', MON[Number(r.period.slice(5, 7)) - 1]], ['TERMS', r.settings.paymentTerms]]);
  const share = u.basis === 'share';
  const rows: Row[] = [row(b('Gross Income', { u: true }))];
  if (share && u.model === 'long_term') rows.push(row({ t: 'Monthly Rent (long-term tenant)', indent: true }, '1', 'months', money(u.gross), money(u.gross, { dash: false })));
  else if (share) rows.push(row({ t: 'Hospitality Income', indent: true }, String(u.nights), '%', pct(u.occupancy * 100), money(u.gross, { dash: false })));
  else rows.push(row({ t: 'Fixed Monthly Rent', indent: true }, '1', 'months', money(u.fixedRent), money(u.fixedRent)));
  if (share) {
    rows.push(gapRow(b('(-) Expense Deduction', { u: true })));
    for (const d of u.deductions) rows.push(row({ t: d.label, indent: true }, d.quantity == null ? '' : String(d.quantity), d.uom ?? '', money(d.price), money(d.amount)));
    rows.push(row('', '', '', b('Total Deduction', { align: 'c' }), b(money(u.deductionsTotal, { dash: false }))));
    rows.push(gapRow(b('Net Income Before Deduct Management Fees'), '', '', '', money(u.net, { dash: false })));
    rows.push(row(b(`${pct(u.operatorPct ?? 0)} To Operator`), '', '', pct(u.operatorPct ?? 0), money(-u.operatorShare, { dash: false })));
    if (u.topUp > 0) rows.push(row(b('Minimum Guarantee Top-up'), '', '', money(u.guarantee), money(u.topUp)));
  }
  rows.push(row(b('Payout Before O2 Adjustment'), '', '', '', b(money(u.payoutBeforeAdjustments, { dash: false }))));
  u.adjustments.forEach((a, i) => rows.push({ cells: [a.description.toUpperCase(), '', '', '', money(a.amount)], gap: i === 0 }));
  rows.push(row(b('Net Payout to Owner'), '', '', '', b(money(u.netPayout, { dash: false }))));
  table(s, ctx, [{ w: 0.44, align: 'l' }, { w: 0.09, align: 'c' }, { w: 0.11, align: 'c' }, { w: 0.18, align: 'r' }, { w: 0.18, align: 'r' }],
    ['DESCRIPTION', 'QTY', 'UOM', 'PRICE (RM)', 'AMOUNT (RM)'], rows, false);
  termsAndSignatures(s, ctx, r.settings.monthlyTerms);
}

const YEAR_COLS = [{ w: 0.14, align: 'l' as const }, { w: 0.21, align: 'r' as const }, { w: 0.22, align: 'r' as const }, { w: 0.21, align: 'r' as const }, { w: 0.22, align: 'r' as const }];
const YEAR_HEAD = ['MONTH', 'GROSS INCOME (RM)', 'EXPENSE DEDUCTION (RM)', 'GROSS DEDUCTION (RM)', 'NET INCOME (RM)'];

function yearPage(ctx: Ctx, u: Unit) {
  const { r } = ctx;
  const year = r.period.slice(0, 4);
  const s = sheet(ctx, `YEAR-TO-DATE OWNER INCOME REPORT (JAN - DEC ${year})`);
  parties(s, ctx, ownerLeft(ctx, u), [['REF. NO.', u.refNo], null, ['MONTH', `${MON[Number(r.period.slice(5, 7)) - 1]} ${year}`]]);
  const rows = u.year.map(y => row(b(`${y.label}${y.source === 'workbook' ? ' *' : ''}`), money(y.gross), money(y.deductions), money(y.operator), money(y.net)));
  const t = u.yearTotal;
  rows.push(row(b('TOTAL'), b(money(t.gross)), b(money(t.deductions)), b(money(t.operator)), b(money(t.net))));
  table(s, ctx, YEAR_COLS, YEAR_HEAD, rows, true);
  if (u.year.some(y => y.source === 'workbook')) note(s, ctx, '* Paid before Property OS: the owner workbook records the payout for this month, not its breakdown.');
  termsAndSignatures(s, ctx, r.settings.yearTerms);
}

function ownerMonthPage(ctx: Ctx) {
  const { r } = ctx;
  const sum = (f: (u: Unit) => number) => r.units.reduce((n, u) => n + f(u), 0);
  const income = (u: Unit) => (u.basis === 'share' ? u.gross : u.fixedRent);
  const deduct = (u: Unit) => (u.basis === 'share' ? u.deductionsTotal : 0);
  const operator = (u: Unit) => (u.basis === 'share' ? u.operatorShare - u.topUp : 0);
  const adj = (u: Unit) => u.adjustments.reduce((n, a) => n + a.amount, 0);
  const s = sheet(ctx, 'OWNER INCOME REPORT (ALL UNITS)');
  parties(s, ctx, [['OWNER', r.owner.name.toUpperCase()], ['UNITS', String(r.units.length)], ['TEL', ctx.phone(r.owner.phone)], ['EMAIL', r.owner.email ?? '']],
    [['REF. NO.', `${r.period.slice(2, 4)}${r.period.slice(5, 7)}-OWNER`], ['DATE', dayMonYear(r.periodEnd)], ['MONTHS', MON[Number(r.period.slice(5, 7)) - 1]], ['TERMS', r.settings.paymentTerms]]);
  const rows = r.units.map(u => row(b(u.code), money(income(u)), money(deduct(u)), money(operator(u)), money(u.payoutBeforeAdjustments), money(adj(u)), b(money(u.netPayout, { dash: false }))));
  rows.push(row(b('TOTAL'), b(money(sum(income))), b(money(sum(deduct))), b(money(sum(operator))), b(money(sum(u => u.payoutBeforeAdjustments))), b(money(sum(adj))), b(money(sum(u => u.netPayout), { dash: false }))));
  table(s, ctx, [{ w: 0.25, align: 'l' }, ...[0.13, 0.13, 0.12, 0.13, 0.11, 0.13].map(w => ({ w, align: 'r' as const }))],
    ['UNIT', 'GROSS INCOME (RM)', 'EXPENSE DEDUCTION (RM)', 'TO OPERATOR (RM)', 'PAYOUT BEFORE O2 (RM)', 'O2 (RM)', 'NET PAYOUT (RM)'], rows, true);
  note(s, ctx, `Each unit's own report follows, with every income line, deduction and owner credit or charge. To operator is after any minimum guarantee top-up. Units: ${r.units.map(u => `${u.code} (${MODEL_NAME[u.model ?? (u.basis === 'share' ? 'management' : 'grr')] ?? u.model})`).join(', ')}.`);
  termsAndSignatures(s, ctx, r.settings.monthlyTerms);
}

function ownerYearPage(ctx: Ctx) {
  const { r } = ctx;
  const year = r.period.slice(0, 4);
  type K = 'gross' | 'deductions' | 'operator' | 'net';
  const months = MON.map((label, i) => {
    const ys = r.units.map(u => u.year[i]).filter(Boolean);
    const add = (k: K) => (ys.some(y => y[k] != null) ? ys.reduce((n, y) => n + (y[k] ?? 0), 0) : null);
    return { label, gross: add('gross'), deductions: add('deductions'), operator: add('operator'), net: add('net'), workbook: ys.some(y => y.source === 'workbook') };
  });
  const total = (k: K) => months.reduce((n, m) => n + (m[k] ?? 0), 0);
  const s = sheet(ctx, `YEAR-TO-DATE OWNER INCOME REPORT, ALL UNITS (JAN - DEC ${year})`);
  parties(s, ctx, [['OWNER', r.owner.name.toUpperCase()], ['UNITS', r.units.map(u => u.code).join(', ')]], [null, ['MONTH', `${MON[Number(r.period.slice(5, 7)) - 1]} ${year}`]]);
  const rows = months.map(m => row(b(`${m.label}${m.workbook ? ' *' : ''}`), money(m.gross), money(m.deductions), money(m.operator), money(m.net)));
  rows.push(row(b('TOTAL'), b(money(total('gross'))), b(money(total('deductions'))), b(money(total('operator'))), b(money(total('net')))));
  table(s, ctx, YEAR_COLS, YEAR_HEAD, rows, true);
  if (months.some(m => m.workbook)) note(s, ctx, '* Paid before Property OS for at least one unit: the owner workbook records the payout for that month, not its breakdown.');
  termsAndSignatures(s, ctx, r.settings.yearTerms);
}

/** The statement as PDF bytes. A statement with no unit figures (paid before Property OS) has nothing to draw: check
 *  `r.units.length` first. */
export async function statementPdf(r: Report, opts: StatementPdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`Owner Income Report ${r.owner.name} ${r.period}`));
  doc.setAuthor(safe(r.settings.company.legalName));
  const ctx: Ctx = {
    doc, r,
    font: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    // A logo that is not a PNG leaves the letterhead without one rather than failing the statement.
    logo: opts.logo ? await doc.embedPng(opts.logo).catch(() => null) : null,
    phone: opts.phone ?? (raw => (raw ?? '').trim()),
  };
  if (r.units.length > 1) { ownerMonthPage(ctx); ownerYearPage(ctx); }
  for (const u of r.units) { monthPage(ctx, u); yearPage(ctx, u); }
  return doc.save();
}
