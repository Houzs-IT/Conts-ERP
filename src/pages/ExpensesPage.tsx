import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { rm } from '../lib/format';
import { TONE, cx } from '../lib/design-tokens';
import type { Tone } from '../lib/types';

// Category is a closed list. The monthly-expense dialog only offers the recurring
// operating categories (internet / electricity / water / cleaning / maintenance /
// other, per BUTTONS.md §10); the richer set below also covers expenses that flow
// in from maintenance completion and channel settlement, so their rows still label.
type Category =
  | 'internet' | 'electricity' | 'water' | 'cleaning'
  | 'housekeeping' | 'maintenance' | 'utilities' | 'consumables'
  | 'furniture' | 'management_fee' | 'channel_fee' | 'other';

const CAT_LABEL: Record<Category, string> = {
  internet: 'Internet', electricity: 'Electricity', water: 'Water', cleaning: 'Cleaning',
  housekeeping: 'Housekeeping', maintenance: 'Maintenance', utilities: 'Utilities',
  consumables: 'Consumables', furniture: 'Furniture', management_fee: 'Management fee',
  channel_fee: 'Channel fee', other: 'Other',
};
const CAT_TONE: Record<Category, Tone> = {
  internet: 'info', electricity: 'warning', water: 'info', cleaning: 'info',
  housekeeping: 'info', maintenance: 'warning', utilities: 'neutral',
  consumables: 'neutral', furniture: 'info', management_fee: 'neutral',
  channel_fee: 'neutral', other: 'neutral',
};

// The dialog's category set — the monthly deductions an operator adds by hand.
const ADD_CATEGORIES: Category[] = ['internet', 'electricity', 'water', 'cleaning', 'maintenance', 'other'];

// Charge-to mirrors Maintenance. New monthly expenses land on the owner statement.
type ChargeTo = 'owner' | 'guest_deposit' | 'the_conts' | 'warranty';
const CHARGE_LABEL: Record<string, string> = {
  owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty',
};

interface Expense {
  id: string; unitNumber: string; propertyName: string; category: Category;
  description: string; amount: number; incurredOn: string; reference: string | null; chargeTo: ChargeTo;
  unitId?: string; locked?: boolean;
}
interface Payload { data: Expense[]; total: number; generatedAt: string; sentPeriods?: string[] }

/** Renders until /api/finance/expenses is seeded. Delete once the endpoint returns rows. */
const FALLBACK: Payload = {
  generatedAt: '', total: 476900,
  data: [
    { id: 'EXP-0931', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', category: 'housekeeping', description: 'Housekeeping, 11 turnovers', amount: 38500, incurredOn: '2026-08-31', reference: 'HK-2026-08-A1203', chargeTo: 'owner' },
    { id: 'EXP-0920', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', category: 'maintenance', description: 'Aircon quarterly service', amount: 7800, incurredOn: '2026-08-20', reference: 'INV-2026-0820', chargeTo: 'owner' },
    { id: 'EXP-0918', unitNumber: '#C-31-14', propertyName: 'Sentral Suites', category: 'maintenance', description: 'Plumbing works, riser replacement', amount: 320000, incurredOn: '2026-09-14', reference: 'AQF-4417', chargeTo: 'owner' },
    { id: 'EXP-0915', unitNumber: '#B-08-11', propertyName: 'Arcoris', category: 'consumables', description: 'Coffee pods, toiletries, 3 months', amount: 24000, incurredOn: '2026-09-12', reference: 'PO-2026-0912', chargeTo: 'owner' },
    { id: 'EXP-0911', unitNumber: '#15-06', propertyName: 'Scarletz', category: 'utilities', description: 'TNB and Indah Water, August', amount: 18600, incurredOn: '2026-09-05', reference: 'TNB-0895512', chargeTo: 'owner' },
    { id: 'EXP-0908', unitNumber: '#2207', propertyName: 'Tribeca', category: 'furniture', description: 'Replacement dining chairs, 2', amount: 56000, incurredOn: '2026-09-02', reference: 'FRN-2026-114', chargeTo: 'owner' },
    { id: 'EXP-0902', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', category: 'maintenance', description: 'Sofa cover deep clean', amount: 12000, incurredOn: '2026-08-14', reference: 'HK-2026-08-SOFA', chargeTo: 'guest_deposit' },
  ],
};

// A period is locked once its owner statement has been sent — its expenses can no
// longer be edited (BUTTONS.md §10). July and August 2026 have gone out; the
// current month is still open.
const SENT_PERIODS = new Set(['2026-07', '2026-08']);

// Grid template shared by the table header, each row and the total row. Mirrors
// the former COLS inline value as a Tailwind arbitrary grid-template-columns.
const COLS_CLASS = 'grid-cols-[minmax(168px,1.5fr)_minmax(128px,1.1fr)_minmax(116px,1fr)_minmax(104px,0.9fr)_minmax(120px,1fr)_minmax(96px,0.85fr)_74px]';
const MYT = 'Asia/Kuala_Lumpur';

const periodOf = (iso: string) => iso.slice(0, 7);
const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
};
const dateLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: MYT });
};
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: MYT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const toSen = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

// Standard field. The former inputStyle object relied on `font: inherit`, which
// (applied last) resets the control to the inherited body font — 16px / 400 /
// IBM Plex Sans — overriding the nominal size/weight. These classes reproduce that
// exact rendering. Preflight is off in this project, so borders carry border-solid.
const field = 'block w-full box-border h-10 px-3 py-0 border border-solid border-line rounded-control outline-none bg-card text-ink font-sans text-[16px] font-normal';
const fieldMono = 'block w-full box-border h-10 px-3 py-0 border border-solid border-line rounded-control outline-none bg-card text-ink font-mono text-[16px] font-normal';
const labelClass = 'text-[12px] font-medium text-muted-ink';

export default function ExpensesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/finance/expenses', FALLBACK);
  const toast = useToast();

  // Optimistic overlay: added rows live in `added`, every edit lands in `edits`
  // keyed by id. There is no backend in dev, so the real call is attempted and its
  // failure swallowed — the interaction still lands.
  const [added, setAdded] = useState<Expense[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Expense>>>({});
  const fire = (p: Promise<unknown>) => { void p.catch(notifyFailure); };

  const merged = useMemo(
    () => [...added, ...(data?.data ?? [])].map(e => ({ ...e, ...edits[e.id] })),
    [added, data, edits],
  );

  // Filters — unit, category and period, all client-side over the loaded set so
  // added rows and edits survive a filter change.
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [unit, setUnit] = useState<string>('all');
  const [period, setPeriod] = useState<string>('all');

  const cats = useMemo(() => [...new Set(merged.map(e => e.category))], [merged]);
  const units = useMemo(() => [...new Set(merged.map(e => e.unitNumber))], [merged]);
  const periods = useMemo(() => [...new Set(merged.map(e => periodOf(e.incurredOn)))].sort().reverse(), [merged]);

  const rows = merged.filter(e =>
    (cat === 'all' || e.category === cat) &&
    (unit === 'all' || e.unitNumber === unit) &&
    (period === 'all' || periodOf(e.incurredOn) === period));

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const filtered = cat !== 'all' || unit !== 'all' || period !== 'all';
  const clearFilters = () => { setCat('all'); setUnit('all'); setPeriod('all'); };
  const sentPeriods = useMemo(() => new Set(data?.sentPeriods ?? (import.meta.env.DEV ? [...SENT_PERIODS] : [])), [data]);
  const isLocked = (e: Expense) => e.locked ?? sentPeriods.has(periodOf(e.incurredOn));

  // Modal state
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [reporting, setReporting] = useState(false);

  // ---- Actions -------------------------------------------------------------

  function createExpense(input: Omit<Expense, 'id' | 'chargeTo'>) {
    const optimistic: Expense = { ...input, id: `EXP-${Math.floor(1000 + Math.random() * 9000)}`, chargeTo: 'owner' };
    setAdded(a => [optimistic, ...a]);
    setCreating(false);
    toast({
      tone: 'success', title: 'Expense added.',
      body: `${CAT_LABEL[optimistic.category]} · ${rm(optimistic.amount)} on ${optimistic.propertyName || 'unit'} ${optimistic.unitNumber}.`,
    });
    fire(api.post('/expenses', {
      unitId: optimistic.unitNumber, propertyName: optimistic.propertyName, category: optimistic.category, amount: optimistic.amount,
      incurredOn: optimistic.incurredOn, reference: optimistic.reference, description: optimistic.description,
    }));
  }

  function saveEdit(id: string, delta: Partial<Expense>) {
    setEdits(e => ({ ...e, [id]: { ...e[id], ...delta } }));
    setEditing(null);
    toast({ tone: 'success', title: 'Expense updated.', body: 'The change lands on this period’s statement.' });
    fire(api.patch(`/expenses/${id}`, delta));
  }

  function generateReport(scopeUnit: string, scopePeriod: string) {
    const reportRows = merged.filter(e =>
      (scopeUnit === 'all' || e.unitNumber === scopeUnit) &&
      (scopePeriod === 'all' || periodOf(e.incurredOn) === scopePeriod));
    const sum = reportRows.reduce((s, r) => s + r.amount, 0);
    const unitLabel = scopeUnit === 'all' ? 'All units' : scopeUnit;
    const periodText = scopePeriod === 'all' ? 'All periods' : monthLabel(scopePeriod);
    const generatedAt = new Date().toLocaleString('en-MY', { timeZone: MYT, hour12: false });

    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const header = [
      [q('The Conts — Expenses report')],
      [q('Scope'), q(`${unitLabel} · ${periodText}`)],
      [q('Filters applied'), q(`Unit: ${unitLabel}; Category: ${cat === 'all' ? 'all' : CAT_LABEL[cat]}; Period: ${periodText}`)],
      [q('Generated'), q(`${generatedAt} MYT`)],
      [q('Rows'), q(`${reportRows.length} expenses`)],
      [''],
      ['Expense ID', 'Unit', 'Property', 'Category', 'Date', 'Reference', 'Description', 'Amount (RM)', 'Charge to'].map(q),
    ];
    const body = reportRows.map(e => [
      q(e.id), q(e.unitNumber), q(e.propertyName), q(CAT_LABEL[e.category]), q(e.incurredOn),
      q(e.reference ?? ''), q(e.description), q((e.amount / 100).toFixed(2)), q(CHARGE_LABEL[e.chargeTo] ?? e.chargeTo),
    ]);
    const totalRow = [['', '', '', '', '', '', q('Total'), q((sum / 100).toFixed(2)), ''].join(',')];
    const csv = [...header, ...body].map(r => r.join(',')).concat(totalRow).join('\r\n');

    const namePart = (s: string) => s.replace(/[^0-9A-Za-z]+/g, '').toLowerCase() || 'all';
    downloadCsv(`expenses-${namePart(unitLabel)}-${scopePeriod === 'all' ? 'all' : scopePeriod}.csv`, csv);

    setReporting(false);
    toast({
      tone: 'success', title: 'Report generated.',
      body: `${reportRows.length} ${reportRows.length === 1 ? 'expense' : 'expenses'} · ${rm(sum)} · ${unitLabel} · ${periodText}.`,
    });
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        sub={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · ${rm(total)} in this view`}
        right={
          <div className="flex gap-[9px] flex-wrap">
            <Button variant="secondary" onClick={() => setReporting(true)}>Generate report</Button>
            <Button variant="primary" onClick={() => setCreating(true)}>Add expense</Button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <div className="flex gap-[10px] flex-wrap items-center">
        <div className="flex gap-[7px] flex-wrap">
          {(['all', ...cats] as (Category | 'all')[]).map(c => {
            const on = c === cat;
            return (
              <button key={c} onClick={() => setCat(c)}
                className={cx('h-8 flex items-center px-[13px] py-0 rounded-full cursor-pointer whitespace-nowrap font-sans text-[16px] font-normal border border-solid',
                  on ? 'border-black bg-black text-white' : 'border-line bg-card text-muted-ink')}>
                {c === 'all' ? 'All categories' : CAT_LABEL[c]}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 flex-wrap ml-auto">
          <select aria-label="Filter by unit" value={unit} onChange={e => setUnit(e.target.value)}
            className={cx('block box-border w-auto h-8 pl-3 pr-[30px] py-0 border border-solid border-line rounded-control outline-none bg-card font-sans text-[16px] font-normal', unit === 'all' ? 'text-muted-ink' : 'text-ink')}>
            <option value="all">All units</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select aria-label="Filter by period" value={period} onChange={e => setPeriod(e.target.value)}
            className={cx('block box-border w-auto h-8 pl-3 pr-[30px] py-0 border border-solid border-line rounded-control outline-none bg-card font-sans text-[16px] font-normal', period === 'all' ? 'text-muted-ink' : 'text-ink')}>
            <option value="all">All periods</option>
            {periods.map(p => <option key={p} value={p}>{monthLabel(p)}{sentPeriods.has(p) ? ' · sent' : ''}</option>)}
          </select>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            <div className={cx('grid', COLS_CLASS, 'gap-[14px] py-[9px] px-[22px] bg-muted [border-bottom:1px_solid_var(--color-line,#DEDAD3)] text-[12px] font-semibold text-muted-ink')}>
              <div>Description</div><div>Unit</div><div>Category</div><div>Date</div><div>Reference</div><div className="text-right">Amount</div><div />
            </div>

            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={7} /> : rows.length === 0 ? (
              <div className="py-[28px] px-[22px] flex flex-col gap-2">
                <span className="text-[13px]">No expenses match these filters.</span>
                {filtered && <button onClick={clearFilters} className="self-start font-sans text-[16px] font-normal text-gold-ink bg-transparent border-none cursor-pointer">Clear filters</button>}
              </div>
            ) : rows.map(r => {
              const locked = isLocked(r);
              return (
                <div key={r.id} className={cx('grid', COLS_CLASS, 'gap-[14px] items-center min-h-[52px] py-[9px] px-[22px] [border-bottom:1px_solid_var(--color-line-soft,#EDEAE4)]')}>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13.5px]">{r.description}</span>
                    {r.chargeTo !== 'owner' && <span className="text-[11.5px] text-muted-ink">Charged to {CHARGE_LABEL[r.chargeTo] ?? r.chargeTo}</span>}
                  </div>
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="text-[13px]">{r.unitNumber}</span>
                    <span className="text-[11.5px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{r.propertyName}</span>
                  </div>
                  <div><Badge tone={CAT_TONE[r.category]} label={CAT_LABEL[r.category]} /></div>
                  <div className="flex flex-col gap-px">
                    <span className="text-[12.5px]">{dateLabel(r.incurredOn)}</span>
                    {locked && <span className="text-[11px] text-muted-ink">Statement sent</span>}
                  </div>
                  <div className="font-mono text-[11px] text-muted-ink whitespace-nowrap overflow-hidden text-ellipsis">{r.reference ?? '—'}</div>
                  <div className="text-right text-[13px] font-medium">{rm(r.amount)}</div>
                  <div className="flex justify-end">
                    <button onClick={() => setEditing(r)} title={locked ? `The ${monthLabel(periodOf(r.incurredOn))} statement has been sent, so this expense is locked.` : 'Edit this expense'}
                      className={cx('h-[30px] px-[11px] py-0 rounded-control cursor-pointer font-sans text-[16px] font-normal inline-flex items-center gap-[5px] border border-solid border-line bg-card', locked ? 'text-muted-ink' : 'text-ink')}>
                      {locked ? 'Locked' : 'Edit'}
                    </button>
                  </div>
                </div>
              );
            })}

            {rows.length > 0 && (
              <div className={cx('grid', COLS_CLASS, 'gap-[14px] py-[13px] px-[22px] bg-page text-[13px] font-semibold')}>
                <div className="[grid-column:1/6]">Total</div>
                <div className="text-right">{rm(total)}</div>
                <div />
              </div>
            )}
          </div>
        </div>
      </Card>

      <span className="text-[12px] text-muted-ink">
        Every deduction carries a category, date, amount and reference.
      </span>

      {creating && <ExpenseModal mode="create" onClose={() => setCreating(false)} onSubmit={createExpense} />}
      {editing && (
        <ExpenseModal
          mode="edit"
          expense={editing}
          locked={isLocked(editing)}
          lockReason={`The ${monthLabel(periodOf(editing.incurredOn))} statement has been sent, so this expense can no longer be edited.`}
          onClose={() => setEditing(null)}
          onSave={delta => saveEdit(editing.id, delta)}
        />
      )}
      {reporting && (
        <ReportModal
          units={units}
          periods={periods}
          defaultUnit={unit}
          defaultPeriod={period !== 'all' ? period : (periods[0] ?? 'all')}
          onClose={() => setReporting(false)}
          onGenerate={generateReport}
        />
      )}
    </>
  );
}

// ---- Local modal shell -----------------------------------------------------

function Modal({ title, sub, onClose, footer, children, width = 520 }: {
  title: string; sub?: string; onClose: () => void; footer: ReactNode; children: ReactNode; width?: number;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-h-[90vh] overflow-y-auto bg-card rounded-card [box-shadow:var(--shadow-overlay)] [animation:dialog-in_var(--motion-slow)_var(--ease-out)_both]" style={{ maxWidth: width }}>
        <div className="pt-[22px] px-[22px] pb-[18px] flex flex-col gap-1">
          <h2 className="m-0 text-[18px] leading-[1.3] font-semibold [text-wrap:pretty]">{title}</h2>
          {sub && <p className="m-0 text-[13px] leading-[1.55] text-muted-ink [text-wrap:pretty]">{sub}</p>}
        </div>
        <div className="px-[22px] pb-5 flex flex-col gap-[14px]">{children}</div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line,#DEDAD3)] bg-page flex items-center justify-end gap-[9px] flex-wrap">
          {footer}
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

// ---- Add / edit expense ----------------------------------------------------

function ExpenseModal({ mode, expense, locked, lockReason, onClose, onSubmit, onSave }: {
  mode: 'create' | 'edit';
  expense?: Expense;
  locked?: boolean;
  lockReason?: string;
  onClose: () => void;
  onSubmit?: (e: Omit<Expense, 'id' | 'chargeTo'>) => void;
  onSave?: (delta: Partial<Expense>) => void;
}) {
  const [propertyName, setPropertyName] = useState(expense?.propertyName ?? '');
  const [unitNumber, setUnitNumber] = useState(expense?.unitNumber ?? '');
  const [category, setCategory] = useState<Category>(expense?.category ?? 'internet');
  const [amount, setAmount] = useState(expense ? (expense.amount / 100).toFixed(2) : '');
  const [incurredOn, setIncurredOn] = useState(expense?.incurredOn ?? todayISO());
  const [reference, setReference] = useState(expense?.reference ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');

  const sen = toSen(amount);
  const readOnly = mode === 'edit' && !!locked;
  // Category, date, amount and reference are all mandatory — every deduction must
  // be explainable (api.md validation rules).
  const valid = !readOnly && unitNumber.trim() !== '' && !!sen && sen > 0 && incurredOn !== '' && reference.trim() !== '' && description.trim() !== '';

  // The dialog's category select must always be able to show the current value,
  // even when it came in from a category outside the add-set.
  const catOptions = ADD_CATEGORIES.includes(category) ? ADD_CATEGORIES : [category, ...ADD_CATEGORIES];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !sen) return;
    if (mode === 'create') {
      onSubmit?.({
        propertyName: propertyName.trim(), unitNumber: unitNumber.trim(), category,
        description: description.trim(), amount: sen, incurredOn, reference: reference.trim(),
      });
    } else {
      onSave?.({
        propertyName: propertyName.trim(), unitNumber: unitNumber.trim(), category,
        description: description.trim(), amount: sen, incurredOn, reference: reference.trim(),
      });
    }
  }

  const disabledReason = readOnly ? 'This expense is locked.'
    : !unitNumber.trim() ? 'Add the unit first.'
    : !sen || sen <= 0 ? 'Enter the amount.'
    : !reference.trim() ? 'A reference is required on every expense.'
    : !description.trim() ? 'Add a short description.'
    : 'Complete the required fields.';

  return (
    <Modal
      title={mode === 'create' ? 'Add monthly expense' : 'Edit expense'}
      sub={mode === 'create'
        ? 'Logs a deduction against the unit for the owner statement. Every expense needs a category, date, amount and reference.'
        : `${expense?.propertyName} ${expense?.unitNumber}`}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && (
          <Button size="sm" variant="primary" onClick={submit} disabled={!valid} disabledReason={disabledReason}>
            {mode === 'create' ? 'Add expense' : 'Save changes'}
          </Button>
        )}
      </>}>
      {readOnly && (
        <div className={cx('py-[10px] px-3 rounded-control', TONE.warning.bg, 'text-[var(--color-warning-fg)] text-[12.5px] [text-wrap:pretty]')}>
          {lockReason}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-[14px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
          <LabeledField label="Unit"><input required disabled={readOnly} value={unitNumber} onChange={e => setUnitNumber(e.target.value)} placeholder="#A-12-03" className={field} /></LabeledField>
          <LabeledField label="Property"><input disabled={readOnly} value={propertyName} onChange={e => setPropertyName(e.target.value)} placeholder="Vista Jaya One" className={field} /></LabeledField>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
          <LabeledField label="Category">
            <select disabled={readOnly} value={category} onChange={e => setCategory(e.target.value as Category)} className={field}>
              {catOptions.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </LabeledField>
          <LabeledField label="Amount (RM)">
            <input inputMode="decimal" disabled={readOnly} value={amount} onChange={e => setAmount(e.target.value)} placeholder="185.00"
              className={cx(field, 'text-right tabular-nums')} />
          </LabeledField>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
          <LabeledField label="Date"><input type="date" required disabled={readOnly} value={incurredOn} onChange={e => setIncurredOn(e.target.value)} className={field} /></LabeledField>
          <LabeledField label="Reference"><input required disabled={readOnly} value={reference} onChange={e => setReference(e.target.value)} placeholder="INV-2026-0912" className={fieldMono} /></LabeledField>
        </div>
        <LabeledField label="Description">
          <textarea disabled={readOnly} value={description} onChange={e => setDescription(e.target.value)} placeholder="Internet, September" rows={2}
            className="block w-full box-border px-3 py-[10px] border border-solid border-line rounded-control outline-none bg-card text-ink font-sans text-[16px] font-normal h-auto resize-y leading-[1.5]" />
        </LabeledField>
      </form>
    </Modal>
  );
}

// ---- Generate report -------------------------------------------------------

function ReportModal({ units, periods, defaultUnit, defaultPeriod, onClose, onGenerate }: {
  units: string[]; periods: string[]; defaultUnit: string; defaultPeriod: string;
  onClose: () => void; onGenerate: (unit: string, period: string) => void;
}) {
  const [unit, setUnit] = useState(defaultUnit);
  const [period, setPeriod] = useState(defaultPeriod);
  const unitLabel = unit === 'all' ? 'All units' : unit;
  const periodText = period === 'all' ? 'All periods' : monthLabel(period);

  return (
    <Modal title="Generate expenses report" sub="Per unit, per month. Exports a CSV whose header prints the applied filters, the generated time and the data scope." onClose={onClose} width={480}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => onGenerate(unit, period)}>Generate report</Button>
      </>}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[14px]">
        <LabeledField label="Unit">
          <select value={unit} onChange={e => setUnit(e.target.value)} className={field}>
            <option value="all">All units</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="Period">
          <select value={period} onChange={e => setPeriod(e.target.value)} className={field}>
            <option value="all">All periods</option>
            {periods.map(p => <option key={p} value={p}>{monthLabel(p)}</option>)}
          </select>
        </LabeledField>
      </div>
      <div className="py-[10px] px-3 rounded-control bg-page border border-solid border-line text-[12.5px] text-muted-ink">
        Scope: {unitLabel} · {periodText}
      </div>
    </Modal>
  );
}

// ---- CSV download ----------------------------------------------------------

function downloadCsv(name: string, text: string) {
  try {
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (e) { notifyFailure(e); }
}
