import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FileDropRow } from '../../components/Attachments';
import { Select } from '../../components/Select';
import { UnitPicker } from '../../components/UnitPicker';
import { MoneyInput, DateField } from '../../components/inputs';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { useUnitRoster } from '../../lib/useUnitRoster';
import { api, errorMessage } from '../../lib/api';
import { monthLabel, rm, todayMyt } from '../../lib/format';
import { StatusBadge } from '../../components/StatusBadge';
import { contractSplit, type SplitContract } from '../../lib/utilitySplit';
import { pdfToJpegs, photoForReader } from '../../lib/pdfPages';
import { pageFileName } from '../../lib/scanPage';

/** Scan bills (finance, chew 2 Nov 2026; plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Task 5): pick a
 *  month's PDFs or photos; every page is read (three at a time, no time limit) and shown as it finishes, with the unit
 *  it is for and how sure that is. Everything can be changed by hand. "Record" saves the ticked rows in one go
 *  (functions/_lib/utilityScan.ts): a period crossing the contract start or end is split by days, "Owner paid this
 *  bill" gives the bill back to the owner, and the bills the company pays go to finance as one payment request per
 *  provider. */
type Kind = 'electricity' | 'water' | 'internet' | 'sewerage';
type Read = {
  kind: string; provider: string | null; billMonth: string | null; periodFrom: string | null; periodTo: string | null;
  amountDueSen: number | null; accountNoVisible: string | null; accountNoFull: string | null; confidenceNotes: string | null;
};
type Match = { colour: 'green' | 'amber' | 'red'; accountId: string | null; alreadyRecorded: boolean; reasons: string[] };
type ScanAnswer = { scanId: string; read: Read; match: Match; unitId: string | null; candidates: { accountId: string; unitId: string | null; clues: string[] }[] };
type Row = {
  key: string; file: File; fileName: string; pageNo: number; thumb: string;
  state: 'waiting' | 'reading' | 'done' | 'failed' | 'recorded'; problem?: string;
  scan?: ScanAnswer;
  kind: Kind | ''; billMonth: string; periodFrom: string; periodTo: string; amountSen: number | null; unitId: string;
  /** The account the page matched, kept while its unit is the one proposed (a unit can have two meters of a kind). */
  accountId: string | null;
  ownerPaid: boolean; tick: boolean;
};
type Group = { provider: string; count: number; amountSen: number; scanIds: string[] };
type Sent = Group & { part: number; requestNo?: string; failed?: string };
type ScanUnit = { id: string; label: string; contracts: SplitContract[] };

const KINDS: { value: Kind; label: string }[] = [
  { value: 'electricity', label: 'Electricity' }, { value: 'water', label: 'Water' }, { value: 'internet', label: 'Internet' }, { value: 'sewerage', label: 'Indah Water' },
];
const AT_ONCE = 3;
const COLOUR: Record<Match['colour'], { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  green: { tone: 'success', label: 'Matched' }, amber: { tone: 'warning', label: 'Check' }, red: { tone: 'danger', label: 'Pick the unit' },
};
/** The bill month: the last 18 months and next month, and whatever the page says if it is outside them. */
const monthOptions = (current: string) => {
  const [y, m] = todayMyt().slice(0, 7).split('-').map(Number);
  const list = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(y, m - i, 1)).toISOString().slice(0, 7));
  if (current && !list.includes(current)) list.unshift(current);
  return list.map(v => ({ value: v, label: monthLabel(`${v}-01`) }));
};
const cell ='px-2 py-2 align-top border-b border-[var(--color-border-muted)]';

export default function ScanBills({ onBack, onRecorded }: { onBack: () => void; onRecorded: () => void }) {
  const toast = useToast();
  const roster = useUnitRoster();
  const ctx = useApi<{ units: ScanUnit[] }>('/expenses/utilities/scan');
  const contractsOf = useMemo(() => new Map((ctx.data?.units ?? []).map(u => [u.id, u.contracts])), [ctx.data]);
  const [batchId] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState<Row[]>([]);
  const [splitting, setSplitting] = useState(0);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [toPay, setToPay] = useState<Sent[]>([]);
  const stopped = useRef(false);
  const running = useRef(0);
  const part = useRef(0);
  /* The rows live here and every change goes through it first, so a page added while others are being read never
     overwrites their results (the screen state is only a copy for drawing). */
  const rowsRef = useRef<Row[]>([]);
  useEffect(() => () => rowsRef.current.forEach(r => URL.revokeObjectURL(r.thumb)), []);
  const commit = (next: Row[]) => { rowsRef.current = next; setRows(next); };
  const patch = (key: string, p: Partial<Row>) => commit(rowsRef.current.map(r => (r.key === key ? { ...r, ...p } : r)));

  /* Three pages at a time; a slow page holds up only its own slot. */
  function pump() {
    while (!stopped.current && running.current < AT_ONCE) {
      const next = rowsRef.current.find(r => r.state === 'waiting');
      if (!next) return;
      running.current++;
      patch(next.key, { state: 'reading' });
      void readOne(next).finally(() => { running.current--; pump(); });
    }
  }

  async function readOne(row: Row) {
    try {
      const fd = new FormData();
      /* Sent as the type it really is: a PNG labelled JPEG is refused by the reader. */
      const page = await (await fetch(row.thumb)).blob();
      const type = page.type || 'image/jpeg';
      fd.append('file', new File([page], pageFileName(row.fileName, row.pageNo, type), { type }));
      fd.append('kind', 'receipt');
      const doc = await api.post<{ id: string }>('/documents', fd);
      const s = await api.post<ScanAnswer>('/expenses/utilities/scan', { documentId: doc.id, batchId });
      const kind = (KINDS.some(k => k.value === s.read.kind) ? s.read.kind : '') as Kind | '';
      patch(row.key, {
        state: 'done', scan: s, kind, billMonth: s.read.billMonth ?? '', periodFrom: s.read.periodFrom ?? '', periodTo: s.read.periodTo ?? '',
        amountSen: s.read.amountDueSen, unitId: s.unitId ?? '', accountId: s.unitId ? s.match.accountId : null,
        tick: s.match.colour === 'green' && !s.match.alreadyRecorded,
      });
    } catch (e) {
      patch(row.key, { state: 'failed', problem: errorMessage(e) });
    }
  }

  async function pick(list: FileList) {
    setProblem(null);
    stopped.current = false;
    const files = Array.from(list);
    setSplitting(n => n + files.length);
    for (const file of files) {
      /* Each page joins the queue as soon as it is drawn, so reading starts while the rest of the PDF is still drawn. */
      const add = (b: Blob, pageNo: number) => {
        commit([...rowsRef.current, {
          key: crypto.randomUUID(), file, fileName: file.name, pageNo, thumb: URL.createObjectURL(b), state: 'waiting',
          kind: '', billMonth: '', periodFrom: '', periodTo: '', amountSen: null, unitId: '', accountId: null, ownerPaid: false, tick: false,
        }]);
        pump();
      };
      try {
        if (file.type === 'application/pdf') {
          let n = 0;
          for await (const p of pdfToJpegs(file)) { if (stopped.current) break; add(p, ++n); }
        } else if (!stopped.current) add(await photoForReader(file), 1);
      } catch (e) {
        setProblem(`${file.name} could not be opened: ${errorMessage(e)}`);
      } finally {
        setSplitting(n => n - 1);
      }
      if (stopped.current) break;
    }
  }

  /* Stop: no more pages are drawn or read; the pages being read finish. Each stopped or failed page can be read again. */
  function stop() {
    stopped.current = true;
    commit(rowsRef.current.map(r => (r.state === 'waiting' ? { ...r, state: 'failed', problem: 'Stopped' } : r)));
  }
  function readAgain(key: string) {
    stopped.current = false;
    patch(key, { state: 'waiting', problem: undefined });
    pump();
  }

  const ready = (r: Row) => r.state === 'done' && r.tick && !!r.kind && /^\d{4}-\d{2}$/.test(r.billMonth) && (r.amountSen ?? 0) > 0 && !!r.unitId;
  const chosen = rows.filter(r => r.state === 'done' && r.tick);
  const recordable = chosen.filter(ready);
  const total = rows.length, finished = rows.filter(r => r.state !== 'waiting' && r.state !== 'reading').length;

  /* A save whose answer never came back can simply be pressed again: pages already recorded are skipped, and the
     answer still lists what finance pays, so the payment requests go out (functions/_lib/utilityScan.ts). */
  async function record() {
    setProblem(null);
    if (chosen.length !== recordable.length) return setProblem('Every ticked row needs its kind, month, amount and unit.');
    setSaving(true);
    try {
      const res = await api.post<{ recorded: number; alreadyDone: number; rolled: unknown[]; ownerLines: number; notSplit: string[]; toPay: Group[] }>(
        '/expenses/utilities/scan/record', {
          batchId, rows: recordable.map(r => ({
            scanId: r.scan!.scanId, unitId: r.unitId, accountId: r.accountId, kind: r.kind, billMonth: r.billMonth, amountSen: r.amountSen,
            periodFrom: r.periodFrom || null, periodTo: r.periodTo || null, ownerPaid: r.ownerPaid,
          })),
        });
      const done = new Set(recordable.map(r => r.key));
      commit(rowsRef.current.map(r => (done.has(r.key) ? { ...r, state: 'recorded', tick: false } : r)));
      const n = res.recorded + res.alreadyDone;
      toast({ tone: 'success', title: `${n} bill${n === 1 ? '' : 's'} recorded`,
        body: [res.rolled.length ? `${res.rolled.length} go on a later statement (late bill).` : '', res.ownerLines ? `${res.ownerLines} owner line${res.ownerLines === 1 ? '' : 's'} added.` : ''].filter(Boolean).join(' ') || undefined });
      onRecorded();
      part.current += 1;
      await sendToFinance(res.toPay, part.current);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  /* One payment request per provider and save; the PDFs and photos its bills came from go with it when small enough. */
  async function sendToFinance(groups: Group[], n: number) {
    const out: Sent[] = [];
    for (const g of groups) {
      const ids = new Set(g.scanIds);
      const sources = [...new Set(rowsRef.current.filter(r => r.scan && ids.has(r.scan.scanId)).map(r => r.file))];
      const size = sources.reduce((s, f) => s + f.size, 0);
      const form = new FormData();
      form.set('data', JSON.stringify({ batchId, part: n, scanIds: g.scanIds, provider: g.provider }));
      if (sources.length <= 8 && size <= 20 * 1024 * 1024) for (const f of sources) form.append('file', f);
      try {
        const made = await api.post<{ requestNo: string }>('/expenses/utilities/scan/payment-requests', form);
        out.push({ ...g, part: n, requestNo: made.requestNo });
      } catch (e) {
        out.push({ ...g, part: n, failed: errorMessage(e) });
      }
    }
    setToPay(prev => [...prev, ...out]);
  }
  /* Only the requests that failed, each with its own save number (so one that went through is never sent again). */
  async function sendAgain() {
    const failed = toPay.filter(t => t.failed);
    setToPay(prev => prev.filter(t => !t.failed));
    for (const f of failed) await sendToFinance([f], f.part);
  }

  const splitText = (r: Row) => {
    if (!r.unitId || !r.periodFrom || !r.periodTo || !r.amountSen) return null;
    const s = contractSplit({ from: r.periodFrom, to: r.periodTo }, r.amountSen, contractsOf.get(r.unitId) ?? []);
    if (s.kind === 'two-contracts') return 'Two contracts in this period: split by hand';
    if (s.kind !== 'split') return null;
    return `${s.outsideDays} days owner alone ${rm(s.outsideSen)} · ${s.insideDays} days shared ${rm(s.insideSen)}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Scan bills" sub="Read a month's utility bills from their PDFs or photos, check them, and record them in one go."
        actions={<Button size="sm" variant="secondary" icon={<Icon name="ArrowLeft" size="sm" />} onClick={onBack}>Utility bills</Button>} />
      <Card className="p-4 flex flex-col gap-3">
        <FileDropRow label="Add bills" hint="PDFs (every page is read on its own) or photos." accept="application/pdf,image/*" multiple
          onPick={l => void pick(l)} busy={splitting > 0} />
        {total > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-[length:var(--text-small)]">
            <span>{finished < total ? `Reading page ${finished + 1} of ${total}` : `${total} page${total === 1 ? '' : 's'} read`}</span>
            {finished < total && <Button size="sm" variant="ghost" onClick={stop}>Stop</Button>}
          </div>
        )}
        {ctx.error && <div role="alert" className="text-danger">{ctx.error}</div>}
      </Card>

      {rows.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-[length:var(--text-small)]">
              <thead className="sticky top-0 bg-[var(--color-surface)]">
                <tr className="text-left">
                  {['Record', 'Page', 'Kind', 'Bill month', 'Period', 'Amount (RM)', 'Unit', 'Owner paid this bill', 'Check'].map(h => <th key={h} className={`${cell} font-semibold`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const editable = r.state === 'done';
                  const c = r.scan ? COLOUR[r.scan.match.colour] : null;
                  const split = splitText(r);
                  return (
                    <tr key={r.key} className={r.state === 'recorded' ? 'opacity-60' : undefined}>
                      <td className={cell}>
                        <input type="checkbox" aria-label={`Record page ${r.pageNo} of ${r.fileName}`} checked={r.tick} disabled={!editable}
                          onChange={e => patch(r.key, { tick: e.target.checked })} />
                      </td>
                      <td className={cell}>
                        <a href={r.thumb} target="_blank" rel="noreferrer" title="Open the page">
                          <img src={r.thumb} alt={`Page ${r.pageNo} of ${r.fileName}`} className="w-14 h-14 object-cover rounded border border-[var(--color-border-muted)]" />
                        </a>
                        <div className="mt-1 max-w-[7rem] truncate text-[var(--color-text-muted)]" title={r.fileName}>p. {r.pageNo}</div>
                      </td>
                      <td className={cell}><Select label="Kind" value={r.kind} onChange={v => patch(r.key, { kind: v as Kind })} options={KINDS} placeholder="Kind" disabled={!editable} className="w-36" /></td>
                      <td className={cell}>
                        <Select label="Bill month" value={r.billMonth} onChange={v => patch(r.key, { billMonth: v })} options={monthOptions(r.billMonth)} placeholder="Month" disabled={!editable} className="w-32" />
                      </td>
                      <td className={`${cell} min-w-[12rem]`}>
                        <div className="flex flex-col gap-1">
                          <DateField aria-label="Period from" value={r.periodFrom} onChange={v => patch(r.key, { periodFrom: v })} />
                          <DateField aria-label="Period to" value={r.periodTo} onChange={v => patch(r.key, { periodTo: v })} />
                          {split && <span className="text-[var(--color-text-muted)]">{split}</span>}
                        </div>
                      </td>
                      <td className={`${cell} min-w-[8rem]`}><MoneyInput aria-label="Amount" valueSen={r.amountSen} onChangeSen={v => patch(r.key, { amountSen: v })} disabled={!editable} /></td>
                      <td className={`${cell} min-w-[14rem]`}>
                        <UnitPicker label="Unit" units={roster} value={r.unitId} disabled={!editable}
                          onChange={id => patch(r.key, { unitId: id, accountId: id && id === r.scan?.unitId ? r.scan.match.accountId : null, tick: r.tick || !!id })} />
                      </td>
                      <td className={cell}>
                        <input type="checkbox" aria-label="Owner paid this bill" checked={r.ownerPaid} disabled={!editable} onChange={e => patch(r.key, { ownerPaid: e.target.checked })} />
                      </td>
                      <td className={`${cell} min-w-[14rem]`}>
                        {r.state === 'waiting' && <span className="text-[var(--color-text-muted)]">Waiting</span>}
                        {r.state === 'reading' && <span className="text-[var(--color-text-muted)]">Reading…</span>}
                        {r.state === 'failed' && (
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-danger">{r.problem}</span>
                            <Button size="sm" variant="ghost" onClick={() => readAgain(r.key)}>Read again</Button>
                          </div>
                        )}
                        {r.state === 'recorded' && <span>Recorded</span>}
                        {c && r.state === 'done' && (
                          <div className="flex flex-col gap-1">
                            <span className="self-start"><StatusBadge tone={c.tone} label={c.label} size="sm" /></span>
                            {r.scan!.match.reasons.map(x => <span key={x} className={x === 'Already recorded' ? 'font-semibold' : 'text-[var(--color-text-muted)]'}>{x}</span>)}
                            {r.scan!.read.confidenceNotes && <span className="text-[var(--color-text-muted)]">{r.scan!.read.confidenceNotes}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 p-4 border-t border-[var(--color-border-muted)]">
            <Button variant="primary" disabled={saving || recordable.length === 0} onClick={() => void record()}>
              {saving ? 'Recording…' : `Record ${recordable.length} bill${recordable.length === 1 ? '' : 's'}`}
            </Button>
            {problem && <span role="alert" className="text-danger">{problem}</span>}
          </div>
        </Card>
      )}

      {toPay.length > 0 && (
        <Card className="p-4 flex flex-col gap-2">
          <h2 className="font-semibold">Sent to finance</h2>
          {toPay.map((t, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <span>{t.provider} {rm(t.amountSen)} ({t.count} bill{t.count === 1 ? '' : 's'})</span>
              {t.requestNo ? <span className="text-[var(--color-text-muted)]">Payment request {t.requestNo}</span>
                : <span className="text-danger">Not sent: {t.failed}</span>}
            </div>
          ))}
          {toPay.some(t => t.failed) && <div><Button size="sm" variant="secondary" onClick={() => void sendAgain()}>Send to finance again</Button></div>}
        </Card>
      )}
    </div>
  );
}

