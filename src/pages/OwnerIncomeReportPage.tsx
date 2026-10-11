import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { amount, phone } from '../lib/format';
import { TERMS, toOperator } from '../lib/statementTerms';

/** `#/finance/statements/:id/report[?unit=|?view=owner]` — the Owner Income Report, laid out as the owner's own report:
 *  page 1 the unit's month (OWNER INCOME REPORT), page 2 its year to date. `view=owner` puts the owner's whole
 *  account first: every unit of the statement on one month page and one year-to-date page, then each unit. A4, printed by the browser:
 *  "Download PDF" opens the print dialog with Save as PDF. Rendered outside the app shell so nothing else prints.
 *  Letterhead and terms come from Settings (company.*, report.*). */

interface Row { key: string; label: string; quantity: number | null; uom: string | null; price: number | null; amount: number }
interface YearRow { month: string; label: string; gross: number | null; deductions: number | null; operator: number | null; net: number | null; source: string }
interface Unit {
  unitId: string; code: string; refNo: string; address: string | null; propertyName: string; unitNumber: string; basis: 'share' | 'fixed_rent'; model: string | null;
  nights: number; days: number; occupancy: number; gross: number; deductions: Row[]; deductionsTotal: number; net: number; operatorPct: number | null;
  operatorShare: number; guarantee: number; topUp: number; fixedRent: number; payoutBeforeAdjustments: number;
  adjustments: { id: string; description: string; amount: number }[]; netPayout: number;
  year: YearRow[]; yearTotal: { gross: number; deductions: number; operator: number; net: number };
}
interface Report {
  statementId: string; period: string; periodEnd: string; state: string;
  settings: { company: { legalName: string; companyNumber: string; address: string; phone: string; email: string; logo: string }; paymentTerms: string; monthlyTerms: string[]; yearTerms: string[] };
  owner: { name: string; phone: string | null; email: string | null };
  units: Unit[];
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MON_TITLE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 4,998.81; a deduction in brackets (397.12); nothing as '-'. */
const money = (sen: number | null, opts: { brackets?: boolean; dash?: boolean } = {}) => {
  if (sen === null || (sen === 0 && opts.dash !== false)) return '-';
  const v = amount(Math.abs(sen));
  return sen < 0 || opts.brackets ? `(${v})` : v;
};
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const dayMonYear = (iso: string) => `${iso.slice(8, 10)}-${MON_TITLE[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;

export default function OwnerIncomeReportPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const owner = useSession().user?.role === 'owner';
  const unit = params.get('unit');
  const combined = !unit && params.get('view') === 'owner';
  const { data, loading, error } = useApi<{ data: Report }>(`/statements/${encodeURIComponent(id)}/report${unit ? `?unit=${encodeURIComponent(unit)}` : ''}`);
  const all = useApi<{ data: Report }>(unit ? `/statements/${encodeURIComponent(id)}/report` : null);
  const r = data?.data;
  const choices = (unit ? all.data?.data.units : r?.units) ?? [];

  // A4 is 210 mm (794 px) wide; on a phone the sheets are scaled to fit rather than scrolled sideways.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - 32) / 794));
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  function download() {
    const before = document.title;
    if (r) document.title = `Owner Income Report ${r.units.length === 1 ? r.units[0].refNo : `${r.owner.name} ${r.period}`}`;
    window.print();
    document.title = before;
  }

  return (
    <div className="oir-root">
      <style>{CSS}</style>
      <div className="oir-bar">
        <button onClick={() => navigate(owner ? '/' : `/finance/statements/${encodeURIComponent(id)}`)}>{owner ? 'Back to your account' : 'Back to statement'}</button>
        {choices.length > 1 && (
          <label>
            <span className="oir-sr">Unit</span>
            <select value={unit ?? (combined ? '__owner' : '')} onChange={e => { const v = e.target.value; setParams(v === '__owner' ? { view: 'owner' } : v ? { unit: v } : {}); }}>
              <option value="__owner">By owner: all {choices.length} units combined</option>
              <option value="">By unit: each of the {choices.length} units</option>
              {choices.map(u => <option key={u.unitId} value={u.unitId}>{u.code}</option>)}
            </select>
          </label>
        )}
        <span className="oir-grow" />
        {r && r.state === 'provisional' && <span className="oir-flag">Provisional: figures can still change</span>}
        <button className="oir-primary" onClick={download} disabled={!r?.units.length}>Download PDF</button>
      </div>

      {!r ? <div className="oir-note">{loading ? 'Loading the report...' : error ?? 'This report could not be opened.'}</div>
        : !r.units.length ? <div className="oir-note">This statement has no unit figures to report. Months paid from the owner workbook before Property OS only carry the payout.</div>
        : (
          <div className="oir-sheets" style={{ zoom: scale } as CSSProperties}>
            {combined && r.units.length > 1 && <div><OwnerMonthPage r={r} /><OwnerYearPage r={r} /></div>}
            {r.units.map(u => (
              <div key={u.unitId}>
                <MonthPage r={r} u={u} />
                <YearPage r={r} u={u} />
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function Letterhead({ r }: { r: Report }) {
  const c = r.settings.company;
  return (
    <header className="oir-head">
      <div>
        <div className="oir-company">{c.legalName}</div>
        {c.companyNumber && <div className="oir-small">Company No: {c.companyNumber}</div>}
        {c.address && <div className="oir-addr">{c.address}</div>}
        {(c.phone || c.email) && <div className="oir-addr oir-contact">{[c.phone && `TEL: ${phone(c.phone)}`, c.email && `EMAIL: ${c.email}`].filter(Boolean).join(' | ')}</div>}
      </div>
      <img src={c.logo} alt="The Conts" className="oir-logo" />
    </header>
  );
}

function Parties({ r, u, right }: { r: Report; u: Unit; right: [string, string][] }) {
  const left: [string, string][] = [['OWNER', r.owner.name.toUpperCase()], ['BUILDING', u.code], ['UNIT', u.address ?? `${u.propertyName} ${u.unitNumber}`], ['TEL', r.owner.phone ?? ''], ['EMAIL', r.owner.email ?? '']];
  return (
    <div className="oir-parties">
      <dl>{left.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>: {v}</dd></div>)}</dl>
      <dl>{right.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>: {v}</dd></div>)}</dl>
    </div>
  );
}

function Signatures() {
  return <div className="oir-sign"><div>Authorised Signature</div><div>Acknowledge By</div></div>;
}

function Terms({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <section className="oir-terms"><h3>Term &amp; Conditions:-</h3><ol>{items.map((t, i) => <li key={i}>{t}</li>)}</ol></section>;
}

function MonthPage({ r, u }: { r: Report; u: Unit }) {
  const mon = MON[Number(r.period.slice(5, 7)) - 1];
  const share = u.basis === 'share';
  return (
    <article className="oir-sheet">
      <Letterhead r={r} />
      <h1>OWNER INCOME REPORT</h1>
      <Parties r={r} u={u} right={[['REF. NO.', u.refNo], ['DATE', dayMonYear(r.periodEnd)], ['MONTHS', mon], ['TERMS', r.settings.paymentTerms]]} />
      <table className="oir-table">
        <colgroup><col style={{ width: '45%' }} /><col style={{ width: '8%' }} /><col style={{ width: '10%' }} /><col style={{ width: '18%' }} /><col style={{ width: '19%' }} /></colgroup>
        <thead><tr><th>DESCRIPTION</th><th>QTY</th><th>UOM</th><th>PRICE (RM)</th><th>AMOUNT (RM)</th></tr></thead>
        <tbody>
          <tr><td><u><b>{TERMS.grossIncome}</b></u></td><td /><td /><td /><td /></tr>
          {share && u.model === 'long_term' ? (
            <tr><td className="oir-in">{TERMS.monthlyRent}</td><td className="c">1</td><td className="c">months</td><td className="r">{money(u.gross)}</td><td className="r">{money(u.gross, { dash: false })}</td></tr>
          ) : share ? (
            <tr><td className="oir-in">{TERMS.hospitalityIncome}</td><td className="c">{u.nights}</td><td className="c">%</td><td className="r">{pct(u.occupancy * 100)}</td><td className="r">{money(u.gross, { dash: false })}</td></tr>
          ) : (
            <tr><td className="oir-in">{TERMS.fixedRent}</td><td className="c">1</td><td className="c">months</td><td className="r">{money(u.fixedRent)}</td><td className="r">{money(u.fixedRent)}</td></tr>
          )}
          {share && <>
            <tr className="oir-gap"><td><u><b>(-) {TERMS.expenseDeduction}</b></u></td><td /><td /><td /><td /></tr>
            {u.deductions.map(d => (
              <tr key={d.key}><td className="oir-in">{d.label}</td><td className="c">{d.quantity ?? ''}</td><td className="c">{d.uom}</td><td className="r">{money(d.price)}</td><td className="r">{money(d.amount)}</td></tr>
            ))}
            <tr><td /><td /><td /><td className="r"><b>{TERMS.totalDeduction}</b></td><td className="r oir-box"><b>{money(u.deductionsTotal, { dash: false })}</b></td></tr>
            <tr className="oir-gap"><td><b>{TERMS.netIncomeFull}</b></td><td /><td /><td /><td className="r">{money(u.net, { dash: false })}</td></tr>
            <tr><td><b>{toOperator(u.operatorPct ?? 0)}</b></td><td /><td /><td className="r">{pct(u.operatorPct ?? 0)}</td><td className="r">{money(-u.operatorShare, { dash: false })}</td></tr>
            {u.topUp > 0 && <tr><td><b>{TERMS.topUp}</b></td><td /><td /><td className="r">{money(u.guarantee)}</td><td className="r">{money(u.topUp)}</td></tr>}
          </>}
          <tr><td><b>{TERMS.payoutBeforeAdjustment}</b></td><td /><td /><td /><td className="r oir-box"><b>{money(u.payoutBeforeAdjustments, { dash: false })}</b></td></tr>
          {u.adjustments.map(a => <tr key={a.id} className="oir-gap"><td>{a.description}</td><td /><td /><td /><td className="r">{money(a.amount)}</td></tr>)}
          <tr><td><b>{TERMS.netPayout}</b></td><td /><td /><td /><td className="r oir-box"><b>{money(u.netPayout, { dash: false })}</b></td></tr>
          <tr className="oir-fill"><td /><td /><td /><td /><td className="oir-box" /></tr>
        </tbody>
      </table>
      <Terms items={r.settings.monthlyTerms} />
      <Signatures />
    </article>
  );
}

function YearPage({ r, u }: { r: Report; u: Unit }) {
  const year = r.period.slice(0, 4);
  const fromWorkbook = u.year.some(y => y.source === 'workbook');
  return (
    <article className="oir-sheet">
      <Letterhead r={r} />
      <h1>YEAR-TO-DATE OWNER INCOME REPORT (JAN - DEC {year})</h1>
      <Parties r={r} u={u} right={[['REF. NO.', u.refNo], ['MONTH', `${MON[Number(r.period.slice(5, 7)) - 1]} ${year}`]]} />
      <table className="oir-table oir-ytd">
        <colgroup><col style={{ width: '12%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /></colgroup>
        <thead><tr><th>MONTH</th><th>GROSS INCOME (RM)</th><th>EXPENSE DEDUCTION (RM)</th><th>GROSS DEDUCTION (RM)</th><th>NET INCOME (RM)</th></tr></thead>
        <tbody>
          {u.year.map(y => (
            <tr key={y.month}>
              <td><b>{y.label}</b>{y.source === 'workbook' ? ' *' : ''}</td>
              <td className="r">{money(y.gross)}</td><td className="r">{money(y.deductions)}</td><td className="r">{money(y.operator)}</td><td className="r">{money(y.net)}</td>
            </tr>
          ))}
          <tr className="oir-total"><td><b>TOTAL</b></td><td className="r"><b>{money(u.yearTotal.gross)}</b></td><td className="r"><b>{money(u.yearTotal.deductions)}</b></td><td className="r"><b>{money(u.yearTotal.operator)}</b></td><td className="r"><b>{money(u.yearTotal.net)}</b></td></tr>
        </tbody>
      </table>
      {fromWorkbook && <p className="oir-foot">* Paid before Property OS: the owner workbook records the payout for this month, not its breakdown.</p>}
      <Terms items={r.settings.yearTerms} />
      <Signatures />
    </article>
  );
}

const MODEL_NAME: Record<string, string> = {
  management: 'Profit share', management_guarantee: 'Profit share, minimum guarantee', grr: 'Guaranteed rent', master_lease: 'Master lease', long_term: 'Long-term let',
};

/** By owner, page 1: every unit of the statement on one page, with the owner's total. */
function OwnerMonthPage({ r }: { r: Report }) {
  const mon = MON[Number(r.period.slice(5, 7)) - 1];
  const sum = (f: (u: Unit) => number) => r.units.reduce((n, u) => n + f(u), 0);
  const income = (u: Unit) => (u.basis === 'share' ? u.gross : u.fixedRent);
  const adj = (u: Unit) => u.adjustments.reduce((n, a) => n + a.amount, 0);
  const ref = `${r.period.slice(2, 4)}${r.period.slice(5, 7)}-OWNER`;
  const left: [string, string][] = [['OWNER', r.owner.name.toUpperCase()], ['UNITS', String(r.units.length)], ['TEL', r.owner.phone ?? ''], ['EMAIL', r.owner.email ?? '']];
  const right: [string, string][] = [['REF. NO.', ref], ['DATE', dayMonYear(r.periodEnd)], ['MONTHS', mon], ['TERMS', r.settings.paymentTerms]];
  return (
    <article className="oir-sheet">
      <Letterhead r={r} />
      <h1>OWNER INCOME REPORT (ALL UNITS)</h1>
      <div className="oir-parties">
        <dl>{left.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>: {v}</dd></div>)}</dl>
        <dl>{right.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>: {v}</dd></div>)}</dl>
      </div>
      <table className="oir-table oir-ytd oir-owner">
        <colgroup><col style={{ width: '25%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '12%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} /></colgroup>
        <thead><tr><th>UNIT</th><th>GROSS INCOME (RM)</th><th>EXPENSE DEDUCTION (RM)</th><th>TO OPERATOR (RM)</th><th>PAYOUT BEFORE O2 (RM)</th><th>O2 (RM)</th><th>NET PAYOUT (RM)</th></tr></thead>
        <tbody>
          {r.units.map(u => (
            <tr key={u.unitId}>
              <td><b>{u.code}</b><div className="oir-model">{MODEL_NAME[u.model ?? (u.basis === 'share' ? 'management' : 'grr')]}{u.basis === 'share' && u.operatorPct != null ? `, ${toOperator(u.operatorPct)}` : ''}</div></td>
              <td className="r">{money(income(u))}</td>
              <td className="r">{money(u.basis === 'share' ? u.deductionsTotal : 0)}</td>
              <td className="r">{money(u.basis === 'share' ? u.operatorShare - u.topUp : 0)}</td>
              <td className="r">{money(u.payoutBeforeAdjustments)}</td>
              <td className="r">{money(adj(u))}</td>
              <td className="r"><b>{money(u.netPayout, { dash: false })}</b></td>
            </tr>
          ))}
          <tr className="oir-total">
            <td><b>TOTAL</b></td>
            <td className="r"><b>{money(sum(income))}</b></td>
            <td className="r"><b>{money(sum(u => (u.basis === 'share' ? u.deductionsTotal : 0)))}</b></td>
            <td className="r"><b>{money(sum(u => (u.basis === 'share' ? u.operatorShare - u.topUp : 0)))}</b></td>
            <td className="r"><b>{money(sum(u => u.payoutBeforeAdjustments))}</b></td>
            <td className="r"><b>{money(sum(adj))}</b></td>
            <td className="r oir-box"><b>{money(sum(u => u.netPayout), { dash: false })}</b></td>
          </tr>
        </tbody>
      </table>
      <p className="oir-foot">Each unit's own report follows, with every income line, deduction and owner credit or charge. {TERMS.toOperator} is after any {TERMS.topUp.toLowerCase()}.</p>
      <Terms items={r.settings.monthlyTerms} />
      <Signatures />
    </article>
  );
}

/** By owner, page 2: the year to date of all the units, month by month. */
function OwnerYearPage({ r }: { r: Report }) {
  const year = r.period.slice(0, 4);
  const months = MON.map((label, i) => {
    const rows = r.units.map(u => u.year[i]).filter(Boolean);
    const add = (k: 'gross' | 'deductions' | 'operator' | 'net') => rows.some(y => y[k] != null) ? rows.reduce((n, y) => n + (y[k] ?? 0), 0) : null;
    return { label, gross: add('gross'), deductions: add('deductions'), operator: add('operator'), net: add('net'), workbook: rows.some(y => y.source === 'workbook') };
  });
  const total = (k: 'gross' | 'deductions' | 'operator' | 'net') => months.reduce((n, m) => n + (m[k] ?? 0), 0);
  return (
    <article className="oir-sheet">
      <Letterhead r={r} />
      <h1>YEAR-TO-DATE OWNER INCOME REPORT, ALL UNITS (JAN - DEC {year})</h1>
      <div className="oir-parties">
        <dl>{([['OWNER', r.owner.name.toUpperCase()], ['UNITS', r.units.map(u => u.code).join(', ')]] as [string, string][]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>: {v}</dd></div>)}</dl>
        <dl><div><dt>MONTH</dt><dd>: {MON[Number(r.period.slice(5, 7)) - 1]} {year}</dd></div></dl>
      </div>
      <table className="oir-table oir-ytd">
        <colgroup><col style={{ width: '12%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /></colgroup>
        <thead><tr><th>MONTH</th><th>GROSS INCOME (RM)</th><th>EXPENSE DEDUCTION (RM)</th><th>GROSS DEDUCTION (RM)</th><th>NET INCOME (RM)</th></tr></thead>
        <tbody>
          {months.map(m => (
            <tr key={m.label}><td><b>{m.label}</b>{m.workbook ? ' *' : ''}</td><td className="r">{money(m.gross)}</td><td className="r">{money(m.deductions)}</td><td className="r">{money(m.operator)}</td><td className="r">{money(m.net)}</td></tr>
          ))}
          <tr className="oir-total"><td><b>TOTAL</b></td><td className="r"><b>{money(total('gross'))}</b></td><td className="r"><b>{money(total('deductions'))}</b></td><td className="r"><b>{money(total('operator'))}</b></td><td className="r"><b>{money(total('net'))}</b></td></tr>
        </tbody>
      </table>
      {months.some(m => m.workbook) && <p className="oir-foot">* Paid before Property OS for at least one unit: the owner workbook records the payout for that month, not its breakdown.</p>}
      <Terms items={r.settings.yearTerms} />
      <Signatures />
    </article>
  );
}

const CSS = `
.oir-owner td { font-size: 9.5pt; }
.oir-model { font-size: 8.5pt; color: #333; }
.oir-root { min-height: 100vh; background: #e9e7e3; color: #000; padding-bottom: 32px; }
.oir-bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 16px; background: #fff; border-bottom: 1px solid #d6d3cd; font: 13px/1.4 "IBM Plex Sans", system-ui, sans-serif; }
.oir-bar button, .oir-bar select { height: 34px; padding: 0 12px; border: 1px solid #c9c5be; border-radius: 6px; background: #fff; color: #151515; font: inherit; cursor: pointer; }
.oir-bar .oir-primary { background: #151515; color: #fff; border-color: #151515; font-weight: 600; }
.oir-bar button:disabled { opacity: .45; cursor: not-allowed; }
.oir-grow { flex: 1; }
.oir-flag { padding: 4px 10px; border-radius: 999px; background: #fff4d8; color: #8a5a12; font-size: 12px; }
.oir-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.oir-note { max-width: 560px; margin: 48px auto; padding: 0 16px; font: 14px/1.5 "IBM Plex Sans", system-ui, sans-serif; color: #444; }
.oir-sheets { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px 0; }
.oir-sheet { box-sizing: border-box; width: 210mm; min-height: 297mm; padding: 11mm 15mm 9mm; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.18);
  font-family: "Times New Roman", Times, serif; font-size: 10.5pt; line-height: 1.3; display: flex; flex-direction: column; }
.oir-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 4px; border-bottom: 1.5px solid #000; }
.oir-company { font-size: 19pt; font-weight: 700; text-transform: uppercase; letter-spacing: .01em; margin-bottom: 3px; }
.oir-small { font-size: 9pt; margin-bottom: 3px; }
.oir-addr { font-size: 9.5pt; font-weight: 700; max-width: 112mm; text-transform: uppercase; }
.oir-contact { text-transform: none; }
.oir-logo { width: 34mm; height: auto; margin-top: 2mm; }
.oir-sheet h1 { margin: 9px 0 10px; text-align: center; font-size: 12.5pt; font-weight: 700; }
.oir-parties { display: grid; grid-template-columns: 1.25fr 1fr; gap: 0 24px; margin-bottom: 10px; }
.oir-parties dl { margin: 0; }
.oir-parties dl > div { display: grid; grid-template-columns: 22mm 1fr; margin-bottom: 5px; }
.oir-parties dl:last-child > div { grid-template-columns: 22mm 1fr; }
.oir-parties dt { font-weight: 700; }
.oir-parties dd { margin: 0; padding-left: 1.2em; text-indent: -1.2em; }
.oir-table { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
.oir-table th { background: #dce9f5; border: 1.5px solid #000; padding: 5px 6px; font-weight: 700; text-align: center; }
.oir-table td { border-left: 1.5px solid #000; padding: 3px 6px; vertical-align: top; }
.oir-table .c { text-align: center; } .oir-table .r { text-align: right; white-space: nowrap; }
.oir-table .oir-in { padding-left: 16px; }
.oir-table tr.oir-gap td { padding-top: 9px; }
.oir-table td.oir-box { border-top: 1.5px solid #000; border-right: 1.5px solid #000; }
.oir-table tr.oir-fill td { height: 18px; }
.oir-ytd td, .oir-ytd th { border: 1.5px solid #000; padding: 6px 7px; }
.oir-ytd tr.oir-total td { padding: 7px; }
.oir-foot { margin: 6px 0 0; font-size: 9pt; }
.oir-terms { margin-top: 12px; font-size: 10pt; }
.oir-terms h3 { margin: 0 0 4px; font-size: 10pt; font-style: italic; font-weight: 700; text-decoration: underline; }
.oir-terms ol { margin: 0; padding-left: 28px; }
.oir-terms li { margin-bottom: 3px; }
.oir-sign { display: flex; justify-content: space-between; margin-top: auto; padding-top: 18px; }
.oir-sign div { width: 62mm; padding-top: 6px; border-top: 1.5px solid #000; font-size: 11pt; }
@page { size: A4; margin: 0; }
@media print {
  html, body { background: #fff !important; }
  /* Only the sheets: no update notice, toast or anything else the app keeps on screen. */
  body * { visibility: hidden; }
  .oir-root, .oir-root * { visibility: visible; }
  .oir-root { position: absolute; left: 0; top: 0; width: 100%; }
  .oir-root { background: #fff; padding: 0; }
  .oir-bar { display: none !important; }
  .oir-sheets { display: block; padding: 0; zoom: 1 !important; }
  .oir-sheet { box-shadow: none; width: 210mm; height: 297mm; min-height: 0; page-break-after: always; break-after: page; overflow: hidden; }
  .oir-sheets > div:last-child > .oir-sheet:last-child { page-break-after: auto; break-after: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
