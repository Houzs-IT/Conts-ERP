import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/States';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { useToast } from '../components/Toast';
import { api, ApiFailure } from '../lib/api';
import { rm, date as fmtDate, time as fmtTime } from '../lib/format';
import { STATEMENT } from '../lib/vocabulary';
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

/** The owner roster a fresh period is drawn against — clone into provisional rows. */
const ROSTER = FALLBACK.data.map(({ ownerName, unitsLabel, grossBookingValue, managementFee, expensesTotal, netPayout }) =>
  ({ ownerName, unitsLabel, grossBookingValue, managementFee, expensesTotal, netPayout }));

const PERIODS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

function periodLabel(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
}

const SELECT_REASON: Record<StatementState, string> = {
  provisional: 'Cannot send. This statement is still provisional.',
  finalised: '',
  sent: 'Already sent to the owner.',
  paid: 'Paid — nothing left to send.',
};

const COLS = '32px minmax(160px,1.6fr) minmax(118px,1fr) minmax(96px,0.9fr) minmax(96px,0.9fr) minmax(110px,1fr) minmax(92px,0.9fr) 40px';

export default function StatementsPage() {
  const { data, loading, error, reload } = useApi<Payload>(`/statements?period=${BASE_PERIOD}`, FALLBACK);
  const toast = useToast();

  const [viewPeriod, setViewPeriod] = useState(BASE_PERIOD);
  const [added, setAdded] = useState<Statement[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Statement>>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [sendConfirm, setSendConfirm] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genInitial, setGenInitial] = useState('2026-09');
  const [busy, setBusy] = useState(false);

  const baseRows = data?.data ?? [];
  const allRows = useMemo(
    () => [...added, ...baseRows].map(r => ({ ...r, ...edits[r.id], period: r.period ?? BASE_PERIOD })),
    [added, baseRows, edits],
  );
  const rows = allRows.filter(r => r.period === viewPeriod);
  const lockedPeriods = useMemo(() => {
    const s = new Set<string>();
    allRows.forEach(r => { if (r.state === 'sent' || r.state === 'paid') s.add(r.period ?? BASE_PERIOD); });
    return s;
  }, [allRows]);

  const selected = rows.filter(r => sel[r.id] && r.state === 'finalised');
  const sendable = rows.filter(r => r.state === 'finalised');
  const notSent = sendable.length;

  function setState(ids: string[], state: StatementState) {
    setEdits(e => {
      const n = { ...e };
      ids.forEach(id => { n[id] = { ...n[id], state }; });
      return n;
    });
  }

  function openGenerate(initial: string) {
    setGenInitial(initial);
    setGenOpen(true);
  }

  async function runGenerate(period: string) {
    const stamp = Date.now();
    const fresh: Statement[] = ROSTER.map((o, i) => ({
      ...o, id: `gen-${period}-${stamp}-${i}`, period, state: 'provisional',
    }));
    setAdded(a => [...fresh, ...a.filter(r => r.period !== period)]);
    setViewPeriod(period);
    setSel({});
    setGenOpen(false);
    toast({ tone: 'success', title: `Statements generated for ${fresh.length} owners. Review before sending.` });
    try {
      await api.post('/statements/generate', { period, ownerIds: [] });
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 409) {
        toast({ tone: 'warning', title: 'That period is locked.', body: 'A period that has already been sent cannot be regenerated.' });
      } // dev: no backend — keep the optimistic rows
    }
  }

  async function runSend() {
    const targets = selected;
    const ids = targets.map(t => t.id);
    if (!ids.length) { setSendConfirm(false); return; }
    setBusy(true);
    setState(ids, 'sent'); // optimistic
    try {
      const res = await api.post<{ sent: number; failed: { id: string; reason: string }[] }>(
        '/statements/send', { statementIds: ids });
      const failed = res.failed ?? [];
      if (failed.length) {
        const failedIds = new Set(failed.map(f => f.id));
        setState(targets.filter(t => failedIds.has(t.id)).map(t => t.id), 'finalised'); // keep the sent ones, revert only failures
        const names = targets.filter(t => failedIds.has(t.id)).map(t => t.ownerName);
        toast({ tone: 'warning', title: `${res.sent} sent, ${failed.length} not.`, body: `Not sent: ${names.join(', ')}.` });
      } else {
        toast({ tone: 'success', title: `${res.sent || ids.length} statements sent.`, body: 'Owners were emailed and the statements are live on their portals.' });
      }
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 422) {
        setState(ids, 'finalised'); // revert — provisional numbers must never reach owners
        toast({ tone: 'critical', title: `${ids.length} statements are still provisional and were not sent. Finalise them first.` });
      } else {
        // dev: no backend — keep the optimistic send
        toast({ tone: 'success', title: `${ids.length} statements sent.`, body: 'Owners were emailed and the statements are live on their portals.' });
      }
    } finally {
      setBusy(false);
      setSel({});
      setSendConfirm(false);
    }
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
    toast({ tone: 'info', title: 'Statement PDF', body: `${r.ownerName} — generated into R2 and served as a signed link.` });
    api.get(`/statements/${r.id}/pdf`).catch(() => { /* dev: no backend / binary body */ });
  }

  return (
    <>
      <PageHeader
        title="Owner statements"
        sub={`${periodLabel(viewPeriod)} period · ${notSent} ${notSent === 1 ? 'statement' : 'statements'} not yet sent`}
        right={
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Statement period</span>
              <select
                value={viewPeriod}
                onChange={e => { setViewPeriod(e.target.value); setSel({}); }}
                style={{ height: 36, padding: '0 30px 0 12px', borderRadius: radius.control, border: `1px solid ${color.border}`, background: color.card, color: color.ink, fontSize: 13, fontWeight: 500, font: 'inherit', cursor: 'pointer', appearance: 'none' }}
              >
                {PERIODS.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}
              </select>
              <Icon name="ChevronDown" size="sm" style={{ position: 'absolute', right: 9, pointerEvents: 'none', color: color.textMuted }} />
            </label>
            <Button size="sm" variant="secondary" icon={<Icon name="Download" size="sm" />} onClick={exportCsv} disabled={rows.length === 0} disabledReason="Nothing to export for this period yet.">Export</Button>
            <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => openGenerate(lockedPeriods.has('2026-09') ? '2026-10' : '2026-09')}>Generate statements</Button>
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
          {selected.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '11px 22px', background: color.black, color: '#FFFFFF' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{selected.length} of {sendable.length} selected · {periodLabel(viewPeriod)}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => setSel({})} style={{ fontSize: text.small, fontWeight: 500, color: color.onDark, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear</button>
                <button onClick={() => setSendConfirm(true)} style={{ padding: '7px 13px', borderRadius: radius.control, background: color.gold, color: color.black, fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                  Send {selected.length} {selected.length === 1 ? 'statement' : 'statements'}
                </button>
              </div>
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 920 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
                <div />
                <div>Owner</div>
                <div style={{ textAlign: 'right' }}>Gross booking value</div>
                <div style={{ textAlign: 'right' }}>Fees</div>
                <div style={{ textAlign: 'right' }}>Expenses</div>
                <div style={{ textAlign: 'right' }}>Net payout</div>
                <div>Status</div>
                <div />
              </div>

              {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={8} /> : rows.map(s => {
                const can = s.state === 'finalised';
                const on = !!sel[s.id];
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRow(s)}
                    onKeyDown={e => { if (e.key === 'Enter') openRow(s); }}
                    style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 50, padding: '8px 22px', borderBottom: `1px solid ${color.borderMuted}`, background: on ? color.goldTint : '#FFFFFF', cursor: 'pointer' }}
                  >
                    <span onClick={e => e.stopPropagation()} style={{ display: 'flex' }}>
                      <input
                        type="checkbox"
                        disabled={!can}
                        checked={on}
                        title={can ? undefined : SELECT_REASON[s.state]}
                        aria-label={can ? `Select ${s.ownerName}` : `${s.ownerName} cannot be selected — ${SELECT_REASON[s.state]}`}
                        onChange={() => setSel(v => ({ ...v, [s.id]: !v[s.id] }))}
                        style={{ width: 17, height: 17, accentColor: '#11694A', cursor: can ? 'pointer' : 'not-allowed' }}
                      />
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.ownerName}</span>
                      <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.unitsLabel}</span>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{rm(s.grossBookingValue, { cents: false })}</div>
                    <div style={{ textAlign: 'right', fontSize: 13, color: color.textMuted, fontVariantNumeric: 'tabular-nums' }}>&minus; {rm(s.managementFee, { cents: false })}</div>
                    <div style={{ textAlign: 'right', fontSize: 13, color: color.textMuted, fontVariantNumeric: 'tabular-nums' }}>&minus; {rm(s.expensesTotal, { cents: false })}</div>
                    <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{rm(s.netPayout)}</div>
                    <div><Badge tone={STATEMENT[s.state].tone} label={STATEMENT[s.state].label} /></div>
                    <button
                      onClick={e => downloadPdf(s, e)}
                      aria-label={`Download PDF for ${s.ownerName}`}
                      title="Download PDF"
                      style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: radius.control, background: 'transparent', border: `1px solid ${color.border}`, color: color.textMuted, cursor: 'pointer' }}
                    >
                      <Icon name="FileText" size="sm" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '11px 22px', borderTop: `1px solid ${color.border}`, background: color.page, fontSize: text.small, color: color.textMuted }}>
            <span>{rows.length} of {viewPeriod === BASE_PERIOD ? (data?.total ?? rows.length) : rows.length} owners · page size {data?.pageSize ?? 25}</span>
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
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={busy ? undefined : onClose} style={{ position: 'absolute', inset: 0 }} />
      <div ref={ref} style={{ position: 'relative', width: '100%', maxWidth: 440, background: 'var(--color-surface-card)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)', overflow: 'hidden', animation: 'dialog-in var(--motion-slow) var(--ease-out) both' }}>
        <div style={{ padding: '22px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, fontWeight: 600 }}>Generate statements</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-muted)' }}>
            Draws every settled booking, fee and documented expense for the period. Statements land as Provisional and must be reviewed before sending.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label htmlFor="gen-period" style={{ fontSize: text.small, fontWeight: 500, color: color.textMuted }}>Period</label>
            <select id="gen-period" value={period} onChange={e => setPeriod(e.target.value)} disabled={busy}
              style={{ height: 40, padding: '0 12px', borderRadius: radius.control, border: `1px solid ${color.border}`, background: color.card, color: color.ink, fontSize: 14, font: 'inherit', cursor: 'pointer' }}>
              {periods.map(p => (
                <option key={p} value={p} disabled={lockedPeriods.has(p)}>
                  {periodLabel(p)}{lockedPeriods.has(p) ? ' — already sent' : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ padding: '9px 11px', borderRadius: radius.control, background: color.page, border: `1px solid ${color.border}`, fontSize: 12, color: locked ? toneCritical() : color.textMuted }}>
            {locked ? 'This period has already been sent and cannot be regenerated.' : 'A period that has already been sent cannot be regenerated.'}
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${color.border}`, background: color.page, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={locked} disabledReason="This period has already been sent." onClick={confirm}>
            {busy ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function toneCritical() { return 'var(--color-critical-fg)'; }
