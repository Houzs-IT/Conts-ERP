// Page totals against the owner's sample PDFs:
//   AVA Residence B31-09 (Dream Crafter, format 1, six pages): 11,418 / 11,830 / 6,057.5 / 10,080 / 6,561 / -40,
//     GRAND TOTAL 45,906.5. Every line transcribed from the PDF; page breaks where the sample breaks.
//   D'Clover A-3A-3A (Dream Crafter, format 3): page 1 transcribed line by line (net 20,577.71 against list
//     37,215.52, each discounted line rounded to the sen); pages 2-8 as one line per page carrying that page's
//     list and net totals (typed amount); last page TOTAL 137,866.56 / DISCOUNT 42,623.42 / FINAL 95,243.14.
import { describe, expect, test } from 'vitest';
import { layoutDocument, pageTotalSen, summaryRows } from './print-layout';
import { buildRows, rmPlain } from './print-model';
import { AVA, DC_REST, dclover, doc, item, kl48, RM, section, skyline } from './print-fixtures';

describe('AVA Residence B31-09, format 1 (amount only)', () => {
  const d = doc('AMOUNT', AVA);
  const layout = layoutDocument(d);

  test('six pages with the sample page totals', () => {
    expect(layout.pages.map((p) => pageTotalSen(d, p))).toEqual([RM(11418), RM(11830), RM(6057.5), RM(10080), RM(6561), RM(-40)]);
  });

  test('page totals print as the sample does', () => {
    expect(layout.pages.map((p) => rmPlain(pageTotalSen(d, p)!))).toEqual(['11418', '11830', '6057.5', '10080', '6561', '-40']);
  });

  test('GRAND TOTAL 45,906.5 on the last page; no closing page needed', () => {
    expect(layout.closing.summary.finalSen).toBe(RM(45906.5));
    expect(summaryRows(d, layout.closing.summary)).toEqual([{ label: 'GRAND TOTAL', sen: RM(45906.5), tone: 'final' }]);
    expect(layout.closing.ownPage).toBe(false);
    expect(layout.pages.at(-1)!.isLast).toBe(true);
  });

  test('numbering restarts per section, add-ons and dimensions unnumbered', () => {
    const rows = buildRows(d).filter((r) => r.type === 'line');
    const nums = rows.map((r) => r.cells.no ?? '');
    expect(nums.slice(0, 4)).toEqual(['1', '', '', '']);
    const wiring = rows.find((r) => r.cells.desc?.startsWith('LOOPING NEW LIGHTING POINT'));
    expect(wiring?.cells.no).toBe('1');
  });

  test('measured line prints "20FT" and its rate "15/FT"; lump-sum section prints its price on the band', () => {
    const rows = buildRows(d);
    const track = rows.find((r) => r.type === 'line' && r.cells.desc?.startsWith('RECESSED'));
    expect(track?.type === 'line' && [track.cells.qty, track.cells.unit, track.cells.amount]).toEqual(['20FT', '15/FT', '300']);
    const curtain = rows.find((r) => r.type === 'band' && r.text.startsWith('CURTAIN'));
    expect(curtain?.type === 'band' && curtain.amount).toBe('3231');
    const room = rows.find((r) => r.type === 'line' && r.cells.desc === 'MASTER 10 FT');
    expect(room?.type === 'line' && room.cells.no).toBe('1');
  });

  test('waived line keeps its pink highlight and negative amount', () => {
    const waived = buildRows(d).find((r) => r.type === 'line' && r.cells.desc?.startsWith('DEFECT CHECK'));
    expect(waived?.type === 'line' && [waived.highlight, waived.cells.amount]).toEqual(['PINK', '-550']);
  });
});

describe("D'Clover A-3A-3A, format 3 (discount detail)", () => {
  const d = dclover();
  const layout = layoutDocument(d, undefined, { density: 'compact' });

  test('page 1: list TOTAL 37,215.52 with the net subtotal 20,577.71 above it', () => {
    expect(layout.pages[0].listSen).toBe(RM(37215.52));
    expect(layout.pages[0].netSen).toBe(RM(20577.71));
    expect(pageTotalSen(d, layout.pages[0])).toBe(RM(37215.52));
  });

  test('pages 2-8 keep their own totals', () => {
    expect(layout.pages.slice(1, 8).map((p) => [p.listSen, p.netSen])).toEqual(DC_REST.map(([l, n]) => [RM(l), RM(n)]));
  });

  test('last page: TOTAL 137,866.56 -> DISCOUNT 42,623.42 -> FINAL TOTAL 95,243.14', () => {
    expect(summaryRows(d, layout.closing.summary)).toEqual([
      { label: 'TOTAL (RM)', sen: RM(137866.56), tone: 'plain' },
      { label: 'DISCOUNT (RM)', sen: RM(42623.42), tone: 'discount' },
      { label: 'FINAL TOTAL (RM)', sen: RM(95243.14), tone: 'final' },
    ]);
  });

  test('disc price is the discounted amount, the % beside it, amount at list', () => {
    const wall = buildRows(d).find((r) => r.type === 'line' && r.cells.desc === 'WALL CABINET');
    expect(wall?.type === 'line' && [wall.cells.discPrice, wall.cells.disc, wall.cells.amount]).toEqual(['2686.46', '-40%', '4477.44']);
    const shelf = buildRows(d).find((r) => r.type === 'line' && r.cells.desc?.startsWith('WALL SHELF'));
    expect(shelf?.type === 'line' && [shelf.cells.qty, shelf.cells.discPrice, shelf.cells.amount]).toEqual(['3', '1123.2', '1872']);
  });

  test('payment terms carry each instalment; normal density pushes page 1 over two pages', () => {
    expect(layout.closing.termsLines.map((t) => t.label)).toEqual(['1ST PAYMENT - 30%', '2ND PAYMENT - 30%', '3RD PAYMENT - 35%', '4TH PAYMENT - 5%']);
    const normal = layoutDocument(d);
    expect(normal.pages.length).toBeGreaterThan(layout.pages.length);
    expect(normal.closing.summary.finalSen).toBe(RM(95243.14));
  });
});

describe('the other formats', () => {
  test('qty only (Skyline Embassy package): no prices, page totals blank, one package total', () => {
    const d = skyline();
    const layout = layoutDocument(d);
    expect(pageTotalSen(d, layout.pages[0])).toBeNull();
    const row = buildRows(d).find((r) => r.type === 'line');
    expect(row?.type === 'line' && row.cells.amount).toBeUndefined();
    expect(summaryRows(d, layout.closing.summary)).toEqual([{ label: 'TOTAL (RM)', sen: RM(1200 + 600 + 2100 + 1800 + 1600 + 300 + 1400 + 700), tone: 'final' }]);
  });

  test('promotion vs standard (KL 48): promotion = unit price, standard = list price, total at promotion', () => {
    const d = kl48();
    const rows = buildRows(d).filter((r) => r.type === 'line');
    expect([rows[0].cells.promo, rows[0].cells.standard, rows[0].cells.qty]).toEqual(['1800', '2000', 'FULL UNIT']);
    // The sample prints 14,200; its lines add to 14,600 (owner question 1: lines are the rule).
    expect(layoutDocument(d).closing.summary.finalSen).toBe(RM(14600));
  });

  test('unit price format; FOC prints FOC; document discount adds TOTAL -> DISCOUNT -> GRAND TOTAL', () => {
    const d = doc('UNIT_PRICE', [section('X', [item('LOOPING NEW LIGHTING POINT', 65, { qty: 31 }), item('DESIGN', 800, { isFoc: true })])], { docDiscountSen: RM(15), docDiscountLabel: 'Showroom discount' });
    const rows = buildRows(d).filter((r) => r.type === 'line');
    expect([rows[0].cells.unit, rows[0].cells.amount]).toEqual(['65', '2015']);
    expect(rows[1].cells.amount).toBe('FOC');
    const s = layoutDocument(d).closing.summary;
    expect(summaryRows(d, s).map((r) => [r.label, r.sen])).toEqual([['TOTAL (RM)', RM(2015)], ['SHOWROOM DISCOUNT (RM)', RM(15)], ['GRAND TOTAL', RM(2000)]]);
  });

  test('a long document breaks by itself and never leaves a band alone at a page foot', () => {
    const many = Array.from({ length: 80 }, (_, i) => item(`ITEM ${i + 1}`, 10));
    const d = doc('AMOUNT', [section('A', many.slice(0, 26)), section('B', many.slice(26))]);
    const layout = layoutDocument(d);
    expect(layout.pages.length).toBeGreaterThan(2);
    for (const p of layout.pages) {
      if (p.rows.length) expect(p.rows.at(-1)!.type).not.toBe('band');
    }
    expect(layout.pages.reduce((s, p) => s + p.netSen, 0)).toBe(RM(800));
  });
});
