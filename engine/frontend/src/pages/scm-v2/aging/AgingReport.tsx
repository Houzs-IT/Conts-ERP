// ----------------------------------------------------------------------------
// AgingReport — Reports › AR aging / AP aging, the formal debtor and creditor
// aging from the books (ported from Houzs pages/scm-v2/AgingReport.tsx on
// 21 Nov 2026, drawn with the Conts Accounting page's own parts). As at any day;
// one row per customer or supplier; columns by the bill's month — This month ·
// 1 · 2 · 3 · 4 months + — or by days, or by due date; money not tied to a bill
// in Unapplied (未冲); a row opens its bills and its unapplied money; the rows
// add up to the control accounts and the foot says so. Conts: every customer
// (SDC) or supplier (SCC) control, or one; one department; the OPENING journal
// shown by the opening documents it stands for.
// ----------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  AGING_COLUMN_LABELS, useAging,
  type AgingBasis, type AgingBuckets, type AgingReportData, type AgingRow, type AgingSide,
} from '../../../vendor/scm/lib/aging-queries';
import { DateField } from '../../../vendor/scm/components/DateField';
import { todayMyt } from '../../../vendor/scm/lib/dates';
import { fmtDate, fmtDateOrDash, fmtSenPlain } from '../../../vendor/shared/format';
import { DataTable, type Column } from '../../../components/DataTable';
import { DepartmentSelect, type Department } from '../../../conts/department';
import styles from '../Suppliers.module.css';
import {
  OVERDUE_BUCKET, UNAPPLIED_LABEL, agingInvoiceLines, agingPartyCounts, bucketLabel, linesIn, partiesIn, soOfGroup,
  type AgingInvoiceLine, type AgingPick, type BucketTone,
} from './agingViews';

const SIDE: Record<AgingSide, { title: string; party: string; parties: string; kind: 'debtor' | 'creditor' }> = {
  ar: { title: 'AR aging', party: 'Customer', parties: 'customers', kind: 'debtor' },
  ap: { title: 'AP aging', party: 'Supplier', parties: 'suppliers', kind: 'creditor' },
};

const INK_GOOD = 'var(--c-secondary-a, #2F5D4F)';
const INK_BAD = 'var(--c-festive-b, #B8331F)';
const TONE: Record<BucketTone | 'brass', { bg: string; fg: string }> = {
  calm: { bg: 'rgba(47, 93, 79, 0.12)', fg: INK_GOOD },
  info: { bg: 'rgba(232, 107, 58, 0.10)', fg: 'var(--c-orange)' },
  warn: { bg: 'rgba(232, 107, 58, 0.18)', fg: 'var(--c-orange)' },
  late: { bg: 'rgba(184, 51, 31, 0.14)', fg: INK_BAD },
  brass: { bg: 'rgba(34, 31, 32, 0.06)', fg: 'var(--c-ink)' },
};
/* The five columns, the older the warmer. */
const COLUMN_TONES: BucketTone[] = ['calm', 'info', 'warn', 'late', 'late'];

/** A figure as the statements print it: 1,234.56, a negative in brackets, nothing as a dash. */
const money = (sen: number): string => (sen === 0 ? '—' : fmtSenPlain(sen));
const sumOf = <T,>(rows: readonly T[], sen: (r: T) => number): number => rows.reduce((n, r) => n + sen(r), 0);
const daysText = (days: number | null): string => (days != null && days > 0 ? String(days) : '—');
const partyLabel = (code: string | null, name: string): string => (code && code !== name ? `${code} · ${name}` : name);

const selectStyle: CSSProperties = { padding: '4px 8px', fontSize: 'var(--fs-13)' };

function Pill({ tone, children }: { tone: BucketTone | 'brass'; children: React.ReactNode }) {
  const c = TONE[tone];
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.fg, fontSize: 'var(--fs-12)', fontWeight: 700 }}>
      {children}
    </span>
  );
}

function Tile({ label, value, sub, on, tone, onClick }: { label: string; value: string; sub: string; on: boolean; tone?: BucketTone | 'brass'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      textAlign: 'left', cursor: 'pointer',
      padding: 'var(--space-3) var(--space-4)', background: 'var(--c-cream)',
      border: `${on ? 2 : 1}px solid ${on ? 'var(--c-orange)' : 'var(--c-line, rgba(34,31,32,0.08))'}`,
      borderRadius: 'var(--radius-md)',
    }}>
      <div className={styles.subtitle} style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
        {tone && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: TONE[tone].fg }} />}
        {label}
      </div>
      <div style={{ fontSize: 'var(--fs-16)', fontWeight: 800, color: 'var(--c-ink)' }}>{value}</div>
      <div style={{ fontSize: 'var(--fs-12)', color: 'var(--c-muted, #6b6b6b)' }}>{sub}</div>
    </button>
  );
}

/** A bill's number: on AR, the order it belongs to opens. */
function BillNo({ side, docNo, so }: { side: AgingSide; docNo: string; so: string | null }) {
  return side === 'ar' && so
    ? <Link to={`/scm/sales-orders/${encodeURIComponent(so)}`} onClick={(e) => e.stopPropagation()} className={styles.codeChip}>{docNo}</Link>
    : <span className={styles.codeChip}>{docNo}</span>;
}

/** A party: its code (opening its ledger as at the day) and its name. */
function PartyCell({ side, row, asOf }: { side: AgingSide; row: Pick<AgingRow, 'code' | 'name'>; asOf: string }) {
  const ledger = row.code ? `/scm/party-ledger?kind=${SIDE[side].kind}&code=${encodeURIComponent(row.code)}&to=${asOf}` : null;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
      {row.code && row.code !== row.name && (
        ledger
          ? <Link to={ledger} onClick={(e) => e.stopPropagation()} style={{ fontSize: 'var(--fs-12)', color: 'var(--c-orange)' }}>{row.code}</Link>
          : <span style={{ fontSize: 'var(--fs-12)' }}>{row.code}</span>
      )}
      <span>{row.name}</span>
    </span>
  );
}

const cell: CSSProperties = { padding: '4px 10px', borderBottom: '1px solid var(--c-line, rgba(34,31,32,0.08))', fontSize: 'var(--fs-13)' };
const num: CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/** A party's bills and its unapplied money, under its row. */
function PartyBills({ side, row, labels }: { side: AgingSide; row: AgingRow; labels: readonly string[] }) {
  return (
    <table style={{ width: '100%', maxWidth: 920, borderCollapse: 'collapse', margin: '2px 0 6px' }} aria-label={`${row.name}'s bills`}>
      <thead>
        <tr>
          {['Bill', 'Kind', 'Date', 'Due'].map((h) => <th key={h} style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>{h}</th>)}
          <th style={{ ...num, fontWeight: 600 }}>Amount</th><th style={{ ...num, fontWeight: 600 }}>Outstanding</th>
          <th style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>Column</th>
        </tr>
      </thead>
      <tbody>
        {row.items.map((i, n) => (
          <tr key={`b${n}`}>
            <td style={cell}><BillNo side={side} docNo={i.docNo} so={soOfGroup(i.group)} /></td>
            <td style={cell}>{i.kind}</td>
            <td style={cell}>{fmtDate(i.date)}</td>
            <td style={cell}>{fmtDateOrDash(i.dueDate)}</td>
            <td style={num}>{fmtSenPlain(i.amountSen)}</td>
            <td style={{ ...num, fontWeight: 700 }}>{fmtSenPlain(i.openSen)}</td>
            <td style={cell}>{labels[i.column]}</td>
          </tr>
        ))}
        {row.unapplied.map((u, n) => (
          <tr key={`u${n}`}>
            <td style={cell}><span className={styles.codeChip}>{u.docNo}</span></td>
            <td style={cell}>{u.kind}</td>
            <td style={cell}>{fmtDate(u.date)}</td>
            <td style={cell}>—</td>
            <td style={num} />
            <td style={num}>{fmtSenPlain(u.amountSen)}</td>
            <td style={cell}><Pill tone="brass">{UNAPPLIED_LABEL}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The foot: the books' figure beside the report's, the opening split, and what is not in the books. */
export function agingNotes(side: AgingSide, d: AgingReportData): string[] {
  const books = d.controls.reduce((n, k) => n + k.balanceSen, 0);
  const notes = [
    `In the books (${d.controls.map((k) => k.code).join(' + ') || 'no control'}) as at ${fmtDateOrDash(d.asOf)}: ${fmtSenPlain(books)} · difference ${fmtSenPlain(d.differenceSen)}.`,
  ];
  if (d.opening.unsplitSen !== 0) {
    notes.push(`${fmtSenPlain(d.opening.unsplitSen)} of the opening balance is not explained by the opening ${side === 'ar' ? 'invoices and credits' : 'bills and advances'}: it is one line, “Opening balance not split”.`);
  }
  if (d.outside.count > 0) {
    notes.push(`${d.outside.count} migrated ${side === 'ar' ? 'customer' : 'supplier'} invoice(s) are open for ${fmtSenPlain(d.outside.sen)} — they were never booked in this ledger, so they are not in this aging.`);
  }
  return notes;
}

type View = 'party' | 'invoice';

export const AgingReport = ({ side }: { side: AgingSide }) => {
  const words = SIDE[side];
  const [asOf, setAsOf] = useState(() => todayMyt());
  const [basis, setBasis] = useState<AgingBasis>('invoice');
  const [buckets, setBuckets] = useState<AgingBuckets>('month');
  const [control, setControl] = useState('all');
  const [department, setDepartment] = useState<Department | ''>('');
  const [view, setView] = useState<View>('party');
  const [find, setFind] = useState('');
  const [pick, setPick] = useState<AgingPick>(null);
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set());
  const q = useAging(side, { asOf, basis, buckets, control, department });
  const d = q.data;
  const labels = AGING_COLUMN_LABELS[buckets];
  const party = words.party.toLowerCase();

  const found = useMemo(() => {
    const all = d?.rows ?? [];
    const needle = find.trim().toLowerCase();
    return needle ? all.filter((row) => `${row.code ?? ''} ${row.name}`.toLowerCase().includes(needle)) : all;
  }, [d, find]);
  const parties = useMemo(() => partiesIn(found, pick), [found, pick]);
  const lines = useMemo(() => (d ? linesIn(agingInvoiceLines(found, d.asOf), pick) : []), [d, found, pick]);
  const counts = useMemo(() => agingPartyCounts(d?.rows ?? [], labels.length), [d, labels.length]);
  const count = (n: number) => `${n} ${n === 1 ? party : words.parties}`;
  const pickTile = (p: AgingPick) => setPick((now) => (now === p ? null : p));
  const pickName = pick === null ? '' : pick === 'unapplied' ? UNAPPLIED_LABEL : labels[pick];
  const allOpen = parties.length > 0 && parties.every((row) => openRows.has(row.key));

  const toggle = (key: string) => setOpenRows((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const empty = !d ? ''
    : d.rows.length === 0 ? `Nothing owed on these accounts as at ${fmtDate(d.asOf)}.`
      : found.length === 0 ? `No ${party} matches “${find.trim()}”.`
        : view === 'party' ? `No ${party} with money in ${pickName}.` : `No line in ${pickName}.`;

  const partyColumns = useMemo((): Column<AgingRow>[] => [
    {
      key: 'party', label: words.party, alwaysVisible: true,
      getValue: (row) => partyLabel(row.code, row.name), sortValue: (row) => row.name.toLowerCase(),
      render: (row) => <PartyCell side={side} row={row} asOf={asOf} />,
    },
    {
      key: 'balance', label: 'Balance', align: 'right',
      getValue: (row) => row.balanceSen / 100, exportValue: (row) => row.balanceSen / 100, exportFormat: 'money',
      render: (row) => <span style={{ fontWeight: 700 }}>{money(row.balanceSen)}</span>,
      total: (rows) => fmtSenPlain(sumOf(rows, (row) => row.balanceSen)),
    },
    ...labels.map((label, c): Column<AgingRow> => ({
      key: `c${c}`, label, align: 'right',
      getValue: (row) => row.cells[c] / 100, exportValue: (row) => row.cells[c] / 100, exportFormat: 'money',
      render: (row) => money(row.cells[c]),
      total: (rows) => fmtSenPlain(sumOf(rows, (row) => row.cells[c])),
    })),
    {
      key: 'unapplied', label: UNAPPLIED_LABEL, align: 'right',
      description: 'Money not tied to a bill — a deposit, an advance, a credit note not knocked off',
      getValue: (row) => row.unappliedSen / 100, exportValue: (row) => row.unappliedSen / 100, exportFormat: 'money',
      render: (row) => money(row.unappliedSen),
      total: (rows) => fmtSenPlain(sumOf(rows, (row) => row.unappliedSen)),
    },
  ], [labels, words.party, side, asOf]);

  const invoiceColumns = useMemo((): Column<AgingInvoiceLine>[] => [
    { key: 'doc', label: 'Bill', alwaysVisible: true, getValue: (l) => l.docNo, render: (l) => <BillNo side={side} docNo={l.docNo} so={l.so} /> },
    { key: 'kind', label: 'Kind', getValue: (l) => l.kind, render: (l) => l.kind },
    { key: 'party', label: words.party, getValue: (l) => l.partyName, render: (l) => l.partyName },
    { key: 'code', label: `${words.party} code`, getValue: (l) => l.partyCode ?? '', render: (l) => l.partyCode ?? '—' },
    { key: 'date', label: 'Date', getValue: (l) => l.date, render: (l) => fmtDate(l.date) },
    { key: 'due', label: 'Due', getValue: (l) => l.dueDate ?? '', render: (l) => fmtDateOrDash(l.dueDate) },
    {
      key: 'outstanding', label: 'Outstanding', align: 'right',
      getValue: (l) => l.outstandingSen / 100, exportValue: (l) => l.outstandingSen / 100, exportFormat: 'money',
      render: (l) => <span style={{ fontWeight: l.bucket === 'unapplied' ? 400 : 700 }}>{fmtSenPlain(l.outstandingSen)}</span>,
      total: (ls) => fmtSenPlain(sumOf(ls, (l) => l.outstandingSen)),
    },
    {
      key: 'days', label: 'Days overdue', align: 'right', getValue: (l) => l.daysOverdue,
      render: (l) => <span style={{ color: (l.daysOverdue ?? 0) > 60 ? INK_BAD : undefined }}>{daysText(l.daysOverdue)}</span>,
    },
    {
      key: 'age', label: 'Age', getValue: (l) => bucketLabel(l.bucket),
      render: (l) => <Pill tone={l.bucket === 'unapplied' ? 'brass' : OVERDUE_BUCKET[l.bucket].tone}>{bucketLabel(l.bucket)}</Pill>,
    },
  ], [side, words.party]);

  const accounts = d?.accounts ?? [];
  const hasOther = accounts.some((a) => a.other);

  return (
    <div className="space-y-3">
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={styles.subtitle}>As at</span>
        <DateField value={asOf} onChange={(v) => setAsOf(v || todayMyt())} aria-label={`${words.title} as at`} />
        <select aria-label="Age by" value={basis} onChange={(e) => setBasis(e.target.value as AgingBasis)} style={selectStyle}>
          <option value="invoice">Age by bill date</option>
          <option value="due">Age by due date</option>
        </select>
        <select aria-label="Columns" value={buckets} onChange={(e) => setBuckets(e.target.value as AgingBuckets)} style={selectStyle}>
          <option value="month">Columns by month</option>
          <option value="day">Columns by days</option>
        </select>
        <select aria-label="Accounts" value={control} onChange={(e) => setControl(e.target.value)} style={selectStyle}>
          <option value="all">All {side === 'ar' ? 'customer' : 'supplier'} controls</option>
          {hasOther && <option value="trade">All but {side === 'ar' ? 'Other Debtors' : 'Other Creditors'}</option>}
          {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
        </select>
        <DepartmentSelect label={`${words.title} department`} blank="All departments" value={department} onChange={setDepartment} style={selectStyle} />
        <select aria-label="View" value={view} onChange={(e) => setView(e.target.value as View)} style={selectStyle}>
          <option value="party">By {party}</option>
          <option value="invoice">By bill</option>
        </select>
        {view === 'party' && (
          <button type="button" style={selectStyle}
            onClick={() => setOpenRows(allOpen ? new Set() : new Set(parties.map((row) => row.key)))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find a ${party}`} aria-label={`Find a ${party}`} style={{ ...selectStyle, width: 200 }} />
      </div>

      {q.isError ? (
        <div role="alert" style={{
          padding: 'var(--space-3) var(--space-4)', background: 'rgba(184, 51, 31, 0.10)', border: `1px solid ${INK_BAD}`,
          borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-13)', color: INK_BAD,
        }}>
          <strong>The aging did not load, so this report is not a statement about the books.</strong>{' '}
          {q.error instanceof Error ? q.error.message : 'Please try again.'}
        </div>
      ) : (
        <>
          <section aria-label={`${words.title} figures`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
            {labels.map((label, i) => (
              <Tile key={label} label={label} tone={COLUMN_TONES[i]} value={d ? fmtSenPlain(d.totals.cells[i]) : '—'} sub={count(counts.cells[i])}
                on={pick === i} onClick={() => pickTile(i)} />
            ))}
            <Tile label={UNAPPLIED_LABEL} tone="brass" value={d ? fmtSenPlain(d.totals.unappliedSen) : '—'} sub={count(counts.unapplied)}
              on={pick === 'unapplied'} onClick={() => pickTile('unapplied')} />
            <Tile label="Total" value={d ? fmtSenPlain(d.totals.balanceSen) : '—'} sub={count(counts.all)} on={pick === null} onClick={() => setPick(null)} />
          </section>

          {view === 'party' ? (
            <DataTable<AgingRow>
              tableId={`accounting-${side}-aging-parties`}
              columns={partyColumns}
              rows={d ? parties : null}
              loading={!d}
              getRowKey={(row) => row.key}
              emptyLabel={empty}
              onRowClick={(row) => toggle(row.key)}
              expandable={{
                render: (row) => <PartyBills side={side} row={row} labels={labels} />,
                rowKey: (row) => row.key, expandedIds: openRows, onExpandedChange: setOpenRows,
              }}
              exportName={`${side}-aging-${asOf}`}
              exportXlsx
            />
          ) : (
            <DataTable<AgingInvoiceLine>
              tableId={`accounting-${side}-aging-bills`}
              columns={invoiceColumns}
              rows={d ? lines : null}
              loading={!d}
              getRowKey={(l) => l.key}
              emptyLabel={empty}
              exportName={`${side}-aging-by-bill-${asOf}`}
              exportXlsx
            />
          )}
          {d && (
            <ul aria-label="Aging notes" style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-12)', display: 'grid', gap: 4 }}>
              {agingNotes(side, d).map((n, i) => (
                <li key={n} style={i === 0 ? { color: d.differenceSen === 0 ? INK_GOOD : INK_BAD, fontWeight: d.differenceSen === 0 ? 400 : 700 } : undefined}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
