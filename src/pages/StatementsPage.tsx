import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Dialog } from '../components/Dialog';
import { Field } from '../components/Field';
import { EmptyState } from '../components/States';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, ApiFailure } from '../lib/api';
import { rm, date as fmtDate, time as fmtTime, todayMyt, monthLabel } from '../lib/format';
import { STATEMENT } from '../lib/vocabulary';
import { TONE, cx } from '../lib/design-tokens';
import type { StatementState } from '../lib/types';
import { useUrlState, usePhone, ListCard, Pager, SearchBox, Chip, STICKY_HEAD, shiftMonth } from './finance/listKit';

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

const SELECT_REASON: Record<StatementState, string> = {
  provisional: 'Cannot send. This statement is still provisional.',
  finalised: '',
  sent: 'Already sent to the owner.',
  paid: 'Paid — nothing left to send.',
};
const STATE_ORDER: StatementState[] = ['provisional', 'finalised', 'sent', 'paid'];

// Every column can shrink so the table fits without a sideways scrollbar (which would stop the header sticking).
const gridCols = 'grid-cols-[28px_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(92px,0.85fr)_70px]';

export default function StatementsPage() {
  const url = useUrlState();
  const phone = usePhone();
  const thisMonth = todayMyt().slice(0, 7);
  const pickedPeriod = /^\d{4}-\d{2}$/.test(url.get('period')) ? url.get('period') : '';
  const stateFilter = (STATE_ORDER as string[]).includes(url.get('state')) ? url.get('state') as StatementState : '';
  const q = url.get('q');
  const page = Math.max(1, Number(url.get('page')) || 1);
  const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), ...(pickedPeriod ? { period: pickedPeriod } : {}), ...(stateFilter ? { state: stateFilter } : {}), ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) });
  const { data, loading, error, reload } = useApi<Payload>(`/statements?${query}`, FALLBACK);
  const toast = useToast();

  const [edits, setEdits] = useState<Record<string, Partial<Statement>>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [sendConfirm, setSendConfirm] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genInitial, setGenInitial] = useState(shiftMonth(thisMonth, -1));
  const [adjustTarget, setAdjustTarget] = useState<Statement | null>(null);
  const [busy, setBusy] = useState(false);

  // The server opens on the latest period that has statements; the URL holds a period only once one is picked.
  const viewPeriod = pickedPeriod || data?.period || shiftMonth(thisMonth, -1);
  const setViewPeriod = (p: string) => { url.set({ period: p, page: null }); setSel({}); };
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

  const selected = rows.filter(r => sel[r.id] && r.state === 'finalised');
  const selectedProvisional = rows.filter(r => sel[r.id] && r.state === 'provisional');
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
      setSel({});
      setGenOpen(false);
      reload();
      toast({
        tone: res.count ? 'success' : 'info',
        title: res.count ? `Statements generated for ${res.count} ${res.count === 1 ? 'owner' : 'owners'}. Review before sending.` : 'Nothing to generate for that month.',
        body: res.skipped ? `${res.skipped} already finalised and left as they are.` : undefined,
      });
    } catch (e) {
      const locked = e instanceof ApiFailure && e.status === 409;
      toast({ tone: locked ? 'warning' : 'critical', title: locked ? 'That period is locked.' : 'Statements were not generated.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); }
  }

  async function runFinalise() {
    const ids = selectedProvisional.map(t => t.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await api.post<{ finalised: number; failed: { id: string; reason: string }[] }>('/statements/finalise', { statementIds: ids });
      setEdits({}); setSel({}); reload();
      toast(res.failed.length
        ? { tone: 'warning', title: `${res.finalised} finalised, ${res.failed.length} not.`, body: res.failed[0].reason }
        : { tone: 'success', title: `${res.finalised} ${res.finalised === 1 ? 'statement' : 'statements'} finalised.`, body: 'The figures are now frozen and ready to send.' });
    } catch (e) {
      toast({ tone: 'critical', title: 'Not finalised.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); }
  }

  async function runSend() {
    const targets = selected;
    const ids = targets.map(t => t.id);
    if (!ids.length) { setSendConfirm(false); return; }
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
      toast({ tone: 'critical', title: 'Statements were not sent.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally {
      setBusy(false);
      setSel({});
      setSendConfirm(false);
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
      toast({ tone: locked ? 'warning' : 'critical', title: locked ? 'This statement is locked.' : 'Adjustment was not recorded.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); }
  }

  function exportCsv() {
    const genAt = data?.generatedAt || new Date().toISOString();
    const extra = [stateFilter && `status ${STATEMENT[stateFilter].label}`, q && `search "${q}"`].filter(Boolean).join(', ');
    const filtersLine = `Filters applied: period ${periodLabel(viewPeriod)}${extra ? `, ${extra}` : ''} · generated ${fmtDate(genAt)} ${fmtTime(genAt)}`;
    const scopeLine = `Scope: ${rows.length} owners · ${periodLabel(viewPeriod)} · management + finance view`;
    const head = ['Owner', 'Units', 'Gross booking value', 'Fees', 'Expenses', 'Net payout', 'Status'];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const body = rows.map(r => [r.ownerName, r.unitsLabel, rm(r.grossBookingValue), rm(r.managementFee), rm(r.expensesTotal), rm(r.netPayout), STATEMENT[r.state].label]);
    const lines = [`# ${filtersLine}`, `# ${scopeLine}`, '', head.map(esc).join(','), ...body.map(r => r.map(esc).join(',')),
      ['Total', '', rm(totals.gross), rm(totals.fee), rm(totals.expenses), rm(totals.net), ''].map(esc).join(',')];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = `owner-statements-${viewPeriod}.csv`; a.click();
    URL.revokeObjectURL(href);
    toast({ tone: 'success', title: 'Export ready.', body: 'The CSV header prints the applied filters, generated time and scope.' });
  }

  function openRow(r: Statement) { window.location.hash = `#/finance/statements/${r.id}`; }

  function downloadPdf(r: Statement, e: MouseEvent) {
    e.stopPropagation();
    window.open(`/api/statements/${encodeURIComponent(r.id)}/pdf`, '_blank', 'noopener');
  }

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
            <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportCsv} disabled={rows.length === 0} disabledReason="Nothing to export for this period yet.">Export</Button>
            <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => openGenerate(lockedPeriods.has(shiftMonth(thisMonth, -1)) ? thisMonth : shiftMonth(thisMonth, -1))}>Generate statements</Button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      {periodHasNone ? (
        <EmptyState
          title={`No statements for ${periodLabel(viewPeriod)} yet.`}
          body="Generate the period to draw every settled booking, fee and documented expense into provisional statements."
          action={{ label: 'Generate statements', onClick: () => openGenerate(viewPeriod) }}
        />
      ) : (<>
        <div className="flex flex-col gap-2">
          <div className={cx('flex gap-[7px] shrink-0', phone ? 'overflow-x-auto -mx-4 px-4 pb-1' : 'flex-wrap')}>
            <Chip on={!stateFilter} onClick={() => url.set({ state: null, page: null })} count={current?.count}>All</Chip>
            {STATE_ORDER.map(s => (
              <Chip key={s} on={stateFilter === s} onClick={() => url.set({ state: stateFilter === s ? null : s, page: null })} count={current ? current[s] : undefined}>{STATEMENT[s].label}</Chip>
            ))}
          </div>
          <SearchBox className="max-w-[420px]" label="Search statements" placeholder="Search owner or unit" value={q} onChange={v => url.set({ q: v || null, page: null })} />
        </div>

        <ListCard busy={loading && !!data}>
          {(selected.length > 0 || selectedProvisional.length > 0) && (
            <div className="sticky -top-6 z-[3] flex items-center justify-between gap-[14px] flex-wrap px-[22px] py-[11px] bg-black text-white">
              <span className="text-[13px] font-medium">{selected.length + selectedProvisional.length} selected · {periodLabel(viewPeriod)}</span>
              <div className="flex items-center gap-[10px]">
                <button onClick={() => setSel({})} className="[font:inherit] text-[var(--color-text-on-dark)] bg-transparent border-none cursor-pointer">Clear</button>
                {selectedProvisional.length > 0 && (
                  <button onClick={runFinalise} disabled={busy} className="py-[7px] px-[13px] rounded-control bg-white text-black text-[12.5px] font-semibold border-none cursor-pointer">
                    Finalise {selectedProvisional.length}
                  </button>
                )}
                {selected.length > 0 && (
                  <button onClick={() => setSendConfirm(true)} className="py-[7px] px-[13px] rounded-control bg-gold text-black text-[12.5px] font-semibold border-none cursor-pointer">
                    Send {selected.length} {selected.length === 1 ? 'statement' : 'statements'}
                  </button>
                )}
              </div>
            </div>
          )}

          {loading && !data ? <TableSkeleton rows={8} cols={phone ? 2 : 7} /> : rows.length === 0 ? (
            <div className="py-[44px] px-[22px] text-center flex flex-col items-center gap-2">
              <span className="text-[14px] font-medium">No statements match these filters.</span>
              <button onClick={() => url.set({ state: null, q: null, page: null })} className="font-sans text-[14px] text-gold-ink bg-transparent border-none cursor-pointer">Clear filters</button>
            </div>
          ) : phone ? (
            <div>
              {rows.map(s => {
                const can = s.state === 'finalised' || s.state === 'provisional';
                return (
                  <div key={s.id} className={cx('flex items-start gap-3 py-[11px] px-4 [border-bottom:1px_solid_var(--color-line-soft)]', sel[s.id] ? 'bg-gold-tint' : 'bg-card')}>
                    <input type="checkbox" disabled={!can} checked={!!sel[s.id]} aria-label={`Select ${s.ownerName}`}
                      onChange={() => setSel(v => ({ ...v, [s.id]: !v[s.id] }))} className="mt-[3px] w-[17px] h-[17px] accent-[#11694A]" />
                    <button onClick={() => openRow(s)} className="flex flex-col gap-[3px] min-w-0 flex-1 text-left bg-transparent border-none p-0 cursor-pointer font-sans text-ink">
                      <span className="text-[13.5px] font-medium truncate">{s.ownerName}</span>
                      <span className="text-[12px] text-muted-ink truncate">{s.unitsLabel}</span>
                      <span className="text-[11.5px] text-muted-ink tabular-nums">Gross {rm(s.grossBookingValue, { cents: false })} · fees {rm(s.managementFee, { cents: false })} · costs {rm(s.expensesTotal, { cents: false })}</span>
                    </button>
                    <div className="flex flex-col items-end gap-[5px] shrink-0">
                      <span className="text-[13.5px] font-semibold tabular-nums">{rm(s.netPayout, { cents: false })}</span>
                      <Badge tone={STATEMENT[s.state].tone} label={STATEMENT[s.state].label} size="sm" />
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between py-3 px-4 bg-page text-[13px] font-semibold">
                <span>{total} {total === 1 ? 'owner' : 'owners'}</span>
                <span className="tabular-nums">{rm(totals.net)}</span>
              </div>
            </div>
          ) : (
            <div role="table" aria-label={`Owner statements, ${periodLabel(viewPeriod)}`}>
              <div role="row" className={cx('grid', gridCols, 'gap-[14px] px-[22px] py-[9px]', STICKY_HEAD)}>
                <div />
                <div>Owner</div>
                <div className="text-right">Gross booking value</div>
                <div className="text-right">Fees</div>
                <div className="text-right">Expenses</div>
                <div className="text-right">Net payout</div>
                <div>Status</div>
                <div />
              </div>

              {rows.map(s => {
                const can = s.state === 'finalised' || s.state === 'provisional';
                const on = !!sel[s.id];
                return (
                  <div
                    key={s.id}
                    role="row"
                    tabIndex={0}
                    onClick={() => openRow(s)}
                    onKeyDown={e => { if (e.key === 'Enter') openRow(s); }}
                    className={cx('grid', gridCols, 'gap-[14px] items-center min-h-[50px] py-[7px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer', on ? 'bg-gold-tint' : 'bg-card hover:bg-page')}
                  >
                    <span onClick={e => e.stopPropagation()} className="flex">
                      <input
                        type="checkbox"
                        disabled={!can}
                        checked={on}
                        title={can ? undefined : SELECT_REASON[s.state]}
                        aria-label={can ? `Select ${s.ownerName}` : `${s.ownerName} cannot be selected — ${SELECT_REASON[s.state]}`}
                        onChange={() => setSel(v => ({ ...v, [s.id]: !v[s.id] }))}
                        className={`w-[17px] h-[17px] accent-[#11694A] ${can ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      />
                    </span>
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-[13.5px] font-medium truncate" title={s.ownerName}>{s.ownerName}</span>
                      <span className="text-[11.5px] text-muted-ink truncate" title={s.unitsLabel}>{s.unitsLabel}</span>
                    </div>
                    <div className="text-right text-[13px] tabular-nums whitespace-nowrap">{rm(s.grossBookingValue, { cents: false })}</div>
                    <div className="text-right text-[13px] text-muted-ink tabular-nums whitespace-nowrap">&minus; {rm(s.managementFee, { cents: false })}</div>
                    <div className="text-right text-[13px] text-muted-ink tabular-nums whitespace-nowrap">&minus; {rm(s.expensesTotal, { cents: false })}</div>
                    <div className={cx('text-right text-[13px] font-semibold tabular-nums whitespace-nowrap', s.netPayout < 0 ? TONE.critical.text : '')}>{rm(s.netPayout)}</div>
                    <div><Badge tone={STATEMENT[s.state].tone} label={STATEMENT[s.state].label} /></div>
                    <div className="flex justify-end gap-[6px]" onClick={e => e.stopPropagation()}>
                      {(s.state === 'provisional' || s.state === 'finalised') && (
                        <button
                          onClick={() => setAdjustTarget(s)}
                          aria-label={`Adjust statement for ${s.ownerName}`}
                          title="Add an adjustment"
                          className="grid place-items-center w-[30px] h-[30px] rounded-control bg-transparent border border-solid border-line text-muted-ink cursor-pointer"
                        >
                          <Icon name="Pencil" size="sm" />
                        </button>
                      )}
                      <button
                        onClick={e => downloadPdf(s, e)}
                        aria-label={`Download PDF for ${s.ownerName}`}
                        title="Download PDF"
                        className="grid place-items-center w-[30px] h-[30px] rounded-control bg-transparent border border-solid border-line text-muted-ink cursor-pointer"
                      >
                        <Icon name="FileText" size="sm" />
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className={cx('grid', gridCols, 'gap-[14px] items-center px-[22px] py-[12px] bg-page text-[13px] font-semibold')}>
                <div />
                <div>Total · {total} {total === 1 ? 'owner' : 'owners'}</div>
                <div className="text-right tabular-nums whitespace-nowrap">{rm(totals.gross, { cents: false })}</div>
                <div className="text-right tabular-nums whitespace-nowrap">&minus; {rm(totals.fee, { cents: false })}</div>
                <div className="text-right tabular-nums whitespace-nowrap">&minus; {rm(totals.expenses, { cents: false })}</div>
                <div className="text-right tabular-nums whitespace-nowrap">{rm(totals.net)}</div>
                <div /><div />
              </div>
            </div>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={total} unit="statements" onPage={p => url.set({ page: p > 1 ? p : null })} />
          <div className="flex items-center justify-between gap-3 flex-wrap px-[22px] py-[11px] [border-top:1px_solid_var(--color-line)] bg-page text-[12px] text-muted-ink">
            <span>{periodLabel(viewPeriod)}{filtered ? ' · filtered' : ''}</span>
            <span>Every deduction carries a category, date and amount</span>
          </div>
        </ListCard>
      </>)}

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

      <Dialog
        busy={busy}
        onClose={() => { if (!busy) setSendConfirm(false); }}
        spec={!sendConfirm ? null : {
          title: `Send ${selected.length} ${selected.length === 1 ? 'statement' : 'statements'} to owners?`,
          body: 'Owners receive an email and portal notification with the PDF. Sent statements cannot be edited, only superseded by an adjustment.',
          meta: `${rm(selected.reduce((sum, r) => sum + r.netPayout, 0))} total · finalised statements only`,
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
            Draws every settled booking, fee and documented expense for the period. Statements land as Provisional and must be reviewed before sending.
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
