// ----------------------------------------------------------------------------
// CreditNoteKnockOff — a credit note knocks off the party's open invoices on the
// AP Payment's own table (ported from Houzs ERP, "like AutoCount"): a supplier
// credit note (SCN) the supplier's purchase and AP invoices, a customer credit
// note (CN) the customer's sales invoices.
//
// Tick = knock the invoice off in full, as far as the credit reaches; untick =
// give it back; a typed figure = part of it. On a draft the ticks are the plan
// the post carries out; on a posted note "Save knock-off" carries them out at
// once. It posts nothing: the note's own journal already moved the party's
// control. The server half is acc/credit-note-allocations.ts.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Button } from '@2990s/design-system';
import { MoneyInput } from '../../vendor/scm/components/MoneyInput';
import {
  useCreditNoteKnockOff, useSetCreditNoteAllocations,
  type KnockOffRow, type KnockOffTarget,
} from '../../vendor/scm/lib/credit-note-queries';
import { fmtDateOrDash, fmtSen } from '../../vendor/shared/format';

/** The ticks: what the note takes from each invoice, by invoice id. */
export type KnockOffPick = Record<string, KnockOffTarget | undefined>;

/** The ticks a table already holds — a posted note's knock-off, a draft's plan. */
export const pickFromRows = (rows: KnockOffRow[] | undefined): KnockOffPick => {
  const out: KnockOffPick = {};
  for (const r of rows ?? []) if (r.noteSen > 0) out[r.id] = { kind: r.kind, id: r.id, amountSen: r.noteSen };
  return out;
};
export const pickTargets = (pick: KnockOffPick): KnockOffTarget[] =>
  Object.values(pick).filter((t): t is KnockOffTarget => t != null && t.amountSen > 0);
export const pickSen = (pick: KnockOffPick): number => pickTargets(pick).reduce((s, t) => s + t.amountSen, 0);
const samePick = (a: KnockOffPick, b: KnockOffPick): boolean => {
  const x = pickTargets(a);
  return x.length === pickTargets(b).length && x.every((t) => b[t.id]?.amountSen === t.amountSen);
};

/** What the table says, by whose invoices it holds. */
const WORDS = {
  supplier: {
    holder: 'supplier', table: "Knock off the supplier's invoices", loading: "Loading the supplier's invoices…",
    none: 'No invoice of this supplier owes anything now — the credit stays with the supplier.',
    posted: 'tick to knock an invoice off, untick to give it back — like an AP Payment',
  },
  customer: {
    holder: 'customer', table: "Knock off against the customer's invoices", loading: "Loading the customer's invoices…",
    none: 'No open invoice for this customer. The note stays as credit on the customer until it is knocked off.',
    posted: 'tick to knock an invoice off, untick to give it back — posts nothing',
  },
} as const;
export type KnockOffWho = keyof typeof WORDS;

const soft: React.CSSProperties = { fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' };
const danger = 'var(--c-festive-b, #B8331F)';
const th: React.CSSProperties = { padding: '6px 8px', fontSize: 'var(--fs-11)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 8px', borderTop: '1px solid var(--line, #e3e1da)' };
const num: React.CSSProperties = { textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'That was not accepted.');

/** The AP Payment's Apply-to-invoice table, for a credit note. A customer's
    invoice says what it is For — its order and its total. */
export function KnockOffTable({ rows, creditSen, pick, onChange, disabled = false, who }: {
  rows: KnockOffRow[]; creditSen: number; pick: KnockOffPick; onChange: (next: KnockOffPick) => void; disabled?: boolean; who: KnockOffWho;
}) {
  /* A typed figure the row cannot take is pulled back to what it can; the
     field is drawn again so it shows the figure kept, not the one typed. */
  const [redraw, setRedraw] = useState(0);
  const customer = who === 'customer';
  const taken = pickSen(pick);
  const put = (r: KnockOffRow, sen: number): void => {
    const next = { ...pick };
    if (sen > 0) next[r.id] = { kind: r.kind, id: r.id, amountSen: sen };
    else delete next[r.id];
    onChange(next);
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table aria-label={WORDS[who].table} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-13)' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 34 }} aria-label="Knock off in full" />
            <th style={th}>Invoice</th>
            <th style={th}>Date</th>
            <th style={th}>{customer ? 'For' : 'Supplier Ref'}</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
            <th style={{ ...th, textAlign: 'right' }}>Outstanding</th>
            <th style={{ ...th, textAlign: 'right' }}>Knock off</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mine = pick[r.id]?.amountSen ?? 0;
            /* The most this row can take: what it owes before this note, and
               what the credit has left once the other rows are counted. */
            const max = Math.max(0, Math.min(r.owedSen, creditSen - (taken - mine)));
            return (
              <tr key={r.id}>
                <td style={td}>
                  <input type="checkbox" checked={mine > 0} disabled={disabled || (mine === 0 && max === 0)} aria-label={`Knock off ${r.number}`}
                    onChange={(e) => put(r, e.target.checked ? max : 0)} style={{ width: 16, height: 16 }} />
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>
                  {r.number}
                  {r.kind === 'API' && <span style={{ ...soft, marginLeft: 6, fontFamily: 'inherit' }} title="AP invoice — a bill keyed in Finance">AP</span>}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--fg-muted)' }}>{fmtDateOrDash(r.invoiceDate)}</td>
                <td style={{ ...td, color: r.invoiceRef ? undefined : 'var(--fg-muted)' }}>{r.invoiceRef || '—'}</td>
                <td style={{ ...td, ...num }}>{fmtSen(r.totalSen)}</td>
                <td style={{ ...td, ...num, color: 'var(--fg-muted)' }}>{fmtSen(r.owedSen)}</td>
                <td style={{ ...td, ...num }}>
                  <MoneyInput key={`${r.id}:${redraw}`} bare valueSen={mine} selectOnFocus disabled={disabled} aria-label={`Amount off ${r.number}`} style={{ width: 120 }}
                    onCommit={(sen) => {
                      const kept = Math.max(0, Math.min(max, sen ?? 0));
                      if (kept !== (sen ?? 0)) setRedraw((n) => n + 1);
                      put(r, kept);
                    }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "Knocking off RM X · credit left RM Y of RM Z" — red when the ticks outrun the note. */
export function KnockOffSum({ takenSen, totalSen, who }: { takenSen: number; totalSen: number; who: KnockOffWho }) {
  const over = takenSen > totalSen;
  return (
    <div style={{ ...soft, color: over ? danger : soft.color }} aria-label="Knock-off total">
      Knocking off <strong style={num}>{fmtSen(takenSen)}</strong>
      {over
        ? <> — more than the note's {fmtSen(totalSen)}; untick some first.</>
        : <> · credit left <strong style={num}>{fmtSen(totalSen - takenSen)}</strong> of {fmtSen(totalSen)} — it stays with the {WORDS[who].holder}.</>}
    </div>
  );
}

/** A saved note's knock-off (draft or posted): the ticks, and "Save knock-off" to
    keep them — a draft's as its plan, a posted note's carried out at once.
    `canSave` false shows the table read-only (a posted note's knock-off is the
    poster's key; the server refuses it anyway). */
export function NoteKnockOff({ noteId, posted, totalSen, who, canSave = true }: { noteId: string; posted: boolean; totalSen: number; who: KnockOffWho; canSave?: boolean }) {
  const q = useCreditNoteKnockOff(noteId);
  const save = useSetCreditNoteAllocations();
  const server = useMemo(() => pickFromRows(q.data?.rows), [q.data]);
  const [edit, setEdit] = useState<KnockOffPick | null>(null);
  const pick = edit ?? server;
  const dirty = edit != null && !samePick(edit, server);
  const rows = q.data?.rows ?? [];
  const w = WORDS[who];
  return (
    <section aria-label="Knock off" style={{ display: 'grid', gap: 6, fontSize: 'var(--fs-13)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong>{w.table}</strong>
        <span style={soft}>{posted ? w.posted : 'tick the invoices this credit comes off — carried out when the note posts'}</span>
      </div>
      {q.isLoading && <div style={soft}>{w.loading}</div>}
      {q.isError && <div style={{ color: danger }}>The invoices did not load — {errText(q.error)}</div>}
      {q.data?.refusal && <div style={soft}>{q.data.refusal}</div>}
      {q.data && !q.data.refusal && rows.length === 0 && <div style={soft}>{w.none}</div>}
      {rows.length > 0 && <KnockOffTable rows={rows} creditSen={totalSen} pick={pick} onChange={setEdit} disabled={save.isPending || !canSave} who={who} />}
      {!q.data?.refusal && <KnockOffSum takenSen={pickSen(pick)} totalSen={totalSen} who={who} />}
      {dirty && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Button size="sm" disabled={save.isPending || pickSen(pick) > totalSen}
            onClick={() => save.mutate({ noteId, targets: pickTargets(pick) }, { onSuccess: () => setEdit(null) })}>
            {save.isPending ? 'Saving…' : 'Save knock-off'}
          </Button>
          <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setEdit(null)}>Undo changes</Button>
        </div>
      )}
      {(save.data?.short ?? []).map((s) => (
        <div key={s.number} style={{ color: danger }}>{s.number} took only {fmtSen(s.appliedSen)} of {fmtSen(s.askedSen)} — it owes no more now.</div>
      ))}
      {save.isError && <div style={{ color: danger }}>{errText(save.error)}</div>}
    </section>
  );
}
