import { useMemo, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog, Drawer, type DialogSpec } from '../components/Dialog';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { TONE } from '../lib/design-tokens';
import { dateTime, plural } from '../lib/format';
import { EmptyState } from '../components/States';
import { SearchSelect } from '../components/Select';
import { useUnitRoster } from '../lib/useUnitRoster';
import { TASK } from '../lib/vocabulary';
import type { TaskState } from '../lib/types';

// A checklist item is pass (true), fail (false) or not yet checked (null). An
// item can be optional; only the required items decide whether the unit is
// released for check-in. A failed item carries a note and, once raised, a link
// to the maintenance issue that tracks it.
interface Check { item: string; ok: boolean | null; note?: string; required?: boolean; linkedIssue?: string }
interface Inspection {
  id: string; ref?: string; unitId?: string; unitNumber: string; propertyName: string; inspector: string | null;
  state: TaskState; passed: boolean | null; checklist: Check[]; notes: string | null; inspectedAt: string | null;
}
interface Payload { data: Inspection[]; generatedAt: string }

const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'INS-0417', unitNumber: '#B-08-11', propertyName: 'Arcoris', inspector: 'Aina Zulkifli', state: 'in_progress', passed: null, inspectedAt: null, notes: null, checklist: [
      { item: 'Linen set complete and pressed', ok: true, required: true },
      { item: 'Bathroom sealed and dry', ok: true, required: true },
      { item: 'Consumables restocked', ok: null, required: true },
      { item: 'Aircon cooling within 10 minutes', ok: null, required: true },
      { item: 'Wifi reachable at 20 Mbps', ok: null, required: false },
    ] },
    { id: 'INS-0416', unitNumber: '#2207', propertyName: 'Tribeca', inspector: 'Chan Wei Wen', state: 'assigned', passed: null, inspectedAt: null, notes: null, checklist: [
      { item: 'Linen set complete and pressed', ok: null, required: true },
      { item: 'Bathroom sealed and dry', ok: null, required: true },
      { item: 'Consumables restocked', ok: null, required: true },
      { item: 'Aircon cooling within 10 minutes', ok: null, required: true },
      { item: 'Wifi reachable at 20 Mbps', ok: null, required: false },
    ] },
    { id: 'INS-0415', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', inspector: 'Chan Wei Wen', state: 'resolved', passed: true, inspectedAt: '2026-09-15T16:10', notes: null, checklist: [
      { item: 'Linen set complete and pressed', ok: true, required: true },
      { item: 'Bathroom sealed and dry', ok: true, required: true },
      { item: 'Consumables restocked', ok: true, required: true },
      { item: 'Aircon cooling within 10 minutes', ok: true, required: true },
      { item: 'Wifi reachable at 20 Mbps', ok: true, required: false },
    ] },
    { id: 'INS-0414', unitNumber: '#15-06', propertyName: 'Scarletz', inspector: 'Aina Zulkifli', state: 'reopened', passed: false, inspectedAt: '2026-09-14T11:40', notes: null, checklist: [
      { item: 'Linen set complete and pressed', ok: true, required: true },
      { item: 'Bathroom sealed and dry', ok: false, required: true, linkedIssue: 'MNT-0913', note: 'Silicone lifting behind the basin. Raised as MNT-0913.' },
      { item: 'Consumables restocked', ok: true, required: true },
      { item: 'Aircon cooling within 10 minutes', ok: false, required: true, note: 'Reached 26°C only. Service booked.' },
      { item: 'Wifi reachable at 20 Mbps', ok: true, required: false },
    ] },
  ],
};

type Filter = 'All' | 'In progress' | 'Passed' | 'Failed';
const FILTERS: Filter[] = ['All', 'In progress', 'Passed', 'Failed'];

// Attention-first: unfinished and failed inspections sit above the settled
// passes. Every group renders only when it has rows.
const GROUP_ORDER: TaskState[] = ['overdue', 'reopened', 'in_progress', 'waiting', 'assigned', 'open', 'resolved'];

const nowStamp = () => new Date().toISOString();
const unitRef = (i: Inspection) => `${i.propertyName} ${i.unitNumber}`;

function counts(cl: Check[]) {
  return {
    passed: cl.filter(c => c.ok === true).length,
    failed: cl.filter(c => c.ok === false).length,
    pending: cl.filter(c => c.ok === null).length,
    total: cl.length,
  };
}

// The release gate. Only required items decide it; a failed optional item is
// worth raising but never holds the unit off check-in.
function gate(cl: Check[]) {
  const required = cl.filter(c => c.required !== false);
  const failed = cl.filter(c => c.ok === false);
  return {
    required,
    failed,
    allRequiredDecided: required.every(c => c.ok !== null),
    allRequiredPass: required.length > 0 && required.every(c => c.ok === true),
    hasRequiredFail: required.some(c => c.ok === false),
    everyFailLinked: failed.every(c => !!c.linkedIssue),
  };
}

export default function InspectionsPage() {
  const { data, loading, error, reload } = useApi<Payload>('/inspections', FALLBACK);
  const toast = useToast();

  // Overlay keyed by inspection id: a change shows at once and is rolled back if the server refuses.
  const [edits, setEdits] = useState<Record<string, Partial<Inspection>>>({});
  const [filter, setFilter] = useState<Filter>('All');
  const [openId, setOpenId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'pass' | 'fail'; id: string } | null>(null);

  const rows = useMemo(
    () => (data?.data ?? []).map(i => ({ ...i, ...edits[i.id] })),
    [data, edits],
  );

  const patch = (id: string, delta: Partial<Inspection>) =>
    setEdits(e => ({ ...e, [id]: { ...e[id], ...delta } }));
  /** Show `delta` now, run `call`, then `ok()` on success or restore the previous overlay on failure. */
  function tryEdit(id: string, delta: Partial<Inspection>, call: () => Promise<unknown>, ok?: () => void) {
    const prev = edits[id];
    patch(id, delta);
    call().then(() => { ok?.(); reload(); }).catch(err => { setEdits(e => ({ ...e, [id]: prev ?? {} })); notifyFailure(err); });
  }

  const active = openId ? rows.find(r => r.id === openId) ?? null : null;

  // ---- Actions -------------------------------------------------------------

  function startInspection(i: Inspection) {
    if (i.state === 'assigned' || i.state === 'open') {
      tryEdit(i.id, { state: 'in_progress' }, () => api.post(`/inspections/${i.id}/start`, {}),
        () => toast({ tone: 'info', title: 'Inspection started.', body: `Checklist opened for ${unitRef(i)}.` }));
    }
    setOpenId(i.id);
  }

  function setItem(i: Inspection, idx: number, ok: boolean) {
    const current = i.checklist[idx];
    const next = current.ok === ok ? null : ok; // second click on the same choice clears it
    const checklist = i.checklist.map((c, n) => n === idx ? { ...c, ok: next } : c);
    tryEdit(i.id, { checklist, state: i.state === 'assigned' || i.state === 'open' ? 'in_progress' : i.state },
      () => api.post(`/inspections/${i.id}/items`, { item: current.item, result: next }));
  }

  async function raiseIssue(i: Inspection, idx: number) {
    const item = i.checklist[idx];
    try {
      const made = await api.post<{ id: string }>('/maintenance/issues', {
        unitId: i.unitId ?? i.unitNumber, propertyName: i.propertyName, title: item.item, detail: `Failed on inspection ${i.ref ?? i.id}.`,
        photoIds: [], blocksUnit: false, quotedAmount: null, chargeTo: 'owner',
      });
      const ref = `MNT-${made.id.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase()}`;
      const note = item.note?.trim() ? item.note : `Raised as ${ref}.`;
      const checklist = i.checklist.map((c, n) => n === idx ? { ...c, linkedIssue: ref, note } : c);
      toast({ tone: 'success', title: 'Maintenance issue raised.', body: `${ref} raised for "${item.item}".` });
      tryEdit(i.id, { checklist }, () => api.post(`/inspections/${i.id}/items`, { item: item.item, result: false, note, linkedIssue: made.id }));
    } catch (e) {
      toast({ tone: 'critical', title: 'Could not raise the issue.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    }
  }

  function setNote(i: Inspection, idx: number, note: string) {
    const checklist = i.checklist.map((c, n) => n === idx ? { ...c, note } : c);
    patch(i.id, { checklist });
  }

  function completePass(i: Inspection) {
    setConfirm(null);
    setOpenId(null);
    tryEdit(i.id, { state: 'resolved', passed: true, inspectedAt: nowStamp() },
      () => api.post(`/inspections/${i.id}/complete`, { result: 'pass', checklist: i.checklist }),
      () => toast({ tone: 'success', title: 'Inspection passed.', body: `${unitRef(i)} is released for check-in. The unit now shows ready.` }));
  }

  function completeFail(i: Inspection) {
    const failedCount = i.checklist.filter(c => c.ok === false).length;
    setConfirm(null);
    setOpenId(null);
    tryEdit(i.id, { state: 'reopened', passed: false, inspectedAt: nowStamp() },
      () => api.post(`/inspections/${i.id}/complete`, { result: 'fail', checklist: i.checklist }),
      () => toast({
        tone: 'warning', title: 'Inspection failed.',
        body: `${unitRef(i)} stays off check-in. ${failedCount} ${failedCount === 1 ? 'item is' : 'items are'} tracked as maintenance.`,
      }));
  }

  // ---- Derived -------------------------------------------------------------

  const filtered = rows.filter(i =>
    filter === 'All' ? true
    : filter === 'Passed' ? i.passed === true
    : filter === 'Failed' ? i.passed === false
    : i.passed === null);

  const groups = GROUP_ORDER
    .map(state => ({ state, items: filtered.filter(i => i.state === state) }))
    .filter(g => g.items.length > 0);

  const released = rows.filter(i => i.passed === true).length;
  const gated = rows.filter(i => i.passed !== true).length;

  const confirmInspection = confirm ? rows.find(r => r.id === confirm.id) ?? null : null;
  const dialogSpec: DialogSpec | null = !confirmInspection ? null
    : confirm!.kind === 'pass' ? {
        title: `Pass ${unitRef(confirmInspection)}?`,
        body: 'The unit is released for check-in and shows ready. Housekeeping is cleared for the next stay.',
        meta: `${confirmInspection.ref ?? confirmInspection.id} · ${confirmInspection.inspector ?? 'Unassigned'} · all required checks passed`,
        confirmLabel: 'Pass and release',
        onConfirm: () => completePass(confirmInspection),
      }
    : {
        title: `Complete ${unitRef(confirmInspection)} as failed?`,
        body: 'The unit stays off check-in until a follow-up inspection passes. Each failed item is tracked as a maintenance issue.',
        meta: `${confirmInspection.ref ?? confirmInspection.id} · ${gate(confirmInspection.checklist).failed.length} failed · release stays blocked`,
        danger: true,
        confirmLabel: 'Complete as failed',
        onConfirm: () => completeFail(confirmInspection),
      };

  return (
    <>
      <PageHeader
        title="Inspections"
        sub={`${plural(rows.length, 'inspection')} · ${released} released · ${gated} awaiting a pass`}
        primary={<Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setStarting(true)}>Start inspection</Button>}
      />

      {error && <StaleBanner message={`Showing the last inspections we have. ${error}`} onRetry={reload} />}

      <div className="flex gap-[7px] flex-wrap">
        {FILTERS.map(fl => {
          const on = fl === filter;
          return (
            <button key={fl} onClick={() => setFilter(fl)}
              className={`h-8 flex items-center px-[13px] py-0 rounded-full cursor-pointer whitespace-nowrap [font:inherit] border ${on ? 'bg-black text-white border-black' : 'bg-white text-muted-ink border-line'}`}>
              {fl}
            </button>
          );
        })}
      </div>

      <span className="text-meta text-muted-ink">
        A unit is released for check-in only after a pass. Every failed item needs a note and a maintenance issue.
      </span>

      {loading && rows.length === 0 ? (
        <Card><TableSkeleton rows={4} cols={2} /></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon="ClipboardList" title="No inspections yet"
          body="An inspection checks a unit after cleaning, item by item, before it is released for the next guest. Start one for any unit."
          action={{ label: 'Start inspection', onClick: () => setStarting(true) }} />
      ) : filtered.length === 0 ? (
        <EmptyState kind="filtered" title={`No inspections are ${filter.toLowerCase()}.`} action={{ label: 'Show all', onClick: () => setFilter('All') }} />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(g => (
            <div key={g.state} className="flex flex-col gap-2">
              <div className="flex items-center gap-[9px] pl-[2px]">
                <Badge tone={TASK[g.state].tone} label={TASK[g.state].label} />
                <span className="text-meta text-muted-ink">{g.items.length}</span>
              </div>
              <div className="flex flex-col gap-3">
                {g.items.map(i => (
                  <InspectionRow key={i.id} inspection={i} onOpen={() => startInspection(i)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Drawer open={!!active} onClose={() => setOpenId(null)} width={560}>
        {active && (
          <ChecklistPanel
            inspection={active}
            onClose={() => setOpenId(null)}
            onToggle={(idx, ok) => setItem(active, idx, ok)}
            onNote={(idx, note) => setNote(active, idx, note)}
            onRaise={idx => raiseIssue(active, idx)}
            onPass={() => setConfirm({ kind: 'pass', id: active.id })}
            onFail={() => setConfirm({ kind: 'fail', id: active.id })}
          />
        )}
      </Drawer>

      <Dialog busy={false} onClose={() => setConfirm(null)} spec={dialogSpec} />
      {starting && <StartDialog onClose={() => setStarting(false)} onStarted={id => { setStarting(false); reload(); setOpenId(id); }} />}
    </>
  );
}

/** Pick a unit and start an inspection from the standard checklist. If one is already open for that unit,
 *  the server hands that one back instead of starting a second. */
function StartDialog({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const units = useUnitRoster();
  const toast = useToast();
  const [unitId, setUnitId] = useState('');
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const r = await api.post<{ id: string; existing?: boolean }>('/inspections', { unitId });
      toast(r.existing ? { tone: 'info', title: 'This unit already has an inspection open.', body: 'Opened it instead of starting a second.' } : { tone: 'success', title: 'Inspection started.' });
      onStarted(r.id);
    } catch (e) {
      toast({ tone: 'critical', title: 'Inspection was not started.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
    } finally { setBusy(false); }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Start inspection" className="fixed inset-0 z-[60] grid place-items-center p-4 bg-[var(--color-surface-scrim)]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <div className="px-[22px] pt-[22px] pb-4 flex flex-col gap-3">
          <h2 className="m-0 text-title font-semibold">Start inspection</h2>
          <p className="m-0 text-copy text-muted-ink">Checks linen, bathroom, supplies, aircon and wifi. The unit is released for check-in only after a pass.</p>
          <SearchSelect label="Unit" showLabel value={unitId} onChange={setUnitId} placeholder="Search unit or building"
            options={units.map(u => ({ value: u.id, label: u.unitNumber, group: u.propertyName }))} />
        </div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-2 rounded-b-card">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!unitId} disabledReason="Choose a unit first." onClick={start}>Start</Button>
        </div>
      </div>
    </div>
  );
}

// ---- Row -------------------------------------------------------------------

function ReleaseBadge({ passed }: { passed: boolean | null }) {
  if (passed === true) return <Badge tone="success" label="Released" />;
  if (passed === false) return <Badge tone="critical" label="Not released" />;
  return <Badge tone="warning" label="Release pending" />;
}

function actionLabel(i: Inspection): string {
  if (i.passed === true) return 'Review inspection';
  if (i.passed === false) return 'Re-inspect';
  if (i.checklist.every(c => c.ok === null)) return 'Start inspection';
  return 'Open checklist';
}

function InspectionRow({ inspection: i, onOpen }: { inspection: Inspection; onOpen: () => void }) {
  const c = counts(i.checklist);
  return (
    <Card>
      <div className="py-[15px] px-5 border-b border-line-soft flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-[3px] min-w-[220px] flex-1">
          <div className="flex items-center gap-[9px] flex-wrap">
            <span className="font-mono text-caption text-muted-ink">{i.ref ?? i.id}</span>
            <span className="text-copy font-semibold">{unitRef(i)}</span>
            <Badge tone={TASK[i.state].tone} label={TASK[i.state].label} />
            <ReleaseBadge passed={i.passed} />
          </div>
          <span className="text-meta text-muted-ink">
            {i.inspector ?? 'Unassigned'}{i.inspectedAt ? ` · ${dateTime(i.inspectedAt)}` : ''} · {c.passed} passed · {c.failed} failed
            {c.pending > 0 ? ` · ${c.pending} to check` : ''}
          </span>
        </div>
        <Button size="sm" variant={i.passed === null ? 'primary' : 'secondary'} onClick={onOpen}>{actionLabel(i)}</Button>
      </div>
      {i.checklist.map(item => (
        <div key={item.item} className="flex items-start gap-[11px] py-[11px] px-5 border-b border-line-soft">
          <StatusBox ok={item.ok} />
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className={`text-copy ${item.ok === false ? 'text-[var(--color-critical-fg)]' : 'text-ink'}`}>
              {item.item}
              {item.required === false && <span className="text-muted-ink font-normal"> · optional</span>}
            </span>
            {item.note && <span className="text-meta text-[var(--color-critical-fg)] text-pretty">{item.note}</span>}
          </div>
          {item.linkedIssue && (
            <span className="font-mono text-caption text-muted-ink flex-none mt-0.5">{item.linkedIssue}</span>
          )}
        </div>
      ))}
    </Card>
  );
}

function StatusBox({ ok }: { ok: boolean | null }) {
  const fill = ok === null
    ? 'border-line bg-white'
    : ok
      ? 'border-[#16845B] bg-[#16845B]'
      : 'border-[#C2413B] bg-[#C2413B]';
  return (
    <span className={`w-[18px] h-[18px] flex-none mt-px rounded-[4px] grid place-items-center border text-white ${fill}`}>
      {ok !== null && <Icon name={ok ? 'Check' : 'X'} size="sm" />}
    </span>
  );
}

// ---- Checklist drawer ------------------------------------------------------

function ChecklistPanel({
  inspection: i, onClose, onToggle, onNote, onRaise, onPass, onFail,
}: {
  inspection: Inspection; onClose: () => void;
  onToggle: (idx: number, ok: boolean) => void; onNote: (idx: number, note: string) => void;
  onRaise: (idx: number) => void; onPass: () => void; onFail: () => void;
}) {
  const c = counts(i.checklist);
  const g = gate(i.checklist);
  const canPass = g.allRequiredDecided && g.allRequiredPass;
  const canFail = g.allRequiredDecided && g.hasRequiredFail && g.everyFailLinked;

  const footerReason = !g.allRequiredDecided
    ? 'Mark every required item pass or fail first.'
    : g.hasRequiredFail && !g.everyFailLinked
      ? 'Raise a maintenance issue for each failed item first.'
      : undefined;

  return (
    <>
      <div className="pt-5 px-[22px] pb-4 border-b border-line flex flex-col gap-[9px]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-[9px] flex-wrap">
              <span className="font-mono text-caption text-muted-ink">{i.ref ?? i.id}</span>
              <h2 className="m-0 text-title font-semibold">{unitRef(i)}</h2>
            </div>
            <span className="text-meta text-muted-ink">
              {i.inspector ?? 'Unassigned'}{i.inspectedAt ? ` · ${dateTime(i.inspectedAt)}` : ''}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close" className="bg-transparent border-none p-1 cursor-pointer text-muted-ink flex flex-none">
            <Icon name="X" size="base" />
          </button>
        </div>
        <div className="flex items-center gap-[9px] flex-wrap">
          <Badge tone={TASK[i.state].tone} label={TASK[i.state].label} />
          <ReleaseBadge passed={i.passed} />
          <span className="text-meta text-muted-ink">
            {c.passed} of {c.total} passed{c.failed > 0 ? ` · ${c.failed} failed` : ''}{c.pending > 0 ? ` · ${c.pending} to check` : ''}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pt-1.5 px-[22px] pb-[18px]">
        {i.checklist.map((item, idx) => (
          <div key={item.item} className="py-[14px] border-b border-line-soft flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-copy font-medium">{item.item}</span>
                <span className="text-caption text-muted-ink">{item.required === false ? 'Optional' : 'Required for release'}</span>
              </div>
              <PassFail value={item.ok} onPass={() => onToggle(idx, true)} onFail={() => onToggle(idx, false)} />
            </div>
            {item.ok === false && (
              <div className={`flex flex-col gap-2 py-[11px] px-3 rounded-control ${TONE.critical.bg} border border-[#C2413B33]`}>
                <textarea
                  value={item.note ?? ''}
                  onChange={e => onNote(idx, e.target.value)}
                  placeholder="What is wrong, and what needs doing."
                  rows={2}
                  className="w-full box-border py-[9px] px-[11px] text-ink bg-white border border-line rounded-control outline-none [font:inherit] resize-y"
                />
                <div className="flex items-center gap-2.5 flex-wrap">
                  {item.linkedIssue ? (
                    <span className="inline-flex items-center gap-1.5 text-meta text-[var(--color-critical-fg)]">
                      <Icon name="Wrench" size="sm" />
                      Tracked as {item.linkedIssue}
                    </span>
                  ) : (
                    <button onClick={() => onRaise(idx)} className="h-8 px-3 py-0 rounded-control border border-[#C2413B] bg-white text-[var(--color-critical-fg)] cursor-pointer [font:inherit] inline-flex items-center gap-1.5">
                      <Icon name="Wrench" size="sm" />
                      Raise maintenance issue
                    </button>
                  )}
                  <span className="text-caption text-muted-ink">A failed item holds the unit off check-in.</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="py-[14px] px-[22px] border-t border-line bg-page flex flex-col gap-2.5">
        <div className={`flex items-center gap-[9px] text-copy ${canPass ? 'text-[var(--color-success-fg)]' : g.hasRequiredFail && g.allRequiredDecided ? 'text-[var(--color-critical-fg)]' : 'text-muted-ink'}`}>
          <Icon name={canPass ? 'CircleCheck' : 'Lock'} size="sm" />
          <span className="flex-1">
            {canPass
              ? 'All required items pass. This unit can be released for check-in.'
              : g.hasRequiredFail && g.allRequiredDecided
                ? 'A required item failed. The unit stays off check-in until it is re-inspected.'
                : 'Mark every required item to unlock completion.'}
          </span>
        </div>
        <div className="flex items-center justify-end gap-[9px] flex-wrap">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          {g.hasRequiredFail && g.allRequiredDecided ? (
            <Button size="sm" variant="danger" onClick={onFail} disabled={!canFail} disabledReason={footerReason}>Complete as failed</Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onPass} disabled={!canPass} disabledReason={footerReason}>Pass and release</Button>
          )}
        </div>
      </div>
    </>
  );
}

function PassFail({ value, onPass, onFail }: { value: boolean | null; onPass: () => void; onFail: () => void }) {
  const seg = 'py-[7px] px-[14px] cursor-pointer [font:inherit] inline-flex items-center gap-[5px]';
  return (
    <div className="inline-flex flex-none border border-line rounded-control overflow-hidden">
      <button type="button" onClick={onPass} aria-pressed={value === true}
        className={`${seg} [border-width:0_1px_0_0] [border-style:solid] [border-color:var(--color-line)] ${value === true ? 'bg-[#16845B] text-white' : 'bg-white text-muted-ink'}`}>
        <Icon name="Check" size="sm" /> Pass
      </button>
      <button type="button" onClick={onFail} aria-pressed={value === false}
        className={`${seg} [border:none] ${value === false ? 'bg-[#C2413B] text-white' : 'bg-white text-muted-ink'}`}>
        <Icon name="X" size="sm" /> Fail
      </button>
    </div>
  );
}
