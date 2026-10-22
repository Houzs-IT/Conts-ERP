// node --test src/lib/statementPdf.test.mjs (npm test). One owner with two units, as /api/statements/:id/report answers.
// STATEMENT_PDF_OUT=<file> also writes the PDF, to look at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { statementPdf, safe } from './statementPdf.ts';

const year = (net) => ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((label, i) => ({
  month: `2026-${String(i + 1).padStart(2, '0')}`, label, gross: i < 9 ? 500000 : null, deductions: i < 9 ? -80000 : null,
  operator: i < 9 ? -120000 : null, net: i < 9 ? net : null, source: i < 3 ? 'workbook' : 'statement',
}));
const unit = (over) => ({
  unitId: 'u1', code: 'SKY-D49-03A', refNo: '2609-D4903A', address: 'Skyline KL, Jalan 1, No. 3', propertyName: 'Skyline KL', unitNumber: 'D49-03A',
  basis: 'share', model: 'management', nights: 24, days: 30, occupancy: 0.8, gross: 500000,
  deductions: [{ key: 'clean', label: 'Cleaning', quantity: 6, uom: 'times', price: 6000, amount: -36000 }, { key: 'util', label: 'Utilities', quantity: null, uom: null, price: null, amount: -44000 }],
  deductionsTotal: -80000, net: 420000, operatorPct: 30, operatorShare: 126000, guarantee: 0, topUp: 0, fixedRent: 0,
  payoutBeforeAdjustments: 294000, adjustments: [{ id: 'a1', description: 'Aircon repair', amount: -15000 }], netPayout: 279000,
  year: year(279000), yearTotal: { gross: 4500000, deductions: -720000, operator: -1080000, net: 2511000 },
  ...over,
});
const report = {
  statementId: 's1', period: '2026-09', periodEnd: '2026-09-30', state: 'provisional',
  settings: {
    company: { legalName: 'The Conts Sdn Bhd', companyNumber: '202401000001', address: 'No. 2, Jalan Kerinchi\nKL Gateway, Kerinchi Lestari, 59200 Kuala Lumpur', phone: '+60 11-6133 3289', email: 'hello@example.com', logo: '' },
    paymentTerms: 'Within 14 days', monthlyTerms: ['Figures are in Malaysian ringgit.', 'Report errors within 7 days of this statement.'], yearTerms: ['Year to date from Property OS statements.'],
  },
  // A Chinese character the built-in font cannot draw: it must print as "?" rather than stop the file.
  owner: { name: 'Lim 林 Chee Keong', phone: '+60 12-345 6789', email: 'lim@example.com' },
  units: [unit({}), unit({ unitId: 'u2', code: 'SKY-A30-07', refNo: '2609-A3007', basis: 'fixed_rent', model: 'grr', fixedRent: 310000, payoutBeforeAdjustments: 310000, adjustments: [], netPayout: 310000 })],
};

test('two units: the owner pages, then a month and a year page per unit', async () => {
  const bytes = await statementPdf(report);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 6);
  if (process.env.STATEMENT_PDF_OUT) writeFileSync(process.env.STATEMENT_PDF_OUT, bytes);
});

test('one unit: no owner pages', async () => {
  const bytes = await statementPdf({ ...report, state: 'sent', units: [unit({})] });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});

test('characters outside the built-in font become "?"', () => {
  assert.equal(safe('Lim 林 − café'), 'Lim ? ? café');
});
