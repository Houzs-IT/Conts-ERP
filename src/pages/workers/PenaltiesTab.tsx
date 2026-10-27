import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { StatTile, StatRow } from '../../components/Metric';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { MoneyInput, DateField } from '../../components/inputs';
import { PillTabs } from '../../components/ops/OpsUi';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { mayRun, mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { rm, date, todayMyt } from '../../lib/format';
import type { PenaltiesPayload } from '../../../functions/api/penalties/index';
import type { Penalty, PenaltyStatus, JobOption, JobKind } from '../../../functions/_lib/penalties';
import type { Employee } from '../../../functions/_lib/hrFields';
import { monthName } from './PayrollTab';

/* ------------------------------------------------------------------ *
 * HR > Employees > Worker Penalty: Hookka's Worker Penalty tab. A penalty
 * is raised against a cleaning or repair job (Hookka: a production order),
 * shared out to the workers responsible, approved, and taken off each
 * one's payslip on the payroll month it lands on.
 * ------------------------------------------------------------------ */

type Filter = 'all' | PenaltyStatus;
const dayText = (d: string): string => date(`${d}T12:00:00+08:00`);
const months = (p: Penalty): string => [...new Set(p.lines.map(l => l.payrollPeriod).filter((x): x is string => !!x))].map(monthName).join(', ');
const workers = (p: Penalty): string => p.lines.map(l => l.name).join(', ');

export default function PenaltiesTab() {
  const { data, loading, error, reload } = useApi<PenaltiesPayload>('/penalties');
  const { user } = useSession();
  const mayEdit = mayWork(user, 'hr');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Penalty | null>(null);
  const [editing, setEditing] = useState<{ penalty: Penalty | null } | null>(null);
  const all = data?.data ?? [];
  const count = (s: PenaltyStatus) => all.filter(p => p.status === s).length;
  const needle = search.trim().toLowerCase();
  const shown = all.filter(p => (filter === 'all' || p.status === filter)
    && (!needle || [p.penaltyNo, p.jobRef, p.reason, workers(p)].some(v => (v ?? '').toLowerCase().includes(needle))));

  const columns = useMemo<Column<Penalty>[]>(() => [
    { key: 'no', label: 'Penalty No.', value: p => p.penaltyNo, width: 120, render: p => <span className="font-semibold tabular-nums">{p.penaltyNo}</span> },
    { key: 'date', label: 'Date', type: 'date', value: p => p.date, width: 120 },
    { key: 'job', label: 'Job', value: p => p.jobRef, width: 220 },
    { key: 'reason', label: 'Reason', value: p => p.reason, width: 240 },
    { key: 'workers', label: 'Workers', value: workers, width: 200 },
    { key: 'amount', label: 'Amount', type: 'money', value: p => p.totalSen, width: 120 },
    { key: 'month', label: 'Payroll month', value: months, width: 150 },
    { key: 'status', label: 'Status', type: 'status', entity: 'penalty', value: p => p.status, width: 190 },
  ], []);

  return (
    <div className="flex flex-col gap-5">
      {error && <StaleBanner message={`Showing the last penalties we have. ${error}`} onRetry={reload} />}
      <StatRow cols={3}>
        <StatTile label="Pending Approval" value={data ? String(count('pending')) : undefined} loading={loading && !data} tone={count('pending') ? 'warning' : undefined} />
        <StatTile label="Approved, Awaiting Payroll" value={data ? String(count('approved')) : undefined} loading={loading && !data} />
        <StatTile label="Posted" value={data ? String(count('posted')) : undefined} loading={loading && !data} />
      </StatRow>

      <DataTable<Penalty>
        id="penalties" columns={columns} rows={loading && !data ? null : shown} rowKey={p => p.id} pageSize={0}
        noun={['penalty', 'penalties']} exportName="worker-penalties" onRowClick={setOpen}
        header={
          <div className="pt-5 pb-3 px-5 flex flex-col gap-3 [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Worker Penalty</span>
              {mayEdit && <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setEditing({ penalty: null })}>New penalty</Button>}
            </span>
            <span className="flex items-end gap-3 flex-wrap">
              <span className="w-[280px] max-w-full"><Field aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Penalty no., job, worker…" /></span>
              <PillTabs<Filter> value={filter} onChange={setFilter} tabs={[
                { value: 'all', label: 'All', count: all.length }, { value: 'draft', label: 'Draft', count: count('draft') },
                { value: 'pending', label: 'Pending Approval', count: count('pending') }, { value: 'approved', label: 'Approved', count: count('approved') },
                { value: 'posted', label: 'Posted', count: count('posted') },
              ]} />
            </span>
          </div>
        }
        empty={{ title: 'No penalties.', body: 'A penalty is raised against a cleaning or repair job and taken off the workers\' pay once approved.', action: mayEdit ? { label: 'New penalty', onClick: () => setEditing({ penalty: null }) } : undefined }}
        renderCard={p => (
          <span className="flex flex-col gap-[3px]">
            <span className="flex items-center gap-2 flex-wrap"><span className="text-copy font-semibold tabular-nums">{p.penaltyNo}</span><StatusBadge entity="penalty" value={p.status} size="sm" /></span>
            <span className="text-meta text-muted-ink">{dayText(p.date)} · {rm(p.totalSen)} · {workers(p)}</span>
            <span className="text-meta">{p.reason}</span>
          </span>
        )}
      />

      {open && <Detail penalty={open} onClose={() => setOpen(null)} onEdit={() => { setEditing({ penalty: open }); setOpen(null); }} onChange={() => { setOpen(null); reload(); }} />}
      {editing && <Editor penalty={editing.penalty} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function Detail({ penalty: p, onClose, onEdit, onChange }: { penalty: Penalty; onClose: () => void; onEdit: () => void; onChange: () => void }) {
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const { user } = useSession();
  const mayEdit = mayWork(user, 'hr');
  const full = mayRun(user, 'hr');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(action: 'submit' | 'approve' | 'reject' | 'revoke', body: object = {}) {
    setBusy(true);
    try {
      await api.post(`/penalties/${p.id}/${action}`, body);
      toast({ tone: 'success', title: { submit: 'Submitted for approval.', approve: 'Penalty approved.', reject: 'Sent back to draft.', revoke: 'Approval revoked.' }[action], body: p.penaltyNo });
      onChange();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (await ask({ title: `Delete ${p.penaltyNo}?`, body: 'The draft is removed for good.', confirmLabel: 'Delete', danger: true }) === null) return;
    try { await api.del(`/penalties/${p.id}`); toast({ tone: 'success', title: 'Draft deleted.', body: p.penaltyNo }); onChange(); }
    catch (e) { notifyFailure(e); }
  }
  const row = (k: string, v: ReactNode) => <span className="flex justify-between gap-3 py-1 text-copy"><span className="text-muted-ink">{k}</span><span className="text-right">{v}</span></span>;

  return (
    <Modal title={p.penaltyNo} sub={`${dayText(p.date)} · ${rm(p.totalSen)}`} onClose={onClose} width={600}
      footer={<>
        {p.status === 'draft' && mayEdit && <>
          <Button size="sm" variant="tertiary" icon={<Icon name="Trash2" size="sm" />} onClick={() => void remove()} disabled={busy}>Delete</Button>
          <Button size="sm" variant="secondary" icon={<Icon name="Pencil" size="sm" />} onClick={onEdit} disabled={busy}>Edit</Button>
          <Button size="sm" variant="primary" onClick={() => void act('submit')} disabled={busy || !p.lines.length}>Submit</Button>
        </>}
        {p.status === 'pending' && full && !rejecting && <>
          <Button size="sm" variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>Reject</Button>
          <Button size="sm" variant="primary" icon={<Icon name="Check" size="sm" />} onClick={() => void act('approve')} disabled={busy}>Approve</Button>
        </>}
        {p.status === 'pending' && full && rejecting && <>
          <Button size="sm" variant="secondary" onClick={() => setRejecting(false)} disabled={busy}>Back</Button>
          <Button size="sm" variant="danger" onClick={() => void act('reject', { reason })} disabled={busy || !reason.trim()}>Reject</Button>
        </>}
        {p.status === 'approved' && full && <Button size="sm" variant="secondary" onClick={() => void act('revoke')} disabled={busy}>Revoke</Button>}
        {p.status === 'posted' && <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}
      </>}>
      {confirmDialog}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          {row('Status', <StatusBadge entity="penalty" value={p.status} size="sm" />)}
          {row('Job', p.jobRef ?? 'None')}
          {row('Reason', p.reason)}
          {p.remarks && row('Remarks', p.remarks)}
          {row('Raised by', p.createdBy ?? '')}
          {p.approvedBy && row('Approved by', `${p.approvedBy}${p.approvedAt ? `, ${date(p.approvedAt)}` : ''}`)}
          {p.rejectedReason && p.status === 'draft' && row('Sent back because', <span className="text-danger">{p.rejectedReason}</span>)}
        </div>
        <div className="flex flex-col">
          <span className="text-meta font-semibold text-muted-ink pb-1">RESPONSIBLE WORKERS</span>
          {p.lines.length === 0 && <span className="text-copy text-muted-ink">No workers yet.</span>}
          {p.lines.map(l => (
            <span key={l.id} className="flex items-center justify-between gap-3 py-1.5 text-copy [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
              <span className="font-semibold">{l.name}</span>
              <span className="flex items-center gap-3 text-meta text-muted-ink">
                <span>{l.payrollPeriod ? monthName(l.payrollPeriod) : 'Not on payroll yet'}</span>
                <span>{l.posted ? 'Deducted' : l.payrollPeriod ? 'To deduct' : ''}</span>
                <span className="text-copy text-ink tabular-nums">{rm(l.amountSen)}</span>
              </span>
            </span>
          ))}
        </div>
        {rejecting && <Field label="Why it goes back (they see this)" value={reason} onChange={e => setReason(e.target.value)} placeholder="Amount does not match the damage report" />}
      </div>
    </Modal>
  );
}

interface WorkerLine { key: string; person: string; amountSen: number | null }
const personKey = (e: Pick<Employee, 'id' | 'cleanerId' | 'technicianId'>): string => e.id ?? (e.cleanerId ? `c:${e.cleanerId}` : `t:${e.technicianId}`);
let seq = 0;

function Editor({ penalty, onClose, onDone }: { penalty: Penalty | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const people = useApi<{ data: Employee[] }>('/employees');
  const staff = (people.data?.data ?? []).filter(e => e.isActive && e.status === 'active');
  const byKey = new Map(staff.map(e => [personKey(e), e]));
  const [day, setDay] = useState(penalty?.date ?? todayMyt());
  const [job, setJob] = useState<{ kind: JobKind; id: string; ref: string } | null>(penalty?.jobKind && penalty.jobId ? { kind: penalty.jobKind, id: penalty.jobId, ref: penalty.jobRef ?? '' } : null);
  const [reason, setReason] = useState(penalty?.reason ?? '');
  const [remarks, setRemarks] = useState(penalty?.remarks ?? '');
  const [lines, setLines] = useState<WorkerLine[]>(penalty?.lines.map(l => ({ key: `w${++seq}`, person: l.employeeId, amountSen: l.amountSen })) ?? []);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<JobOption[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (job || query.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      try { setFound((await api.get<{ data: JobOption[] }>('/penalties/jobs', { q: query.trim() })).data); }
      catch (e) { notifyFailure(e); }
    }, 250);
    return () => clearTimeout(t);
  }, [query, job]);

  function pickJob(j: JobOption) {
    setJob({ kind: j.kind, id: j.id, ref: j.ref });
    setQuery('');
    // Hookka suggests the job's people: add whoever did it and is not on the penalty yet.
    const have = new Set(lines.map(l => l.person));
    const add = j.people.map(p => staff.find(e => (p.cleanerId && e.cleanerId === p.cleanerId) || (p.technicianId && e.technicianId === p.technicianId)))
      .filter((e): e is Employee => !!e && !have.has(personKey(e)));
    if (add.length) setLines(ls => [...ls, ...add.map(e => ({ key: `w${++seq}`, person: personKey(e), amountSen: null }))]);
  }

  async function save(submit: boolean) {
    setBusy(true);
    setErrors({});
    try {
      const body = {
        date: day, jobKind: job?.kind ?? null, jobId: job?.id ?? null, reason, remarks, submit,
        lines: lines.map(l => {
          const e = byKey.get(l.person);
          return { employeeId: e?.id ?? null, cleanerId: e?.id ? null : e?.cleanerId ?? null, technicianId: e?.id ? null : e?.technicianId ?? null, amountSen: l.amountSen ?? 0 };
        }),
      };
      if (penalty) await api.put(`/penalties/${penalty.id}`, body); else await api.post('/penalties', body);
      toast({ tone: 'success', title: submit ? 'Penalty submitted for approval.' : 'Draft saved.', body: reason });
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      notifyFailure(e);
    } finally { setBusy(false); }
  }

  const total = lines.reduce((n, l) => n + (l.amountSen ?? 0), 0);
  return (
    <Modal title={penalty ? `Edit ${penalty.penaltyNo}` : 'New penalty'} sub="Raised against a cleaning or repair job, shared out to the workers responsible." onClose={onClose} width={640}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="secondary" onClick={() => void save(false)} disabled={busy}>Save Draft</Button>
        <Button size="sm" variant="primary" onClick={() => void save(true)} disabled={busy || !lines.length}>Save &amp; Submit</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-copy font-semibold">1. Job</h3>
          {job ? (
            <span className="flex items-center justify-between gap-3 rounded-control border border-solid border-line px-3 py-2">
              <span className="flex flex-col"><span className="text-copy font-semibold">{job.ref}</span><span className="text-meta text-muted-ink">{job.kind === 'cleaning' ? 'Cleaning job' : 'Repair job'}</span></span>
              <Button size="sm" variant="tertiary" onClick={() => setJob(null)}>Change</Button>
            </span>
          ) : (
            <>
              <Field aria-label="Find the job" value={query} onChange={e => setQuery(e.target.value)} placeholder="Unit number or job title (optional)" error={errors.jobId} />
              {found.length > 0 && (
                <div className="rounded-control border border-solid border-line flex flex-col max-h-[220px] overflow-y-auto">
                  {found.map(j => (
                    <button key={`${j.kind}-${j.id}`} type="button" onClick={() => pickJob(j)}
                      className="text-left px-3 py-2 bg-card border-0 [border-bottom:1px_solid_var(--color-line-soft)] cursor-pointer hover:bg-page [font-family:inherit]">
                      <span className="block text-copy">{j.ref}</span>
                      <span className="block text-meta text-muted-ink">{j.kind === 'cleaning' ? 'Cleaning' : 'Repair'}{j.date ? ` · ${dayText(j.date)}` : ''}{j.people.length ? ` · ${j.people.map(p => p.name).join(', ')}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <div className="grid gap-x-4 gap-y-3 grid-cols-1 sm:grid-cols-2">
          <DateField label="Date" value={day} onChange={v => v && setDay(v)} required error={errors.date} />
          <span />
          <div className="sm:col-span-2"><Field label="Reason for penalty" value={reason} onChange={e => setReason(e.target.value)} placeholder="Broken glass left in the unit after cleaning" error={errors.reason} /></div>
          <div className="sm:col-span-2"><Field label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Owner sent photos; cost of replacement RM 120" /></div>
        </div>

        <section className="flex flex-col gap-2">
          <span className="flex items-baseline justify-between">
            <h3 className="m-0 text-copy font-semibold">Workers</h3>
            <span className="text-meta text-muted-ink tabular-nums">Total {rm(total)}</span>
          </span>
          {lines.map(l => (
            <span key={l.key} className="grid gap-2 grid-cols-[1fr_150px_auto] items-end">
              <Select label="Worker" size="md" value={l.person} placeholder="Pick a worker" onChange={v => setLines(ls => ls.map(x => (x.key === l.key ? { ...x, person: v } : x)))}
                options={staff.map(e => ({ value: personKey(e), label: e.employeeId ? `${e.employeeId} · ${e.name}` : e.name }))} />
              <MoneyInput aria-label="Amount (RM)" valueSen={l.amountSen} onChangeSen={v => setLines(ls => ls.map(x => (x.key === l.key ? { ...x, amountSen: v } : x)))} placeholder="Amount" />
              <Button size="sm" variant="tertiary" aria-label="Remove worker" icon={<Icon name="X" size="sm" />} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}>Remove</Button>
            </span>
          ))}
          <span><Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setLines(ls => [...ls, { key: `w${++seq}`, person: '', amountSen: null }])}>Add worker</Button></span>
          {errors.lines && <span className="text-meta text-danger">{errors.lines}</span>}
        </section>
      </div>
    </Modal>
  );
}
