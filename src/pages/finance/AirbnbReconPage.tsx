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
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { Field } from '../../components/Field';
import { Switch } from '../../components/Switch';
import { useConfirm } from '../../components/ConfirmDialog';
import { Segmented as Tabs } from '../../components/ops/OpsUi';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure, ApiFailure } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { csvObjects } from '../../lib/sheets';
import { count, date, dateShort, dateTime, monthLabel, nights as nightsText, plural, rm, todayMyt } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import type { AnyTone } from '../../lib/status';
import { useUrlState, MonthStepper, shiftMonth } from './listKit';

/** Finance > Airbnb reconciliation (chew's spec and answers, 10 and 11 Nov 2026; docs/superpowers/plans/2026-11-10-airbnb-reconciliation.md).
 *  Upload Airbnb's transaction CSVs for a month; each reservation's Airbnb money is set against it by confirmation code
 *  and sorted by rule. Finance confirms each line in a window that lists what changes (the reservation, the owner's
 *  statement, the company income with its type), or keeps it as it is; lines that only record company income can be
 *  confirmed together. A confirmation is undone while the statements it touched are open. */

type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12' | 'R13' | 'R99';
type IncomeKind = 'additional_charge' | 'recovered' | 'cancelled_paid' | 'aircover';
interface Stay { id: string; unit: string; guest: string | null; checkIn: string; checkOut: string; state: string; net: number }
interface Choice { typeId: string | null; subTypeId: string | null }
interface Recorded { code: string | null; key: string; typeId: string | null; subTypeId: string | null; amount: number }
/** `recorded`: what a confirmation recorded for it (added on the page), else null. */
interface Income { kind: IncomeKind; amount: number; date: string; txnIds: string[]; note: string; details: string | null; key: string; proposed: Choice | null; recorded?: Recorded | null }
interface Preview {
  ok: boolean; message: string | null;
  changes: {
    reservationId: string; unit: string; state: { before: string; after: string }; gross: { before: number; after: number }; net: { before: number; after: number };
    fee: number; openMonths: string[];
  }[];
  shares: { unit: string; owner: string; sen: number; months: string[]; onMonth: string; guarantee: boolean }[];
}
interface Decision { action: string; note: string | null; at: string; by: string | null; reservations: number; income: number; ownerShares: { sen: number; onMonth: string }[] }
interface Line {
  code: string; rule: Rule; sure: 'likely' | 'look' | null; action: 'none' | 'set_amount' | 'cancel' | 'check' | 'wait';
  newAmount: number | null; suggestion: string; income: Income[]; needsConfirm: boolean;
  guest: string | null; listing: string | null; startDate: string | null; endDate: string | null; nights: number | null;
  stays: Stay[]; found: boolean; cancelled: boolean; systemNet: number | null;
  payments: { id: string; date: string; amount: number; inMonth: boolean }[];
  reservation: number; adjustment: number; extra: number; aircover: number; difference: number | null;
  decision?: Decision | null; preview?: Preview | null; previewSet?: Preview | null; bulk?: boolean;
}
interface IncomeType { id: string; parentId: string | null; name: string; systemKey: string | null; matchWords: string | null; active: boolean; sortOrder: number }
interface RuleTotal { rule: Rule; label: string; count: number; system: number; airbnb: number; difference: number }
interface Payload {
  ready: boolean; month: string; today: string; mayUpload: boolean;
  confirmReady?: boolean; mayConfirm?: boolean; mayManageTypes?: boolean;
  rules?: Record<Rule, string>; incomeKinds?: Record<IncomeKind, string>; incomeTypes?: IncomeType[];
  months?: { month: string; lines: number }[];
  files?: { id: string; fileName: string; lines: number; added: number; duplicates: number; uploadedAt: string; uploadedBy: string | null }[];
  lines?: Line[]; summary?: RuleTotal[];
  totals?: { bank: number; money: number; reservations: number; adjustments: number; resolutions: number; income: Record<IncomeKind, number>; needsConfirm: number };
  recordedIncome?: Recorded[];
  payouts?: { id: string; date: string; arrivingBy: string | null; details: string | null; referenceCode: string | null; paidOut: number }[];
  loose?: { id: string; date: string; type: string; details: string | null; amount: number }[];
}
interface UploadAnswer { files: { name: string; lines: number; added: number; duplicates: number }[]; added: number; duplicates: number; months: { month: string; lines: number }[] }
interface DecideAnswer { confirmed: number; kept: number; reservations: number; income: number; ownerShares: { amount: number; onMonth: string }[]; regenerate: string[] }
type View = 'confirm' | 'done' | 'all' | 'income' | 'bank';
interface IncomeRow extends Income { rowKey: string; code: string; rule: Rule; unit: string }

/** Equal is good, waiting is neutral, a change to make is a warning, a reservation not found or not understood is critical. */
const RULE_TONE: Record<Rule, AnyTone> = {
  R1: 'success', R2: 'gold', R3: 'neutral', R4: 'gold', R5: 'info', R6: 'neutral', R7: 'warning', R8: 'warning',
  R9: 'critical', R10: 'gold', R11: 'critical', R12: 'neutral', R13: 'gold', R99: 'critical',
};
/** "To confirm" opens on what needs a decision: not found or not understood, then amounts to change, then company
 *  income only, then confirm-only lines. */
const RULE_FIRST: Rule[] = ['R99', 'R9', 'R11', 'R4', 'R10', 'R8', 'R7', 'R2', 'R3', 'R5', 'R13', 'R6', 'R1', 'R12'];
const KIND_TONE: Record<IncomeKind, AnyTone> = { additional_charge: 'info', recovered: 'gold', cancelled_paid: 'warning', aircover: 'neutral' };
const ACTION: Record<Line['action'], string> = { none: 'Nothing to change', set_amount: 'Set the amount', cancel: 'Mark cancelled', check: 'Look by hand', wait: 'Wait for a later file' };
/** What the rules give each system type (migration 0259), shown where finance keeps the types. */
const SYSTEM_TEXT: Record<string, string> = {
  additional_charge: 'The rules give this type to a resolution payout nothing else explains.',
  aircover: 'The rules give this type to an AirCover reimbursement.',
  recovered: 'The rules give this type to money Airbnb paid back after taking it.',
  cancelled_paid: 'The rules give this type to a cancelled reservation Airbnb still paid for.',
};
const money = (sen: number | null | undefined) => (sen == null ? '–' : rm(sen));
const signed = (sen: number) => (sen < 0 ? `−${rm(-sen)}` : rm(sen));
const paymentsText = (l: Line) => l.payments.map(p => `${dateShort(p.date)} ${rm(p.amount)}${p.inMonth ? '' : ` (${monthLabel(p.date)})`}`).join('; ');
const unitsOf = (l: Line) => [...new Set(l.stays.map(s => s.unit))].join(', ');
const monthsText = (months: string[]) => months.map(m => monthLabel(m)).join(' and ');

/** The name of a type, with its sub-type: "Additional charge · Pickup". */
function typeNamer(types: IncomeType[]) {
  const byId = new Map(types.map(t => [t.id, t]));
  return (c: Choice | null | undefined) => {
    const t = c?.typeId ? byId.get(c.typeId) : undefined;
    if (!t) return null;
    const s = c?.subTypeId ? byId.get(c.subTypeId) : undefined;
    return s ? `${t.name} · ${s.name}` : t.name;
  };
}
/** A type that can be chosen now: active, with an active sub-type when it has any. */
function typeChosen(types: IncomeType[], c: Choice | null | undefined) {
  const t = types.find(x => x.id === c?.typeId && !x.parentId && x.active);
  if (!t) return false;
  const subs = types.filter(x => x.parentId === t.id && x.active);
  return !subs.length || subs.some(x => x.id === c?.subTypeId);
}
/** What a confirmation wrote, for the toast. */
function answerText(r: DecideAnswer) {
  const parts = [
    r.reservations ? `${plural(r.reservations, 'reservation')} changed` : '',
    r.income ? `${rm(r.income)} company income recorded` : '',
    r.ownerShares.length ? `owner ${r.ownerShares.map(s => `${signed(s.amount)} on the ${monthLabel(s.onMonth)} statement`).join(', ')}` : '',
  ].filter(Boolean);
  const regen = r.regenerate.length ? ` The ${monthsText(r.regenerate)} owner statements show it when generated again.` : '';
  return (parts.length ? `${parts.join('; ')}.` : 'Nothing changed on the reservation.') + regen;
}

export default function AirbnbReconPage() {
  const url = useUrlState();
  const today = todayMyt();
  const month = /^\d{4}-\d{2}$/.test(url.get('month')) ? url.get('month') : shiftMonth(today.slice(0, 7), -1);
  const view = (['confirm', 'done', 'all', 'income', 'bank'] as View[]).find(v => v === url.get('view')) ?? 'confirm';
  const ruleFilter = url.get('rule') as Rule | '';
  const { data, loading, error, reload } = useApi<Payload>(`/airbnb-recon?month=${month}`);
  const toast = useToast();
  const [undoUi, ask] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Line | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const rules = data?.rules;
  const ruleText = (r: Rule) => `${r} ${rules?.[r] ?? ''}`.trim();
  const types = useMemo(() => data?.incomeTypes ?? [], [data]);
  const typeName = useMemo(() => typeNamer(types), [types]);
  const mayConfirm = !!data?.mayConfirm;

  const recorded = useMemo(() => data?.recordedIncome ?? [], [data]);
  // Each company income line with what was recorded for it, if confirmed: a decided line shows the type chosen.
  const lines = useMemo(() => {
    const byKey = new Map(recorded.map(r => [`${r.code}|${r.key}`, r]));
    return (data?.lines ?? []).map(l => ({ ...l, income: l.income.map(i => ({ ...i, recorded: byKey.get(`${l.code}|${i.key}`) ?? null })) }));
  }, [data, recorded]);
  const open = useMemo(() => lines.filter(l => l.needsConfirm && !l.decision), [lines]);
  const done = useMemo(() => lines.filter(l => !!l.decision), [lines]);
  const bulkLines = useMemo(() => (mayConfirm ? open.filter(l => l.bulk) : []), [open, mayConfirm]);
  const shownLines = useMemo(() => {
    const base = view === 'confirm' ? open : view === 'done' ? done : lines;
    const shown = base.filter(l => !ruleFilter || l.rule === ruleFilter);
    return view === 'confirm' ? [...shown].sort((a, b) => RULE_FIRST.indexOf(a.rule) - RULE_FIRST.indexOf(b.rule)) : shown;
  }, [lines, open, done, view, ruleFilter]);
  const income = useMemo<IncomeRow[]>(() => lines.flatMap(l => l.income.map((i, n) => ({ ...i, rowKey: `${l.code}-${n}`, code: l.code, rule: l.rule, unit: unitsOf(l) }))), [lines]);
  const t = data?.totals;
  const counted = lines.filter(l => l.rule !== 'R12').length;
  const equal = lines.filter(l => l.rule === 'R1').length;
  const change = open.reduce((n, l) => n + (l.action === 'set_amount' && l.newAmount != null && l.systemNet != null ? l.newAmount - l.systemNet : 0), 0);
  const incomeTotal = t ? Object.values(t.income).reduce((n, v) => n + v, 0) : 0;
  const recordedTotal = recorded.reduce((n, r) => n + r.amount, 0);

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

  async function undo(l: Line) {
    const kept = l.decision?.action === 'keep';
    const yes = await ask({
      title: `Undo ${l.code}?`, confirmLabel: 'Undo', danger: true,
      body: kept ? 'It goes back to the list to confirm.'
        : 'The reservation goes back to what it was, its company income is removed, and so are the owner adjustments it made. It goes back to the list to confirm.',
    });
    if (yes === null) return;
    try {
      const r = await api.post<{ regenerate: string[] }>('/airbnb-recon/undo', { month, code: l.code });
      toast({ tone: 'success', title: `${l.code} undone.`, body: r.regenerate.length ? `The ${monthsText(r.regenerate)} owner statements show it when generated again.` : undefined });
      reload();
    } catch (err) {
      notifyFailure(err);
    }
  }

  const upload = data?.mayUpload
    ? <Button variant="primary" icon={<Icon name="Upload" size="sm" />} loading={busy} onClick={() => fileRef.current?.click()}>Upload Airbnb CSV</Button>
    : null;
  const ruleChip = ruleFilter ? (
    <button type="button" onClick={() => url.set({ rule: null })} className="bg-transparent border-0 p-0 cursor-pointer" title="Show every rule">
      <StatusBadge tone={RULE_TONE[ruleFilter]} label={<>{ruleText(ruleFilter)} ✕</>} />
    </button>
  ) : null;

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
                <StatTile label="To confirm" value={count(open.length)} tone={open.length ? 'warning' : undefined} onClick={() => url.set({ view: null, rule: null })} active={view === 'confirm'}
                  hint={[done.length ? `${count(done.length)} done` : '', change ? `amounts would go ${change > 0 ? 'up' : 'down'} by ${rm(Math.abs(change))}` : ''].filter(Boolean).join(' · ') || 'No reservation amount to change'} />
                <StatTile hero label="Company income" value={rm(incomeTotal)} onClick={() => url.set({ view: 'income', rule: null })} active={view === 'income'}
                  hint={data.confirmReady
                    ? (incomeTotal ? `${rm(recordedTotal)} recorded · ${rm(incomeTotal - recordedTotal)} to confirm` : 'None this month')
                    : (Object.keys(t.income) as IncomeKind[]).filter(k => t.income[k]).map(k => `${data.incomeKinds?.[k] ?? k} ${rm(t.income[k])}`).join(' · ') || 'None this month'} />
              </StatRow>
              <ByRule summary={data.summary ?? []} active={ruleFilter} onRule={r => url.set({ rule: r === ruleFilter ? null : r, view: view === 'income' || view === 'bank' ? 'all' : view === 'confirm' ? null : view })} />
              <Tabs<View> label="Which lines" value={view} onChange={v => url.set({ view: v === 'confirm' ? null : v })} className="self-start"
                options={[
                  { value: 'confirm', label: `To confirm (${count(open.length)})` },
                  ...(data.confirmReady ? [{ value: 'done' as View, label: `Confirmed (${count(done.length)})` }] : []),
                  { value: 'all', label: `All reservations (${count(lines.length)})` },
                  { value: 'income', label: `Company income (${count(income.length)})` },
                  { value: 'bank', label: `Bank transfers (${count(data.payouts?.length ?? 0)})` },
                ]} />
              {!data.confirmReady && data.mayUpload && (
                <p className="m-0 text-meta text-muted-ink">Confirming starts after a database update (migration 0259). Until then this page only shows.</p>
              )}
              {view === 'income' ? <IncomeTable rows={income} kinds={data.incomeKinds} typeName={typeName} ready={!!data.confirmReady} ruleText={ruleText} month={month}
                  onTypes={data.confirmReady ? () => setTypesOpen(true) : undefined} />
                : view === 'bank' ? <BankTable payouts={data.payouts ?? []} loose={data.loose ?? []} month={month} />
                : <BookingTable key={view} rows={shownLines} ruleText={ruleText} month={month} view={view} typeName={typeName}
                    onOpen={mayConfirm && view === 'confirm' ? l => { if (l.preview) setConfirming(l); } : undefined}
                    onUndo={mayConfirm ? undo : undefined}
                    filter={<>
                      {ruleChip}
                      {view === 'confirm' && bulkLines.length > 0 && (
                        <Button size="sm" variant="secondary" icon={<Icon name="ListChecks" size="sm" />} onClick={() => setBulkOpen(true)}>
                          Confirm company income only ({count(bulkLines.length)})
                        </Button>
                      )}
                    </>} />}
            </>
          ) : null}
      </div>
      {confirming && (
        <ConfirmWindow line={confirming} month={month} types={types} ruleText={ruleText}
          onClose={() => setConfirming(null)} onDone={() => { setConfirming(null); reload(); }} />
      )}
      {bulkOpen && (
        <BulkWindow lines={bulkLines} month={month} typeName={typeName}
          onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); reload(); }} />
      )}
      {typesOpen && <IncomeTypesWindow types={types} mayEdit={!!data?.mayManageTypes} onClose={() => setTypesOpen(false)} onSaved={reload} />}
      {undoUi}
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

/** What a decision wrote, in a few words. */
function decisionText(d: Decision) {
  if (d.action === 'keep') return 'Nothing changed';
  const owner = d.ownerShares.reduce((n, s) => n + s.sen, 0);
  return [
    d.reservations ? `${plural(d.reservations, 'reservation')} changed` : 'Reservation unchanged',
    d.income ? plural(d.income, 'income line') : '',
    d.ownerShares.length ? `owner ${signed(owner)} on ${monthsText([...new Set(d.ownerShares.map(s => s.onMonth))])}` : '',
  ].filter(Boolean).join(' · ');
}

function BookingTable({ rows, ruleText, month, view, filter, typeName, onOpen, onUndo }: {
  rows: Line[]; ruleText: (r: Rule) => string; month: string; view: View; filter: React.ReactNode;
  typeName: (c: Choice | null | undefined) => string | null; onOpen?: (l: Line) => void; onUndo?: (l: Line) => void;
}) {
  const status: Column<Line> = {
    key: 'status', label: 'Status', type: 'status', width: 150, value: l => (l.decision ? l.decision.action : l.needsConfirm ? 'open' : 'none'),
    status: l => (l.decision ? { label: l.decision.action === 'keep' ? 'Kept as it is' : 'Confirmed', tone: l.decision.action === 'keep' ? 'neutral' : 'success' }
      : l.needsConfirm ? { label: 'To confirm', tone: 'warning' } : null),
    sub: l => (l.decision ? `${l.decision.by ?? 'Someone'}, ${dateShort(l.decision.at)}` : null),
  };
  const columns: Column<Line>[] = [
    { key: 'code', label: 'Confirmation code', type: 'ref', value: l => l.code, phone: 'title', hideable: false, width: 130 },
    {
      key: 'rule', label: 'Rule', type: 'status', width: 230, phone: 'badge', value: l => l.rule,
      status: l => ({ label: `${ruleText(l.rule)}${l.sure === 'look' ? ' · look closer' : l.sure === 'likely' ? ' · likely' : ''}`, tone: RULE_TONE[l.rule] }),
    },
    ...(view === 'confirm' ? [] : [status]),
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
    ...(view === 'done' ? [
      { key: 'wrote', label: 'What it wrote', value: (l: Line) => (l.decision ? decisionText(l.decision) : null), width: 260, sortable: false },
      { key: 'note', label: 'Note', value: (l: Line) => l.decision?.note ?? null, width: 200, sortable: false },
    ] : [
      { key: 'suggestion', label: 'Suggestion', value: (l: Line) => l.suggestion, width: 400, sortable: false, render: (l: Line) => <span className="text-meta whitespace-normal">{l.suggestion}</span> },
      { key: 'newAmount', label: 'Set reservation to (RM)', type: 'money' as const, align: 'right' as const, width: 120, value: (l: Line) => (l.action === 'check' ? null : l.newAmount) },
    ]),
    {
      key: 'incomeType', label: 'Company income', width: 220, sortable: false, hidden: view === 'all',
      value: l => l.income.map(i => `${rm(i.amount)} ${typeName(i.recorded ?? i.proposed) ?? 'type to choose'}`).join('; ') || null,
      render: l => (l.income.length ? <span className="text-meta">{l.income.map(i => `${rm(i.amount)} ${typeName(i.recorded ?? i.proposed) ?? '(type to choose)'}`).join('; ')}</span> : <span className="text-muted-ink">–</span>),
    },
    {
      key: 'payments', label: 'Airbnb payments', value: paymentsText, width: 220, sortable: false,
      render: l => (l.payments.length ? <span className="text-meta">{paymentsText(l)}</span> : <span className="text-muted-ink">–</span>),
    },
    { key: 'adjustment', label: 'Taken back (RM)', type: 'money', align: 'right', width: 110, value: l => l.adjustment || null },
    { key: 'extra', label: 'Extra and AirCover (RM)', type: 'money', align: 'right', width: 120, value: l => l.extra + l.aircover || null },
    { key: 'action', label: 'To do', value: l => ACTION[l.action], width: 140, hidden: true },
    ...(onOpen && view === 'confirm' ? [{
      key: 'open', label: '', width: 110, sortable: false, noExport: true, hideable: false,
      render: (l: Line) => (l.preview ? <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); onOpen(l); }}>Confirm…</Button> : null),
    }] : []),
    ...(onUndo && view === 'done' ? [{
      key: 'undo', label: '', width: 90, sortable: false, noExport: true, hideable: false,
      render: (l: Line) => <Button size="sm" variant="tertiary" icon={<Icon name="Undo2" size="sm" />} onClick={e => { e.stopPropagation(); onUndo(l); }}>Undo</Button>,
    }] : []),
  ];
  return (
    <DataTable id={`airbnb-recon.${view}`} urlPrefix="b" columns={columns} rows={rows} rowKey={l => l.code}
      rowTone={l => (l.rule === 'R9' || l.rule === 'R11' ? 'critical' : null)}
      onRowClick={onOpen && view === 'confirm' ? onOpen : undefined}
      toolbar={filter} exportName={`airbnb-reconciliation-${month}${view === 'confirm' ? '-to-confirm' : view === 'done' ? '-confirmed' : ''}`} noun={['reservation', 'reservations']}
      empty={{ title: view === 'confirm' ? 'Nothing to confirm this month.' : view === 'done' ? 'Nothing confirmed this month yet.' : 'No reservations this month.' }} />
  );
}

/** One line's confirm window (chew asked for one, 11 Nov 2026): what changes on the reservation and on the owner's
 *  statement, each company income line with its type, then Keep as it is or Confirm. */
function ConfirmWindow({ line, month, types, ruleText, onClose, onDone }: {
  line: Line; month: string; types: IncomeType[]; ruleText: (r: Rule) => string; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState<'leave' | 'set'>('leave');
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(line.income.map(i => [i.key, i.proposed ?? { typeId: null, subTypeId: null }])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'keep' | null>(null);
  const preview = amount === 'set' && line.previewSet ? line.previewSet : line.preview;
  const typed = line.income.every(i => typeChosen(types, choices[i.key]));
  const blocked = !preview?.ok ? (preview?.message ?? 'This line cannot be confirmed here.') : !typed ? 'Choose the type of each company income line first.' : '';
  const regen = [...new Set((preview?.changes ?? []).flatMap(c => c.openMonths))].sort();

  async function send(decision: 'confirm' | 'keep') {
    setBusy(decision);
    try {
      const r = await api.post<DecideAnswer>('/airbnb-recon/decisions', {
        month, items: [{ code: line.code, decision, setAmount: amount === 'set', note, income: line.income.map(i => ({ key: i.key, ...choices[i.key] })) }],
      });
      toast({ tone: 'success', title: decision === 'keep' ? `${line.code} kept as it is.` : `${line.code} confirmed.`, body: decision === 'keep' ? undefined : answerText(r) });
      onDone();
    } catch (err) {
      notifyFailure(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={`Confirm ${line.code}`} width={640} onClose={onClose} busy={!!busy}
      sub={<>{ruleText(line.rule)} · {unitsOf(line) || 'not in the system'}{line.startDate ? ` · ${dateShort(line.startDate)}${line.endDate ? ` – ${dateShort(line.endDate)}` : ''}` : ''}</>}
      footer={<>
        <Button size="sm" variant="tertiary" onClick={onClose} disabled={!!busy} disabledReason="Working on it.">Cancel</Button>
        <Button size="sm" variant="secondary" loading={busy === 'keep'} disabled={!!busy && busy !== 'keep'} disabledReason="Working on it." onClick={() => send('keep')}>Keep as it is</Button>
        <Button size="sm" variant="primary" icon={<Icon name="Check" size="sm" />} loading={busy === 'confirm'} disabled={!!blocked || (!!busy && busy !== 'confirm')}
          disabledReason={blocked || 'Working on it.'} onClick={() => send('confirm')}>Confirm</Button>
      </>}>
      <p className="m-0 text-copy">{line.suggestion}</p>

      {line.previewSet && (
        <Block title="Reservation amount">
          <Tabs<'leave' | 'set'> label="Reservation amount" value={amount} onChange={setAmount} className="self-start"
            options={[{ value: 'leave', label: `Leave it at ${money(line.systemNet)}` }, { value: 'set', label: `Set it to ${money(line.newAmount)}` }]} />
        </Block>
      )}

      <Block title="Reservation">
        {!preview ? null : !preview.ok ? (
          <div className="rounded-control bg-warning-bg text-warning px-3 py-2 text-copy">{preview.message}</div>
        ) : preview.changes.length ? (
          <ul className="m-0 pl-4 flex flex-col gap-1 text-copy">
            {preview.changes.map(c => (
              <li key={c.reservationId}>
                {c.state.after === 'cancelled' && c.state.before !== 'cancelled'
                  ? <><span className="font-semibold">{c.unit}</span>: marked cancelled, so its {rm(c.net.before)} comes off.</>
                  : <>
                    <span className="font-semibold">{c.unit}</span>: <span className="tabular-nums">{rm(c.net.before)} → {rm(c.net.after)}</span>
                    <div className="text-meta text-muted-ink">Guest total {rm(c.gross.before)} → {rm(c.gross.after)}; Airbnb’s fee {rm(c.fee)} stays.</div>
                  </>}
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-copy text-muted-ink">Nothing changes on the reservation.</p>}
      </Block>

      {preview?.ok && (preview.shares.length > 0 || regen.length > 0) && (
        <Block title="Owner statement">
          <ul className="m-0 pl-4 flex flex-col gap-1 text-copy">
            {preview.shares.map(s => (
              <li key={`${s.unit}-${s.onMonth}`}>
                {s.sen > 0 ? 'Credit' : 'Charge'} <span className="font-semibold tabular-nums">{rm(Math.abs(s.sen))}</span> to {s.owner || 'the owner'} ({s.unit}) on the {monthLabel(s.onMonth)} statement, as {monthsText(s.months)} is final.
                {s.guarantee && <div className="text-meta text-warning">This unit has a minimum guarantee: if the guarantee was paid that month, check the amount by hand.</div>}
              </li>
            ))}
            {regen.length > 0 && <li>The {monthsText(regen)} statement shows the new amount when it is generated again.</li>}
          </ul>
        </Block>
      )}

      {line.income.length > 0 && (
        <Block title="Company income">
          <div className="flex flex-col gap-3">
            {line.income.map(i => (
              <IncomePick key={i.key} income={i} types={types} value={choices[i.key] ?? { typeId: null, subTypeId: null }}
                onChange={c => setChoices(was => ({ ...was, [i.key]: c }))} />
            ))}
          </div>
        </Block>
      )}

      <Field label="Note (optional)" value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Why, if it is not obvious" />
      <p className="m-0 text-meta text-muted-ink">Keep as it is closes the line and changes nothing. Either can be undone from Confirmed.</p>
    </Modal>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-meta font-semibold text-muted-ink uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  );
}

function IncomePick({ income, types, value, onChange }: { income: Income; types: IncomeType[]; value: Choice; onChange: (c: Choice) => void }) {
  const tops = types.filter(t => !t.parentId && t.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const subs = types.filter(t => t.parentId && t.parentId === value.typeId && t.active).sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div className="flex flex-col gap-2 pb-3 [border-bottom:1px_solid_var(--color-line)] last:border-b-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-copy min-w-0">{dateShort(income.date)} · <span className="text-muted-ink">{income.details || income.note}</span></span>
        <span className="font-semibold tabular-nums whitespace-nowrap">{rm(income.amount)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select label="Type" showLabel value={value.typeId ?? ''} placeholder="Choose a type" className="min-w-[200px]"
          options={tops.map(t => ({ value: t.id, label: t.name }))} onChange={v => onChange({ typeId: v || null, subTypeId: null })} />
        {subs.length > 0 && (
          <Select label="Sub-type" showLabel value={value.subTypeId ?? ''} placeholder="Choose one" className="min-w-[220px]"
            options={subs.map(t => ({ value: t.id, label: t.name }))} onChange={v => onChange({ ...value, subTypeId: v || null })} />
        )}
      </div>
    </div>
  );
}

/** Several lines that only record company income, confirmed together with the types the rules gave them (chew's
 *  point 5). R10 and anything that changes a reservation stays one by one. */
function BulkWindow({ lines, month, typeName, onClose, onDone }: {
  lines: Line[]; month: string; typeName: (c: Choice | null | undefined) => string | null; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const byType = new Map<string, { n: number; sen: number }>();
  for (const l of lines) for (const i of l.income) {
    const k = typeName(i.proposed) ?? 'No type';
    const was = byType.get(k) ?? { n: 0, sen: 0 };
    byType.set(k, { n: was.n + 1, sen: was.sen + i.amount });
  }
  const total = [...byType.values()].reduce((n, x) => n + x.sen, 0);
  const plain = lines.filter(l => !l.income.length).length;

  async function go() {
    setBusy(true);
    try {
      const r = await api.post<DecideAnswer>('/airbnb-recon/decisions', { month, items: lines.map(l => ({ code: l.code, decision: 'confirm' })) });
      toast({ tone: 'success', title: `${plural(r.confirmed, 'reservation')} confirmed.`, body: answerText(r) });
      onDone();
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) toast({ tone: 'critical', title: 'None was confirmed.', body: err.message });
      else notifyFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Confirm ${plural(lines.length, 'reservation')}`} width={560} onClose={onClose} busy={busy}
      sub="These only record company income: no reservation and no owner statement changes. Each line takes the type shown; to choose another, confirm that reservation on its own."
      footer={<>
        <Button size="sm" variant="tertiary" onClick={onClose} disabled={busy} disabledReason="Working on it.">Cancel</Button>
        <Button size="sm" variant="primary" icon={<Icon name="Check" size="sm" />} loading={busy} onClick={go}>Confirm {count(lines.length)}</Button>
      </>}>
      <table className="w-full text-copy border-collapse">
        <thead>
          <tr className="text-meta text-muted-ink [border-bottom:1px_solid_var(--color-line)]">
            <th className="py-1.5 pr-2 text-left font-semibold">Type</th>
            <th className="py-1.5 px-2 text-right font-semibold">Lines</th>
            <th className="py-1.5 pl-2 text-right font-semibold">Amount (RM)</th>
          </tr>
        </thead>
        <tbody>
          {[...byType.entries()].map(([k, x]) => (
            <tr key={k} className="[border-bottom:1px_solid_var(--color-line)]">
              <td className="py-1.5 pr-2">{k}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{count(x.n)}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{rm(x.sen)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1.5 pr-2">Total</td>
            <td className="py-1.5 px-2 text-right tabular-nums">{count([...byType.values()].reduce((n, x) => n + x.n, 0))}</td>
            <td className="py-1.5 pl-2 text-right tabular-nums">{rm(total)}</td>
          </tr>
        </tbody>
      </table>
      {plain > 0 && <p className="m-0 text-meta text-muted-ink">{plural(plain, 'reservation')} with nothing to record: equal after Airbnb’s adjustment, confirmed only.</p>}
      <p className="m-0 text-meta text-muted-ink">{lines.map(l => l.code).join(', ')}</p>
    </Modal>
  );
}

function IncomeTable({ rows, kinds, typeName, ready, ruleText, month, onTypes }: {
  rows: IncomeRow[]; kinds?: Record<IncomeKind, string>; typeName: (c: Choice | null | undefined) => string | null; ready: boolean;
  ruleText: (r: Rule) => string; month: string; onTypes?: () => void;
}) {
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const done = rows.filter(r => r.recorded).reduce((n, r) => n + r.amount, 0);
  const byType = new Map<string, number>();
  for (const r of rows) if (r.recorded) { const k = typeName(r.recorded) ?? 'No type'; byType.set(k, (byType.get(k) ?? 0) + r.amount); }
  const columns: Column<IncomeRow>[] = [
    { key: 'code', label: 'Confirmation code', type: 'ref', value: r => r.code, phone: 'title', hideable: false, width: 130 },
    ready
      ? {
        key: 'type', label: 'Type', type: 'status', phone: 'badge', width: 240, value: r => typeName(r.recorded ?? r.proposed) ?? '',
        status: r => (r.recorded ? { label: typeName(r.recorded) ?? 'No type', tone: 'success' } : { label: typeName(r.proposed) ?? 'Type to choose', tone: 'neutral', outline: true }),
        sub: r => (r.recorded ? 'Recorded' : 'Not confirmed yet'),
      }
      : { key: 'kind', label: 'Kind', type: 'status', value: r => r.kind, status: r => ({ label: kinds?.[r.kind] ?? r.kind, tone: KIND_TONE[r.kind] }), phone: 'badge', width: 190 },
    { key: 'date', label: 'Date', type: 'date', value: r => r.date, width: 110 },
    { key: 'amount', label: 'Amount (RM)', type: 'money', align: 'right', value: r => r.amount, phone: 'right', width: 110 },
    { key: 'unit', label: 'Unit', value: r => r.unit || null, width: 130 },
    { key: 'rule', label: 'Reservation rule', value: r => ruleText(r.rule), width: 230 },
    { key: 'note', label: 'Airbnb line', value: r => r.details || r.note, width: 260 },
  ];
  return (
    <DataTable id="airbnb-recon.income" urlPrefix="i" columns={columns} rows={rows} rowKey={r => r.rowKey} exportName={`airbnb-company-income-${month}`}
      toolbar={onTypes ? <Button size="sm" variant="secondary" icon={<Icon name="Tags" size="sm" />} onClick={onTypes}>Income types</Button> : undefined}
      above={<div className="px-4 py-2 text-meta text-muted-ink">
        The company’s, never an owner’s. Total <span className="font-semibold text-ink tabular-nums">{rm(total)}</span>
        {ready && <>; recorded <span className="font-semibold text-ink tabular-nums">{rm(done)}</span>{byType.size ? ` (${[...byType.entries()].map(([k, v]) => `${k} ${rm(v)}`).join(', ')})` : ''}</>}.
      </div>}
      noun={['line', 'lines']} empty={{ title: 'No company income this month.' }} />
  );
}

/** Finance keeps the income types itself (chew, 11 Nov 2026): add a type or a sub-type, rename one, change the words
 *  that pick it, or make it inactive. Never deleted, so income already recorded keeps its name. */
function IncomeTypesWindow({ types, mayEdit, onClose, onSaved }: { types: IncomeType[]; mayEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState<{ id?: string; parentId: string | null; parentName: string | null; name: string; matchWords: string; active: boolean; systemKey: string | null } | null>(null);
  const sorted = [...types].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const tops = sorted.filter(t => !t.parentId);
  const edit = (t: IncomeType, parentName: string | null) =>
    setEditing({ id: t.id, parentId: t.parentId, parentName, name: t.name, matchWords: t.matchWords ?? '', active: t.active, systemKey: t.systemKey });
  const row = (t: IncomeType, parentName: string | null) => (
    <div className={cx('flex items-start justify-between gap-3 py-2', parentName && 'pl-6')}>
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className={cx('text-copy', !parentName && 'font-semibold', !t.active && 'text-muted-ink')}>
          {t.name}{!t.active && <StatusBadge tone="neutral" outline label="Inactive" size="sm" className="ml-2" />}
        </span>
        {t.matchWords && <span className="text-meta text-muted-ink">Words: {t.matchWords}</span>}
        {t.systemKey && <span className="text-meta text-muted-ink">{SYSTEM_TEXT[t.systemKey]}</span>}
      </div>
      {mayEdit && <Button size="sm" variant="tertiary" onClick={() => edit(t, parentName)}>Change</Button>}
    </div>
  );
  return (
    <>
      <Modal title="Income types" width={620} onClose={onClose}
        sub="The kinds of company income on Airbnb reconciliation. A type can be renamed or made inactive, never deleted, so income already recorded keeps its name."
        footer={<>
          {mayEdit && <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />}
            onClick={() => setEditing({ parentId: null, parentName: null, name: '', matchWords: '', active: true, systemKey: null })}>Add a type</Button>}
          <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
        </>}>
        <ul className="m-0 p-0 list-none flex flex-col">
          {tops.map(t => (
            <li key={t.id} className="[border-bottom:1px_solid_var(--color-line)] last:border-b-0 pb-1">
              {row(t, null)}
              {sorted.filter(s => s.parentId === t.id).map(s => <div key={s.id}>{row(s, t.name)}</div>)}
              {mayEdit && (
                <div className="pl-6 pb-1">
                  <Button size="sm" variant="tertiary" icon={<Icon name="Plus" size="sm" />}
                    onClick={() => setEditing({ parentId: t.id, parentName: t.name, name: '', matchWords: '', active: true, systemKey: null })}>Add a sub-type</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!mayEdit && <p className="m-0 text-meta text-muted-ink">Changing the types needs full access to Airbnb reconciliation.</p>}
      </Modal>
      {editing && <TypeForm value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }} />}
    </>
  );
}

function TypeForm({ value, onClose, onSaved }: {
  value: { id?: string; parentId: string | null; parentName: string | null; name: string; matchWords: string; active: boolean; systemKey: string | null };
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(value.name);
  const [words, setWords] = useState(value.matchWords);
  const [active, setActive] = useState(value.active);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = name !== value.name || words !== value.matchWords || active !== value.active;

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api.post('/airbnb-recon/income-types', { id: value.id, parentId: value.parentId, name, matchWords: words, active });
      toast({ tone: 'success', title: value.id ? `${name.trim()} saved.` : `${name.trim()} added.` });
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.fields) setErrors(err.fields);
      else notifyFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal layer="over" width={480} onClose={onClose} busy={busy} dirty={dirty} onSubmit={save}
      title={value.id ? `Change ${value.name}` : value.parentName ? `Add a sub-type under ${value.parentName}` : 'Add an income type'}
      footer={<>
        <Button size="sm" variant="secondary" type="button" onClick={onClose} disabled={busy} disabledReason="Working on it.">Cancel</Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!name.trim()} disabledReason="Give it a name first.">Save</Button>
      </>}>
      <Field label="Name" value={name} maxLength={80} error={errors.name} onChange={e => { setName(e.target.value); setErrors({}); }} autoFocus />
      <Field label="Words to recognise" value={words} maxLength={300} onChange={e => setWords(e.target.value)} placeholder="e.g. pickup, airport"
        help="Words in Airbnb’s Details, separated by commas. A line whose Details has one of them starts with this type." />
      {value.systemKey && <p className="m-0 text-meta text-muted-ink">{SYSTEM_TEXT[value.systemKey]} Made inactive, those lines start with no type and finance chooses one.</p>}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-copy font-medium">{active ? 'Active' : 'Inactive'}</span>
          <span className="text-meta text-muted-ink">An inactive type is not offered when confirming.</span>
        </div>
        <Switch checked={active} onChange={setActive} label="Active" />
      </div>
    </Modal>
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
