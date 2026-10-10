import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyText } from '../../components/MoneyText';
import Icon from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, downloadFile, notifyFailure } from '../../lib/api';
import { monthLabel, date, todayMyt, titleCase } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { PAYERS, PAYER_LABEL, ENTRY_CATEGORIES, CATEGORY_LABEL } from '../../lib/revenueModel';

/** Expenses recorded to units: entry (one bill with who pays and its receipt), a month's utility bills by account
 *  number, and the month's list. Used on the unit's Financials tab and the owner profile. Money flows one way:
 *  an expense is recorded to its unit; the statement deducts it only when the owner pays it. */

export interface UnitChoice { id: string; label: string }

interface ExpenseRow {
  id: string; unitId: string; unitNumber: string; propertyName: string; category: string; description: string; amount: number;
  incurredOn: string; reference: string | null; chargeTo: string; locked: boolean; receiptDocumentId: string | null;
}
interface ListPayload { data: ExpenseRow[]; totals?: { amount: number; count: number } }

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

/** One expense: unit, category, amount, date, who pays, and the receipt. */
export function ExpenseEntryModal({ units, defaultUnitId, month, onClose, onSaved }: { units: UnitChoice[]; defaultUnitId?: string; month: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayMyt();
  const [f, setF] = useState({
    unitId: defaultUnitId ?? units[0]?.id ?? '', category: 'electricity', amount: '', incurredOn: today.startsWith(month) ? today : lastDayOf(month),
    chargeTo: 'owner', description: '',
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }));
  const amount = Math.round(Number(f.amount || 0) * 100);
  const ok = !!f.unitId && f.amount !== '' && Number.isFinite(Number(f.amount)) && amount >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.incurredOn);
  const payer = PAYERS.find(p => p.value === f.chargeTo);

  async function save() {
    if (!ok || busy) return;
    setBusy(true); setFields({});
    try {
      let receiptDocumentId: string | null = null;
      if (receipt) {
        const fd = new FormData();
        fd.append('file', receipt); fd.append('unitId', f.unitId); fd.append('kind', 'receipt');
        receiptDocumentId = (await api.post<{ id: string }>('/documents', fd)).id;
      }
      const cat = ENTRY_CATEGORIES.find(c => c.value === f.category)?.label ?? f.category;
      await api.post('/expenses', {
        unitId: f.unitId, category: f.category, amount, incurredOn: f.incurredOn, chargeTo: f.chargeTo,
        description: f.description.trim() || `${cat} ${monthLabel(f.incurredOn.slice(0, 7))}`, receiptDocumentId,
      });
      toast({ tone: 'success', title: 'Expense recorded.', body: `${cat}, ${PAYER_LABEL[f.chargeTo]} pays.${f.chargeTo === 'owner' ? ' It goes on the owner statement.' : ' It stays off the owner statement.'}` });
      onSaved(); onClose();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Expense was not recorded.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); }
  }

  return (
    <Sheet title="Record an expense" sub="Recorded to the unit. Only expenses the owner pays are deducted on their statement." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" loading={busy} disabled={!ok} disabledReason="Pick the unit and enter the amount and date" onClick={() => void save()}>Record expense</Button></>}>
      {units.length > 1 && <Select showLabel size="md" label="Unit" value={f.unitId} onChange={set('unitId')} options={units.map(u => ({ value: u.id, label: titleCase(u.label) }))} />}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select showLabel size="md" label="Category" value={f.category} onChange={set('category')} options={ENTRY_CATEGORIES} />
        <Field label="Amount (RM)" type="number" min={0} step="0.01" numeric placeholder="e.g. 120.50" value={f.amount} onChange={e => set('amount')(e.target.value)} error={fields.amount} />
        <Field label="Date" type="date" value={f.incurredOn} onChange={e => set('incurredOn')(e.target.value)} error={fields.incurredOn} />
        <Select showLabel size="md" label="Paid by" value={f.chargeTo} onChange={set('chargeTo')} options={PAYERS.map(p => ({ value: p.value, label: p.label }))} />
      </div>
      {payer && <p className="m-0 -mt-1 text-meta text-muted-ink">{payer.help}</p>}
      <Field label="Description (optional)" placeholder="e.g. TNB bill September" value={f.description} onChange={e => set('description')(e.target.value)} />
      <div className="flex flex-col gap-1.5">
        <span className="text-meta font-medium text-muted-ink">Receipt (optional)</span>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="secondary" icon={<Icon name="Upload" size="sm" />} onClick={() => fileRef.current?.click()}>{receipt ? 'Change file' : 'Attach photo or PDF'}</Button>
          {receipt && <span className="text-meta text-ink [overflow-wrap:anywhere]">{receipt.name}</span>}
          {fields.receipt && <span className="text-meta text-critical">{fields.receipt}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { setReceipt(e.currentTarget.files?.item(0) ?? null); e.currentTarget.value = ''; }} />
      </div>
    </Sheet>
  );
}

interface UtilityRow { accountId: string; unitId: string; unitLabel: string; kind: string; kindLabel: string; accountNo: string; provider: string | null; expenseId: string | null; amount: number | null; chargeTo: string | null; recordedElsewhere: boolean }

/** A month's utility bills, one line per account number on the owner's (or the unit's) units. */
export function UtilitiesModal({ ownerId, unitId, month: initial, onClose, onSaved }: { ownerId?: string; unitId?: string; month: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(initial);
  const scope = ownerId ? `&ownerId=${encodeURIComponent(ownerId)}` : unitId ? `&unitId=${encodeURIComponent(unitId)}` : '';
  const { data, loading, error } = useApi<{ data: UtilityRow[] }>(`/expenses/utilities?month=${month}${scope}`);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [payers, setPayers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAmounts({}); setPayers({}); }, [month]);
  const rows = data?.data ?? [];
  const value = (r: UtilityRow) => amounts[r.accountId] ?? (r.amount != null && !r.recordedElsewhere ? (r.amount / 100).toFixed(2) : '');
  const entered = rows.filter(r => !r.recordedElsewhere && value(r) !== '' && Number(value(r)) > 0);

  async function save() {
    setBusy(true);
    try {
      const r = await api.post<{ saved: number; locked: string[]; recordedElsewhere: string[] }>('/expenses/utilities', {
        month, rows: entered.map(x => ({ accountId: x.accountId, amount: Math.round(Number(value(x)) * 100), chargeTo: payers[x.accountId] ?? x.chargeTo ?? 'owner' })),
      });
      const skipped = r.locked.length + r.recordedElsewhere.length;
      toast({ tone: skipped ? 'warning' : 'success', title: `${r.saved} ${r.saved === 1 ? 'bill' : 'bills'} recorded for ${monthLabel(month)}.`,
        body: skipped ? `${r.locked.length ? `${r.locked.length} skipped: that statement is final. ` : ''}${r.recordedElsewhere.length ? `${r.recordedElsewhere.length} already recorded another way.` : ''}` : 'Owner-paid bills go on the owner statement.' });
      onSaved(); onClose();
    } catch (e) {
      toast({ tone: 'critical', title: 'Bills were not recorded.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); }
  }

  const step = (by: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); };
  return (
    <Sheet wide title="Monthly utility bills" sub="One line per account number. Enter the bill amount; empty lines are skipped. Re-entering a month replaces what was entered here." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" loading={busy} disabled={!entered.length} disabledReason="Enter at least one bill" onClick={() => void save()}>Record {entered.length || ''} {entered.length === 1 ? 'bill' : 'bills'}</Button></>}>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="w-[34px] h-[34px] grid place-items-center rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink"><Icon name="ChevronLeft" size="sm" /></button>
        <span className="text-copy font-semibold min-w-[96px] text-center">{monthLabel(month)}</span>
        <button type="button" aria-label="Next month" onClick={() => step(1)} className="w-[34px] h-[34px] grid place-items-center rounded-control bg-card border border-solid border-line cursor-pointer text-muted-ink"><Icon name="ChevronRight" size="sm" /></button>
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
                  <input aria-label={`${r.kindLabel} ${r.accountNo} amount in ringgit`} type="number" min={0} step="0.01" inputMode="decimal" placeholder="0.00"
                    value={value(r)} onChange={e => setAmounts(a => ({ ...a, [r.accountId]: e.target.value }))} className="field-input h-[38px]! min-w-0 text-right tabular-nums" />
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

/** The month's expenses on a unit or on all of an owner's units, with who paid each and its receipt. */
export function ExpensesCard({ title = 'Expenses recorded to units', ownerId, unitId, month, units, canEdit, onChanged }: {
  title?: string; ownerId?: string; unitId?: string; month: string; units: UnitChoice[]; canEdit: boolean; onChanged?: () => void;
}) {
  const scope = ownerId ? `&owner=${encodeURIComponent(ownerId)}` : unitId ? `&unit=${encodeURIComponent(unitId)}` : '';
  const { data, loading, error, reload } = useApi<ListPayload>(`/finance/expenses?month=${month}${scope}&pageSize=200&sort=date`);
  const [modal, setModal] = useState<null | 'add' | 'utilities'>(null);
  const rows = data?.data ?? [];
  const ownerTotal = rows.filter(r => r.chargeTo === 'owner').reduce((n, r) => n + r.amount, 0);
  const otherTotal = rows.filter(r => r.chargeTo !== 'owner').reduce((n, r) => n + r.amount, 0);
  const saved = () => { reload(); onChanged?.(); };
  const many = units.length > 1;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-heading font-semibold">{title}</span>
          <span className="text-meta text-muted-ink">{monthLabel(month)} · owner pays <MoneyText sen={ownerTotal} mode="exact" className="text-ink font-medium" /> (on the statement) · others pay <MoneyText sen={otherTotal} mode="exact" className="text-ink font-medium" /></span>
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="secondary" icon={<Icon name="Zap" size="sm" />} onClick={() => setModal('utilities')}>Utility bills</Button>
            <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal('add')}>Record expense</Button>
          </div>
        )}
      </div>
      {loading && !data ? <div className="py-4 px-5 text-copy text-muted-ink">Loading expenses…</div>
        : error ? <div className="py-4 px-5 text-copy text-critical">{error}</div>
        : rows.length === 0 ? <div className="py-4 px-5 text-copy text-muted-ink">No expenses recorded for {monthLabel(month)}.</div>
        : (
          <div>
            {rows.map(r => (
              <div key={r.id} className={cx('grid gap-x-3 gap-y-0.5 items-center py-[10px] px-5 [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0',
                many ? 'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(90px,0.8fr)_minmax(0,1.6fr)_minmax(80px,0.7fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.6fr)_minmax(80px,0.7fr)_auto]')}>
                {many && <span className="text-meta text-muted-ink truncate sm:text-copy sm:text-ink col-span-2 sm:col-span-1" title={`${r.propertyName} ${r.unitNumber}`}>{r.unitNumber}</span>}
                <div className="flex flex-col min-w-0">
                  <span className="text-copy truncate" title={r.description}>{r.description || CATEGORY_LABEL[r.category] || r.category}</span>
                  <span className="text-meta text-muted-ink">
                    {CATEGORY_LABEL[r.category] ?? r.category} · {date(r.incurredOn)}
                    {r.receiptDocumentId && <> · <button type="button" onClick={() => downloadFile(`/documents/${r.receiptDocumentId}/download`).catch(notifyFailure)} className="p-0 bg-transparent border-none cursor-pointer text-gold-ink underline [font:inherit]">Receipt</button></>}
                  </span>
                </div>
                <span className={cx('hidden sm:inline text-meta', r.chargeTo === 'owner' ? 'text-ink font-medium' : 'text-muted-ink')}>{PAYER_LABEL[r.chargeTo] ?? r.chargeTo}</span>
                <div className="flex flex-col items-end">
                  <MoneyText sen={r.amount} mode="exact" className="text-copy font-medium" />
                  <span className="sm:hidden text-caption text-muted-ink">{PAYER_LABEL[r.chargeTo] ?? r.chargeTo} pays</span>
                </div>
              </div>
            ))}
          </div>
        )}
      {modal === 'add' && <ExpenseEntryModal units={units} defaultUnitId={unitId} month={month} onClose={() => setModal(null)} onSaved={saved} />}
      {modal === 'utilities' && <UtilitiesModal ownerId={ownerId} unitId={unitId} month={month} onClose={() => setModal(null)} onSaved={saved} />}
    </Card>
  );
}
