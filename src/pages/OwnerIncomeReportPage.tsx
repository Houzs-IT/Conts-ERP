import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';

/** `#/finance/statements/:id/report[?unit=]` — the Owner Income Report, laid out as the owner's own report:
 *  page 1 the unit's month (OWNER INCOME REPORT), page 2 its year to date. A4, printed by the browser:
 *  "Download PDF" opens the print dialog with Save as PDF. Rendered outside the app shell so nothing else prints.
 *  Letterhead and terms come from Settings (company.*, report.*). */

interface Row { key: string; label: string; quantity: number | null; uom: string | null; price: number | null; amount: number }
interface YearRow { month: string; label: string; gross: number | null; deductions: number | null; operator: number | null; net: number | null; source: string }
interface Unit {
  unitId: string; code: string; refNo: string; address: string | null; propertyName: string; unitNumber: string; basis: 'share' | 'fixed_rent';
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
  const v = (Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sen < 0 || opts.brackets ? `(${v})` : v;
};
const pct = (n: number) => `${Number(n.toFixed(2))}%`;
const dayMonYear = (iso: string) => `${iso.slice(8, 10)}-${MON_TITLE[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;

export default function OwnerIncomeReportPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const unit = params.get('unit');
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
    if (r) document.title = `Owner Income Report ${r.units.length === 1 ? r.units[0].refNo : r.period}`;
    window.print();
    document.title = before;
  }

  return (
    <div className="oir-root">
      <style>{CSS}</style>
      <div className="oir-bar">
        <button onClick={() => navigate(`/finance/statements/${encodeURIComponent(id)}`)}>Back to statement</button>
        {choices.length > 1 && (
          <label>
            <span className="oir-sr">Unit</span>
            <select value={unit ?? ''} onChange={e => { const v = e.target.value; setParams(v ? { unit: v } : {}); }}>
              <option value="">All {choices.length} units</option>
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
        {(c.phone || c.email) && <div className="oir-addr oir-contact">{[c.phone && `TEL: ${c.phone}`, c.email && `EMAIL: ${c.email}`].filter(Boolean).join(' | ')}</div>}
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
          <tr><td><u><b>Gross Income</b></u></td><td /><td /><td /><td /></tr>
          {share ? (
            <tr><td className="oir-in">Hospitality Income</td><td className="c">{u.nights}</td><td className="c">%</td><td className="r">{pct(u.occupancy * 100)}</td><td className="r">{money(u.gross, { dash: false })}</td></tr>
          ) : (
            <tr><td className="oir-in">Fixed Monthly Rent</td><td className="c">1</td><td className="c">months</td><td className="r">{money(u.fixedRent)}</td><td className="r">{money(u.fixedRent)}</td></tr>
          )}
          {share && <>
            <tr className="oir-gap"><td><u><b>(-) Expense Deduction</b></u></td><td /><td /><td /><td /></tr>
            {u.deductions.map(d => (
              <tr key={d.key}><td className="oir-in">{d.label}</td><td className="c">{d.quantity ?? ''}</td><td className="c">{d.uom}</td><td className="r">{money(d.price)}</td><td className="r">{money(d.amount)}</td></tr>
            ))}
            <tr><td /><td /><td /><td className="r"><b>Total Deduction</b></td><td className="r oir-box"><b>{money(u.deductionsTotal, { dash: false })}</b></td></tr>
            <tr className="oir-gap"><td><b>Net Income Before Deduct Management Fees</b></td><td /><td /><td /><td className="r">{money(u.net, { dash: false })}</td></tr>
            <tr><td><b>{pct(u.operatorPct ?? 0)} To Operator</b></td><td /><td /><td className="r">{pct(u.operatorPct ?? 0)}</td><td className="r">{money(-u.operatorShare, { dash: false })}</td></tr>
            {u.topUp > 0 && <tr><td><b>Minimum Guarantee Top-up</b></td><td /><td /><td className="r">{money(u.guarantee)}</td><td className="r">{money(u.topUp)}</td></tr>}
          </>}
          <tr><td><b>Payout Before O2 Adjustment</b></td><td /><td /><td /><td className="r oir-box"><b>{money(u.payoutBeforeAdjustments, { dash: false })}</b></td></tr>
          {u.adjustments.map(a => <tr key={a.id} className="oir-gap"><td>{a.description}</td><td /><td /><td /><td className="r">{money(a.amount)}</td></tr>)}
          <tr><td><b>Net Payout to Owner</b></td><td /><td /><td /><td className="r oir-box"><b>{money(u.netPayout, { dash: false })}</b></td></tr>
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

const CSS = `
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
