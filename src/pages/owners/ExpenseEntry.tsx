import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { MoneyInput, DateField } from '../../components/inputs';
import { MoneyText } from '../../components/MoneyText';
import Icon from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, downloadFile, errorMessage, notifyFailure } from '../../lib/api';
import { monthLabel, titleCase } from '../../lib/format';
import { cx } from '../../lib/design-tokens';
import { PAYERS } from '../../lib/revenueModel';
import { Field } from '../../components/Field';
import { receiptRequired } from '../../lib/receipts';

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

interface UtilityRow {
  accountId: string; unitId: string; unitLabel: string; kind: string; kindLabel: string; accountNo: string; provider: string | null;
  expenseId: string | null; amount: number | null; chargeTo: string | null; receiptDocumentId: string | null; recordedElsewhere: boolean;
}
interface BareUnit { unitId: string; unitLabel: string }

const ACCOUNT_KINDS = [{ value: 'electricity', label: 'Electricity' }, { value: 'water', label: 'Water' }, { value: 'internet', label: 'Wi-Fi' }, { value: 'sewerage', label: 'IndahWater' }];

/** A month's utility bills, one line per account number on the owner's (or the unit's, or every) unit. A bill the owner
 *  pays goes in with its receipt (src/lib/receipts.ts); one already on file for that bill is kept. Units with no
 *  account number on file are listed under the bills with "Add account", so none is left out of the month. */
export function UtilitiesModal({ ownerId, unitId, month: initial, onClose, onSaved }: { ownerId?: string; unitId?: string; month: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(initial);
  const scope = ownerId ? `&ownerId=${encodeURIComponent(ownerId)}` : unitId ? `&unitId=${encodeURIComponent(unitId)}` : '';
  const { data, loading, error, reload } = useApi<{ data: UtilityRow[]; unitsWithoutAccount?: BareUnit[] }>(`/expenses/utilities?month=${month}${scope}`);
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [payers, setPayers] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, File | null>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [billDate, setBillDate] = useState(lastDayOf(initial));
  useEffect(() => { setAmounts({}); setPayers({}); setReceipts({}); setRowErrors({}); setBillDate(lastDayOf(month)); }, [month]);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(billDate) && billDate.startsWith(month);
  const rows = data?.data ?? [];
  const bare = data?.unitsWithoutAccount ?? [];
  const value = (r: UtilityRow): number | null => r.accountId in amounts ? amounts[r.accountId] : (r.amount != null && !r.recordedElsewhere ? r.amount : null);
  const payer = (r: UtilityRow) => payers[r.accountId] ?? r.chargeTo ?? 'owner';
  const entered = rows.filter(r => !r.recordedElsewhere && (value(r) ?? 0) > 0);
  const needsReceipt = (r: UtilityRow) => receiptRequired(r.kind, payer(r)) && !receipts[r.accountId] && !r.receiptDocumentId;
  const missing = entered.filter(needsReceipt);

  async function save() {
    setBusy(true); setRowErrors({});
    try {
      const uploaded: Record<string, string> = {};
      for (const x of entered) {
        const file = receipts[x.accountId];
        if (!file || !receiptRequired(x.kind, payer(x))) continue;
        const fd = new FormData();
        fd.append('file', file); fd.append('unitId', x.unitId); fd.append('kind', 'receipt');
        uploaded[x.accountId] = (await api.post<{ id: string }>('/documents', fd)).id;
      }
      const r = await api.post<{ saved: number; locked: string[]; recordedElsewhere: string[] }>('/expenses/utilities', {
        month, date: billDate, rows: entered.map(x => ({ accountId: x.accountId, amount: value(x), chargeTo: payer(x), receiptDocumentId: uploaded[x.accountId] ?? null })),
      });
      const skipped = r.locked.length + r.recordedElsewhere.length;
      toast({ tone: skipped ? 'warning' : 'success', title: `${r.saved} ${r.saved === 1 ? 'bill' : 'bills'} recorded for ${monthLabel(month)}.`,
        body: skipped ? `${r.locked.length ? `${r.locked.length} skipped: that statement is final. ` : ''}${r.recordedElsewhere.length ? `${r.recordedElsewhere.length} already recorded another way.` : ''}` : 'Owner-paid bills go on the owner statement with their receipts.' });
      onSaved(); onClose();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setRowErrors(e.fields);
      toast({ tone: 'critical', title: 'Bills were not recorded.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  const step = (by: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); };
  const disabledReason = !dateOk ? `Pick a bill date in ${monthLabel(month)}`
    : !entered.length ? 'Enter at least one bill'
    : `Attach the receipt for each bill the owner pays (${missing.length} missing)`;
  return (
    <Sheet wide title="Monthly utility bills" sub="One line per account number. Enter the bill amount and attach its receipt; empty lines are skipped. Re-entering a month replaces what was entered here." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" loading={busy} disabled={!entered.length || !dateOk || missing.length > 0} disabledReason={disabledReason} onClick={() => void save()}>Record {entered.length || ''} {entered.length === 1 ? 'bill' : 'bills'}</Button></>}>
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
        : <>
          {rows.length > 0 && (
            <div className="shrink-0 border border-solid border-line rounded-card overflow-hidden">
              {rows.map(r => {
                const amount = value(r);
                const owes = !r.recordedElsewhere && (amount ?? 0) > 0 && receiptRequired(r.kind, payer(r));
                return (
                  <div key={r.accountId} className="grid grid-cols-[minmax(0,1fr)_112px] sm:grid-cols-[minmax(0,1fr)_120px_140px_150px] gap-x-3 gap-y-2 items-center py-[10px] px-3 [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
                    <div className="flex flex-col min-w-0">
                      <span className="text-copy font-medium truncate" title={r.unitLabel}>{titleCase(r.unitLabel)}</span>
                      <span className="text-meta text-muted-ink truncate">{r.kindLabel} · {r.accountNo}{r.provider ? ` · ${r.provider}` : ''}{r.recordedElsewhere ? ' · already recorded' : r.expenseId ? ' · entered here' : ''}</span>
                    </div>
                    {r.recordedElsewhere ? (
                      <MoneyText sen={r.amount ?? 0} mode="exact" tone="muted" className="text-copy text-right" />
                    ) : (
                      <MoneyInput aria-label={`${r.kindLabel} ${r.accountNo} amount in ringgit`}
                        valueSen={amount} onChangeSen={sen => setAmounts(a => ({ ...a, [r.accountId]: sen }))} className="field-input h-[38px]! min-w-0 text-right tabular-nums" />
                    )}
                    <div className="col-span-2 sm:col-span-1 min-w-0">
                      {!r.recordedElsewhere && <Select size="sm" label={`Who pays ${r.kindLabel} ${r.accountNo}`} className="w-full" value={payer(r)}
                        onChange={v => setPayers(p => ({ ...p, [r.accountId]: v }))} options={PAYERS.map(p => ({ value: p.value, label: p.label }))} />}
                    </div>
                    <div className="col-span-2 sm:col-span-1 min-w-0">
                      {!r.recordedElsewhere && (
                        <RowReceipt label={`${r.kindLabel} ${r.accountNo}`} file={receipts[r.accountId] ?? null} onPick={f => setReceipts(x => ({ ...x, [r.accountId]: f }))}
                          existing={r.receiptDocumentId} needed={owes && needsReceipt(r)} error={rowErrors[r.accountId]} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {rows.length === 0 && bare.length === 0 && <div className="text-copy text-muted-ink">No units here.</div>}
          {bare.length > 0 && <NoAccountUnits units={bare} onAdded={reload} />}
        </>}
    </Sheet>
  );
}

/** The receipt of one line: a new file picked here, the one already on that month's bill, or "Attach receipt". */
function RowReceipt({ label, file, onPick, existing, needed, error }: {
  label: string; file: File | null; onPick: (f: File | null) => void; existing: string | null; needed: boolean; error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const LINK = 'p-0 bg-transparent border-none cursor-pointer text-meta underline [font-family:inherit] whitespace-nowrap';
  return (
    <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap min-w-0">
      {file ? (
        <>
          <span className="inline-flex items-center gap-1 text-meta text-ink min-w-0"><Icon name="Paperclip" size="sm" /><span className="truncate max-w-[110px]" title={file.name}>{file.name}</span></span>
          <button type="button" aria-label={`Remove the receipt for ${label}`} onClick={() => onPick(null)} className={cx(LINK, 'text-muted-ink')}>Remove</button>
        </>
      ) : existing ? (
        <>
          <button type="button" onClick={() => downloadFile(`/documents/${existing}/download`).catch(notifyFailure)} className={cx(LINK, 'text-gold-ink')}>Receipt on file</button>
          <button type="button" onClick={() => input.current?.click()} className={cx(LINK, 'text-muted-ink')}>Replace</button>
        </>
      ) : (
        <>
          {needed && <span className="text-meta text-warning font-medium whitespace-nowrap">Receipt needed</span>}
          <button type="button" aria-label={`Attach the receipt for ${label}`} onClick={() => input.current?.click()} className={cx(LINK, 'text-ink')}>Attach receipt</button>
        </>
      )}
      {error && <span className="basis-full text-meta text-critical">{error}</span>}
      <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={e => { onPick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
    </div>
  );
}

/** Units with no utility account number on file: listed so none is missed in the month, each with "Add account". */
function NoAccountUnits({ units, onAdded }: { units: BareUnit[]; onAdded: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="shrink-0 flex flex-col gap-2">
      <span className="text-meta font-medium text-muted-ink">No account on file · {units.length} {units.length === 1 ? 'unit' : 'units'}</span>
      <div className="border border-solid border-line rounded-card overflow-hidden">
        {units.map(u => (
          <div key={u.unitId} className="py-[10px] px-3 flex flex-col gap-2 [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
            <div className="flex items-center justify-between gap-3 min-w-0">
              <span className="flex flex-col min-w-0">
                <span className="text-copy font-medium truncate" title={u.unitLabel}>{titleCase(u.unitLabel)}</span>
                <span className="text-meta text-muted-ink">No account on file</span>
              </span>
              {open !== u.unitId && <Button size="sm" variant="secondary" onClick={() => setOpen(u.unitId)}>Add account</Button>}
            </div>
            {open === u.unitId && <AddAccountForm unitId={u.unitId} unitLabel={u.unitLabel} onCancel={() => setOpen(null)} onAdded={() => { setOpen(null); onAdded(); }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddAccountForm({ unitId, unitLabel, onCancel, onAdded }: { unitId: string; unitLabel: string; onCancel: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState('electricity');
  const [accountNo, setAccountNo] = useState('');
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function save() {
    if (!accountNo.trim() || busy) return;
    setBusy(true); setFields({});
    try {
      await api.post('/expenses/utility-accounts', { unitId, kind, accountNo: accountNo.trim(), provider: provider.trim() || null });
      toast({ tone: 'success', title: 'Account added.', body: `${titleCase(unitLabel)} now has a line for its ${ACCOUNT_KINDS.find(k => k.value === kind)?.label ?? kind} bill.` });
      onAdded();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Account was not added.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-start">
      <Select showLabel size="md" label="Bill" value={kind} onChange={setKind} options={ACCOUNT_KINDS} />
      <Field label="Account number" placeholder="From the bill" maxLength={60} value={accountNo} onChange={e => setAccountNo(e.target.value)} error={fields.accountNo} />
      <Field label="Provider (optional)" placeholder="e.g. TNB" maxLength={60} value={provider} onChange={e => setProvider(e.target.value)} error={fields.provider} />
      <div className="sm:col-span-3 flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!accountNo.trim()} disabledReason="Enter the account number" onClick={() => void save()}>Add account</Button>
      </div>
    </div>
  );
}
