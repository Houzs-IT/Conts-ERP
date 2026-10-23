import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useApi } from '../lib/useApi';
import { CLEANER_FALLBACK, type Cleaner, type Employment } from '../lib/useCleaners';
import { api, notifyFailure } from '../lib/api';
import { plural } from '../lib/format';
import { Select } from '../components/Select';
import { CloseButton } from '../components/CloseButton';
import { PhoneInput, phoneProblem } from '../components/inputs/PhoneInput';
import { PillTabs } from '../components/ops/OpsUi';
import { useSession } from '../lib/session';

/* ------------------------------------------------------------------ *
 * Operations -> Workers: everyone who does the cleaning and the repairs,
 * one tab each. Each list has the company's own people (who can be
 * given app access: employee ID and PIN) and outside companies (no
 * login). The assign pickers on Cleaning and Maintenance pick from here.
 * ------------------------------------------------------------------ */

type ListKey = 'cleaners' | 'technicians';

/** A list entry: a cleaner (GET /housekeeping/cleaners) or a technician (GET /maintenance/technicians?all=1). */
type Worker = Cleaner & { loginRole?: string | null };

interface ListSide { title: string; hint: string; add: string; empty: string; word: string; namePh: string }
interface ListConfig {
  label: string; noun: string; Noun: string; jobs: string; listUrl: string; api: string;
  inside: ListSide; outside: ListSide; busyLabel: string; busyToday: boolean;
  vendorLabel: string; vendorPh: string; offBody: string;
}

const LISTS: Record<ListKey, ListConfig> = {
  cleaners: {
    label: 'Cleaners', noun: 'cleaner', Noun: 'Cleaner', jobs: 'cleaning jobs', listUrl: '/housekeeping/cleaners', api: '/housekeeping/cleaners',
    inside: { title: 'Internal staff', hint: 'Your own cleaners. With app access they sign in and get jobs on their phone.', add: 'Add internal cleaner', empty: 'No internal cleaners yet.', word: 'Internal staff', namePh: 'Nurul Huda' },
    outside: { title: 'Outsourced / third-party', hint: 'Outside cleaning companies you assign by hand or by rule. No login.', add: 'Add outsourced', empty: 'No outsourced cleaners yet.', word: 'Outsourced', namePh: 'BrightNest Crew' },
    busyLabel: 'Open jobs today', busyToday: true, vendorLabel: 'Vendor / company', vendorPh: 'SparkleClean Services',
    offBody: 'They come off the assign picker, so no new cleaning jobs can go to them. Jobs already assigned stay as they are. You can reactivate them at any time.',
  },
  technicians: {
    label: 'Technicians', noun: 'technician', Noun: 'Technician', jobs: 'repair jobs', listUrl: '/maintenance/technicians?all=1', api: '/maintenance/technicians',
    inside: { title: 'In-house', hint: 'Your own technicians. With app access they sign in and get repair jobs on their phone.', add: 'Add in-house technician', empty: 'No in-house technicians yet.', word: 'In-house', namePh: 'Ahmad Faiz' },
    outside: { title: 'Contractors', hint: 'Outside companies you give repair jobs to. No login: tell them about the job yourself.', add: 'Add contractor', empty: 'No contractors yet.', word: 'Contractors', namePh: 'Ah Seng Plumbing' },
    busyLabel: 'Open jobs', busyToday: false, vendorLabel: 'Company', vendorPh: 'Ah Seng Plumbing Sdn Bhd',
    offBody: 'They come off "who fixes it", so no new repair jobs can go to them. Jobs already given to them stay as they are. You can reactivate them at any time.',
  },
};
const isListKey = (v: string | null): v is ListKey => v === 'cleaners' || v === 'technicians';

const inputCls = 'block w-full box-border h-10 px-3 py-0 text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy';
const labelCls = 'text-meta font-medium text-muted-ink';

/** Who may give a worker app access (functions/_lib/fieldAccess.ts). */
const GRANT = ['management', 'operations_manager'];
const FIELD_ROLES = ['housekeeper', 'technician'];

/** How an in-house worker gets into the app, if at all. An office login (an operations person who also does repairs)
 *  signs in with email on the desk screens and never gets a PIN. */
function appAccess(w: Worker): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (w.employeeId) return { label: w.employeeId, tone: 'success' };
  if (w.userId && w.loginRole && !FIELD_ROLES.includes(w.loginRole)) return { label: 'Office login', tone: 'neutral' };
  if (w.userId) return { label: 'Email sign-in', tone: 'success' };
  return { label: 'No app access', tone: 'warning' };
}
const mayGetPin = (w: Worker) => w.employmentType === 'internal' && w.isActive && !(w.userId && w.loginRole && !FIELD_ROLES.includes(w.loginRole));

interface Draft { name: string; employmentType: Employment; vendorName: string; phone: string }
const emptyDraft = (employmentType: Employment): Draft => ({ name: '', employmentType, vendorName: '', phone: '' });

export default function WorkersPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab: ListKey = isListKey(asked) ? asked : 'cleaners';
  const tabs = (
    <PillTabs<ListKey> value={tab} onChange={t => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true })}
      tabs={[{ value: 'cleaners', label: 'Cleaners' }, { value: 'technicians', label: 'Technicians' }]} />
  );
  return <WorkerList key={tab} list={tab} tabs={tabs} />;
}

function WorkerList({ list, tabs }: { list: ListKey; tabs: ReactNode }) {
  const cfg = LISTS[list];
  const { data, loading, error, reload } = useApi<{ data: Worker[] }>(cfg.listUrl, list === 'cleaners' ? CLEANER_FALLBACK : undefined);
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const { user } = useSession();
  const mayGrant = GRANT.includes(user?.role ?? '');

  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; id?: string; draft: Draft } | null>(null);
  const [access, setAccess] = useState<{ worker: Worker; given?: { employeeId: string; pin: string } } | null>(null);
  const [busy, setBusy] = useState(false);

  const roster = data?.data ?? [];
  const internal = roster.filter(w => w.employmentType === 'internal');
  const outsourced = roster.filter(w => w.employmentType === 'outsourced');
  const activeCount = roster.filter(w => w.isActive).length;

  async function doSave() {
    if (!modal) return;
    const d = modal.draft;
    if (!d.name.trim()) { toast({ tone: 'critical', title: 'Name required.', body: `Give the ${cfg.noun} a name.` }); return; }
    setBusy(true);
    const vendorName = d.employmentType === 'outsourced' ? d.vendorName.trim() : '';
    try {
      if (modal.mode === 'create') {
        const { id } = await api.post<{ id: string }>(cfg.api, { name: d.name.trim(), employmentType: d.employmentType, vendorName: vendorName || null, phone: d.phone.trim() || null });
        if (d.employmentType === 'internal' && mayGrant) {
          // An in-house worker gets app access straight away: their employee ID and first PIN are shown next.
          setModal(null);
          reload();
          const given = await api.post<{ employeeId: string; pin: string; userId: string }>(`${cfg.api}/${id}/access`, {});
          setAccess({ worker: { id, name: d.name.trim(), employmentType: 'internal', vendorName: null, phone: d.phone.trim() || null, userId: given.userId, employeeId: given.employeeId, isActive: true, busy: 0 }, given });
          reload();
          return;
        }
        toast({ tone: 'success', title: `${cfg.Noun} added.`, body: d.employmentType === 'internal' ? 'A manager can give them app access.' : `${d.name.trim()} · ${cfg.outside.word}.` });
      } else if (modal.id) {
        await api.patch(`${cfg.api}/${modal.id}`, { name: d.name.trim(), employmentType: d.employmentType, vendorName, phone: d.phone.trim() });
        toast({ tone: 'success', title: `${cfg.Noun} updated.`, body: `${d.name.trim()}.` });
      }
      setModal(null);
      reload();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }

  async function toggleActive(w: Worker) {
    if (w.isActive && await ask({ title: `Deactivate ${w.name}?`, body: cfg.offBody, confirmLabel: 'Deactivate', danger: true }) === null) return;
    try {
      await api.patch(`${cfg.api}/${w.id}`, { isActive: !w.isActive });
      toast({ tone: w.isActive ? 'warning' : 'success', title: w.isActive ? `${w.name} deactivated.` : `${w.name} reactivated.`, body: w.isActive ? 'No new jobs can go to them.' : 'They can be given jobs again.' });
      reload();
    } catch (e) { notifyFailure(e); }
  }

  const openEdit = (w: Worker) => setModal({ mode: 'edit', id: w.id, draft: { name: w.name, employmentType: w.employmentType, vendorName: w.vendorName ?? '', phone: w.phone ?? '' } });
  const rows = (side: Worker[]) => (loading && roster.length === 0 ? null : side);

  return (
    <>
      {confirmDialog}
      <PageHeader
        title="Workers"
        sub={data ? `${plural(roster.length, cfg.noun)} · ${activeCount} active · ${internal.length} ${cfg.inside.word.toLowerCase()} · ${outsourced.length} ${cfg.outside.word.toLowerCase()}` : 'Loading the list…'}
        primary={
          <Button size="sm" variant="primary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setModal({ mode: 'create', draft: emptyDraft('internal') })}>
            Add {cfg.noun}
          </Button>
        }
      />
      <div className="mb-4">{tabs}</div>

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <div className="flex flex-col gap-5">
        <WorkerSection list={list} side="internal" cfg={cfg} workers={rows(internal)} onAdd={() => setModal({ mode: 'create', draft: emptyDraft('internal') })} onEdit={openEdit} onToggle={toggleActive} onAccess={mayGrant ? w => setAccess({ worker: w }) : undefined} />
        <WorkerSection list={list} side="outsourced" cfg={cfg} workers={rows(outsourced)} onAdd={() => setModal({ mode: 'create', draft: emptyDraft('outsourced') })} onEdit={openEdit} onToggle={toggleActive} />
      </div>

      {access && <AccessModal cfg={cfg} worker={access.worker} given0={access.given} onClose={() => setAccess(null)} onDone={reload} />}

      {modal && (
        <FormModal
          cfg={cfg}
          title={modal.mode === 'create' ? `Add ${cfg.noun}` : `Edit ${cfg.noun}`}
          busy={busy}
          note={modal.mode === 'create' && modal.draft.employmentType === 'internal'
            ? (mayGrant ? 'After saving you get their employee ID and first PIN for the app.' : 'A manager can give them app access after you save.') : null}
          draft={modal.draft}
          onChange={d => setModal(m => m && { ...m, draft: d })}
          onClose={() => setModal(null)}
          onSave={doSave}
        />
      )}
    </>
  );
}

function WorkerSection({ list, side, cfg, workers, onAdd, onEdit, onToggle, onAccess }: {
  list: ListKey; side: Employment; cfg: ListConfig; workers: Worker[] | null; onAdd: () => void;
  onEdit: (w: Worker) => void; onToggle: (w: Worker) => void; onAccess?: (w: Worker) => void;
}) {
  const s = side === 'internal' ? cfg.inside : cfg.outside;
  const columns = useMemo<Column<Worker>[]>(() => [
    { key: 'name', label: 'Name', value: w => w.name, hideable: false, width: 200, render: w => <span className="font-semibold">{w.name}</span> },
    ...(side === 'outsourced' ? [{ key: 'vendor', label: cfg.vendorLabel, value: (w: Worker) => w.vendorName, width: 180 }] : []),
    { key: 'phone', label: 'Phone', type: 'phone', value: w => w.phone, width: 150 },
    ...(side === 'internal' ? [{ key: 'login', label: 'App access', type: 'status' as const, value: (w: Worker) => appAccess(w).label, status: (w: Worker) => appAccess(w), width: 140 }] : []),
    { key: 'busy', label: cfg.busyLabel, type: 'number', value: w => w.busy, width: 120 },
    { key: 'active', label: 'Status', type: 'status', value: w => (w.isActive ? 'active' : 'inactive'),
      status: w => ({ label: w.isActive ? 'Active' : 'Inactive', tone: w.isActive ? 'success' : 'neutral' }), width: 110 },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: onAccess && side === 'internal' ? 360 : 220, align: 'right', render: w => actions(w) },
  ], [side, cfg, onEdit, onToggle, onAccess]); // eslint-disable-line react-hooks/exhaustive-deps
  function actions(w: Worker) {
    return (
      <span className="flex gap-[7px] items-center justify-end">
        {onAccess && mayGetPin(w) && (
          <Button size="sm" variant="tertiary" icon={<Icon name="KeyRound" size="sm" />} onClick={() => onAccess(w)}>
            {w.employeeId ? 'New PIN' : 'Give app access'}
          </Button>
        )}
        <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => onEdit(w)}>Edit</Button>
        <Button size="sm" variant="tertiary" icon={<Icon name={w.isActive ? 'UserMinus' : 'UserCheck'} size="sm" />} onClick={() => onToggle(w)}>
          {w.isActive ? 'Deactivate' : 'Reactivate'}
        </Button>
      </span>
    );
  }
  return (
    <DataTable<Worker>
      id={`${list}.${side}`} urlPrefix={side === 'internal' ? 'in.' : 'out.'} columns={columns} rows={workers} rowKey={w => w.id}
      pageSize={0} noun={[cfg.noun, `${cfg.noun}s`]} exportName={`${list}-${side === 'internal' ? 'in-house' : 'outside'}`}
      rowTone={w => (w.isActive ? null : 'muted')}
      header={
        <div className="pt-5 pb-3 px-5 flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">{s.title}</span>
            {workers && <span className="text-meta text-muted-ink tabular-nums">{workers.length}</span>}
          </span>
          <span className="text-meta text-muted-ink">{s.hint}</span>
        </div>
      }
      empty={{ title: s.empty, body: s.hint, action: { label: s.add, onClick: onAdd } }}
      renderCard={w => (
        <span className="flex flex-col gap-[3px] min-w-0">
          <span className="flex items-center gap-[9px] flex-wrap">
            <span className="text-copy font-semibold">{w.name}</span>
            {!w.isActive && <StatusBadge tone="neutral" label="Inactive" size="sm" />}
            {w.isActive && side === 'internal' && appAccess(w).tone === 'warning' && <StatusBadge tone="warning" label="No app access" size="sm" />}
          </span>
          <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap">
            {w.vendorName && <span>{cfg.vendorLabel}: {w.vendorName}</span>}
            {w.phone && <span>{w.phone}</span>}
            {side === 'internal' ? appAccess(w).tone !== 'warning' && <span>{appAccess(w).label}</span> : <span>No login</span>}
            <span>{plural(w.busy, 'open job')}{cfg.busyToday ? ' today' : ''}</span>
          </span>
          <span className="flex justify-start pt-1">{actions(w)}</span>
        </span>
      )}
    />
  );
}

function FormModal({ cfg, title, busy, draft, note, onChange, onClose, onSave }: {
  cfg: ListConfig; title: string; busy: boolean; draft: Draft; note: string | null;
  onChange: (d: Draft) => void; onClose: () => void; onSave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('#wk-name')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const set = (p: Partial<Draft>) => onChange({ ...draft, ...p });

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[460px] max-h-[88vh] overflow-y-auto bg-card rounded-card shadow-[var(--shadow-overlay)] animate-dialog">
        <div className="pt-5 px-5 pb-1 flex items-start justify-between gap-3">
          <h2 className="m-0 text-title leading-[1.3] font-semibold">{title}</h2>
          <CloseButton onClick={onClose} disabled={busy} />
        </div>
        <div className="pt-4 px-5 pb-1 flex flex-col gap-4">
          <div className="flex flex-col gap-[7px]">
            <Select label="Employment" showLabel size="md" value={draft.employmentType} disabled={busy}
              onChange={v => set({ employmentType: v as Employment })}
              options={[{ value: 'internal', label: cfg.inside.word }, { value: 'outsourced', label: cfg.outside.title }]} />
          </div>

          <div className="flex flex-col gap-[7px]">
            <label htmlFor="wk-name" className={labelCls}>Name</label>
            <input id="wk-name" value={draft.name} disabled={busy} placeholder={draft.employmentType === 'outsourced' ? cfg.outside.namePh : cfg.inside.namePh}
              onChange={e => set({ name: e.target.value })} className={inputCls} />
          </div>

          {draft.employmentType === 'outsourced' && (
            <div className="flex flex-col gap-[7px]">
              <label htmlFor="wk-vendor" className={labelCls}>{cfg.vendorLabel}</label>
              <input id="wk-vendor" value={draft.vendorName} disabled={busy} placeholder={cfg.vendorPh}
                onChange={e => set({ vendorName: e.target.value })} className={inputCls} />
            </div>
          )}


          <div className="flex flex-col gap-[7px]">
            <PhoneInput label="Phone (optional)" value={draft.phone} onChange={v => set({ phone: v })} disabled={busy} error={phoneProblem(draft.phone)} />
          </div>
          {note && <span className="text-meta text-muted-ink">{note}</span>}
        </div>
        <div className="py-[14px] px-5 mt-2 [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap sticky bottom-0">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!draft.name.trim()} disabledReason="Enter a name first." onClick={onSave}>Save {cfg.noun}</Button>
        </div>
      </div>
    </div>
  );
}

/** "Give app access" / "New PIN": the worker's employee ID (made on first access) and their first PIN, shown once. */
function AccessModal({ cfg, worker, given0, onClose, onDone }: {
  cfg: ListConfig; worker: Worker; given0?: { employeeId: string; pin: string }; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [given, setGiven] = useState<{ employeeId: string; pin: string } | null>(given0 ?? null);
  const toast = useToast();
  const fresh = !worker.userId;
  const title = given ? `Sign-in for ${worker.name}` : worker.employeeId ? `New PIN for ${worker.name}` : `Give ${worker.name} app access`;
  const link = `${window.location.origin}/#/field`;

  /** The sign-in as one message the manager pastes into WhatsApp or SMS. */
  async function copyMessage(employeeId: string, pin: string): Promise<void> {
    const text = `Hi ${worker.name}, this is your sign-in for The Conts app.\n\n`
      + `1. On your phone, open ${link}\n2. Employee ID: ${employeeId}\n3. PIN: ${pin}\n\n`
      + 'The first time, it asks you to choose your own PIN.';
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: 'success', title: 'Copied.', body: `Paste it in a private message to ${worker.name}.` });
    } catch {
      toast({ tone: 'warning', title: 'Could not copy. Give them the ID and PIN by hand.' });
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await api.post<{ employeeId: string; pin: string }>(`${cfg.api}/${worker.id}/access`, {});
      setGiven(r);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not give access. Try again in a moment.');
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[460px] max-h-[88vh] overflow-y-auto bg-card rounded-card shadow-[var(--shadow-overlay)] animate-dialog">
        <div className="pt-5 px-5 pb-1 flex items-start justify-between gap-3">
          <h2 className="m-0 text-title leading-[1.3] font-semibold">{title}</h2>
          <CloseButton onClick={onClose} disabled={busy} />
        </div>
        {given ? (
          <div className="pt-4 px-5 pb-5 flex flex-col gap-4 text-copy">
            <span>Give {worker.name} these two. The PIN is shown only now.</span>
            <span className="flex gap-3 flex-wrap">
              <span className="flex flex-col gap-1">
                <span className="text-meta text-muted-ink">Employee ID</span>
                <span className="py-3 px-4 rounded-control bg-page border border-solid border-line text-[28px] font-semibold tabular-nums">{given.employeeId}</span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-meta text-muted-ink">First PIN</span>
                <span className="py-3 px-4 rounded-control bg-page border border-solid border-line text-[28px] font-semibold tracking-[0.3em] tabular-nums">{given.pin}</span>
              </span>
            </span>
            <span className="text-meta text-muted-ink text-pretty">
              They open <span className="font-semibold text-ink">{link}</span> on their phone, type the number
              after EMP- and this PIN, and choose their own PIN the first time. Copy message puts all of this in one text to send them.
            </span>
          </div>
        ) : (
          <div className="pt-4 px-5 pb-1 flex flex-col gap-4">
            <span className="text-meta text-muted-ink text-pretty">
              {worker.employeeId
                ? `${worker.name} keeps employee ID ${worker.employeeId} and gets a new 6-digit PIN. Their old PIN stops working and they are signed out on every phone.`
                : fresh
                  ? `This makes a ${cfg.noun} login for ${worker.name} with the next employee ID (EMP-...) and a 6-digit PIN. In the field app they see only their own ${cfg.jobs}.`
                  : `${worker.name} gets the next employee ID (EMP-...) and a 6-digit PIN. Their old password stops working and they are signed out on every phone.`}
            </span>
            {error && <div role="alert" className="[border-left:2px_solid_var(--color-critical-line)] bg-critical-bg py-3 px-3.5 text-meta text-danger">{error}</div>}
          </div>
        )}
        <div className="py-[14px] px-5 mt-2 [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap sticky bottom-0">
          {given
            ? <>
                <Button size="sm" variant="secondary" onClick={() => copyMessage(given.employeeId, given.pin)}>Copy message</Button>
                <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
              </>
            : <>
                <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy} onClick={submit}>
                  {worker.employeeId ? 'Give new PIN' : 'Give app access'}
                </Button>
              </>}
        </div>
      </div>
    </div>
  );
}
