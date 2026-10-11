import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { MoneyInput, DateField } from '../../components/inputs';
import { MoneyText } from '../../components/MoneyText';
import Icon from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, errorMessage } from '../../lib/api';
import { monthLabel, titleCase } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { PAYERS } from '../../lib/revenueModel';

/** A month's utility bills by account number across an owner's units, entered from one screen (the owner page). One
 *  bill at a time is "Add a bill" (Costs.tsx BillModal), which records the same expense row. Money flows one way: an
 *  expense is recorded to its unit; the statement deducts it only when the owner pays it. */

export interface UnitChoice { id: string; label: string }

const lastDayOf = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

function Sheet({ title, sub, onClose, footer, children, wide }: { title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input,select,button[aria-haspopup]')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div ref={ref} className={cx('relative w-full max-h-[calc(100vh-32px)] flex flex-col bg-card rounded-card shadow-[var(--shadow-overlay)]', wide ? 'max-w-[720px]' : 'max-w-[500px]')}>
        <div className="pt-[22px] px-[22px] pb-1 flex-none"><h2 className="m-0 text-title font-semibold">{title}</h2>{sub && <p className="mt-[5px] mb-0 text-copy text-muted-ink">{sub}</p>}</div>
        <div className="py-4 px-[22px] flex flex-col gap-[14px] overflow-y-auto min-h-0">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end flex-wrap gap-[9px] flex-none">{footer}</div>
      </div>
    </div>
  );
}

interface UtilityRow { accountId: string; unitId: string; unitLabel: string; kind: string; kindLabel: string; accountNo: string; provider: string | null; expenseId: string | null; amount: number | null; chargeTo: string | null; recordedElsewhere: boolean }

/** A month's utility bills, one line per account number on the owner's (or the unit's) units. */
export function UtilitiesModal({ ownerId, unitId, month: initial, onClose, onSaved }: { ownerId?: string; unitId?: string; month: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(initial);
  const scope = ownerId ? `&ownerId=${encodeURIComponent(ownerId)}` : unitId ? `&unitId=${encodeURIComponent(unitId)}` : '';
  const { data, loading, error } = useApi<{ data: UtilityRow[] }>(`/expenses/utilities?month=${month}${scope}`);
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [payers, setPayers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [billDate, setBillDate] = useState(lastDayOf(initial));
  useEffect(() => { setAmounts({}); setPayers({}); setBillDate(lastDayOf(month)); }, [month]);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(billDate) && billDate.startsWith(month);
  const rows = data?.data ?? [];
  const value = (r: UtilityRow): number | null => r.accountId in amounts ? amounts[r.accountId] : (r.amount != null && !r.recordedElsewhere ? r.amount : null);
  const entered = rows.filter(r => !r.recordedElsewhere && (value(r) ?? 0) > 0);

  async function save() {
    setBusy(true);
    try {
      const r = await api.post<{ saved: number; locked: string[]; recordedElsewhere: string[] }>('/expenses/utilities', {
        month, date: billDate, rows: entered.map(x => ({ accountId: x.accountId, amount: value(x), chargeTo: payers[x.accountId] ?? x.chargeTo ?? 'owner' })),
      });
      const skipped = r.locked.length + r.recordedElsewhere.length;
      toast({ tone: skipped ? 'warning' : 'success', title: `${r.saved} ${r.saved === 1 ? 'bill' : 'bills'} recorded for ${monthLabel(month)}.`,
        body: skipped ? `${r.locked.length ? `${r.locked.length} skipped: that statement is final. ` : ''}${r.recordedElsewhere.length ? `${r.recordedElsewhere.length} already recorded another way.` : ''}` : 'Owner-paid bills go on the owner statement.' });
      onSaved(); onClose();
    } catch (e) {
      toast({ tone: 'critical', title: 'Bills were not recorded.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const step = (by: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); };
  return (
    <Sheet wide title="Monthly utility bills" sub="One line per account number. Enter the bill amount; empty lines are skipped. Re-entering a month replaces what was entered here." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" loading={busy} disabled={!entered.length || !dateOk} disabledReason={dateOk ? 'Enter at least one bill' : `Pick a bill date in ${monthLabel(month)}`} onClick={() => void save()}>Record {entered.length || ''} {entered.length === 1 ? 'bill' : 'bills'}</Button></>}>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="w-[34px] h-[34px] grid place-items-center rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink"><Icon name="ChevronLeft" size="sm" /></button>
        <span className="text-copy font-semibold min-w-[96px] text-center">{monthLabel(month)}</span>
        <button type="button" aria-label="Next month" onClick={() => step(1)} className="w-[34px] h-[34px] grid place-items-center rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink"><Icon name="ChevronRight" size="sm" /></button>
      </div>
      <div className="w-[220px] max-w-full">
        <DateField label="Bill date" value={billDate} onChange={setBillDate} min={`${month}-01`} max={lastDayOf(month)}
          error={dateOk ? undefined : `A bill date in ${monthLabel(month)} is required.`} help="Every bill entered here carries this date." />
      </div>
      {loading && !data ? <div className="text-copy text-muted-ink">Loading accounts…</div>
        : error ? <div className="text-copy text-critical">{error}</div>
        : rows.length === 0 ? <div className="text-copy text-muted-ink">No utility account numbers on file for these units. Add them on the unit's Details tab.</div>
        : (
          <div className="border border-solid border-line rounded-card overflow-hidden">
            {rows.map(r => (
              <div key={r.accountId} className="grid grid-cols-[minmax(0,1fr)_112px] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_150px] gap-x-3 gap-y-2 items-center py-[10px] px-3 [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
                <div className="flex flex-col min-w-0">
                  <span className="text-copy font-medium truncate" title={r.unitLabel}>{titleCase(r.unitLabel)}</span>
                  <span className="text-meta text-muted-ink truncate">{r.kindLabel} · {r.accountNo}{r.provider ? ` · ${r.provider}` : ''}</span>
                </div>
                <span className="hidden sm:block text-meta text-muted-ink">{r.recordedElsewhere ? 'Already recorded' : r.expenseId ? 'Entered here' : ''}</span>
                {r.recordedElsewhere ? (
                  <MoneyText sen={r.amount ?? 0} mode="exact" tone="muted" className="text-copy text-right" />
                ) : (
                  <MoneyInput aria-label={`${r.kindLabel} ${r.accountNo} amount in ringgit`}
                    valueSen={value(r)} onChangeSen={sen => setAmounts(a => ({ ...a, [r.accountId]: sen }))} className="field-input h-[38px]! min-w-0 text-right tabular-nums" />
                )}
                <div className="col-span-2 sm:col-span-1">
                  {!r.recordedElsewhere && <Select size="sm" label={`Who pays ${r.kindLabel} ${r.accountNo}`} className="w-full" value={payers[r.accountId] ?? r.chargeTo ?? 'owner'}
                    onChange={v => setPayers(p => ({ ...p, [r.accountId]: v }))} options={PAYERS.map(p => ({ value: p.value, label: p.label }))} />}
                </div>
              </div>
            ))}
          </div>
        )}
    </Sheet>
  );
}

