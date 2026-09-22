import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Card } from '../components/Card';
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
import { TONE } from '../lib/design-tokens';
import type { StatementState } from '../lib/types';

interface Statement {
  id: string; period?: string; ownerName: string; unitsLabel: string; state: StatementState;
  grossBookingValue: number; managementFee: number; expensesTotal: number; netPayout: number;
}
interface Payload {
  data: Statement[]; summary: { notSent: number }; generatedAt: string;
  filtersApplied: Record<string, string>; total?: number; pageSize?: number;
}

const BASE_PERIOD = '2026-08';

const FALLBACK: Payload = {
  generatedAt: '2026-09-16T06:06:00Z', filtersApplied: { period: BASE_PERIOD, building: 'all' },
  summary: { notSent: 2 }, total: 6, pageSize: 25,
  data: [
    { id: 's1', period: BASE_PERIOD, ownerName: 'Lim Chee Keong', unitsLabel: 'Vista Jaya One #A-12-03', grossBookingValue: 926000, managementFee: 231500, expensesTotal: 46300, netPayout: 648200, state: 'paid' },
    { id: 's2', period: BASE_PERIOD, ownerName: 'Rajesh Kumar', unitsLabel: 'Tribeca #2207', grossBookingValue: 1048000, managementFee: 262000, expensesTotal: 31800, netPayout: 754200, state: 'paid' },
    { id: 's3', period: BASE_PERIOD, ownerName: 'Wong Mei Ling', unitsLabel: 'Arcoris #B-08-11', grossBookingValue: 714000, managementFee: 178500, expensesTotal: 24000, netPayout: 511500, state: 'paid' },
    { id: 's4', period: BASE_PERIOD, ownerName: 'Nur Aisyah', unitsLabel: 'The Establishment #A-21-02', grossBookingValue: 769000, managementFee: 192200, expensesTotal: 51200, netPayout: 525600, state: 'finalised' },
    { id: 's5', period: BASE_PERIOD, ownerName: 'Tan Boon Huat', unitsLabel: 'Sentral Suites #C-31-14', grossBookingValue: 498000, managementFee: 124500, expensesTotal: 164000, netPayout: 209500, state: 'finalised' },
    { id: 's6', period: BASE_PERIOD, ownerName: 'Goh Family Trust', unitsLabel: '3 units · Sunway Velocity', grossBookingValue: 2134000, managementFee: 533500, expensesTotal: 89400, netPayout: 1511100, state: 'provisional' },
  ],
};

/** YYYY-MM, moved by whole months. */
const shiftMonth = (p: string, by: number) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const periodLabel = (p: string) => monthLabel(p);

const SELECT_REASON: Record<StatementState, string> = {
  provisional: 'Cannot send. This statement is still provisional.',
  finalised: '',
  sent: 'Already sent to the owner.',
  paid: 'Paid — nothing left to send.',
};

// COLS as an arbitrary grid-template-columns utility (underscores == spaces).
const gridCols = 'grid-cols-[32px_minmax(160px,1.6fr)_minmax(118px,1fr)_minmax(96px,0.9fr)_minmax(96px,0.9fr)_minmax(110px,1fr)_minmax(92px,0.9fr)_76px]';

export default function StatementsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/statements?pageSize=500', FALLBACK);
  const toast = useToast();

  const [pickedPeriod, setViewPeriod] = useState<string | null>(null);
  const thisMonth = todayMyt().slice(0, 7);
  const [edits, setEdits] = useState<Record<string, Partial<Statement>>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [sendConfirm, setSendConfirm] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genInitial, setGenInitial] = useState(shiftMonth(thisMonth, -1));
  const [adjustTarget, setAdjustTarget] = useState<Statement | null>(null);
  const [busy, setBusy] = useState(false);

  const baseRows = data?.data ?? [];
  const allRows = useMemo(
    () => baseRows.map(r => ({ ...r, ...edits[r.id], period: r.period ?? BASE_PERIOD })),
    [baseRows, edits],
  );
  // Every month that has statements, plus the last three and the current one.
  const PERIODS = useMemo(() => {
    const set = new Set<string>(allRows.map(r => r.period ?? BASE_PERIOD));
    for (let i = -3; i <= 0; i++) set.add(shiftMonth(thisMonth, i));
    return [...set].sort();
  }, [allRows, thisMonth]);
  const latestWithData = useMemo(() => [...new Set(allRows.map(r => r.period ?? BASE_PERIOD))].sort().pop(), [allRows]);
  const viewPeriod = pickedPeriod ?? latestWithData ?? shiftMonth(thisMonth, -1);
  const rows = allRows.filter(r => r.period === viewPeriod);
  const lockedPeriods = useMemo(() => {
    const s = new Set<string>();
    allRows.forEach(r => { if (r.state === 'sent' || r.state === 'paid') s.add(r.period ?? BASE_PERIOD); });
    return s;
  }, [allRows]);

  const selected = rows.filter(r => sel[r.id] && r.state === 'finalised');
  const selectedProvisional = rows.filter(r => sel[r.id] && r.state === 'provisional');
  const sendable = rows.filter(r => r.state === 'finalised');
  const notSent = sendable.length;

  function openGenerate(initial: string) {
    setGenInitial(initial);
    setGenOpen(true);
  }

  async function runGenerate(period: string) {
    setBusy(true);
    try {
      const res = await api.post<{ count: number; skipped: number }>('/statements/generate', { period, ownerIds: [] });
      setEdits({});
      setViewPeriod(period);
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
    const b = data?.filtersApplied?.building;
    const buildings = b && b !== 'all' ? b : 'all buildings';
    const filtersLine = `Filters applied: period ${periodLabel(viewPeriod)}, ${buildings} · generated ${fmtDate(genAt)} ${fmtTime(genAt)}`;
    const scopeLine = `Scope: ${rows.length} owners · ${periodLabel(viewPeriod)} · management + finance view`;
    const head = ['Owner', 'Units', 'Gross booking value', 'Fees', 'Expenses', 'Net payout', 'Status'];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const body = rows.map(r => [r.ownerName, r.unitsLabel, rm(r.grossBookingValue), rm(r.managementFee), rm(r.expensesTotal), rm(r.netPayout), STATEMENT[r.state].label]);
    const lines = [`# ${filtersLine}`, `# ${scopeLine}`, '', head.map(esc).join(','), ...body.map(r => r.map(esc).join(','))];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `owner-statements-${viewPeriod}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ tone: 'success', title: 'Export ready.', body: 'The CSV header prints the applied filters, generated time and scope.' });
  }

  function openRow(r: Statement) { window.location.hash = `#/finance/statements/${r.id}`; }

  function downloadPdf(r: Statement, e: MouseEvent) {
    e.stopPropagation();
    window.open(`/api/statements/${encodeURIComponent(r.id)}/pdf`, '_blank', 'noopener');
  }

  return (
    <>
      <PageHeader
        title="Owner statements"
        sub={`${periodLabel(viewPeriod)} period · ${notSent} ${notSent === 1 ? 'statement' : 'statements'} not yet sent`}
        right={
          <div className="flex gap-[9px] flex-wrap items-center">
            <label className="relative flex items-center">
              <span className="absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]">Statement period</span>
              <select
                value={viewPeriod}
                onChange={e => { setViewPeriod(e.target.value); setSel({}); }}
                className="h-9 py-0 pr-[30px] pl-3 rounded-control border border-solid border-line bg-card text-ink [font:inherit] cursor-pointer appearance-none"
              >
                {PERIODS.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}
              </select>
              <Icon name="ChevronDown" size="sm" color="var(--color-muted-ink)" style={{ position: 'absolute', right: 9, pointerEvents: 'none' }} />
            </label>
            <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportCsv} disabled={rows.length === 0} disabledReason="Nothing to export for this period yet.">Export</Button>
            <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => openGenerate(lockedPeriods.has(shiftMonth(thisMonth, -1)) ? thisMonth : shiftMonth(thisMonth, -1))}>Generate statements</Button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      {!loading && rows.length === 0 ? (
        <EmptyState
          title={`No statements for ${periodLabel(viewPeriod)} yet.`}
          body="Generate the period to draw every settled booking, fee and documented expense into provisional statements."
          action={{ label: 'Generate statements', onClick: () => openGenerate(viewPeriod) }}
        />
      ) : (
        <Card>
          {(selected.length > 0 || selectedProvisional.length > 0) && (
            <div className="flex items-center justify-between gap-[14px] flex-wrap px-[22px] py-[11px] bg-black text-white">
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

          <div className="overflow-x-auto">
            <div className="min-w-[920px]">
              <div className={`grid ${gridCols} gap-[14px] px-[22px] py-[9px] bg-muted [border-bottom:1px_solid_var(--color-line)] text-[12px] font-semibold text-muted-ink`}>
                <div />
                <div>Owner</div>
                <div className="text-right">Gross booking value</div>
                <div className="text-right">Fees</div>
                <div className="text-right">Expenses</div>
                <div className="text-right">Net payout</div>
                <div>Status</div>
                <div />
              </div>

              {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={8} /> : rows.map(s => {
                const can = s.state === 'finalised' || s.state === 'provisional';
                const on = !!sel[s.id];
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRow(s)}
                    onKeyDown={e => { if (e.key === 'Enter') openRow(s); }}
                    className={`grid ${gridCols} gap-[14px] items-center min-h-[50px] py-2 px-[22px] [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer ${on ? 'bg-gold-tint' : 'bg-card'}`}
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
                      <span className="text-[13.5px] font-medium">{s.ownerName}</span>
                      <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{s.unitsLabel}</span>
                    </div>
                    <div className="text-right text-[13px] tabular-nums">{rm(s.grossBookingValue, { cents: false })}</div>
                    <div className="text-right text-[13px] text-muted-ink tabular-nums">&minus; {rm(s.managementFee, { cents: false })}</div>
                    <div className="text-right text-[13px] text-muted-ink tabular-nums">&minus; {rm(s.expensesTotal, { cents: false })}</div>
                    <div className="text-right text-[13px] font-semibold tabular-nums">{rm(s.netPayout)}</div>
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
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap px-[22px] py-[11px] [border-top:1px_solid_var(--color-line)] bg-page text-[12px] text-muted-ink">
            <span>{rows.length} {rows.length === 1 ? 'owner' : 'owners'} · {periodLabel(viewPeriod)}</span>
            <span>Every deduction carries a category, date, amount and reference</span>
          </div>
        </Card>
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
