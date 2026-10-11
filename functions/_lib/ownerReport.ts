/** The Owner Income Report (the owner's own two-page layout): page 1 is one unit's month, page 2 its year to date.
 *  Figures come from the statement as generated (statement_units + statement_lines), so the report shows exactly
 *  what was finalised; earlier months of the year come from their own statements, else are worked out from the
 *  data by the same rules (ownerStatement.ts), else, for months only the owner workbook knows, show what was paid. */
import { DEDUCTIONS, loadInputs, computeMonth, statementSettings, type Query } from './ownerStatement';
import { monthEndExclusive } from './revenue';
import { companyFrom, type Company } from './letterhead';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 'Trion KL (2)' + 'A35-03A' -> 'TRION-A3503A', the way the owner workbook names units. */
export function unitCode(propertyName: string, unitNumber: string): string {
  const words = propertyName.toUpperCase().replace(/\(.*?\)/g, ' ').split(/\s+/).filter(Boolean);
  const tag = propertyName.includes('&') ? words.join(' ') : words[0] === 'THE' || (words[0]?.length ?? 0) <= 2 ? words.slice(0, 2).join(' ') : words[0] ?? '';
  return `${tag}-${unitNumber.toUpperCase().replace(/[\s-]/g, '')}`;
}

export type { Company } from './letterhead';

/** The terms printed on the owner's own report (Sep 2026 sample), used until Settings > Owner Income Report saves others. */
export const DEFAULT_MONTHLY_TERMS = [
  'Rental/booking revenue is based on actual confirmed stays during the billing month.',
  'Cleaning, utilities, maintenance, and other expenses are deducted as per agreed service terms.',
  'Owner payouts will be processed and transferred by the 7 working day of the following month, unless delayed by force majeure or third-party platform settlement.',
  'Any discrepancies or disputes regarding the report must be raised in writing within 7 days of receiving the statement. After this period, the report is deemed accepted.',
  'This report is confidential and is intended solely for the property owner. It may not be shared or disclosed to third parties without written consent from The Conts Sdn Bhd.',
].join('\n');
export const DEFAULT_YEAR_TERMS = [
  'All monthly payouts have been made based on verified reports. This annual summary is for owner reference and may be used for internal financial review or tax preparation.',
  'Any income or cost adjustment (e.g., guest refunds, penalty charges, or ad-hoc maintenance) will be reflected in the monthly reports and carried forward into the annual summary accordingly.',
  'This report is confidential and is intended solely for the property owner. It may not be shared or disclosed to third parties without written consent from The Conts Sdn Bhd.',
].join('\n');
export interface ReportSettings { company: Company; paymentTerms: string; monthlyTerms: string[]; yearTerms: string[] }

export async function reportSettings(q: Query): Promise<ReportSettings> {
  const rows = await q<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key LIKE 'company.%' OR key LIKE 'org.%' OR key LIKE 'report.%'`);
  const m = new Map(rows.map(r => [r.key, r.value]));
  const lines = (v: string | undefined) => (v ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return {
    // The same details, and the same defaults, as every printed document (letterhead.ts).
    company: companyFrom(m),
    paymentTerms: m.get('report.paymentTerms') ?? '7th every month',
    // Saved empty prints none; never saved prints the owner's own terms.
    monthlyTerms: lines(m.get('report.monthlyTerms') ?? DEFAULT_MONTHLY_TERMS),
    yearTerms: lines(m.get('report.yearTerms') ?? DEFAULT_YEAR_TERMS),
  };
}

export interface ReportRow { key: string; label: string; quantity: number | null; uom: string | null; price: number | null; amount: number }
export interface YearRow { month: string; label: string; gross: number | null; deductions: number | null; operator: number | null; net: number | null; source: 'statement' | 'computed' | 'workbook' | 'none' }
export interface ReportUnit {
  unitId: string; code: string; refNo: string; address: string | null; propertyName: string; unitNumber: string;
  basis: 'share' | 'fixed_rent'; model: string | null; nights: number; days: number; occupancy: number;
  gross: number; deductions: ReportRow[]; deductionsTotal: number; net: number; operatorPct: number | null; operatorShare: number;
  guarantee: number; topUp: number; fixedRent: number; payoutBeforeAdjustments: number;
  adjustments: { id: string; description: string; amount: number }[]; netPayout: number;
  year: YearRow[]; yearTotal: { gross: number; deductions: number; operator: number; net: number };
}
export interface Report {
  statementId: string; period: string; periodEnd: string; state: string; settings: ReportSettings;
  owner: { name: string; phone: string | null; email: string | null };
  units: ReportUnit[];
}

/** Everything the report page prints, for one statement and optionally one of its units. Null if the statement
 *  does not exist. A statement from the owner workbook (paid history) has no unit figures and yields no units. */
export async function buildReport(q: Query, statementId: string, onlyUnit: string | null): Promise<Report | null> {
  const s = (await q<any>(`SELECT s.*, o.display_name, o.legal_name, o.phone, o.email FROM owner_statements s JOIN owners o ON o.id = s.owner_id WHERE s.id = ?`, statementId))[0];
  if (!s) return null;
  const period = String(s.period_start).slice(0, 7), year = period.slice(0, 4);
  const [settings, units, lines] = await Promise.all([
    reportSettings(q),
    q<any>(`SELECT su.*, u.unit_number, u.address, p.name AS property_name FROM statement_units su JOIN units u ON u.id = su.unit_id JOIN properties p ON p.id = u.property_id
            WHERE su.statement_id = ? ${onlyUnit ? 'AND su.unit_id = ?' : ''} ORDER BY p.name, u.unit_number`, ...(onlyUnit ? [statementId, onlyUnit] : [statementId])),
    q<any>(`SELECT * FROM statement_lines WHERE statement_id = ? ORDER BY sort_order`, statementId),
  ]);
  const firstUnit = (await q<{ unit_id: string }>(`SELECT su.unit_id FROM statement_units su JOIN units u ON u.id = su.unit_id JOIN properties p ON p.id = u.property_id
    WHERE su.statement_id = ? ORDER BY p.name, u.unit_number LIMIT 1`, statementId))[0]?.unit_id ?? null;

  const out: ReportUnit[] = [];
  for (const u of units) {
    const mine = lines.filter((l: any) => (l.unit_id ?? firstUnit) === u.unit_id);
    const deductions: ReportRow[] = DEDUCTIONS.map(([key, label, uom]) => {
      const ls = mine.filter((l: any) => l.line_type === 'expense' && l.category === key);
      const amount = -ls.reduce((n: number, l: any) => n + Number(l.amount), 0);
      const amounts = ls.map((l: any) => -Number(l.amount));
      // As the owner's report prints them: cleaning by the session (9 sessions x 80.00); every other row 1 of its unit
      // at the row's total (Additional Deduction 1 tasks 640.00), and 1 with '-' when there is nothing.
      const perUnit = uom === 'sessions';
      const quantity = !ls.length ? 1 : perUnit ? ls.length : 1;
      const price = !ls.length ? null : perUnit ? (amounts.every((a: number) => a === amounts[0]) ? amounts[0] : null) : amount;
      return { key, label, quantity, uom, price, amount };
    });
    const adjustments = mine.filter((l: any) => l.line_type === 'adjustment' && !['guarantee_top_up', 'fixed_rent'].includes(l.category))
      .map((l: any) => ({ id: l.id, description: l.description, amount: Number(l.amount) }));
    const code = unitCode(u.property_name, u.unit_number);
    out.push({
      unitId: u.unit_id, code, refNo: `${period.slice(2, 4)}${period.slice(5, 7)}-${code}`, address: u.address, propertyName: u.property_name, unitNumber: u.unit_number,
      basis: u.basis, model: u.revenue_model ?? null, nights: Number(u.nights), days: Number(u.days), occupancy: Number(u.days) ? Number(u.nights) / Number(u.days) : 0,
      gross: Number(u.gross_income), deductions, deductionsTotal: Number(u.deductions), net: Number(u.net_income),
      operatorPct: u.owner_pct === null ? null : 100 - Number(u.owner_pct), operatorShare: Number(u.operator_share),
      guarantee: Number(u.guarantee), topUp: Number(u.top_up), fixedRent: Number(u.fixed_rent), payoutBeforeAdjustments: Number(u.payout_before_adjustments),
      // From the lines, so a manual adjustment added after generating (statements/:id/adjust) is on the report too.
      adjustments, netPayout: Number(u.payout_before_adjustments) + adjustments.reduce((n: number, a: { amount: number }) => n + a.amount, 0),
      year: await yearToDate(q, u.unit_id, s.owner_id, period, year),
      yearTotal: { gross: 0, deductions: 0, operator: 0, net: 0 },
    });
  }
  for (const u of out) {
    for (const r of u.year) {
      u.yearTotal.gross += r.gross ?? 0; u.yearTotal.deductions += r.deductions ?? 0; u.yearTotal.operator += r.operator ?? 0; u.yearTotal.net += r.net ?? 0;
    }
  }
  return {
    statementId, period, periodEnd: s.period_end, state: s.state, settings,
    owner: { name: s.legal_name || s.display_name, phone: s.phone || null, email: s.email || null }, units: out,
  };
}

/** JAN..DEC for one unit. NET INCOME is the payout before owner adjustments (as on the owner's own report). */
async function yearToDate(q: Query, unitId: string, ownerId: string, period: string, year: string): Promise<YearRow[]> {
  const stored = await q<any>(`
    SELECT substr(s.period_start, 1, 7) AS month, su.gross_income, su.deductions, su.operator_share, su.payout_before_adjustments, su.basis, su.fixed_rent
    FROM statement_units su JOIN owner_statements s ON s.id = su.statement_id
    WHERE su.unit_id = ? AND s.owner_id = ? AND s.period_start >= ? AND s.period_start <= ?`, unitId, ownerId, `${year}-01-01`, `${period}-01`);
  const workbook = await q<any>(`
    SELECT substr(s.period_start, 1, 7) AS month, SUM(l.amount) AS paid FROM statement_lines l JOIN owner_statements s ON s.id = l.statement_id
    WHERE s.source = 'owner_workbook' AND l.unit_id = ? AND s.period_start >= ? AND s.period_start < ? GROUP BY 1`, unitId, `${year}-01-01`, `${period}-01`);
  const storedOf = new Map(stored.map(r => [r.month, r])), paidOf = new Map(workbook.map(r => [r.month, Number(r.paid)]));
  const missing = MON.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter(m => m <= period && !storedOf.has(m));
  const live = new Map<string, ReturnType<typeof computeMonth>[number]>();
  if (missing.length) {
    const [settings, inputs] = await Promise.all([statementSettings(q), loadInputs(q, `${missing[0]}-01`, monthEndExclusive(missing[missing.length - 1]), { unitId })]);
    for (const m of missing) { const r = computeMonth(m, inputs, settings, 'dated').find(x => x.unitId === unitId); if (r) live.set(m, r); }
  }
  return MON.map((label, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    if (month > period) return { month, label, gross: null, deductions: null, operator: null, net: null, source: 'none' as const };
    const st = storedOf.get(month);
    if (st) return st.basis === 'fixed_rent'
      ? { month, label, gross: Number(st.fixed_rent), deductions: 0, operator: 0, net: Number(st.payout_before_adjustments), source: 'statement' as const }
      : { month, label, gross: Number(st.gross_income), deductions: Number(st.deductions), operator: Number(st.operator_share), net: Number(st.payout_before_adjustments), source: 'statement' as const };
    const lv = live.get(month);
    // A month the workbook paid but whose bookings were never imported (before March 2026) shows what was paid.
    if (paidOf.has(month) && (!lv || lv.nights === 0)) return { month, label, gross: null, deductions: null, operator: null, net: paidOf.get(month)!, source: 'workbook' as const };
    if (!lv || lv.terms.basis === 'none' || (lv.nights === 0 && lv.gross === 0 && lv.deductions === 0 && lv.payoutBeforeAdjustments === 0)) return { month, label, gross: null, deductions: null, operator: null, net: null, source: 'none' as const };
    return lv.terms.basis === 'fixed_rent'
      ? { month, label, gross: lv.fixedRent, deductions: 0, operator: 0, net: lv.payoutBeforeAdjustments, source: 'computed' as const }
      : { month, label, gross: lv.gross, deductions: lv.deductions, operator: lv.operatorShare, net: lv.payoutBeforeAdjustments, source: 'computed' as const };
  });
}
