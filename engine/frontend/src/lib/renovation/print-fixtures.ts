/* Print fixtures transcribed from the owner's sample PDFs (the print target of
   the renovation documents). Used by print-layout.test.ts to pin page totals
   and by the render check (scripts/api-checks/renovation-print.mjs) to draw the
   same documents for a side-by-side look. Customer names are replaced; building,
   unit, lines and amounts are as printed.
     AVA Residence B31-09 (Dream Crafter, format 1, six pages, every line).
     D'Clover A-3A-3A (Dream Crafter, format 3): page 1 line by line, pages 2-8 as
       one line per page carrying that page's list and net totals.
     Skyline Embassy Type A (The Conts, format 4) and KL 48 Type B (format 5). */

import type { PrintFormat } from './print-formats';
import type { PrintBrand, PrintDoc, PrintLineInput, PrintSectionInput } from './print-model';

export const RM = (n: number) => Math.round(n * 100);

const COMPANY_LINES = ['THE CONTS SDN BHD 202301027399 (1521322-V)', 'E-28-02 Menara SUEZCAP 2, KL Gateway,', 'No.2, Jalan Kerinchi, Gerbang Kerinchi Lestari,', '59200 Kuala Lumpur, Wilayah Persekutuan KL.'];
const TERMS = ['Customer shall inspect and confirm that goods receive are in good condition.', 'Goods sold are not returnable. All payment are not refundable.',
  'The company reserves the right not to entertain any claims after 7 days from handover.', 'The company reserves the right to refund the customer if the items purchased be discontinued.'];
const INTRO = 'We refer to our meeting with regards the above captioned matter and we are pleased to submit our quotation as follow : -';
export const DREAM_CRAFTER: PrintBrand = { name: 'Dream Crafter', companyLines: COMPANY_LINES, contactLine: 'PHONE : 016-616 4727 // EMAIL : T.CONTS725@GMAIL.COM',
  bankLine: 'Payment shall be made payable to THE CONTS SDN BHD HLBB 23601011471', termsLines: TERMS, intro: INTRO, signatoryCompany: 'THE CONTS SDN BHD' };
export const THE_CONTS: PrintBrand = { ...DREAM_CRAFTER, name: 'The Conts', contactLine: 'PHONE : 018-9444796 // EMAIL : servicesupport@thecontsgroup.com' };

export type L = Partial<PrintLineInput> & { description: string };
export const line = (p: L): PrintLineInput => ({
  kind: 'ITEM', qty: 1, measureMilli: null, measureUom: null, uom: null, unitPriceSen: 0, discountBp: 0,
  amountOverrideSen: null, isFoc: false, ...p,
});
export const item = (description: string, rm: number, p: Partial<L> = {}) => line({ description, unitPriceSen: RM(rm), ...p });
export const child = (description: string, rm: number, p: Partial<L> = {}) => line({ kind: 'CHILD', description, unitPriceSen: RM(rm), parentId: 'p', ...p });
export const detail = (description: string, p: Partial<L> = {}) => line({ kind: 'DETAIL', description, parentId: 'p', ...p });
export const section = (heading: string, lines: PrintLineInput[], p: Partial<PrintSectionInput> = {}): PrintSectionInput => ({ heading, bandColor: null, lumpSumSen: null, lines, ...p });

export const doc = (format: PrintFormat, sections: PrintSectionInput[], extra: Partial<PrintDoc> = {}): PrintDoc => ({
  kind: 'SALES_ORDER', docNo: 'TEST', format,
  brand: DREAM_CRAFTER,
  header: { attention: 'MR CUSTOMER', customerName: 'MR CUSTOMER', building: 'AVA', unitNo: 'B31-09', preparedBy: 'MK', docDate: '2025-11-04', lastAmended: null },
  sections, docDiscountSen: 0, docDiscountLabel: '', promoLines: [], instalments: [], ...extra,
});

export const AVA: PrintSectionInput[] = [
  section('CARPENTRY WORK', [
    item('SWING DOOR WARDROBE ( 1 EP ) @ MASTER', 5323), detail('W : 8.2 FT X D : 2 FT X H : 9.5 FT'), child('W/BACKING', 870), child('SOFT CLOSE DRAWER', 90, { qty: 4 }),
    item('SWING DOOR WARDROBE ( 1 EP ) @ ROOM 2', 3355), detail('W : 5 FT X D : 2 FT X H : 9.5 FT'), child('ALUMINIUM CASING (LED) 8 ft', 200), child('- LED COB STRIPS + TRANSFORMER SET', 200),
    item('STUDY TABLE @ ROOM 2', 930), detail('W : 3 FT'), child('SOFT CLOSE DRAWER', 90, { qty: 2 }),
    item('TV CONSOLE ( SITTING ) @ LIVING', 2480, { pageBreakBefore: true }), detail('W : 8 FT X H : 400MM'), child('- SOFT CLOSE DRAWERS', 90, { qty: 3 }),
    item('TALLCABINET W/4G GLASS DOOR & COLOR CARCASS', 2132.5), detail('( 1 EP)'), detail('W : 1.5 FT X H : 9 FT X D : 400MM'), child('ALUMINIUM CASING (LED) 19 FT', 475), child('- LED COB STRIPS + TRANSFORMER SET', 200),
    item('MULTIPURPOSE CABINET ( 1 EP ) @ DINING', 5552.5), detail('W : 8.5 FT X D : 40 CM X H : 9.5 FT'), child('ALUMINIUM CASING (LED) 10 FT', 250), child('- LED COB STRIPS + TRANSFORMER SET', 200), child('- SOFT CLOSE DRAWERS', 90, { qty: 3 }),
    item('FRIDGE CABINET ( 1 EP ) @ KITCHEN', 967.5, { pageBreakBefore: true }), detail('W : 2.75FT'),
    item('ISLAND CABINET W/BACKING @ KITCHEN', 2820), detail('W : 5 FT X D : 2 FT X H : 106 CM'), child('QUARTZ STONE TOP', 1100), detail('W : 5 FT X D : 2 FT'),
    item('SHOE CABINET @ ENTRANCE', 1170), detail('W : 2 FT X D : 40 CM X H : 9 FT'),
  ], { bandColor: '#4a90d9' }),
  section('M & E WORK', [
    item('WHOLE HOUSE PAINTING (NIPPON EZ WASH )', 3000), item('PLASTER CEILING ( MASTER & LIVING AREA ONLY)', 2300), child('L BOX ( CURTAIN & AIRCOND BOX ) W : 26 FT', 400),
    item('PROJECT MANAGEMENT FEE', 2000), item('POST RENO + FINAL CLEANING', 500), item('FLOOR PROTECTION', 500),
  ], { bandColor: '#4cd964', pageBreakBefore: true }),
  section('LIGHTING & FAN ( INSTALL ONLY , SUPPLY BY OWNER )', [
    item('CEILING LIGHT ( EYEBALL , DOWNLIGHT )', 20, { qty: 27 }), item('CEILING FAN C/W FAN HOOK', 60, { qty: 5 }),
    item('RECESSED MAGNETIC TRACK / LED CASING ON CEILING', 15, { measureMilli: 20000, measureUom: 'FT' }),
    item('T5 LIGHT', 10, { measureMilli: 24000, measureUom: 'FT' }),
  ]),
  section('WIRING', [
    item('LOOPING NEW LIGHTING POINT ( PIPE WORK )', 60, { qty: 27 }), item('LOOP ADDITIONAL SOCKET ( INCLUDE SOCKET )', 120, { qty: 5 }),
    item('LOOP ADDITIONAL SUBSEQUENT SOCKET ( INCLUDE SOCKET )', 70, { qty: 2 }), item('NEW LIGHTPOINT FROM DB ( INCLUDE SWITCH )', 250),
    item('LOOPING SOCKET POINT ONLY ( FOR POWER TRACK )', 100, { qty: 2 }), item('INSTALL POWER SOCKET ONLY', 50, { qty: 2 }),
    item('LOOPING NEW LIGHT POINT W/SWITCH', 140, { qty: 3 }),
  ], { pageBreakBefore: true }),
  section('CURTAIN WORK ( SG PLEAT DOUBLE LAYER ) 35.9 FT', [
    line({ kind: 'DETAIL', description: 'MASTER 10 FT' }), line({ kind: 'DETAIL', description: 'LIVING 10.6 FT' }),
    line({ kind: 'DETAIL', description: 'ROOM 2 6 FT' }), line({ kind: 'DETAIL', description: 'ROOM 3 9.3 FT' }),
  ], { lumpSumSen: RM(3231) }),
  section('ADD ON :', [
    item('WALL SKIM', 300), item('LOOPIING SWITCH FOR EXHAUST FAN', 90), item('ADD ON SOCKET', 120),
    item('DEFECT CHECK ( WAIVED )', -550, { highlight: 'PINK' }),
  ], { pageBreakBefore: true }),
];

export const DC_P1: PrintSectionInput[] = [
  section('CARPENTRY WORK @ ENTRANCE', [
    item('SHOE CABINET FLOATING', 1935, { discountBp: 4000 }), detail('W : 2.5FT X D : 2 FT X H : 2240mm'),
    child('ALU LED CASING W: 5FT @ MIDDLE & BOTTOM', 150, { discountBp: 4000 }),
  ], { bandColor: '#bfe3f5' }),
  section('CARPENTRY WORK @ KITCHEN AREA', [
    item('WALL CABINET', 4477.44, { discountBp: 4000 }), detail('W : 10.6 FT X D : 1FT X H : 1100mm'),
    child('DISH RACK 800mmW', 240, { discountBp: 4000 }), child('ALU LED CASING W: 10.6FT', 318, { discountBp: 4000 }),
    item('BASE CABINET', 4284.38, { discountBp: 4000 }), detail('W :10.6FT X D : 2 FT X H : 900mm'),
    child('INSTALL SINK ONLY (SUPPLY BY OWNER)', 180, { discountBp: 4000 }), child('FOAM BOARD W CARCASE BELOW SINK (WATER PROOF)W : 3FT', 594, { discountBp: 4000 }),
    child('UNDERMOUNTH SOFT CLOSE DRAWER 3 LAYER', 522, { discountBp: 4000 }), child('INSTALL HOOD & HOB (SUPPLY BY OWNER)', 582, { discountBp: 4000 }),
    child('SUPPLY & INSTALL PULL-OUT TEMPERD GLASS SAUCE TARY', 800, { discountBp: 4000 }),
    item('SINTERED STONE TABLE TOP', 5300, { discountBp: 5400 }), detail('W : 10.6FT X D : 2 FT'),
    item('BACKSLAS SINTERED STONE', 7370, { discountBp: 5000 }), detail('W:10.6FT X 2.3FT'),
  ], { bandColor: '#bfe3f5' }),
  section('CARPENTRY WORK @ KITCHEN OPPOSITE', [
    item('FRIDGE CABINET', 2440.4, { discountBp: 4000 }), detail('W : 3.6FT X D : 2FT X H : 10FT'), detail('(2 EP)'),
    item('ISLAND CABINET', 1899.6, { discountBp: 4000 }), detail('W :4.7FT X D :1.4FT X H : 850mm'),
    child('BACK PANEL', 480.7, { discountBp: 4000 }), child('UNDERMOUNTH SOFT CLOSE DRAWER 3 LAYER', 522, { qty: 2, discountBp: 4000 }),
    item('SINTERED STONE TABLE TOP', 2726, { discountBp: 5000 }), detail('W : 4.7FT X D :2 FT'),
    item('WALL SHELF @ FRIDGE CABINET EP', 624, { qty: 3, discountBp: 4000 }), detail('W: 2 FT X D: 350mm'),
  ], { bandColor: '#bfe3f5' }),
];

/* Pages 2-8 of the sample: [list total, net total] as printed (net rounded to the sen). */
export const DC_REST: Array<[number, number]> = [[33825.36, 20295.22], [16028.68, 9617.21], [5972, 4777.6], [23243, 19694.4], [8370, 8370], [6707, 6707], [6505, 5204]];

export const dclover = (): PrintDoc => doc('DISCOUNT', [
  ...DC_P1,
  ...DC_REST.map(([list, net], i) => section(`PAGE ${i + 2}`, [item(`Lines of sample page ${i + 2}`, list, { amountOverrideSen: RM(net) })], { pageBreakBefore: true })),
], {
  kind: 'QUOTATION',
  promoLines: [{ text: 'SHOW ROOM DISCOUNT - RM42,623.42', color: '#ffff00' }, { text: 'FREE UPGRADE TO MELAMINE E0 - CARPENTRY WORK', color: '#bfe3f5' }, { text: 'FOC DEFCET CHECKING', color: '#f5c6e6' }],
  instalments: [
    { seq: 1, label: '1ST PAYMENT', pctBp: 3000, description: 'Upon confirmation, we will proceed with key collection, arrange defect inspection, and conduct site measurement for design drawings.' },
    { seq: 2, label: '2ND PAYMENT', pctBp: 3000, description: 'Once defects are rectified and the design is finalized, we will begin initial works such as ceiling, electrical, and painting.' },
    { seq: 3, label: '3RD PAYMENT', pctBp: 3500, description: 'A detailed work schedule, including the estimated completion date, will be provided prior to cabinet installation.' },
    { seq: 4, label: '4TH PAYMENT', pctBp: 500, description: 'Final payment shall be made upon project completion and site inspection by the owner. Any defects identified will be rectified within 7 days prior to final payment.' },
  ],
});


export const skyline = (): PrintDoc => doc('QTY_ONLY', [
  section('LIVING AREA', [item('MUJI DESIGN TV CABINET', 1200), item('MUJI COFFEE TABLE SET', 600), item('PREMIUM SOFA 2.5S', 2100)]),
  section('BEDROOM SET', [
    item('JAGER BEDFRAME +DIVAN 8+2 INCH (Q)', 900, { qty: 2 }), item('AKEMI HOTEL PREMIUM GALLENT (Q)', 800, { qty: 2 }), item('MUJI SIDE TABLE', 150, { qty: 2 }),
    item('MUJI 3 DOOR SOFT CLOSE WARDROBE', 1400, { highlight: 'GREY' }), item('MUJI OPEN SHELF WARDROBE', 700),
  ]),
], { kind: 'QUOTATION', brand: THE_CONTS, header: { attention: 'MR HANDSOME / MS PRETTY', customerName: 'TYPE A SKYLINE EMBASSY', building: 'SKYLINE EMBASSY', unitNo: '2B1B', preparedBy: 'WILLIAM', docDate: '2026-01-01', lastAmended: null } });

export const kl48 = (): PrintDoc => doc('PROMO_STANDARD', [
  section('UNIT APPLIANCES', [item('CURTAIN SINGLE LAYER MUJI', 1800, { listPriceSen: RM(2000), uom: 'FULL' })]),
  section('OTHERS APPLIANCES', [item('HISENSE TELEVISION 50 INCH', 1300, { listPriceSen: RM(1500) }), item('MIDEA WASHING MACHINE & DRYER 2 IN1', 1300, { listPriceSen: RM(1500) })]),
  section('AIRBNB', [
    item('AMENITIES', 3000, { listPriceSen: RM(4000) }), item('LINENS SET', 1800, { qty: 3, listPriceSen: RM(1800) }), item('STYLING AND DECORATION', 800, { listPriceSen: RM(1000) }),
    item('SET UP SOP AND PROJECT MANAGEMENT', 500, { listPriceSen: RM(1200) }), item('LABOUR AND INSTALLATION', 500, { listPriceSen: RM(1200) }),
  ]),
], { kind: 'QUOTATION', brand: THE_CONTS, header: { attention: 'MR/MS', customerName: 'TYPE B', building: 'KL 48', unitNo: '', preparedBy: '', docDate: null, lastAmended: null } });
