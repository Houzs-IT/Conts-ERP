import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { MoneyInput, DateField } from '../components/inputs';
import { StaleBanner } from '../components/DataState';
import { Skeleton } from '../components/States';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, errorMessage } from '../lib/api';
import { cx } from '../lib/design-tokens';
import { amount, date as dayText, plural } from '../lib/format';
import { INPUT } from '../components/ops/OpsUi';
import { LabeledField } from './MaintenanceCatalog';

/* GET/POST /api/housekeeping/clean-prices (functions/api/housekeeping/clean-prices.ts). Amounts in sen; null = not set. */
interface Figures { owner: number | null; guest: number | null; cost: number | null }
interface Row { key: string; label: string; basic: Figures; deep: Figures }
interface OwnUnit { unitId: string; unitNumber: string; propertyName: string; beds: number; basic: Figures; deep: Figures }
interface Payload {
  ready: boolean; byCount: boolean; guestPrices?: boolean; mayEdit?: boolean; today?: string; since?: string | null;
  rows?: Row[]; next?: { effectiveFrom: string; rows: Row[] } | null; own?: OwnUnit[];
}

const SIDES = [['basic', 'Basic clean'], ['deep', 'Deep clean']] as const;
type Side = (typeof SIDES)[number][0];
type Field = keyof Figures;
const FIELD_LABEL: Record<Field, string> = { owner: 'Owner', guest: 'Guest', cost: 'Cleaner pay' };

const CELL = 'py-2 px-2 [border-top:1px_solid_var(--color-line-soft)]';
const GROUP = '[border-left:1px_solid_var(--color-line)]';
const figure = (v: number | null) => (v == null ? <span className="text-muted-ink">—</span> : amount(v));

/** Cleaning > Prices, when cleaning is priced by number of beds (chew, 10 Nov 2026): one table, a row per number of
 *  beds, Basic clean and Deep clean side by side, each with what the owner is charged, what a guest is charged and the
 *  cleaner's pay; then the units with their own prices. Management changes it from a date. */
export function CleaningPriceTable({ onSaved }: { onSaved: () => void }) {
  const q = useApi<Payload>('/housekeeping/clean-prices');
  const [editing, setEditing] = useState(false);
  const d = q.data;
  if (q.loading && !d) return <Skeleton height={260} />;
  if (q.error && !d) return <StaleBanner message={q.error} onRetry={q.reload} />;
  if (!d?.byCount || !d.rows) return null;
  const fields: Field[] = d.guestPrices ? ['owner', 'guest', 'cost'] : ['owner', 'cost'];
  return (
    <section className="bg-card rounded-card border border-solid border-line p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <h2 className="m-0 text-heading font-semibold">Cleaning prices by number of beds (RM)</h2>
          <p className="m-0 text-meta text-muted-ink">
            {d.since ? `In force since ${dayText(d.since)}. ` : ''}King, Queen and Single beds count; floor mattresses and sofa beds do not. A unit's own prices, below, win over the table.
          </p>
          {d.next && <p className="m-0 mt-1 text-meta text-gold-ink">New prices from {dayText(d.next.effectiveFrom)}.</p>}
          {!d.guestPrices && <p className="m-0 mt-1 text-meta text-muted-ink">The guest's charge shows once its database update (migration 0257) is applied.</p>}
        </div>
        {d.mayEdit && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Change prices</Button>}
      </div>
      {editing && d.today
        ? <TableEditor rows={d.rows} fields={fields} today={d.today} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); q.reload(); onSaved(); }} />
        : <PriceGrid fields={fields} first="Beds" rows={d.rows.map(r => ({ key: r.key, label: r.label, basic: r.basic, deep: r.deep }))} />}
      <div className="flex flex-col gap-1.5 mt-1">
        <h3 className="m-0 text-copy font-semibold">Units with their own price</h3>
        {d.own && d.own.length > 0
          ? <PriceGrid fields={fields} first="Unit" rows={d.own.map(u => ({ key: u.unitId, label: <span className="flex flex-col"><span><b>{u.unitNumber}</b> <span className="text-muted-ink">{u.propertyName}</span></span><span className="text-meta text-muted-ink">{plural(u.beds, 'bed')}</span></span>, basic: u.basic, deep: u.deep }))} />
          : <span className="text-meta text-muted-ink">No unit has its own price. Set one under Per unit.</span>}
      </div>
    </section>
  );
}

/** The table: Basic clean and Deep clean as column groups, each split into owner, guest and cleaner pay. */
function PriceGrid({ fields, first, rows, cell }: {
  fields: Field[]; first: string; rows: { key: string; label: ReactNode; basic: Figures; deep: Figures }[];
  cell?: (key: string, side: Side, field: Field) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      {/* Fixed columns, so the table and the units below it line up column for column. */}
      <table className="w-full min-w-[640px] table-fixed border-collapse text-copy tabular-nums">
        <colgroup><col className="w-[24%]" />{SIDES.map(([side]) => fields.map(f => <col key={`${side}:${f}`} />))}</colgroup>
        <thead>
          <tr>
            <th rowSpan={2} scope="col" className="text-left align-bottom pb-1.5 pr-2 text-meta font-semibold text-muted-ink">{first}</th>
            {SIDES.map(([side, title]) => (
              <th key={side} colSpan={fields.length} scope="colgroup" className={cx('text-center pb-1 text-copy font-semibold', GROUP)}>{title}</th>
            ))}
          </tr>
          <tr>
            {SIDES.map(([side]) => fields.map((f, n) => (
              <th key={`${side}:${f}`} scope="col" className={cx('text-right pb-1.5 px-2 text-meta font-semibold text-muted-ink', n === 0 && GROUP)}>{FIELD_LABEL[f]}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <th scope="row" className={cx(CELL, 'text-left font-normal pl-0')}>{r.label}</th>
              {SIDES.map(([side]) => fields.map((f, n) => (
                <td key={`${side}:${f}`} className={cx(CELL, 'text-right', n === 0 && GROUP)}>{cell ? cell(r.key, side, f) : figure(r[side][f])}</td>
              )))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableEditor({ rows, fields, today, onClose, onSaved }: { rows: Row[]; fields: Field[]; today: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const start = useMemo(() => Object.fromEntries(rows.map(r => [r.key, { basic: { ...r.basic }, deep: { ...r.deep } }])), [rows]);
  const [grid, setGrid] = useState<Record<string, { basic: Figures; deep: Figures }>>(start);
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = rows.filter(r => SIDES.some(([side]) => fields.some(f => grid[r.key][side][f] !== start[r.key][side][f])));
  const set = (key: string, side: Side, field: Field, v: number | null) =>
    setGrid(g => ({ ...g, [key]: { ...g[key], [side]: { ...g[key][side], [field]: v } } }));
  async function save() {
    setBusy(true);
    try {
      await api.post('/housekeeping/clean-prices', { effectiveFrom: from, note: note.trim() || undefined, rows: changed.map(r => ({ layout: r.key, ...grid[r.key] })) });
      toast({ tone: 'success', title: from > today ? `New prices from ${dayText(from)}.` : 'Prices saved.' });
      onSaved();
    } catch (e) { toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') }); setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-3">
      <PriceGrid fields={fields} first="Beds" rows={rows.map(r => ({ key: r.key, label: r.label, basic: r.basic, deep: r.deep }))}
        cell={(key, side, field) => (
          <MoneyInput className={cx(INPUT, 'text-right min-w-[84px]')} valueSen={grid[key][side][field]} onChangeSen={v => set(key, side, field, v)} placeholder="Not set"
            aria-label={`${rows.find(r => r.key === key)?.label ?? key}, ${side === 'basic' ? 'Basic' : 'Deep'} clean, ${FIELD_LABEL[field]}`} />
        )} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <DateField label="Applies from" value={from} onChange={setFrom} />
        <LabeledField label="Note (optional)"><input className={INPUT} value={note} onChange={e => setNote(e.target.value)} placeholder="New cleaner rates" maxLength={300} /></LabeledField>
      </div>
      <span className="text-meta text-muted-ink">The new prices apply to cleaning jobs on or after the date. Cleaning jobs before it, and every finished one, keep the prices they had. An empty box is not set.</span>
      {from < today && <span className="text-meta text-warning">A date in the past also reprices cleaning jobs on those days that are not finished yet.</span>}
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!changed.length || !from} disabledReason={!from ? 'Pick the date.' : 'Change a price first.'} onClick={() => void save()}>
          {from > today ? `Schedule from ${dayText(from)}` : 'Save prices'}
        </Button>
      </div>
    </div>
  );
}
