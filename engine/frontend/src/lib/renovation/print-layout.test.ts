// Page totals against the owner's sample PDFs:
//   AVA Residence B31-09 (Dream Crafter, format 1, six pages): 11,418 / 11,830 / 6,057.5 / 10,080 / 6,561 / -40,
//     GRAND TOTAL 45,906.5. Every line transcribed from the PDF; page breaks where the sample breaks.
//   D'Clover A-3A-3A (Dream Crafter, format 3): page 1 transcribed line by line (net 20,577.71 against list
//     37,215.52, each discounted line rounded to the sen); pages 2-8 as one line per page carrying that page's
//     list and net totals (typed amount); last page TOTAL 137,866.56 / DISCOUNT 42,623.42 / FINAL 95,243.14.
import { describe, expect, test } from 'vitest';
import { closingHeight, layoutDocument, pageTotalSen, summaryRows } from './print-layout';
import { buildRows, clientContactLine, rmGrouped, splitDimensions } from './print-model';
import { AVA, DC_REST, dclover, doc, item, kl48, RM, section, skyline } from './print-fixtures';

describe('AVA Residence B31-09, format 1 (amount only)', () => {
  const d = doc('AMOUNT', AVA);
  const layout = layoutDocument(d);

  test('six pages with the sample page totals', () => {
    expect(layout.pages.map((p) => pageTotalSen(d, p))).toEqual([RM(11418), RM(11830), RM(6057.5), RM(10080), RM(6561), RM(-40)]);
  });

  test('page totals print as the sample does', () => {
    expect(layout.pages.map((p) => rmGrouped(pageTotalSen(d, p)!))).toEqual(['11,418.00', '11,830.00', '6,057.50', '10,080.00', '6,561.00', '-40.00']);
  });

  test('GRAND TOTAL 45,906.5 on the last page; no closing page needed', () => {
    expect(layout.closing.summary.finalSen).toBe(RM(45906.5));
    expect(summaryRows(d, layout.closing.summary)).toEqual([{ label: 'GRAND TOTAL', sen: RM(45906.5), tone: 'final' }]);
    expect(layout.closing.ownPage).toBe(false);
    expect(layout.pages.at(-1)!.isLast).toBe(true);
  });

  test('numbering runs through the whole document, add-ons and dimensions unnumbered', () => {
    const rows = buildRows(d).filter((r) => r.type === 'line');
    const nums = rows.map((r) => r.cells.no ?? '').filter(Boolean);
    expect(nums.slice(0, 1).concat(rows.map((r) => r.cells.no ?? '').slice(1, 4))).toEqual(['1', '', '', '']);
    expect(nums).toEqual(nums.map((_, i) => String(i + 1)));
  });

  test('measured line prints "20FT" and its rate "15/FT"; lump-sum section prints its price on the band', () => {
    const rows = buildRows(d);
    const track = rows.find((r) => r.type === 'line' && r.cells.desc?.startsWith('RECESSED'));
    expect(track?.type === 'line' && [track.cells.qty, track.cells.unit, track.cells.amount]).toEqual(['20FT', '15.00/FT', '300.00']);
    const curtain = rows.find((r) => r.type === 'band' && r.text.startsWith('CURTAIN'));
    expect(curtain?.type === 'band' && curtain.amount).toBe('3,231.00');
    const room = rows.find((r) => r.type === 'line' && r.cells.desc === 'MASTER 10 FT');
    expect(room?.type === 'line' && Number(room.cells.no)).toBeGreaterThan(1);
  });

  test('waived line keeps its pink highlight and negative amount', () => {
    const waived = buildRows(d).find((r) => r.type === 'line' && r.cells.desc?.startsWith('DEFECT CHECK'));
    expect(waived?.type === 'line' && [waived.highlight, waived.cells.amount]).toEqual(['PINK', '-550.00']);
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
    expect(wall?.type === 'line' && [wall.cells.discPrice, wall.cells.disc, wall.cells.amount]).toEqual(['2,686.46', '-40%', '4,477.44']);
    const shelf = buildRows(d).find((r) => r.type === 'line' && r.cells.desc?.startsWith('WALL SHELF'));
    expect(shelf?.type === 'line' && [shelf.cells.qty, shelf.cells.discPrice, shelf.cells.amount]).toEqual(['3', '1,123.20', '1,872.00']);
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
    expect([rows[0].cells.promo, rows[0].cells.standard, rows[0].cells.qty]).toEqual(['1,800.00', '2,000.00', 'FULL UNIT']);
    // The sample prints 14,200; its lines add to 14,600 (owner question 1: lines are the rule).
    expect(layoutDocument(d).closing.summary.finalSen).toBe(RM(14600));
  });

  test('unit price format; FOC prints FOC; document discount adds TOTAL -> DISCOUNT -> GRAND TOTAL', () => {
    const d = doc('UNIT_PRICE', [section('X', [item('LOOPING NEW LIGHTING POINT', 65, { qty: 31 }), item('DESIGN', 800, { isFoc: true })])], { docDiscountSen: RM(15), docDiscountLabel: 'Showroom discount' });
    const rows = buildRows(d).filter((r) => r.type === 'line');
    expect([rows[0].cells.unit, rows[0].cells.amount]).toEqual(['65.00', '2,015.00']);
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

describe('closingHeight', () => {
  test('leaves room for what the closing block draws', () => {
    const wrap = () => ['one', 'two', 'three'];
    const instalments = [1, 2, 3, 4].map((seq) => ({ seq, label: `${seq}`, pctBp: 2500, description: 'x' }));
    const { height } = closingHeight({ promoLines: [], instalments, kind: 'SALES_ORDER' } as never, wrap);
    expect(height).toBeCloseTo(6 + 10.5 + 4 * (3 * 3.9 + 1.2) + 4 + 34);
  });
});

describe('quotation layout (QT-2611-017)', () => {
  test('dimensions move to a sub-line, normalised; the title keeps its words', () => {
    expect(splitDimensions('Built-in - Shoe cabinet - W : 3 FT X H : FH X D : 400 MM')).toEqual({ title: 'Built-in - Shoe cabinet', dimensions: 'W: 3 FT × H: FH × D: 400 MM' });
    expect(splitDimensions('Built-in TV Console - W : 7.9  FT X H : 450MM  X D : 400 MM')).toEqual({ title: 'Built-in TV Console', dimensions: 'W: 7.9 FT × H: 450 MM × D: 400 MM' });
    expect(splitDimensions('Built-in Wall Cabinet - ( L SHAPE ) - W : 10 FT X H : 3 FT X D : 1 FT').title).toBe('Built-in Wall Cabinet - ( L SHAPE )');
    expect(splitDimensions('Built-in Ep')).toEqual({ title: 'Built-in Ep', dimensions: '' });
    expect(splitDimensions('LED STRIP: WARM WHITE')).toEqual({ title: 'LED STRIP: WARM WHITE', dimensions: '' });
  });

  test('a line under its own area banner drops "@ area"; banners print upper case on the light blue', () => {
    const d = doc('DISCOUNT', [
      section('entrance area', [item('Built-in - Shoe cabinet - W : 3 FT X H : FH X D : 400 MM', 1995, { room: 'entrance area' })]),
      section('SUITE 2 (GROUND FLOOR)', [item('Built-in Ep @ SUITE 2 (GROUND FLOOR)', 310, { qty: 2, room: 'SUITE 2 ( GROUND FLOOR )' }), item('Study table', 850, { room: 'Bedroom' })]),
    ]);
    const rows = buildRows(d);
    expect(rows[0]).toMatchObject({ type: 'band', text: 'ENTRANCE AREA', color: '#DCE8F5' });
    const lines = rows.filter((r) => r.type === 'line');
    expect(lines.map((r) => [r.cells.no, r.cells.desc, r.dimensions])).toEqual([
      ['1', 'Built-in - Shoe cabinet', 'W: 3 FT × H: FH × D: 400 MM'], ['2', 'Built-in Ep', ''], ['3', 'Study table @ Bedroom', ''],
    ]);
    expect(lines[0].cells.discPrice).toBe('1,995.00');
  });

  test('a dimension sub-line adds its height', () => {
    const plain = layoutDocument(doc('AMOUNT', [section('A', [item('Shoe cabinet', 10)])])).pages[0].rows[1];
    const sized = layoutDocument(doc('AMOUNT', [section('A', [item('Shoe cabinet - W : 3 FT', 10)])])).pages[0].rows[1];
    expect(sized.dimensionLines).toEqual(['W: 3 FT']);
    expect(sized.heightMm).toBeGreaterThan(plain.heightMm);
  });

  test('the contact line leaves out the unit and building printed on the right', () => {
    expect(clientContactLine({ customerPhone: '+60162210711', siteAddress: 'LEBUH RAYA KUALA LUMPUR - SEREMBAN\nTAMAN SERDANG RAYA\nA-13-10 QUAVER RESIDENCE', building: 'QUAVER RESIDENCE', unitNo: 'A-13-10' }))
      .toBe('+60162210711 · LEBUH RAYA KUALA LUMPUR - SEREMBAN, TAMAN SERDANG RAYA');
    expect(clientContactLine({ customerPhone: '', siteAddress: 'No 1, Jalan 1\nTAMAN SERDANG RAYA, A-13-10 QUAVER RESIDENCE', building: 'QUAVER RESIDENCE', unitNo: '1' }))
      .toBe('No 1, Jalan 1, TAMAN SERDANG RAYA, A-13-10 QUAVER RESIDENCE');
  });
});
