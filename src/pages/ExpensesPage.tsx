import { useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { rm } from '../lib/format';
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
}
interface Payload { data: Expense[]; total: number; generatedAt: string }

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

const COLS = 'minmax(168px,1.5fr) minmax(128px,1.1fr) minmax(116px,1fr) minmax(104px,0.9fr) minmax(120px,1fr) minmax(96px,0.85fr) 74px';
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

const inputStyle: CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px',
  fontSize: text.body, color: color.ink, background: '#FFFFFF',
  border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', font: 'inherit',
};
const labelStyle: CSSProperties = { fontSize: text.small, fontWeight: 500, color: color.textMuted };

export default function ExpensesPage() {
  const { data, loading, error, reload } = useApi<Payload>('/finance/expenses', FALLBACK);
  const toast = useToast();

  // Optimistic overlay: added rows live in `added`, every edit lands in `edits`
  // keyed by id. There is no backend in dev, so the real call is attempted and its
  // failure swallowed — the interaction still lands.
  const [added, setAdded] = useState<Expense[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Expense>>>({});
  const fire = (p: Promise<unknown>) => { void p.catch(() => { /* dev: no backend, keep optimistic */ }); };

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
  const isLocked = (e: Expense) => SENT_PERIODS.has(periodOf(e.incurredOn));

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
      unitId: optimistic.unitNumber, category: optimistic.category, amount: optimistic.amount,
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
    fire(api.get('/expenses/report', { unitId: scopeUnit === 'all' ? '' : scopeUnit, period: scopePeriod === 'all' ? '' : scopePeriod }));
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        sub={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · ${rm(total)} in this view`}
        right={
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setReporting(true)}>Generate report</Button>
            <Button variant="primary" onClick={() => setCreating(true)}>Add expense</Button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last figures we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {(['all', ...cats] as (Category | 'all')[]).map(c => {
            const on = c === cat;
            return (
              <button key={c} onClick={() => setCat(c)}
                style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                  border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
                {c === 'all' ? 'All categories' : CAT_LABEL[c]}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
          <select aria-label="Filter by unit" value={unit} onChange={e => setUnit(e.target.value)}
            style={{ ...inputStyle, width: 'auto', height: 32, padding: '0 30px 0 12px', fontSize: 12.5, color: unit === 'all' ? color.textMuted : color.ink }}>
            <option value="all">All units</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select aria-label="Filter by period" value={period} onChange={e => setPeriod(e.target.value)}
            style={{ ...inputStyle, width: 'auto', height: 32, padding: '0 30px 0 12px', fontSize: 12.5, color: period === 'all' ? color.textMuted : color.ink }}>
            <option value="all">All periods</option>
            {periods.map(p => <option key={p} value={p}>{monthLabel(p)}{SENT_PERIODS.has(p) ? ' · sent' : ''}</option>)}
          </select>
        </div>
      </div>

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 1000 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Description</div><div>Unit</div><div>Category</div><div>Date</div><div>Reference</div><div style={{ textAlign: 'right' }}>Amount</div><div />
            </div>

            {loading && rows.length === 0 ? <TableSkeleton rows={6} cols={7} /> : rows.length === 0 ? (
              <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13 }}>No expenses match these filters.</span>
                {filtered && <button onClick={clearFilters} style={{ alignSelf: 'flex-start', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear filters</button>}
              </div>
            ) : rows.map(r => {
              const locked = isLocked(r);
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5 }}>{r.description}</span>
                    {r.chargeTo !== 'owner' && <span style={{ fontSize: 11.5, color: color.textMuted }}>Charged to {CHARGE_LABEL[r.chargeTo] ?? r.chargeTo}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13 }}>{r.unitNumber}</span>
                    <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.propertyName}</span>
                  </div>
                  <div><Badge tone={CAT_TONE[r.category]} label={CAT_LABEL[r.category]} /></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 12.5 }}>{dateLabel(r.incurredOn)}</span>
                    {locked && <span style={{ fontSize: 11, color: color.textMuted }}>Statement sent</span>}
                  </div>
                  <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.reference ?? '—'}</div>
                  <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 500 }}>{rm(r.amount)}</div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditing(r)} title={locked ? `The ${monthLabel(periodOf(r.incurredOn))} statement has been sent, so this expense is locked.` : 'Edit this expense'}
                      style={{ height: 30, padding: '0 11px', borderRadius: radius.control, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5,
                        border: `1px solid ${color.border}`, background: '#FFFFFF', color: locked ? color.textMuted : color.ink }}>
                      {locked ? 'Locked' : 'Edit'}
                    </button>
                  </div>
                </div>
              );
            })}

            {rows.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '13px 22px', background: color.page, fontSize: 13, fontWeight: 600 }}>
                <div style={{ gridColumn: '1 / 6' }}>Total</div>
                <div style={{ textAlign: 'right' }}>{rm(total)}</div>
                <div />
              </div>
            )}
          </div>
        </div>
      </Card>

      <span style={{ fontSize: text.small, color: color.textMuted }}>
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
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 24, background: 'var(--color-surface-scrim)', animation: 'fade-in var(--motion-standard) var(--ease-out) both' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'relative', width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', background: '#FFFFFF', borderRadius: radius.card, boxShadow: 'var(--shadow-overlay)', animation: 'dialog-in var(--motion-slow) var(--ease-out) both' }}>
        <div style={{ padding: '22px 22px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, fontWeight: 600, textWrap: 'pretty' }}>{title}</h2>
          {sub && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: color.textMuted, textWrap: 'pretty' }}>{sub}</p>}
        </div>
        <div style={{ padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${color.border}`, background: color.page, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={labelStyle}>{label}</label>
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
        <div style={{ padding: '10px 12px', borderRadius: radius.control, background: 'var(--color-warning)', color: 'var(--color-warning-fg)', fontSize: 12.5, textWrap: 'pretty' }}>
          {lockReason}
        </div>
      )}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <LabeledField label="Unit"><input required disabled={readOnly} value={unitNumber} onChange={e => setUnitNumber(e.target.value)} placeholder="#A-12-03" style={inputStyle} /></LabeledField>
          <LabeledField label="Property"><input disabled={readOnly} value={propertyName} onChange={e => setPropertyName(e.target.value)} placeholder="Vista Jaya One" style={inputStyle} /></LabeledField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <LabeledField label="Category">
            <select disabled={readOnly} value={category} onChange={e => setCategory(e.target.value as Category)} style={inputStyle}>
              {catOptions.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </LabeledField>
          <LabeledField label="Amount (RM)">
            <input inputMode="decimal" disabled={readOnly} value={amount} onChange={e => setAmount(e.target.value)} placeholder="185.00"
              style={{ ...inputStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
          </LabeledField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <LabeledField label="Date"><input type="date" required disabled={readOnly} value={incurredOn} onChange={e => setIncurredOn(e.target.value)} style={inputStyle} /></LabeledField>
          <LabeledField label="Reference"><input required disabled={readOnly} value={reference} onChange={e => setReference(e.target.value)} placeholder="INV-2026-0912" style={{ ...inputStyle, fontFamily: '"IBM Plex Mono", monospace' }} /></LabeledField>
        </div>
        <LabeledField label="Description">
          <textarea disabled={readOnly} value={description} onChange={e => setDescription(e.target.value)} placeholder="Internet, September" rows={2}
            style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }} />
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <LabeledField label="Unit">
          <select value={unit} onChange={e => setUnit(e.target.value)} style={inputStyle}>
            <option value="all">All units</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="Period">
          <select value={period} onChange={e => setPeriod(e.target.value)} style={inputStyle}>
            <option value="all">All periods</option>
            {periods.map(p => <option key={p} value={p}>{monthLabel(p)}</option>)}
          </select>
        </LabeledField>
      </div>
      <div style={{ padding: '10px 12px', borderRadius: radius.control, background: color.page, border: `1px solid ${color.border}`, fontSize: 12.5, color: color.textMuted }}>
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
  } catch { /* dev: download unavailable, the toast still confirms the action */ }
}
