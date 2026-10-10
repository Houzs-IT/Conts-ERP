import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { EmptyState } from '../components/States';
import { StaleBanner } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, ApiFailure, errorMessage } from '../lib/api';
import { fetchAllPages } from '../lib/export';
import { rm, todayMyt, monthLabel, plural } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { StatementState } from '../lib/types';
import { useUrlState, usePhone, SearchBox, Chip, shiftMonth } from './finance/listKit';
import { statusLabel } from '../lib/status';

interface Statement {
  id: string; period?: string; ownerName: string; unitsLabel: string; state: StatementState;
  grossBookingValue: number; managementFee: number; expensesTotal: number; netPayout: number;
}
interface PeriodSummary { period: string; count: number; net: number; provisional: number; finalised: number; sent: number; paid: number }
interface Payload {
  data: Statement[]; summary: { notSent: number }; generatedAt: string; period?: string | null;
  filtersApplied: Record<string, string>; total?: number; page?: number; pageSize?: number;
  totals?: { gross: number; fee: number; expenses: number; net: number };
  periods?: PeriodSummary[];
}

const BASE_PERIOD = '2026-08';

const FALLBACK: Payload = {
  generatedAt: '2026-09-16T06:06:00Z', filtersApplied: { period: BASE_PERIOD, building: 'all' }, period: BASE_PERIOD,
  summary: { notSent: 2 }, total: 3, pageSize: 200,
  data: [
    { id: 's1', period: BASE_PERIOD, ownerName: 'Lim Chee Keong', unitsLabel: 'Vista Jaya One #A-12-03', grossBookingValue: 926000, managementFee: 231500, expensesTotal: 46300, netPayout: 648200, state: 'paid' },
    { id: 's4', period: BASE_PERIOD, ownerName: 'Nur Aisyah', unitsLabel: 'The Establishment #A-21-02', grossBookingValue: 769000, managementFee: 192200, expensesTotal: 51200, netPayout: 525600, state: 'finalised' },
    { id: 's6', period: BASE_PERIOD, ownerName: 'Goh Family Trust', unitsLabel: '3 units · Sunway Velocity', grossBookingValue: 2134000, managementFee: 533500, expensesTotal: 89400, netPayout: 1511100, state: 'provisional' },
  ],
};

const periodLabel = (p: string) => monthLabel(p);
const PAGE_SIZE = 200;
const SIZES = [50, 100, 200, 500];
const STATE_ORDER: StatementState[] = ['provisional', 'finalised', 'sent', 'paid'];

export default function StatementsPage() {
  const url = useUrlState();
  const phone = usePhone();
  const thisMonth = todayMyt().slice(0, 7);
  const pickedPeriod = /^\d{4}-\d{2}$/.test(url.get('period')) ? url.get('period') : '';
  const stateFilter = (STATE_ORDER as string[]).includes(url.get('state')) ? url.get('state') as StatementState : '';
  const q = url.get('q');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const size = SIZES.includes(Number(url.get('size'))) ? Number(url.get('size')) : PAGE_SIZE;
  const query = new URLSearchParams({ pageSize: String(size), ...(pickedPeriod ? { period: pickedPeriod } : {}), ...(stateFilter ? { state: stateFilter } : {}), ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) });
  const { data, loading, error, reload } = useApi<Payload>(`/statements?${query}`, FALLBACK);
  const toast = useToast();

  const [edits, setEdits] = useState<Record<string, Partial<Statement>>>({});
  const [sendTargets, setSendTargets] = useState<{ rows: Statement[]; clear: () => void } | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genInitial, setGenInitial] = useState(shiftMonth(thisMonth, -1));
  const [adjustTarget, setAdjustTarget] = useState<Statement | null>(null);
  const [busy, setBusy] = useState(false);

  // The server opens on the latest period that has statements; the URL holds a period only once one is picked.
  const viewPeriod = pickedPeriod || data?.period || shiftMonth(thisMonth, -1);
  const setViewPeriod = (p: string) => url.set({ period: p, page: null });
  const periodRows = data?.periods ?? [];
  const current = periodRows.find(p => p.period === viewPeriod);

  const rows = useMemo(
    () => (data?.data ?? []).map(r => ({ ...r, ...edits[r.id], period: r.period ?? viewPeriod })).filter(r => r.period === viewPeriod),
    [data, edits, viewPeriod],
  );
  // Every month that has statements, plus the last three and the current one.
  const PERIODS = useMemo(() => {
    const set = new Set<string>(periodRows.map(p => p.period));
    for (let i = -3; i <= 0; i++) set.add(shiftMonth(thisMonth, i));
    set.add(viewPeriod);
    return [...set].sort();
  }, [periodRows, thisMonth, viewPeriod]);
  const lockedPeriods = useMemo(() => new Set(periodRows.filter(p => p.sent + p.paid > 0).map(p => p.period)), [periodRows]);

  const notSent = current?.finalised ?? rows.filter(r => r.state === 'finalised').length;
  const totals = data?.totals ?? {
    gross: rows.reduce((n, r) => n + r.grossBookingValue, 0), fee: rows.reduce((n, r) => n + r.managementFee, 0),
    expenses: rows.reduce((n, r) => n + r.expensesTotal, 0), net: rows.reduce((n, r) => n + r.netPayout, 0),
  };
  const total = data?.total ?? rows.length;
  const filtered = !!(stateFilter || q);

  function openGenerate(initial: string) {
    setGenInitial(initial);
    setGenOpen(true);
  }

  async function runGenerate(period: string) {
    setBusy(true);
    try {
      const res = await api.post<{ count: number; skipped: number }>('/statements/generate', { period, ownerIds: [] });
      setEdits({});
      url.set({ period, page: null, state: null });
      setGenOpen(false);
      reload();
      toast({
        tone: res.count ? 'success' : 'info',
        title: res.count ? `Statements generated for ${res.count} ${res.count === 1 ? 'owner' : 'owners'}. Review before sending.` : 'Nothing to generate for that month.',
        body: res.skipped ? `${res.skipped} already finalised and left as they are.` : undefined,
      });
    } catch (e) {
      const locked = e instanceof ApiFailure && e.status === 409;
      toast({ tone: locked ? 'warning' : 'critical', title: locked ? 'That period is locked.' : 'Statements were not generated.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  async function runFinalise(picked: Statement[], clear: () => void) {
    const ids = picked.filter(r => r.state === 'provisional').map(t => t.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await api.post<{ finalised: number; failed: { id: string; reason: string }[] }>('/statements/finalise', { statementIds: ids });
      setEdits({}); clear(); reload();
      toast(res.failed.length
        ? { tone: 'warning', title: `${res.finalised} finalised, ${res.failed.length} not.`, body: res.failed[0].reason }
        : { tone: 'success', title: `${res.finalised} ${res.finalised === 1 ? 'statement' : 'statements'} finalised.`, body: 'The figures are now frozen and ready to send.' });
    } catch (e) {
      toast({ tone: 'critical', title: 'Not finalised.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  async function runSend() {
    const targets = sendTargets?.rows ?? [];
    const ids = targets.map(t => t.id);
    if (!ids.length) { setSendTargets(null); return; }
    setBusy(true);
    try {
      const res = await api.post<{ sent: number; failed: { id: string; reason: string }[] }>('/statements/send', { statementIds: ids });
      const failed = res.failed ?? [];
      setEdits({}); reload();
      if (failed.length) {
        const failedIds = new Set(failed.map(f => f.id));
        const names = targets.filter(t => failedIds.has(t.id)).map(t => t.ownerName);
        toast({ tone: 'warning', title: `${res.sent} sent, ${failed.length} not.`, body: `Not sent: ${names.join(', ')}.` });
      } else {
        toast({ tone: 'success', title: `${res.sent} ${res.sent === 1 ? 'statement' : 'statements'} sent.`, body: 'Owners were emailed and the statements are live on their portals.' });
      }
    } catch (e) {
      toast({ tone: 'critical', title: 'Statements were not sent.', body: errorMessage(e, 'Try again in a moment.') });
    } finally {
      setBusy(false);
      sendTargets?.clear();
      setSendTargets(null);
    }
  }

  // Manual adjustment — a labelled +/- line on a still-editable statement. The net
  // moves by exactly the amount; gross, fee and expenses are untouched (server rebalances).
  async function runAdjust(target: Statement, label: string, amountSen: number) {
    setBusy(true);
    try {
      const res = await api.post<{ netPayout: number; adjustmentsTotal: number }>(`/statements/${encodeURIComponent(target.id)}/adjust`, { label, amount: amountSen });
      setEdits(e => ({ ...e, [target.id]: { ...e[target.id], netPayout: res.netPayout } }));
      setAdjustTarget(null);
      reload();
      toast({ tone: 'success', title: 'Adjustment recorded.', body: `${target.ownerName} — net payout is now ${rm(res.netPayout)}.` });
    } catch (e) {
      const locked = e instanceof ApiFailure && e.status === 409;
      toast({ tone: locked ? 'warning' : 'critical', title: locked ? 'This statement is locked.' : 'Adjustment was not recorded.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  /** Every statement under the period, status and search, for the table's Export. The endpoint pages at up to 500. */
  async function fetchAll(onProgress: (got: number, of: number) => void) {
    const r = await fetchAllPages<Statement>(async (pg, sz) => {
      const p = await api.get<Payload>(`/statements?${new URLSearchParams({ period: viewPeriod, pageSize: String(sz), page: String(pg), ...(stateFilter ? { state: stateFilter } : {}), ...(q ? { q } : {}) })}`);
      return { rows: p.data.map(x => ({ ...x, ...edits[x.id], period: x.period ?? viewPeriod })), total: p.total ?? p.data.length };
    }, { size: 500, onProgress });
    return r.rows;
  }

  function openRow(r: Statement) { window.location.hash = `#/finance/statements/${r.id}`; }

  const columns = useMemo<Column<Statement>[]>(() => [
    { key: 'owner', label: 'Owner', value: r => r.ownerName, hideable: false, width: 240, sub: r => r.unitsLabel,
      render: r => <span className="font-medium block truncate" title={r.ownerName}>{r.ownerName}</span> },
    { key: 'units', label: 'Units', value: r => r.unitsLabel, hidden: true, width: 220 },
    { key: 'period', label: 'Period', value: r => r.period ?? null, text: r => (r.period ? periodLabel(r.period) : ''), hidden: true, width: 110 },
    { key: 'gross', label: 'Hospitality income', type: 'money', value: r => r.grossBookingValue, width: 140,
      render: r => <span className="tabular-nums whitespace-nowrap">{rm(r.grossBookingValue, { cents: false })}</span> },
    { key: 'fee', label: 'To operator', type: 'money', value: r => r.managementFee, width: 120,
      render: r => <span className="tabular-nums whitespace-nowrap text-muted-ink">&minus; {rm(r.managementFee, { cents: false })}</span> },
    { key: 'expenses', label: 'Deductions', type: 'money', value: r => r.expensesTotal, width: 120,
      render: r => <span className="tabular-nums whitespace-nowrap text-muted-ink">&minus; {rm(r.expensesTotal, { cents: false })}</span> },
    { key: 'net', label: 'Net payout', type: 'money', value: r => r.netPayout, width: 130,
      render: r => <span className={cx('tabular-nums whitespace-nowrap font-semibold', r.netPayout < 0 ? TONE.critical.text : '')}>{rm(r.netPayout)}</span> },
    { key: 'status', label: 'Status', type: 'status', value: r => r.state, width: 120,
      entity: 'statement' },
    { key: 'actions', label: '', width: 84, align: 'right', noExport: true, sortable: false, filter: false, hideable: false,
      render: s => (
        <span className="flex justify-end gap-[6px]" onClick={e => e.stopPropagation()}>
          {(s.state === 'provisional' || s.state === 'finalised') && (
            <button onClick={() => setAdjustTarget(s)} aria-label={`Adjust statement for ${s.ownerName}`} title="Add an adjustment"
              className="grid place-items-center w-[30px] h-[30px] rounded-control bg-transparent border border-solid border-line text-muted-ink cursor-pointer">
              <Icon name="Pencil" size="sm" />
            </button>
          )}
          <button onClick={() => { window.location.hash = `#/finance/statements/${encodeURIComponent(s.id)}/report`; }}
            aria-label={`Owner Income Report for ${s.ownerName}`} title="Owner Income Report (PDF)"
            className="grid place-items-center w-[30px] h-[30px] rounded-control bg-transparent border border-solid border-line text-muted-ink cursor-pointer">
            <Icon name="FileText" size="sm" />
          </button>
        </span>
      ) },
  ], []);

  const periodHasNone = !!data && !current && !filtered;

  return (
    <>
      <PageHeader
        title="Owner statements"
        sub={`${periodLabel(viewPeriod)} period · ${current?.count ?? 0} statements · ${notSent} not yet sent`}
        right={
          <div className="flex gap-[9px] flex-wrap items-center">
            <div className="flex items-center h-9 rounded-control border border-solid border-line bg-card">
              <button aria-label="Previous period" onClick={() => setViewPeriod(shiftMonth(viewPeriod, -1))} className="h-full w-8 grid place-items-center cursor-pointer bg-transparent border-none text-muted-ink text-[16px]">‹</button>
              <label className="relative h-full">
                <span className="absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]">Statement period</span>
                <select value={viewPeriod} onChange={e => setViewPeriod(e.target.value)}
                  className="h-full appearance-none bg-transparent border-none outline-none font-sans text-[14px] font-medium text-ink cursor-pointer px-1 tabular-nums [text-align-last:center]">
                  {[...PERIODS].reverse().map(p => {
                    const s = periodRows.find(x => x.period === p);
                    return <option key={p} value={p}>{periodLabel(p)}{s ? ` · ${s.count}` : ''}</option>;
                  })}
                </select>
              </label>
              <button aria-label="Next period" onClick={() => setViewPeriod(shiftMonth(viewPeriod, 1))} className="h-full w-8 grid place-items-center cursor-pointer bg-transparent border-none text-muted-ink text-[16px]">›</button>
            </div>
            <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => openGenerate(lockedPeriods.has(shiftMonth(thisMonth, -1)) ? thisMonth : shiftMonth(thisMonth, -1))}>Generate statements</Button>
          </div>
        }
      />

      {error && periodHasNone && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      {periodHasNone ? (
        <EmptyState
          title={`No statements for ${periodLabel(viewPeriod)} yet.`}
          body="Generate the period to draw every settled booking, fee and documented expense into provisional statements."
          action={{ label: 'Generate statements', onClick: () => openGenerate(viewPeriod) }}
        />
      ) : (
        <DataTable<Statement>
          id="statements" columns={columns} rows={data ? rows : null} rowKey={r => r.id}
          loading={loading} error={error} onRetry={reload} onRowClick={openRow}
          server={{ total, page: data?.page ?? page, pageSize: data?.pageSize ?? size, sizes: SIZES, defaultPageSize: PAGE_SIZE, fetchAll }}
          viewParams={['state', 'q']} filtered={filtered} onClearFilters={() => url.set({ state: null, q: null, page: null })}
          noun={['statement', 'statements']} exportName={`owner-statements-${viewPeriod}`} selectionKey={viewPeriod}
          empty={{ title: `No statements for ${periodLabel(viewPeriod)}.` }}
          selectable={r => r.state === 'provisional' || r.state === 'finalised'}
          bulkActions={(picked, clear) => {
            const provisional = picked.filter(r => r.state === 'provisional').length;
            const finalised = picked.filter(r => r.state === 'finalised');
            return <>
              {provisional > 0 && <Button size="sm" variant="secondary" loading={busy} onClick={() => runFinalise(picked, clear)}>Finalise {provisional}</Button>}
              {finalised.length > 0 && <Button size="sm" variant="primary" onClick={() => setSendTargets({ rows: finalised, clear })}>Send {plural(finalised.length, 'statement')}</Button>}
            </>;
          }}
          header={
            <div className={cx('flex gap-[7px] py-3 px-[22px] max-md:px-4 [border-bottom:1px_solid_var(--color-line)]', phone ? 'overflow-x-auto' : 'flex-wrap')}>
              <Chip on={!stateFilter} onClick={() => url.set({ state: null, page: null })} count={current?.count}>All</Chip>
              {STATE_ORDER.map(st => (
                <Chip key={st} on={stateFilter === st} onClick={() => url.set({ state: stateFilter === st ? null : st, page: null })} count={current ? current[st] : undefined}>{statusLabel('statement', st)}</Chip>
              ))}
            </div>
          }
          toolbar={<SearchBox className="flex-[1_1_260px] max-w-[420px]" label="Search statements" placeholder="Search owner or unit" value={q} onChange={v => url.set({ q: v || null, page: null })} />}
          renderCard={s => (
            <span className="flex items-start gap-3 text-ink">
              <span className="flex flex-col gap-[3px] min-w-0 flex-1">
                <span className="text-[13.5px] font-medium truncate">{s.ownerName}</span>
                <span className="text-[12px] text-muted-ink truncate">{s.unitsLabel}</span>
                <span className="text-[11.5px] text-muted-ink tabular-nums">Gross {rm(s.grossBookingValue, { cents: false })} · fees {rm(s.managementFee, { cents: false })} · costs {rm(s.expensesTotal, { cents: false })}</span>
              </span>
              <span className="flex flex-col items-end gap-[5px] shrink-0">
                <span className="text-[13.5px] font-semibold tabular-nums">{rm(s.netPayout, { cents: false })}</span>
                <StatusBadge entity="statement" value={s.state} size="sm" />
              </span>
            </span>
          )}
          footer={rows.length > 0 && <>
            <div className="flex items-center justify-between gap-x-5 gap-y-1 flex-wrap px-[22px] max-md:px-4 py-[12px] [border-top:1px_solid_var(--color-line)] bg-page text-[13px] font-semibold">
              <span>Total · {plural(total, 'owner')}{filtered ? ' · filtered' : ''}</span>
              <span className="flex gap-x-5 gap-y-1 flex-wrap tabular-nums">
                <span><span className="text-muted-ink font-normal">Income </span>{rm(totals.gross, { cents: false })}</span>
                <span><span className="text-muted-ink font-normal">To operator </span>&minus; {rm(totals.fee, { cents: false })}</span>
                <span><span className="text-muted-ink font-normal">Deductions </span>&minus; {rm(totals.expenses, { cents: false })}</span>
                <span><span className="text-muted-ink font-normal">Net </span>{rm(totals.net)}</span>
              </span>
            </div>
            <div className="px-[22px] max-md:px-4 pb-[11px] bg-page text-[12px] text-muted-ink">Every deduction carries a category, date and amount.</div>
          </>}
        />
      )}

      {genOpen && (
        <GenerateDialog
          initialPeriod={genInitial}
          periods={PERIODS}
          lockedPeriods={lockedPeriods}
          onClose={() => setGenOpen(false)}
          onGenerate={runGenerate}
        />
      )}

      {adjustTarget && (
        <AdjustDialog
          target={adjustTarget}
          busy={busy}
          onClose={() => { if (!busy) setAdjustTarget(null); }}
          onSubmit={(label, sen) => runAdjust(adjustTarget, label, sen)}
        />
      )}

      <ConfirmDialog
        busy={busy}
        onClose={() => { if (!busy) setSendTargets(null); }}
        spec={!sendTargets ? null : {
          title: `Send ${plural(sendTargets.rows.length, 'statement')} to owners?`,
          body: 'Owners receive an email and portal notification with the PDF. Sent statements cannot be edited, only superseded by an adjustment.',
          meta: `${rm(sendTargets.rows.reduce((sum, r) => sum + r.netPayout, 0))} total · finalised statements only`,
          confirmLabel: 'Send', busyLabel: 'Sending…', onConfirm: runSend,
        }}
      />
    </>
  );
}

/** Form dialog — pick the period, then draw provisional statements. Local to this page. */
function GenerateDialog({ initialPeriod, periods, lockedPeriods, onClose, onGenerate }: {
  initialPeriod: string; periods: string[]; lockedPeriods: Set<string>;
  onClose: () => void; onGenerate: (period: string) => Promise<void> | void;
}) {
  const firstOpen = lockedPeriods.has(initialPeriod)
    ? (periods.find(p => !lockedPeriods.has(p)) ?? initialPeriod)
    : initialPeriod;
  const [period, setPeriod] = useState(firstOpen);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const locked = lockedPeriods.has(period);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function confirm() {
    if (locked) return;
    setBusy(true);
    await onGenerate(period);
    setBusy(false);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Generate statements"
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)] overflow-hidden [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <div className="px-[22px] pt-[22px] pb-[18px] flex flex-col gap-3">
          <h2 className="m-0 text-[18px] leading-[1.3] font-semibold">Generate statements</h2>
          <p className="m-0 text-[13px] leading-[1.55] text-muted-ink">
            Builds each owner's month by the owner workbook's rules: stays split by night into the month, cleaning, bills and other deductions, the contract split, then owner adjustments. Statements land as Provisional and must be reviewed before sending.
          </p>
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="gen-period" className="text-[12px] font-medium text-muted-ink">Period</label>
            <select id="gen-period" value={period} onChange={e => setPeriod(e.target.value)} disabled={busy}
              className="h-10 py-0 px-3 rounded-control border border-solid border-line bg-card text-ink [font:inherit] cursor-pointer">
              {periods.map(p => (
                <option key={p} value={p} disabled={lockedPeriods.has(p)}>
                  {periodLabel(p)}{lockedPeriods.has(p) ? ' — already sent' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className={`py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-[12px] ${locked ? TONE.critical.text : 'text-muted-ink'}`}>
            {locked ? 'This period has already been sent and cannot be regenerated.' : 'A period that has already been sent cannot be regenerated.'}
          </div>
        </div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={locked} disabledReason="This period has already been sent." onClick={confirm}>
            {busy ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Records a manual +/- line on one statement. The net moves by exactly the amount;
 *  gross, fee and expenses stay as generated. Local to this page. */
function AdjustDialog({ target, busy, onClose, onSubmit }: {
  target: Statement; busy: boolean; onClose: () => void; onSubmit: (label: string, amountSen: number) => void;
}) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'deduct' | 'add'>('deduct');
  const ref = useRef<HTMLDivElement>(null);

  const sen = Math.round(Number(amount) * 100) * (direction === 'deduct' ? -1 : 1);
  const valid = label.trim() !== '' && Number.isFinite(sen) && sen !== 0;
  const preview = valid ? target.netPayout + sen : target.netPayout;

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Adjust statement"
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)] overflow-hidden [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]">
        <form onSubmit={e => { e.preventDefault(); if (valid && !busy) onSubmit(label.trim(), sen); }}>
          <div className="px-[22px] pt-[22px] pb-[18px] flex flex-col gap-3">
            <h2 className="m-0 text-[18px] leading-[1.3] font-semibold">Adjust statement</h2>
            <p className="m-0 text-[13px] leading-[1.55] text-muted-ink">
              {target.ownerName} · {target.unitsLabel}. Adds a labelled line to the statement and rebalances the net payout. The gross, fee and expenses are unchanged.
            </p>
            <Field label="What is this adjustment for?" placeholder="e.g. Goodwill credit, prior-month correction" value={label} onChange={e => setLabel(e.target.value)} />
            <div className="flex flex-col gap-[7px]">
              <span className="text-[12px] font-medium text-muted-ink">Direction</span>
              <div className="grid grid-cols-2 gap-[7px]">
                {(['deduct', 'add'] as const).map(d => (
                  <button key={d} type="button" onClick={() => setDirection(d)}
                    className={`h-[var(--control-height)] rounded-control border border-solid text-[13px] font-medium cursor-pointer ${direction === d ? 'border-transparent bg-black text-white' : 'border-line bg-card text-ink'}`}>
                    {d === 'deduct' ? 'Deduct from payout' : 'Add to payout'}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Amount (RM)" type="number" min={0} numeric placeholder="e.g. 150.00" value={amount} onChange={e => setAmount(e.target.value)} />
            <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-[12px] flex items-center justify-between">
              <span className="text-muted-ink">Net payout after adjustment</span>
              <span className="font-semibold tabular-nums">{rm(preview)}</span>
            </div>
          </div>
          <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
            <Button size="sm" variant="secondary" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!valid} disabledReason="Add a description and a non-zero amount.">
              {busy ? 'Saving…' : 'Record adjustment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
