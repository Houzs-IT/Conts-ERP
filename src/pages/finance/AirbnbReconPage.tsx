import { useMemo, useRef, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import { SectionCard } from '../../components/Card';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { EmptyState } from '../../components/States';
import { StatRow, StatTile } from '../../components/Metric';
import { DataTable, type Column } from '../../components/DataTable';
import { Segmented as Tabs } from '../../components/ops/OpsUi';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { csvObjects } from '../../lib/sheets';
import { count, date, dateShort, dateTime, monthLabel, nights as nightsText, plural, rm, todayMyt } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import type { AnyTone } from '../../lib/status';
import { useUrlState, MonthStepper, shiftMonth } from './listKit';

/** Finance > Airbnb reconciliation (chew's spec and answers, 10 Nov 2026; docs/superpowers/plans/2026-11-10-airbnb-reconciliation.md).
 *  Upload Airbnb's transaction CSVs for a month; each booking's Airbnb money is set against the booking by confirmation
 *  code and sorted by rule. Step 1 shows and exports only: nothing changes until finance confirms (Step 2). */

type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12' | 'R13' | 'R99';
type IncomeKind = 'extra_charge' | 'won_back' | 'cancelled_paid' | 'aircover';
interface Stay { id: string; unit: string; guest: string | null; checkIn: string; checkOut: string; state: string; net: number }
interface Income { kind: IncomeKind; amount: number; date: string; txnIds: string[]; note: string }
interface Line {
  code: string; rule: Rule; sure: 'likely' | 'look' | null; action: 'none' | 'set_amount' | 'cancel' | 'check' | 'wait';
  newAmount: number | null; suggestion: string; income: Income[]; needsConfirm: boolean;
  guest: string | null; listing: string | null; startDate: string | null; endDate: string | null; nights: number | null;
  stays: Stay[]; found: boolean; cancelled: boolean; systemNet: number | null;
  payments: { id: string; date: string; amount: number; inMonth: boolean }[];
  reservation: number; adjustment: number; extra: number; aircover: number; difference: number | null;
}
interface RuleTotal { rule: Rule; label: string; count: number; system: number; airbnb: number; difference: number }
interface Payload {
  ready: boolean; month: string; today: string; mayUpload: boolean;
  rules?: Record<Rule, string>; incomeKinds?: Record<IncomeKind, string>;
  months?: { month: string; lines: number }[];
  files?: { id: string; fileName: string; lines: number; added: number; duplicates: number; uploadedAt: string; uploadedBy: string | null }[];
  lines?: Line[]; summary?: RuleTotal[];
  totals?: { bank: number; money: number; reservations: number; adjustments: number; resolutions: number; income: Record<IncomeKind, number>; needsConfirm: number };
  payouts?: { id: string; date: string; arrivingBy: string | null; details: string | null; referenceCode: string | null; paidOut: number }[];
  loose?: { id: string; date: string; type: string; details: string | null; amount: number }[];
}
interface UploadAnswer { files: { name: string; lines: number; added: number; duplicates: number }[]; added: number; duplicates: number; months: { month: string; lines: number }[] }
type View = 'confirm' | 'all' | 'income' | 'bank';
interface IncomeRow extends Income { key: string; code: string; rule: Rule; unit: string }

/** Equal is good, waiting is neutral, a change to make is a warning, a booking not found or not understood is critical. */
const RULE_TONE: Record<Rule, AnyTone> = {
  R1: 'success', R2: 'gold', R3: 'neutral', R4: 'gold', R5: 'info', R6: 'neutral', R7: 'warning', R8: 'warning',
  R9: 'critical', R10: 'gold', R11: 'critical', R12: 'neutral', R13: 'gold', R99: 'critical',
};
/** "To confirm" opens on what needs a decision: not found or not understood, then amounts to change, then company
 *  income only, then confirm-only lines. */
const RULE_FIRST: Rule[] = ['R99', 'R9', 'R11', 'R4', 'R10', 'R8', 'R7', 'R2', 'R3', 'R5', 'R13', 'R6', 'R1', 'R12'];
const KIND_TONE: Record<IncomeKind, AnyTone> = { extra_charge: 'info', won_back: 'gold', cancelled_paid: 'warning', aircover: 'neutral' };
const ACTION: Record<Line['action'], string> = { none: 'Nothing to change', set_amount: 'Set the amount', cancel: 'Mark cancelled', check: 'Look by hand', wait: 'Wait for a later file' };
const money = (sen: number | null | undefined) => (sen == null ? '–' : rm(sen));
const signed = (sen: number) => (sen < 0 ? `−${rm(-sen)}` : rm(sen));
const paymentsText = (l: Line) => l.payments.map(p => `${dateShort(p.date)} ${rm(p.amount)}${p.inMonth ? '' : ` (${monthLabel(p.date)})`}`).join('; ');
const unitsOf = (l: Line) => [...new Set(l.stays.map(s => s.unit))].join(', ');

export default function AirbnbReconPage() {
  const url = useUrlState();
  const today = todayMyt();
  const month = /^\d{4}-\d{2}$/.test(url.get('month')) ? url.get('month') : shiftMonth(today.slice(0, 7), -1);
  const view = (['confirm', 'all', 'income', 'bank'] as View[]).find(v => v === url.get('view')) ?? 'confirm';
  const ruleFilter = url.get('rule') as Rule | '';
  const { data, loading, error, reload } = useApi<Payload>(`/airbnb-recon?month=${month}`);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const rules = data?.rules;
  const ruleText = (r: Rule) => `${r} ${rules?.[r] ?? ''}`.trim();

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const shownLines = useMemo(() => {
    const shown = lines.filter(l => (view === 'confirm' ? l.needsConfirm : true) && (!ruleFilter || l.rule === ruleFilter));
    return view === 'confirm' ? [...shown].sort((a, b) => RULE_FIRST.indexOf(a.rule) - RULE_FIRST.indexOf(b.rule)) : shown;
  }, [lines, view, ruleFilter]);
  const income = useMemo<IncomeRow[]>(() => lines.flatMap(l => l.income.map((i, n) => ({ ...i, key: `${l.code}-${n}`, code: l.code, rule: l.rule, unit: unitsOf(l) }))), [lines]);
  const t = data?.totals;
  const counted = lines.filter(l => l.rule !== 'R12').length;
  const equal = lines.filter(l => l.rule === 'R1').length;
  const change = lines.reduce((n, l) => n + (l.action === 'set_amount' && l.newAmount != null && l.systemNet != null ? l.newAmount - l.systemNet : 0), 0);
  const incomeTotal = t ? Object.values(t.income).reduce((n, v) => n + v, 0) : 0;

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!picked.length) return;
    setBusy(true);
    try {
      const files = await Promise.all(picked.map(async f => ({ name: f.name, rows: csvObjects(await f.text()).rows })));
      const r = await api.post<UploadAnswer>('/airbnb-recon/upload', { month, files });
      const main = r.months[0]?.month;
      toast({
        tone: 'success', title: `${plural(r.added, 'new line')} from ${plural(r.files.length, 'file')}.`,
        body: r.duplicates ? `${plural(r.duplicates, 'line was', 'lines were')} already uploaded, so not recorded again.` : undefined,
      });
      if (main && main !== month) url.set({ month: main });
      else reload();
    } catch (err) {
      notifyFailure(err);
    } finally {
      setBusy(false);
    }
  }

  const upload = data?.mayUpload
    ? <Button variant="primary" icon={<Icon name="Upload" size="sm" />} loading={busy} onClick={() => fileRef.current?.click()}>Upload Airbnb CSV</Button>
    : null;

  return (
    <>
      <PageHeader title="Airbnb reconciliation"
        sub="Airbnb’s payments matched to the reservations by confirmation code and sorted by rule. Nothing changes until finance confirms."
        actions={<MonthStepper label={monthLabel(month)} onStep={by => url.set({ month: shiftMonth(month, by), rule: null })} />}
        primary={upload} />
      <input ref={fileRef} type="file" accept=".csv,text/csv" multiple onChange={onFiles} className="hidden" aria-hidden />
      <div className="flex flex-col gap-4">
        {error && <StaleBanner message={data ? `Showing the last figures we have. ${error}` : error} onRetry={reload} />}
        {loading && !data ? <TableSkeleton rows={8} cols={6} />
          : data && !data.ready ? <EmptyState title="Airbnb reconciliation is not set up yet." body="It is waiting for a database update (migration 0258)." />
          : data && !(data.files?.length || lines.length) ? (
            <EmptyState title={`No Airbnb files for ${monthLabel(month)} yet.`} icon="FileSpreadsheet"
              body={<>Download the transaction history from Airbnb (Earnings › Transaction history › Export CSV) for each account, then upload the files here. A line already uploaded is never recorded twice.{data.months?.length ? <> Months with lines: {data.months.map(m => monthLabel(m.month)).join(', ')}.</> : null}</>}
              action={data.mayUpload ? { label: 'Upload Airbnb CSV', onClick: () => fileRef.current?.click() } : undefined} />
          ) : data && t ? (
            <>
              <Files files={data.files ?? []} />
              <StatRow cols={4}>
                <StatTile label="Paid to the bank" value={rm(t.bank)}
                  hint={t.bank === t.money ? <span className="text-success">✓ Equals the money for reservations</span> : <span className="text-warning">Money for reservations {rm(t.money)}: {signed(t.money - t.bank)} apart</span>} />
                <StatTile label="Reservations equal" value={`${count(equal)} of ${count(counted)}`} hint={counted ? `${((equal / counted) * 100).toFixed(1)}% need nothing` : undefined} />
                <StatTile label="To confirm" value={count(t.needsConfirm)} tone={t.needsConfirm ? 'warning' : undefined} onClick={() => url.set({ view: null, rule: null })} active={view === 'confirm'}
                  hint={change ? `Reservation amounts would go ${change > 0 ? 'up' : 'down'} by ${rm(Math.abs(change))}` : 'No reservation amount to change'} />
                <StatTile hero label="Company income" value={rm(incomeTotal)} onClick={() => url.set({ view: 'income', rule: null })} active={view === 'income'}
                  hint={(Object.keys(t.income) as IncomeKind[]).filter(k => t.income[k]).map(k => `${data.incomeKinds?.[k] ?? k} ${rm(t.income[k])}`).join(' · ') || 'None this month'} />
              </StatRow>
              <ByRule summary={data.summary ?? []} active={ruleFilter} onRule={r => url.set({ rule: r === ruleFilter ? null : r, view: view === 'confirm' || view === 'all' ? (view === 'confirm' ? null : view) : 'all' })} />
              <Tabs<View> label="Which lines" value={view} onChange={v => url.set({ view: v === 'confirm' ? null : v })} className="self-start"
                options={[
                  { value: 'confirm', label: `To confirm (${count(t.needsConfirm)})` },
                  { value: 'all', label: `All reservations (${count(lines.length)})` },
                  { value: 'income', label: `Company income (${count(income.length)})` },
                  { value: 'bank', label: `Bank transfers (${count(data.payouts?.length ?? 0)})` },
                ]} />
              {view === 'income' ? <IncomeTable rows={income} kinds={data.incomeKinds} ruleText={ruleText} month={month} />
                : view === 'bank' ? <BankTable payouts={data.payouts ?? []} loose={data.loose ?? []} month={month} />
                : <BookingTable rows={shownLines} ruleText={ruleText} month={month} view={view}
                    filter={ruleFilter ? <button type="button" onClick={() => url.set({ rule: null })} className="bg-transparent border-0 p-0 cursor-pointer" title="Show every rule">
                      <StatusBadge tone={RULE_TONE[ruleFilter]} label={<>{ruleText(ruleFilter)} ✕</>} /></button> : null} />}
            </>
          ) : null}
      </div>
    </>
  );
}

function Files({ files }: { files: NonNullable<Payload['files']> }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-ink">
      <span className="font-medium text-ink">Files</span>
      {files.map(f => (
        <span key={f.id} title={`${f.uploadedBy ?? 'Someone'}, ${dateTime(f.uploadedAt)}`}>
          <Icon name="FileSpreadsheet" size="sm" style={{ verticalAlign: '-3px', marginRight: 4 }} />
          {f.fileName} · {plural(f.lines, 'line')}{f.duplicates ? ` (${count(f.duplicates)} already there)` : ''} · {date(f.uploadedAt)}
        </span>
      ))}
    </div>
  );
}

function ByRule({ summary, active, onRule }: { summary: RuleTotal[]; active: string; onRule: (r: Rule) => void }) {
  const total = summary.reduce((a, s) => ({ count: a.count + s.count, system: a.system + s.system, airbnb: a.airbnb + s.airbnb, difference: a.difference + s.difference }), { count: 0, system: 0, airbnb: 0, difference: 0 });
  const cell = 'py-1.5 px-2 text-right tabular-nums whitespace-nowrap';
  return (
    <SectionCard title="By rule (RM)">
      <div className="overflow-x-auto">
        <table className="w-full text-copy border-collapse">
          <thead>
            <tr className="text-meta text-muted-ink [border-bottom:1px_solid_var(--color-line)]">
              <th className="py-1.5 px-2 text-left font-semibold">Rule</th>
              <th className="py-1.5 px-2 text-right font-semibold">Reservations</th>
              <th className="py-1.5 px-2 text-right font-semibold">System</th>
              <th className="py-1.5 px-2 text-right font-semibold" title="Paid for the reservations, less anything Airbnb took back">Airbnb</th>
              <th className="py-1.5 px-2 text-right font-semibold" title="System − Airbnb, for the reservations in the system">Difference</th>
            </tr>
          </thead>
          <tbody>
            {summary.map(s => (
              <tr key={s.rule} onClick={() => onRule(s.rule)} className={cx('cursor-pointer hover:bg-muted [border-bottom:1px_solid_var(--color-line)]', active === s.rule && 'bg-muted')}>
                <td className="py-1.5 px-2"><StatusBadge tone={RULE_TONE[s.rule]} label={s.rule} size="sm" /> <span className="ml-1">{s.label}</span></td>
                <td className={cell}>{count(s.count)}</td>
                <td className={cell}>{s.system ? signed(s.system) : '–'}</td>
                <td className={cx(cell, s.airbnb < 0 && 'text-danger')}>{s.airbnb ? signed(s.airbnb) : '–'}</td>
                <td className={cx(cell, s.difference < 0 && 'text-danger')}>{s.difference ? signed(s.difference) : '–'}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 px-2">Total</td>
              <td className={cell}>{count(total.count)}</td>
              <td className={cell}>{rm(total.system)}</td>
              <td className={cell}>{rm(total.airbnb)}</td>
              <td className={cx(cell, total.difference < 0 && 'text-danger')}>{signed(total.difference)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function BookingTable({ rows, ruleText, month, view, filter }: { rows: Line[]; ruleText: (r: Rule) => string; month: string; view: View; filter: React.ReactNode }) {
  const columns: Column<Line>[] = [
    { key: 'code', label: 'Confirmation code', type: 'ref', value: l => l.code, phone: 'title', hideable: false, width: 130 },
    {
      key: 'rule', label: 'Rule', type: 'status', width: 230, phone: 'badge', value: l => l.rule,
      status: l => ({ label: `${ruleText(l.rule)}${l.sure === 'look' ? ' · look closer' : l.sure === 'likely' ? ' · likely' : ''}`, tone: RULE_TONE[l.rule] }),
    },
    { key: 'unit', label: 'Unit', value: unitsOf, sub: l => l.stays[0]?.guest ?? null, width: 130 },
    { key: 'guest', label: 'Guest (Airbnb)', value: l => l.guest, sub: l => l.listing, width: 170, hidden: true },
    {
      key: 'stay', label: 'Stay', value: l => l.startDate, width: 170,
      render: l => (l.startDate ? <span className="whitespace-nowrap">{dateShort(l.startDate)}{l.endDate ? ` – ${dateShort(l.endDate)}` : ''}</span> : '–'),
      sub: l => (l.nights ? nightsText(l.nights) : null),
      exportValue: l => (l.startDate ? `${l.startDate}${l.endDate ? ` to ${l.endDate}` : ''}` : ''),
    },
    {
      key: 'system', label: 'System (RM)', type: 'money', align: 'right', width: 110, value: l => (l.cancelled ? null : l.systemNet),
      render: l => (l.cancelled ? <span className="text-muted-ink">Cancelled</span> : !l.found ? <span className="text-danger">Not found</span> : money(l.systemNet)),
      exportValue: l => (l.cancelled ? 'Cancelled' : !l.found ? 'Not found' : l.systemNet),
      title: 'Guest total − Airbnb’s fee, as on the owner statement, added up over the units of the code',
    },
    {
      key: 'airbnb', label: 'Airbnb (RM)', type: 'money', align: 'right', width: 150, value: l => l.reservation + l.adjustment, phone: 'right',
      sub: l => (l.adjustment ? `less ${rm(-l.adjustment)} taken back` : l.payments.length > 1 ? `${l.payments.length} payments` : null),
      title: 'Paid for the reservation, less anything Airbnb took back',
    },
    {
      key: 'difference', label: 'Difference (RM)', type: 'money', align: 'right', width: 110, value: l => l.difference,
      render: l => (l.difference == null ? '–' : <span className={cx('tabular-nums', l.difference < 0 && 'text-danger')}>{l.difference ? signed(l.difference) : rm(0)}</span>),
      title: 'System − Airbnb',
    },
    { key: 'suggestion', label: 'Suggestion', value: l => l.suggestion, width: 400, sortable: false, render: l => <span className="text-meta whitespace-normal">{l.suggestion}</span> },
    { key: 'newAmount', label: 'Set reservation to (RM)', type: 'money', align: 'right', width: 120, value: l => l.newAmount },
    {
      key: 'payments', label: 'Airbnb payments', value: paymentsText, width: 220, sortable: false,
      render: l => (l.payments.length ? <span className="text-meta">{paymentsText(l)}</span> : <span className="text-muted-ink">–</span>),
    },
    { key: 'adjustment', label: 'Taken back (RM)', type: 'money', align: 'right', width: 110, value: l => l.adjustment || null },
    { key: 'extra', label: 'Extra and AirCover (RM)', type: 'money', align: 'right', width: 120, value: l => l.extra + l.aircover || null },
    { key: 'action', label: 'To do', value: l => ACTION[l.action], width: 140, hidden: true },
  ];
  return (
    <DataTable id={`airbnb-recon.${view}`} urlPrefix="b" columns={columns} rows={rows} rowKey={l => l.code}
      rowTone={l => (l.rule === 'R9' || l.rule === 'R11' ? 'critical' : null)}
      toolbar={filter} exportName={`airbnb-reconciliation-${month}${view === 'confirm' ? '-to-confirm' : ''}`} noun={['reservation', 'reservations']}
      empty={{ title: view === 'confirm' ? 'Nothing to confirm this month.' : 'No reservations this month.' }} />
  );
}

function IncomeTable({ rows, kinds, ruleText, month }: { rows: IncomeRow[]; kinds?: Record<IncomeKind, string>; ruleText: (r: Rule) => string; month: string }) {
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const columns: Column<IncomeRow>[] = [
    { key: 'code', label: 'Confirmation code', type: 'ref', value: r => r.code, phone: 'title', hideable: false, width: 130 },
    { key: 'kind', label: 'Kind', type: 'status', value: r => r.kind, status: r => ({ label: kinds?.[r.kind] ?? r.kind, tone: KIND_TONE[r.kind] }), phone: 'badge', width: 190 },
    { key: 'date', label: 'Date', type: 'date', value: r => r.date, width: 110 },
    { key: 'amount', label: 'Amount (RM)', type: 'money', align: 'right', value: r => r.amount, phone: 'right', width: 110 },
    { key: 'unit', label: 'Unit', value: r => r.unit || null, width: 130 },
    { key: 'rule', label: 'Reservation rule', value: r => ruleText(r.rule), width: 230 },
    { key: 'note', label: 'Airbnb line', value: r => r.note, width: 200 },
  ];
  return (
    <DataTable id="airbnb-recon.income" urlPrefix="i" columns={columns} rows={rows} rowKey={r => r.key} exportName={`airbnb-company-income-${month}`}
      above={<div className="px-4 py-2 text-meta text-muted-ink">The company’s, never an owner’s; kept apart by kind. Total <span className="font-semibold text-ink tabular-nums">{rm(total)}</span>.</div>}
      noun={['line', 'lines']} empty={{ title: 'No company income this month.' }} />
  );
}

function BankTable({ payouts, loose, month }: { payouts: NonNullable<Payload['payouts']>; loose: NonNullable<Payload['loose']>; month: string }) {
  const total = payouts.reduce((n, p) => n + p.paidOut, 0);
  const columns: Column<NonNullable<Payload['payouts']>[number]>[] = [
    { key: 'date', label: 'Date', type: 'date', value: p => p.date, phone: 'title', width: 110 },
    { key: 'arrivingBy', label: 'Arriving by', type: 'date', value: p => p.arrivingBy, width: 110 },
    { key: 'details', label: 'Details', value: p => p.details, width: 260 },
    { key: 'reference', label: 'Reference', value: p => p.referenceCode, width: 160 },
    { key: 'paidOut', label: 'Paid out (RM)', type: 'money', align: 'right', value: p => p.paidOut, phone: 'right', width: 120 },
  ];
  return (
    <div className="flex flex-col gap-3">
      <DataTable id="airbnb-recon.bank" urlPrefix="p" columns={columns} rows={payouts} rowKey={p => p.id} exportName={`airbnb-bank-transfers-${month}`}
        above={<div className="px-4 py-2 text-meta text-muted-ink">{plural(payouts.length, 'transfer')}, total <span className="font-semibold text-ink tabular-nums">{rm(total)}</span>.</div>}
        noun={['transfer', 'transfers']} empty={{ title: 'No bank transfers this month.' }} />
      {loose.length > 0 && (
        <SectionCard title="Lines with no confirmation code">
          <ul className="m-0 pl-4 text-copy">
            {loose.map(l => <li key={l.id}>{date(l.date)} · {l.type} · {l.details ?? '–'} · {signed(l.amount)}</li>)}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
