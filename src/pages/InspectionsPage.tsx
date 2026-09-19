import { useMemo, useState, type CSSProperties } from 'react';
import { color, radius, text, tone as T } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Dialog, Drawer, type DialogSpec } from '../components/Dialog';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { TASK } from '../lib/vocabulary';
import type { TaskState } from '../lib/types';

// A checklist item is pass (true), fail (false) or not yet checked (null). An
// item can be optional; only the required items decide whether the unit is
// released for check-in. A failed item carries a note and, once raised, a link
// to the maintenance issue that tracks it.
interface Check { item: string; ok: boolean | null; note?: string; required?: boolean; linkedIssue?: string }
interface Inspection {
  id: string; unitNumber: string; propertyName: string; inspector: string | null;
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
    { id: 'INS-0415', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One', inspector: 'Chan Wei Wen', state: 'resolved', passed: true, inspectedAt: '15 Sep 16:10', notes: null, checklist: [
      { item: 'Linen set complete and pressed', ok: true, required: true },
      { item: 'Bathroom sealed and dry', ok: true, required: true },
      { item: 'Consumables restocked', ok: true, required: true },
      { item: 'Aircon cooling within 10 minutes', ok: true, required: true },
      { item: 'Wifi reachable at 20 Mbps', ok: true, required: false },
    ] },
    { id: 'INS-0414', unitNumber: '#15-06', propertyName: 'Scarletz', inspector: 'Aina Zulkifli', state: 'reopened', passed: false, inspectedAt: '14 Sep 11:40', notes: null, checklist: [
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

const MYT = 'Asia/Kuala_Lumpur';
const nowStamp = () => {
  const d = new Date();
  const day = d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: MYT });
  const t = d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: MYT });
  return `${day} ${t}`;
};
const newIssueId = () => `MNT-${Math.floor(1000 + Math.random() * 9000)}`;
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

  // Optimistic overlay keyed by inspection id. There is no backend in dev, so
  // every real call is attempted and its failure swallowed — the interaction
  // still lands. See IMPL-BRIEF: the optimistic-local-state pattern.
  const [edits, setEdits] = useState<Record<string, Partial<Inspection>>>({});
  const [filter, setFilter] = useState<Filter>('All');
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'pass' | 'fail'; id: string } | null>(null);

  const rows = useMemo(
    () => (data?.data ?? []).map(i => ({ ...i, ...edits[i.id] })),
    [data, edits],
  );

  const patch = (id: string, delta: Partial<Inspection>) =>
    setEdits(e => ({ ...e, [id]: { ...e[id], ...delta } }));
  const fire = (p: Promise<unknown>) => { void p.catch(() => { /* dev: no backend, keep optimistic */ }); };

  const active = openId ? rows.find(r => r.id === openId) ?? null : null;

  // ---- Actions -------------------------------------------------------------

  function startInspection(i: Inspection) {
    if (i.state === 'assigned' || i.state === 'open') {
      patch(i.id, { state: 'in_progress' });
      toast({ tone: 'info', title: 'Inspection started.', body: `Checklist opened for ${unitRef(i)}.` });
      fire(api.post('/inspections', { unitId: i.unitNumber }));
    }
    setOpenId(i.id);
  }

  function setItem(i: Inspection, idx: number, ok: boolean) {
    const current = i.checklist[idx];
    const next = current.ok === ok ? null : ok; // second click on the same choice clears it
    const checklist = i.checklist.map((c, n) => n === idx ? { ...c, ok: next } : c);
    patch(i.id, {
      checklist,
      state: i.state === 'assigned' || i.state === 'open' ? 'in_progress' : i.state,
    });
    fire(api.post(`/inspections/${i.id}/items`, { item: current.item, result: next }));
  }

  function raiseIssue(i: Inspection, idx: number) {
    const id = newIssueId();
    const item = i.checklist[idx];
    const checklist = i.checklist.map((c, n) =>
      n === idx ? { ...c, linkedIssue: id, note: c.note?.trim() ? c.note : `Raised as ${id}.` } : c);
    patch(i.id, { checklist });
    toast({ tone: 'success', title: 'Maintenance issue raised.', body: `${id} raised for "${item.item}".` });
    fire(api.post('/maintenance/issues', {
      unitId: i.unitNumber, title: item.item, detail: `Failed on inspection ${i.id}.`,
      photoIds: [], blocksUnit: false, quotedAmount: null, chargeTo: 'owner',
    }));
  }

  function setNote(i: Inspection, idx: number, note: string) {
    const checklist = i.checklist.map((c, n) => n === idx ? { ...c, note } : c);
    patch(i.id, { checklist });
  }

  function completePass(i: Inspection) {
    patch(i.id, { state: 'resolved', passed: true, inspectedAt: nowStamp() });
    setConfirm(null);
    setOpenId(null);
    toast({
      tone: 'success', title: 'Inspection passed.',
      body: `${unitRef(i)} is released for check-in. The unit now shows ready.`,
    });
    fire(api.post(`/inspections/${i.id}/complete`, { result: 'pass' }));
  }

  function completeFail(i: Inspection) {
    const failedCount = i.checklist.filter(c => c.ok === false).length;
    patch(i.id, { state: 'reopened', passed: false, inspectedAt: nowStamp() });
    setConfirm(null);
    setOpenId(null);
    toast({
      tone: 'warning', title: 'Inspection failed.',
      body: `${unitRef(i)} stays off check-in. ${failedCount} ${failedCount === 1 ? 'item is' : 'items are'} tracked as maintenance.`,
    });
    fire(api.post(`/inspections/${i.id}/complete`, { result: 'fail' }));
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
        meta: `${confirmInspection.id} · ${confirmInspection.inspector ?? 'Unassigned'} · all required checks passed`,
        confirmLabel: 'Pass and release',
        onConfirm: () => completePass(confirmInspection),
      }
    : {
        title: `Complete ${unitRef(confirmInspection)} as failed?`,
        body: 'The unit stays off check-in until a follow-up inspection passes. Each failed item is tracked as a maintenance issue.',
        meta: `${confirmInspection.id} · ${gate(confirmInspection.checklist).failed.length} failed · release stays blocked`,
        danger: true,
        confirmLabel: 'Complete as failed',
        onConfirm: () => completeFail(confirmInspection),
      };

  return (
    <>
      <PageHeader
        title="Inspections"
        sub={`${rows.length} inspections · ${released} released · ${gated} awaiting a pass`}
      />

      {error && <StaleBanner message={`Showing the last inspections we have. ${error}`} onRetry={reload} />}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {FILTERS.map(fl => {
          const on = fl === filter;
          return (
            <button key={fl} onClick={() => setFilter(fl)}
              style={{ height: 32, display: 'flex', alignItems: 'center', padding: '0 13px', borderRadius: radius.pill, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit',
                border: `1px solid ${on ? color.black : color.border}`, background: on ? color.black : '#FFFFFF', color: on ? '#FFFFFF' : color.textMuted }}>
              {fl}
            </button>
          );
        })}
      </div>

      <span style={{ fontSize: text.small, color: color.textMuted }}>
        A unit is released for check-in only after a pass. Every failed item needs a note and a maintenance issue.
      </span>

      {loading && rows.length === 0 ? (
        <Card><TableSkeleton rows={4} cols={2} /></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13 }}>No inspections match these filters.</span>
            <button onClick={() => setFilter('All')} style={{ alignSelf: 'flex-start', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear filters</button>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map(g => (
            <div key={g.state} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 2 }}>
                <Badge tone={TASK[g.state].tone} label={TASK[g.state].label} />
                <span style={{ fontSize: text.small, color: color.textMuted }}>{g.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
    </>
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
      <div style={{ padding: '15px 20px', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 220, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted }}>{i.id}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{unitRef(i)}</span>
            <Badge tone={TASK[i.state].tone} label={TASK[i.state].label} />
            <ReleaseBadge passed={i.passed} />
          </div>
          <span style={{ fontSize: text.small, color: color.textMuted }}>
            {i.inspector ?? 'Unassigned'}{i.inspectedAt ? ` · ${i.inspectedAt}` : ''} · {c.passed} passed · {c.failed} failed
            {c.pending > 0 ? ` · ${c.pending} to check` : ''}
          </span>
        </div>
        <Button size="sm" variant={i.passed === null ? 'primary' : 'secondary'} onClick={onOpen}>{actionLabel(i)}</Button>
      </div>
      {i.checklist.map(item => (
        <div key={item.item} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 20px', borderBottom: `1px solid ${color.borderMuted}` }}>
          <StatusBox ok={item.ok} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 13, color: item.ok === false ? T.critical.fg : color.ink }}>
              {item.item}
              {item.required === false && <span style={{ color: color.textMuted, fontWeight: 400 }}> · optional</span>}
            </span>
            {item.note && <span style={{ fontSize: 12, color: T.critical.fg, textWrap: 'pretty' }}>{item.note}</span>}
          </div>
          {item.linkedIssue && (
            <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted, flex: 'none', marginTop: 2 }}>{item.linkedIssue}</span>
          )}
        </div>
      ))}
    </Card>
  );
}

function StatusBox({ ok }: { ok: boolean | null }) {
  const line = ok === null ? color.border : ok ? T.success.line : T.critical.line;
  return (
    <span style={{ width: 18, height: 18, flex: 'none', marginTop: 1, borderRadius: radius.xs, display: 'grid', placeItems: 'center',
      border: `1px solid ${line}`, background: ok === null ? '#FFFFFF' : line, color: '#FFFFFF' }}>
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
      <div style={{ padding: '20px 22px 16px', borderBottom: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: text.micro, color: color.textMuted }}>{i.id}</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{unitRef(i)}</h2>
            </div>
            <span style={{ fontSize: text.small, color: color.textMuted }}>
              {i.inspector ?? 'Unassigned'}{i.inspectedAt ? ` · ${i.inspectedAt}` : ''}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: color.textMuted, display: 'flex', flex: 'none' }}>
            <Icon name="X" size="base" />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <Badge tone={TASK[i.state].tone} label={TASK[i.state].label} />
          <ReleaseBadge passed={i.passed} />
          <span style={{ fontSize: text.small, color: color.textMuted }}>
            {c.passed} of {c.total} passed{c.failed > 0 ? ` · ${c.failed} failed` : ''}{c.pending > 0 ? ` · ${c.pending} to check` : ''}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 22px 18px' }}>
        {i.checklist.map((item, idx) => (
          <div key={item.item} style={{ padding: '14px 0', borderBottom: `1px solid ${color.borderMuted}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{item.item}</span>
                <span style={{ fontSize: text.micro, color: color.textMuted }}>{item.required === false ? 'Optional' : 'Required for release'}</span>
              </div>
              <PassFail value={item.ok} onPass={() => onToggle(idx, true)} onFail={() => onToggle(idx, false)} />
            </div>
            {item.ok === false && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 12px', borderRadius: radius.control, background: T.critical.bg, border: `1px solid ${T.critical.line}33` }}>
                <textarea
                  value={item.note ?? ''}
                  onChange={e => onNote(idx, e.target.value)}
                  placeholder="What is wrong, and what needs doing."
                  rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 12.5, lineHeight: 1.5, color: color.ink, background: '#FFFFFF', border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none', font: 'inherit', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {item.linkedIssue ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.critical.fg }}>
                      <Icon name="Wrench" size="sm" />
                      Tracked as {item.linkedIssue}
                    </span>
                  ) : (
                    <button onClick={() => onRaise(idx)} style={{ height: 32, padding: '0 12px', borderRadius: radius.control, border: `1px solid ${T.critical.line}`, background: '#FFFFFF', color: T.critical.fg, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="Wrench" size="sm" />
                      Raise maintenance issue
                    </button>
                  )}
                  <span style={{ fontSize: text.micro, color: color.textMuted }}>A failed item holds the unit off check-in.</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '14px 22px', borderTop: `1px solid ${color.border}`, background: color.page, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: canPass ? T.success.fg : g.hasRequiredFail && g.allRequiredDecided ? T.critical.fg : color.textMuted }}>
          <Icon name={canPass ? 'CircleCheck' : 'Lock'} size="sm" />
          <span style={{ flex: 1 }}>
            {canPass
              ? 'All required items pass. This unit can be released for check-in.'
              : g.hasRequiredFail && g.allRequiredDecided
                ? 'A required item failed. The unit stays off check-in until it is re-inspected.'
                : 'Mark every required item to unlock completion.'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, flexWrap: 'wrap' }}>
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
  const seg: CSSProperties = { padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 };
  return (
    <div style={{ display: 'inline-flex', flex: 'none', border: `1px solid ${color.border}`, borderRadius: radius.control, overflow: 'hidden' }}>
      <button type="button" onClick={onPass} aria-pressed={value === true}
        style={{ ...seg, background: value === true ? T.success.line : '#FFFFFF', color: value === true ? '#FFFFFF' : color.textMuted, borderRight: `1px solid ${color.border}` }}>
        <Icon name="Check" size="sm" /> Pass
      </button>
      <button type="button" onClick={onFail} aria-pressed={value === false}
        style={{ ...seg, background: value === false ? T.critical.line : '#FFFFFF', color: value === false ? '#FFFFFF' : color.textMuted }}>
        <Icon name="X" size="sm" /> Fail
      </button>
    </div>
  );
}
