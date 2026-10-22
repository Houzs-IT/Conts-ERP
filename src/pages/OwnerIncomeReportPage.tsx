import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { amount } from '../lib/format';
import { parsePhone } from '../lib/phone';

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
/** "No. 2" never splits across lines (the letterhead's address wraps as on the owner's report). */
const keepNumbers = (text: string) => text.replace(/\b(No\.?)\s+(?=\d)/gi, '$1\u00a0');
/** As the owner's report prints a phone: a Malaysian number as dialled at home (011-6133 3289), any other with its code. */
const printedPhone = (raw: string | null | undefined) => {
  const p = parsePhone(raw);
  if (!p?.possible) return (raw ?? '').trim();
  return p.callingCode === '60' ? `0${p.national}` : p.international;
};

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
        <button onClick={() => navigate(owner ? '/' : `/owners/statements/${encodeURIComponent(id)}`)}>{owner ? 'Back to your account' : 'Back to statement'}</button>
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
        {r && r.state === 'provisional' && <span className="oir-flag">Draft: figures can still change</span>}
        <button className="oir-primary" onClick={download} disabled={!r?.units.length}>Download PDF</button>
      </div>

      {!r ? <div className="oir-note">{loading ? 'Loading the report...' : error ?? 'This report could not be opened.'}</div>
        : !r.units.length ? (
          <div className="oir-note">
            {r.state === 'provisional'
              ? <>This draft owner statement was made before unit figures were kept. Generate the month again (Owner statements, or Generate owner report on the owner's page) and the report fills in.</>
              : <>This month was paid from the owner workbook before Property OS, so it carries the payout, not the unit figures an Owner Income Report needs.{' '}
                <a href={`/api/statements/${encodeURIComponent(id)}/pdf?format=legacy`} target="_blank" rel="noreferrer">Open the owner statement as it was paid</a>.</>}
          </div>
        )
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

/** `#/finance/statements/print?ids=a,b,c` — several owner statements on one page (the Payouts list's "PDF statements"
 *  export): each statement as the By owner view lays it out, then "Download PDF" prints them all as one file. Months
 *  paid before Property OS have no unit figures and are listed instead, with their old statement link. */
export function StatementsPrintPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ids = useMemo(() => [...new Set((params.get('ids') ?? '').split(',').filter(Boolean))], [params]);
  const [reports, setReports] = useState<Report[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [done, setDone] = useState(0);

  useEffect(() => {
    let live = true;
    setReports([]); setFailed([]); setDone(0);
    // Four at a time, in the order asked, so a long list does not fire a hundred requests at once.
    void (async () => {
      const out: (Report | null)[] = [];
      for (let i = 0; i < ids.length && live; i += 4) {
        const part = await Promise.all(ids.slice(i, i + 4).map(async id => {
          try { return (await api.get<{ data: Report }>(`/statements/${encodeURIComponent(id)}/report`)).data; } catch { return null; }
        }));
        out.push(...part);
        if (live) setDone(out.length);
      }
      if (!live) return;
      setReports(out.filter((r): r is Report => !!r));
      setFailed(ids.filter((_, i) => !out[i]));
    })();
    return () => { live = false; };
  }, [ids]);

  const loading = done < ids.length;
  const printable = reports.filter(r => r.units.length);
  const legacy = reports.filter(r => !r.units.length);

  function download() {
    const before = document.title;
    document.title = `Owner statements ${printable[0]?.period ?? ''}`.trim();
    window.print();
    document.title = before;
  }

  return (
    <div className="oir-root">
      <style>{CSS}</style>
      <div className="oir-bar">
        <button onClick={() => navigate('/owners?view=payouts')}>Back to payouts</button>
        <span>{loading ? `Loading ${done} of ${ids.length} statements...` : `${printable.length} of ${ids.length} statements ready to print`}</span>
        <span className="oir-grow" />
        {printable.some(r => r.state === 'provisional') && <span className="oir-flag">Some are drafts: figures can still change</span>}
        <button className="oir-primary" onClick={download} disabled={loading || !printable.length}>Download PDF</button>
      </div>

      {!ids.length && <div className="oir-note">No statements were chosen. Go back to Payouts and export again.</div>}
      {!loading && (legacy.length > 0 || failed.length > 0) && (
        <div className="oir-note">
          {legacy.length > 0 && <>
            <p>{legacy.length} {legacy.length === 1 ? 'month was' : 'months were'} paid from the owner workbook before Property OS, so there is no Owner Income Report to print. Open each as it was paid:</p>
            <ul>{legacy.map(r => <li key={r.statementId}><a href={`/api/statements/${encodeURIComponent(r.statementId)}/pdf?format=legacy`} target="_blank" rel="noreferrer">{r.owner.name}, {r.period}</a></li>)}</ul>
          </>}
          {failed.length > 0 && <p>{failed.length} {failed.length === 1 ? 'statement' : 'statements'} could not be opened. Reload the page to try again.</p>}
        </div>
      )}
      {printable.length > 0 && (
        <div className="oir-sheets">
          {printable.map(r => (
            <Fragment key={r.statementId}>
              {r.units.length > 1 && <div><OwnerMonthPage r={r} /><OwnerYearPage r={r} /></div>}
              {r.units.map(u => <div key={u.unitId}><MonthPage r={r} u={u} /><YearPage r={r} u={u} /></div>)}
            </Fragment>
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
        {c.address && <div className="oir-addr">{keepNumbers(c.address)}</div>}
        {(c.phone || c.email) && <div className="oir-addr oir-contact">{[c.phone && `TEL: ${printedPhone(c.phone)}`, c.email && `EMAIL: ${c.email}`].filter(Boolean).join(' | ')}</div>}
      </div>
      <img src={c.logo} alt="The Conts" className="oir-logo" />
    </header>
  );
}

/** The owner's details on the left, the report's on the right, row for row as on the owner's report: REF. NO. beside
 *  OWNER, DATE (or MONTH) beside UNIT, MONTHS beside TEL, TERMS beside EMAIL. `right` is indexed by left row; null
 *  leaves the place empty. TEL and EMAIL stand a little apart, as printed. */
type Pair = [string, string] | null;
function PartyRows({ left, right }: { left: [string, string][]; right: Pair[] }) {
  return (
    <div className="oir-parties">
      {left.map(([k, v], i) => {
        const rv = right[i];
        return (
          <div key={k} className={k === 'TEL' || k === 'EMAIL' ? 'oir-prow oir-apart' : 'oir-prow'}>
            <div className="oir-pair"><span className="oir-k">{k}</span><span className="oir-v">: {v}</span></div>
            <div className="oir-pair oir-right">{rv && <><span className="oir-k">{rv[0]}</span><span className="oir-v">: {rv[1]}</span></>}</div>
          </div>
        );
      })}
    </div>
  );
}

function Parties({ r, u, right }: { r: Report; u: Unit; right: Pair[] }) {
  const left: [string, string][] = [['OWNER', r.owner.name.toUpperCase()], ['BUILDING', u.code], ['UNIT', (u.address ?? `${u.propertyName} ${u.unitNumber}`).toUpperCase()],
    ['TEL', printedPhone(r.owner.phone)], ['EMAIL', r.owner.email ?? '']];
  return <PartyRows left={left} right={right} />;
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
      <Parties r={r} u={u} right={[['REF. NO.', u.refNo], null, ['DATE', dayMonYear(r.periodEnd)], ['MONTHS', mon], ['TERMS', r.settings.paymentTerms]]} />
      <table className="oir-table">
        <colgroup><col style={{ width: '44%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '18%' }} /><col style={{ width: '18%' }} /></colgroup>
        <thead><tr><th>DESCRIPTION</th><th>QTY</th><th>UOM</th><th>PRICE (RM)</th><th>AMOUNT (RM)</th></tr></thead>
        <tbody>
          <tr><td><u><b>Gross Income</b></u></td><td /><td /><td /><td /></tr>
          {share && u.model === 'long_term' ? (
            <tr><td className="oir-in">Monthly Rent (long-term tenant)</td><td className="c">1</td><td className="c">months</td><td className="r">{money(u.gross)}</td><td className="r">{money(u.gross, { dash: false })}</td></tr>
          ) : share ? (
            <tr><td className="oir-in">Hospitality Income</td><td className="c">{u.nights}</td><td className="c">%</td><td className="r">{pct(u.occupancy * 100)}</td><td className="r">{money(u.gross, { dash: false })}</td></tr>
          ) : (
            <tr><td className="oir-in">Fixed Monthly Rent</td><td className="c">1</td><td className="c">months</td><td className="r">{money(u.fixedRent)}</td><td className="r">{money(u.fixedRent)}</td></tr>
          )}
          {share && <>
            <tr className="oir-gap"><td><u><b>(-) Expense Deduction</b></u></td><td /><td /><td /><td /></tr>
            {u.deductions.map(d => (
              <tr key={d.key}><td className="oir-in">{d.label}</td><td className="c">{d.quantity ?? ''}</td><td className="c">{d.uom}</td><td className="r">{money(d.price)}</td><td className="r">{money(d.amount)}</td></tr>
            ))}
            <tr><td /><td /><td /><td className="c"><b>Total Deduction</b></td><td className="r oir-box oir-closed"><b>{money(u.deductionsTotal, { dash: false })}</b></td></tr>
            <tr className="oir-gap"><td><b>Net Income Before Deduct Management Fees</b></td><td /><td /><td /><td className="r">{money(u.net, { dash: false })}</td></tr>
            <tr><td><b>{pct(u.operatorPct ?? 0)} To Operator</b></td><td /><td /><td className="r">{pct(u.operatorPct ?? 0)}</td><td className="r">{money(-u.operatorShare, { dash: false })}</td></tr>
            {u.topUp > 0 && <tr><td><b>Minimum Guarantee Top-up</b></td><td /><td /><td className="r">{money(u.guarantee)}</td><td className="r">{money(u.topUp)}</td></tr>}
          </>}
          <tr><td><b>Payout Before O2 Adjustment</b></td><td /><td /><td /><td className="r oir-box"><b>{money(u.payoutBeforeAdjustments, { dash: false })}</b></td></tr>
          {u.adjustments.map((a, i) => <tr key={a.id} className={i === 0 ? 'oir-gap' : undefined}><td>{a.description.toUpperCase()}</td><td /><td /><td /><td className="r">{money(a.amount)}</td></tr>)}
          <tr><td><b>Net Payout to Owner</b></td><td /><td /><td /><td className="r oir-box">{money(u.netPayout, { dash: false })}</td></tr>
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
      <Parties r={r} u={u} right={[['REF. NO.', u.refNo], null, ['MONTH', `${MON[Number(r.period.slice(5, 7)) - 1]} ${year}`]]} />
      <table className="oir-table oir-ytd">
        <colgroup><col style={{ width: '14%' }} /><col style={{ width: '21%' }} /><col style={{ width: '22%' }} /><col style={{ width: '21%' }} /><col style={{ width: '22%' }} /></colgroup>
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
  management: 'Profit share', management_guarantee: 'Profit share, minimum guarantee', management_yearly_guarantee: 'Profit share, yearly guarantee', grr: 'Guaranteed rent', master_lease: 'Master lease', long_term: 'Long-term let',
};

/** By owner, page 1: every unit of the statement on one page, with the owner's total. */
function OwnerMonthPage({ r }: { r: Report }) {
  const mon = MON[Number(r.period.slice(5, 7)) - 1];
  const sum = (f: (u: Unit) => number) => r.units.reduce((n, u) => n + f(u), 0);
  const income = (u: Unit) => (u.basis === 'share' ? u.gross : u.fixedRent);
  const adj = (u: Unit) => u.adjustments.reduce((n, a) => n + a.amount, 0);
  const ref = `${r.period.slice(2, 4)}${r.period.slice(5, 7)}-OWNER`;
  const left: [string, string][] = [['OWNER', r.owner.name.toUpperCase()], ['UNITS', String(r.units.length)], ['TEL', printedPhone(r.owner.phone)], ['EMAIL', r.owner.email ?? '']];
  const right: Pair[] = [['REF. NO.', ref], ['DATE', dayMonYear(r.periodEnd)], ['MONTHS', mon], ['TERMS', r.settings.paymentTerms]];
  return (
    <article className="oir-sheet">
      <Letterhead r={r} />
      <h1>OWNER INCOME REPORT (ALL UNITS)</h1>
      <PartyRows left={left} right={right} />
      <table className="oir-table oir-ytd oir-owner">
        <colgroup><col style={{ width: '25%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '12%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} /></colgroup>
        <thead><tr><th>UNIT</th><th>GROSS INCOME (RM)</th><th>EXPENSE DEDUCTION (RM)</th><th>TO OPERATOR (RM)</th><th>PAYOUT BEFORE O2 (RM)</th><th>O2 (RM)</th><th>NET PAYOUT (RM)</th></tr></thead>
        <tbody>
          {r.units.map(u => (
            <tr key={u.unitId}>
              <td><b>{u.code}</b><div className="oir-model">{MODEL_NAME[u.model ?? (u.basis === 'share' ? 'management' : 'grr')]}{u.basis === 'share' && u.operatorPct != null ? `, ${pct(u.operatorPct)} to operator` : ''}</div></td>
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
      <p className="oir-foot">Each unit's own report follows, with every income line, deduction and owner credit or charge. To operator is after any minimum guarantee top-up.</p>
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
      <PartyRows left={[['OWNER', r.owner.name.toUpperCase()], ['UNITS', r.units.map(u => u.code).join(', ')]]} right={[null, ['MONTH', `${MON[Number(r.period.slice(5, 7)) - 1]} ${year}`]]} />
      <table className="oir-table oir-ytd">
        <colgroup><col style={{ width: '14%' }} /><col style={{ width: '21%' }} /><col style={{ width: '22%' }} /><col style={{ width: '21%' }} /><col style={{ width: '22%' }} /></colgroup>
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
.oir-sheet { box-sizing: border-box; width: 210mm; min-height: 297mm; padding: 11mm 14mm 9mm; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.18);
  font-family: "Times New Roman", Times, serif; font-size: 9pt; line-height: 1.3; display: flex; flex-direction: column; }
.oir-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 4px; border-bottom: 1.5px solid #000; }
/* Sizes measured off the owner's printed report. The address keeps its own line breaks; one saved on a single line
   wraps at the sample's width (after "KL GATEWAY," and "KERINCHI LESTARI,"). */
.oir-company { font-size: 16.5pt; font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }
.oir-small { font-size: 8pt; margin-bottom: 3px; }
.oir-addr { font-size: 9pt; font-weight: 700; max-width: 89.5mm; text-transform: uppercase; white-space: pre-line; line-height: 1.35; }
.oir-contact { text-transform: none; white-space: nowrap; max-width: none; }
.oir-logo { width: 28mm; height: auto; margin-top: 1mm; margin-right: 1mm; }
.oir-sheet h1 { margin: 2.5mm 0 2mm; text-align: center; font-size: 11pt; font-weight: 700; }
.oir-parties { display: flex; flex-direction: column; margin-bottom: 3mm; font-size: 9.5pt; }
.oir-prow { display: grid; grid-template-columns: 62.5% 37.5%; margin-bottom: 1.1mm; }
.oir-prow.oir-apart { margin-top: 2.6mm; margin-bottom: 1.1mm; }
.oir-pair { display: flex; align-items: flex-start; min-width: 0; }
.oir-k { flex: none; min-width: 20mm; font-weight: 700; white-space: nowrap; }
.oir-right .oir-k { min-width: 15.2mm; }
.oir-v { flex: 1; min-width: 0; padding-left: .75em; text-indent: -.75em; padding-right: 20mm; }
.oir-right .oir-v { padding-right: 0; }
.oir-table { width: 100%; border-collapse: collapse; border: 1.5px solid #000; }
.oir-table th { background: #dce9f5; border: 1.5px solid #000; padding: 1mm 1.5mm; font-weight: 700; text-align: center; }
.oir-table td { border-left: 1.5px solid #000; padding: .8mm 1.5mm; vertical-align: top; }
.oir-table .c { text-align: center; } .oir-table .r { text-align: right; white-space: nowrap; }
.oir-table .oir-in { padding-left: 4.5mm; }
.oir-table tr.oir-gap td { padding-top: 2.6mm; }
.oir-table td.oir-box { border-top: 1.5px solid #000; border-right: 1.5px solid #000; }
.oir-table td.oir-closed { border-bottom: 1.5px solid #000; }
.oir-table tr.oir-fill td { height: 18px; }
.oir-ytd td, .oir-ytd th { border: 1.5px solid #000; padding: 1.4mm 1.5mm; }
.oir-ytd tr.oir-total td { padding: 1.4mm 1.5mm; }
.oir-foot { margin: 6px 0 0; font-size: 9pt; }
.oir-terms { margin-top: 5mm; font-size: 9pt; }
.oir-terms h3 { margin: 0 0 1.5mm; font-size: 9pt; font-style: italic; font-weight: 700; text-decoration: underline; }
.oir-terms ol { margin: 0; padding-left: 9.5mm; }
.oir-terms li { margin-bottom: 1.2mm; padding-left: 1mm; }
.oir-sign { display: flex; justify-content: space-between; margin-top: 8mm; }
.oir-sign div { width: 53mm; padding-top: 1.5mm; border-top: 1.5px solid #000; font-size: 10pt; }
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
