import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Company } from '../../functions/_lib/letterhead';
import type { PayFigures } from '../../functions/_lib/payrollCalc';
import { pcbHasFigure, PCB_STATUS_NOTE } from '../../functions/_lib/pcb';
import { safe } from './statementPdf';
import { rm as ringgit } from './format';

/**
 * One payslip as an A4 PDF (HR phase 4), for the desk's Payroll tab and the portal's Pay screen. Load it with a dynamic
 * import: pdf-lib stays out of the first download (the entry-bundle check). Laid out like Hookka's payslip: letterhead,
 * who and when, earnings beside deductions, net pay, then the employer's share and the month's days.
 */

export interface PayslipDoc extends PayFigures {
  period: string; employeeName: string; employeeNo: string | null; payBasis: 'monthly' | 'daily';
  paymentMethod: 'transfer' | 'cash'; bankName: string | null; bankAccount: string | null;
  /** An estimate or a draft prints a warning band; approved and paid do not. */
  status: 'estimate' | 'draft' | 'approved' | 'paid';
}

const MM = 72 / 25.4, W = 210 * MM, H = 297 * MM, L = 16 * MM, R = W - 16 * MM;
const INK = rgb(0.1, 0.1, 0.1), MUTED = rgb(0.42, 0.41, 0.39), WARN = rgb(0.54, 0.35, 0.07), LINE = rgb(0.85, 0.84, 0.81);
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const rm = (sen: number): string => (sen < 0 ? `-${ringgit(-sen)}` : ringgit(sen));
export const periodLabel = (p: string): string => `${MON[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export async function payslipPdf(s: PayslipDoc, company: Company): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Payslip ${s.employeeName} ${s.period}`);
  doc.setAuthor(safe(company.legalName));
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = H - 16 * MM;

  const t = (str: string, x: number, at: number, o: { size?: number; f?: PDFFont; right?: boolean; color?: typeof INK } = {}) => {
    // The built-in font has no long dashes (PCB notes use them): print a plain hyphen rather than "?".
    const size = o.size ?? 9.5, f = o.f ?? font, txt = safe(str.replace(/[–—]/g, '-'));
    page.drawText(txt, { x: o.right ? x - f.widthOfTextAtSize(txt, size) : x, y: at, size, font: f, color: o.color ?? INK });
  };
  const rule = (at: number, p: PDFPage = page) => p.drawLine({ start: { x: L, y: at }, end: { x: R, y: at }, thickness: 0.8, color: LINE });

  t(company.legalName.toUpperCase(), L, y, { size: 14, f: bold }); y -= 13;
  if (company.companyNumber) { t(`Company No: ${company.companyNumber}`, L, y, { size: 8, color: MUTED }); y -= 11; }
  for (const line of company.address.split('\n')) { t(line, L, y, { size: 8.5, color: MUTED }); y -= 10.5; }
  y -= 6; rule(y); y -= 20;
  t('PAYSLIP', L, y, { size: 16, f: bold }); t(periodLabel(s.period), R, y, { size: 12, f: bold, right: true }); y -= 16;
  if (s.status === 'estimate' || s.status === 'draft') {
    t(s.status === 'estimate' ? 'ESTIMATE of the month so far: not a payslip. Figures change until the office approves the month.'
      : 'DRAFT: the office has not approved this payslip yet. Figures can still change.', L, y, { size: 9, f: bold, color: WARN });
    y -= 16;
  }

  const who: [string, string][] = [
    ['Name', s.employeeName], ['Employee ID', s.employeeNo ?? '-'], ['Paid', s.payBasis === 'daily' ? 'By the day' : 'Monthly salary'],
    ['Paid into', s.paymentMethod === 'cash' ? 'Cash' : `${s.bankName ?? 'Bank not set'}${s.bankAccount ? ` ****${s.bankAccount.slice(-4)}` : ''}`],
  ];
  for (const [k, v] of who) { t(k, L, y, { color: MUTED }); t(v, L + 32 * MM, y, { f: bold }); y -= 13; }
  y -= 8;

  const mid = (L + R) / 2, colW = mid - L - 6 * MM;
  const earnings: [string, number][] = [
    s.payBasis === 'daily'
      ? [`Days worked (${s.daysWorked} x ${rm(s.dayRateSen)})`, s.daysWorked * s.dayRateSen]
      : ['Basic salary', s.basicSalarySen],
  ];
  if (s.absentDays) earnings.push([`Absent ${s.absentDays} ${s.absentDays === 1 ? 'day' : 'days'}`, -s.absenceDeductionSen]);
  if (s.lateShortHours) earnings.push([`Late / short ${s.lateShortHours} h`, -s.lateShortSen]);
  if (s.otHours) earnings.push([`Overtime ${s.otHours} h`, s.otSen]);
  if (s.sundayHours) earnings.push([`Sunday ${s.sundayHours} h`, s.sundaySen]);
  if (s.holidayHours) earnings.push([`Public holiday ${s.holidayHours} h`, s.holidaySen]);
  if (s.allowanceSen) earnings.push(['Leader allowance', s.allowanceSen]);
  const pcbShown = pcbHasFigure(s.pcbStatus);
  const deductions: [string, string][] = [
    ['EPF', rm(s.epfEmployeeSen)], ['SOCSO', rm(s.socsoEmployeeSen)], ['EIS', rm(s.eisEmployeeSen)],
    ['PCB (tax)', pcbShown ? rm(s.pcbSen) : '-'],
  ];
  if (s.advanceSen) deductions.push(['Advance taken back', rm(s.advanceSen)]);
  if (s.penaltySen) deductions.push(['Penalty', rm(s.penaltySen)]);
  const top = y;
  t('EARNINGS', L, y, { size: 8.5, f: bold, color: MUTED }); t('DEDUCTIONS', mid + 6 * MM, y, { size: 8.5, f: bold, color: MUTED }); y -= 6; rule(y); y -= 13;
  let yl = y, yr = y;
  for (const [k, v] of earnings) { t(k, L, yl); t(rm(v), L + colW, yl, { right: true }); yl -= 13; }
  for (const [k, v] of deductions) { t(k, mid + 6 * MM, yr); t(v, R, yr, { right: true }); yr -= 13; }
  y = Math.min(yl, yr) - 2; rule(y); y -= 13;
  t('Gross pay', L, y, { f: bold }); t(rm(s.grossSen), L + colW, y, { f: bold, right: true });
  t('Total deductions', mid + 6 * MM, y, { f: bold }); t(rm(s.totalDeductionsSen + s.advanceSen + s.penaltySen), R, y, { f: bold, right: true });
  page.drawLine({ start: { x: mid, y: top + 10 }, end: { x: mid, y: y - 4 }, thickness: 0.8, color: LINE });
  y -= 22;
  page.drawRectangle({ x: L, y: y - 8, width: R - L, height: 26, color: rgb(0.96, 0.95, 0.93) });
  t('NET PAY', L + 4 * MM, y, { size: 12, f: bold }); t(rm(s.netSen), R - 4 * MM, y, { size: 13, f: bold, right: true });
  y -= 30;

  t('EMPLOYER PAYS ON TOP', L, y, { size: 8.5, f: bold, color: MUTED }); y -= 13;
  t(`EPF ${rm(s.epfEmployerSen)}    SOCSO ${rm(s.socsoEmployerSen)}    EIS ${rm(s.eisEmployerSen)}`, L, y); y -= 20;
  t('THE MONTH', L, y, { size: 8.5, f: bold, color: MUTED }); y -= 13;
  t(`Working days ${s.workingDays}    Worked ${s.daysWorked}    Paid leave ${s.paidLeaveDays}    Absent ${s.absentDays}`, L, y); y -= 20;

  rule(y); y -= 12;
  t(pcbShown ? PCB_STATUS_NOTE[s.pcbStatus] : s.pcbNote, L, y, { size: 7.5, color: MUTED });
  t('Computer-generated payslip. No signature needed.', L, 14 * MM, { size: 7.5, color: MUTED });
  return doc.save();
}

/** Builds the PDF and hands it to the browser as a download. */
export async function downloadPayslip(s: PayslipDoc, company: Company): Promise<void> {
  const bytes = await payslipPdf(s, company);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `payslip-${s.employeeName.replace(/[^\w-]+/g, '-').toLowerCase()}-${s.period}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
