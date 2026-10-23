import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner } from '../components/DataState';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useApi } from '../lib/useApi';
import { useCleaners, type Cleaner, type Employment } from '../lib/useCleaners';
import { api, notifyFailure } from '../lib/api';
import { plural } from '../lib/format';
import { Select } from '../components/Select';
import { CloseButton } from '../components/CloseButton';
import { PhoneInput, phoneProblem } from '../components/inputs/PhoneInput';
import { useSession } from '../lib/session';

/* ------------------------------------------------------------------ *
 * Operations -> Cleaners — the housekeeping roster master data.
 * The operator maintains who can be assigned a clean, split by the
 * employment dimension: INTERNAL staff (who log in as housekeepers)
 * vs OUTSOURCED / third-party crews (a vendor, no login). The Assign
 * and Auto-assign controls on Housekeeping pick from this roster.
 * No backend in dev, so mutations use a local overlay and attempt the
 * real call in a swallowed try/catch (matches the other master pages).
 * ------------------------------------------------------------------ */

const EMPLOYMENT_LABEL: Record<Employment, string> = { internal: 'Internal staff', outsourced: 'Outsourced' };

const inputCls = 'block w-full box-border h-10 px-3 py-0 text-ink bg-white border border-solid border-line rounded-control outline-none [font-family:inherit] text-copy';
const labelCls = 'text-meta font-medium text-muted-ink';

/** Who may give a cleaner app access (functions/api/housekeeping/cleaners/[id]/access.ts). */
const GRANT = ['management', 'operations_manager'];

/** How an internal cleaner gets into the field app, if at all. */
function appAccess(c: Cleaner): { label: string; tone: 'success' | 'warning' } {
  if (c.loginPhone) return { label: 'Phone sign-in', tone: 'success' };
  if (c.userId) return { label: 'Email sign-in', tone: 'success' };
  return { label: 'No app access', tone: 'warning' };
}

interface HouseUser { id: string; name: string; busy: number }

interface Draft { name: string; employmentType: Employment; vendorName: string; phone: string; userId: string }
const emptyDraft = (employmentType: Employment): Draft => ({ name: '', employmentType, vendorName: '', phone: '', userId: '' });

export default function CleanersPage() {
  const { cleaners, ready, loading, error, reload } = useCleaners(false);
  const { data: crewData } = useApi<{ data: HouseUser[] }>('/housekeeping/crew?scope=housekeeping', { data: [] });
  const toast = useToast();

  const [added, setAdded] = useState<Cleaner[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Cleaner>>>({});
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; id?: string; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDialog, ask] = useConfirm();
  const { user } = useSession();
  const mayGrant = GRANT.includes(user?.role ?? '');
  const [access, setAccess] = useState<Cleaner | null>(null);

  const roster = [...added, ...cleaners].map(c => ({ ...c, ...edits[c.id] }));
  const patch = (id: string, p: Partial<Cleaner>) => setEdits(e => ({ ...e, [id]: { ...e[id], ...p } }));

  const internal = roster.filter(c => c.employmentType === 'internal');
  const outsourced = roster.filter(c => c.employmentType === 'outsourced');
  const activeCount = roster.filter(c => c.isActive).length;

  async function doSave() {
    if (!modal) return;
    const d = modal.draft;
    if (!d.name.trim()) { toast({ tone: 'critical', title: 'Name required.', body: 'Give the cleaner a name.' }); return; }
    setBusy(true);
    const linkedUser = crewData?.data.find(u => u.id === d.userId);
    if (modal.mode === 'create') {
      const optimistic: Cleaner = {
        id: `local-${crypto.randomUUID()}`, name: d.name.trim(), employmentType: d.employmentType,
        vendorName: d.employmentType === 'outsourced' && d.vendorName.trim() ? d.vendorName.trim() : null,
        phone: d.phone.trim() || null, userId: d.employmentType === 'internal' ? (linkedUser?.id ?? null) : null,
        isActive: true, busy: 0,
      };
      setAdded(a => [optimistic, ...a]);
      toast({ tone: 'success', title: 'Cleaner added.', body: `${optimistic.name} · ${EMPLOYMENT_LABEL[optimistic.employmentType]}.` });
      try {
        await api.post('/housekeeping/cleaners', {
          name: optimistic.name, employmentType: optimistic.employmentType,
          vendorName: optimistic.vendorName, phone: optimistic.phone, userId: optimistic.userId,
        });
      } catch (e) { notifyFailure(e); }
    } else if (modal.id) {
      patch(modal.id, {
        name: d.name.trim(), employmentType: d.employmentType,
        vendorName: d.employmentType === 'outsourced' && d.vendorName.trim() ? d.vendorName.trim() : null,
        phone: d.phone.trim() || null,
      });
      toast({ tone: 'success', title: 'Cleaner updated.', body: `${d.name.trim()}.` });
      try { await api.patch(`/housekeeping/cleaners/${modal.id}`, { name: d.name.trim(), employmentType: d.employmentType, vendorName: d.vendorName.trim(), phone: d.phone.trim() }); }
      catch (e) { notifyFailure(e); }
    }
    setModal(null); setBusy(false);
  }

  async function toggleActive(c: Cleaner) {
    if (c.isActive && await ask({
      title: `Deactivate ${c.name}?`,
      body: 'They come off the assign picker, so no new cleaning jobs can go to them. Jobs already assigned stay as they are. You can reactivate them at any time.',
      confirmLabel: 'Deactivate', danger: true,
    }) === null) return;
    patch(c.id, { isActive: !c.isActive });
    try {
      await api.patch(`/housekeeping/cleaners/${c.id}`, { isActive: !c.isActive });
      toast({ tone: c.isActive ? 'warning' : 'success', title: c.isActive ? 'Cleaner deactivated.' : 'Cleaner reactivated.', body: `${c.name}${c.isActive ? ' is off the assign picker.' : ' is back on the roster.'}` });
    } catch (e) { patch(c.id, { isActive: c.isActive }); notifyFailure(e); }
  }

  function openEdit(c: Cleaner) {
    setModal({ mode: 'edit', id: c.id, draft: { name: c.name, employmentType: c.employmentType, vendorName: c.vendorName ?? '', phone: c.phone ?? '', userId: c.userId ?? '' } });
  }

  return (
    <>
      {confirmDialog}
      <PageHeader
        title="Cleaners"
        sub={ready ? `${plural(roster.length, 'cleaner')} on the roster · ${activeCount} active · ${internal.length} internal, ${outsourced.length} outsourced` : 'Loading the roster…'}
        actions={
          <Button size="sm" variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setModal({ mode: 'create', draft: emptyDraft('outsourced') })}>
            Add outsourced
          </Button>
        }
        primary={
          <Button size="sm" variant="primary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setModal({ mode: 'create', draft: emptyDraft('internal') })}>
            Add internal cleaner
          </Button>
        }
      />

      {error && <StaleBanner message={`Showing the last roster we have. ${error}`} onRetry={reload} />}

      <div className="flex flex-col gap-5">
        <RosterSection kind="internal" title="Internal staff" hint="Your own cleaners. With app access they sign in and get jobs on their phone." emptyTitle="No internal cleaners yet." addLabel="Add internal cleaner" onAdd={() => setModal({ mode: 'create', draft: emptyDraft('internal') })} cleaners={loading && roster.length === 0 ? null : internal} onEdit={openEdit} onToggle={toggleActive} onAccess={mayGrant ? setAccess : undefined} />
        <RosterSection kind="outsourced" title="Outsourced / third-party" hint="Outside cleaning companies you assign by hand or by rule. No login." emptyTitle="No outsourced cleaners yet." addLabel="Add outsourced" onAdd={() => setModal({ mode: 'create', draft: emptyDraft('outsourced') })} cleaners={loading && roster.length === 0 ? null : outsourced} onEdit={openEdit} onToggle={toggleActive} />
      </div>

      {access && <AccessModal cleaner={access} onClose={() => setAccess(null)} onDone={reload} />}

      {modal && (
        <FormModal
          title={modal.mode === 'create' ? (modal.draft.employmentType === 'internal' ? 'Add internal cleaner' : 'Add outsourced cleaner') : 'Edit cleaner'}
          busy={busy}
          crew={crewData?.data ?? []}
          takenUserIds={roster.map(c => c.userId).filter(Boolean) as string[]}
          currentUserId={modal.mode === 'edit' ? roster.find(c => c.id === modal.id)?.userId ?? null : null}
          draft={modal.draft}
          onChange={d => setModal(m => m && { ...m, draft: d })}
          onClose={() => setModal(null)}
          onSave={doSave}
        />
      )}
    </>
  );
}

function RosterSection({ kind, title, hint, emptyTitle, addLabel, onAdd, cleaners, onEdit, onToggle, onAccess }: {
  kind: Employment; title: string; hint: string; emptyTitle: string; addLabel: string; onAdd: () => void; cleaners: Cleaner[] | null;
  onEdit: (c: Cleaner) => void; onToggle: (c: Cleaner) => void; onAccess?: (c: Cleaner) => void;
}) {
  const columns = useMemo<Column<Cleaner>[]>(() => [
    { key: 'name', label: 'Name', value: c => c.name, hideable: false, width: 200, render: c => <span className="font-semibold">{c.name}</span> },
    ...(kind === 'outsourced' ? [{ key: 'vendor', label: 'Vendor', value: (c: Cleaner) => c.vendorName, width: 180 }] : []),
    { key: 'phone', label: 'Phone', type: 'phone', value: c => c.phone, width: 150 },
    ...(kind === 'internal' ? [{ key: 'login', label: 'App access', type: 'status' as const, value: (c: Cleaner) => appAccess(c).label,
      status: (c: Cleaner) => appAccess(c), width: 140 }] : []),
    { key: 'busy', label: 'Open jobs today', type: 'number', value: c => c.busy, width: 120 },
    { key: 'active', label: 'Status', type: 'status', value: c => (c.isActive ? 'active' : 'inactive'),
      status: c => ({ label: c.isActive ? 'Active' : 'Inactive', tone: c.isActive ? 'success' : 'neutral' }), width: 110 },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: onAccess && kind === 'internal' ? 360 : 220, align: 'right', render: c => actions(c) },
  ], [kind, onEdit, onToggle, onAccess]); // eslint-disable-line react-hooks/exhaustive-deps
  function actions(c: Cleaner) {
    return (
      <span className="flex gap-[7px] items-center justify-end">
        {onAccess && c.employmentType === 'internal' && c.isActive && (
          <Button size="sm" variant="tertiary" icon={<Icon name="KeyRound" size="sm" />} onClick={() => onAccess(c)}>
            {c.loginPhone ? 'New PIN' : 'Give app access'}
          </Button>
        )}
        <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => onEdit(c)}>Edit</Button>
        <Button size="sm" variant="tertiary" icon={<Icon name={c.isActive ? 'UserMinus' : 'UserCheck'} size="sm" />} onClick={() => onToggle(c)}>
          {c.isActive ? 'Deactivate' : 'Reactivate'}
        </Button>
      </span>
    );
  }
  return (
    <DataTable<Cleaner>
      id={`cleaners.${kind}`} urlPrefix={kind === 'internal' ? 'in.' : 'out.'} columns={columns} rows={cleaners} rowKey={c => c.id}
      pageSize={0} noun={['cleaner', 'cleaners']} exportName={kind === 'internal' ? 'cleaners-internal' : 'cleaners-outsourced'}
      rowTone={c => (c.isActive ? null : 'muted')}
      header={
        <div className="pt-5 pb-3 px-5 flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">{title}</span>
            {cleaners && <span className="text-meta text-muted-ink tabular-nums">{cleaners.length}</span>}
          </span>
          <span className="text-meta text-muted-ink">{hint}</span>
        </div>
      }
      empty={{ title: emptyTitle, body: hint, action: { label: addLabel, onClick: onAdd } }}
      renderCard={c => (
        <span className="flex flex-col gap-[3px] min-w-0">
          <span className="flex items-center gap-[9px] flex-wrap">
            <span className="text-copy font-semibold">{c.name}</span>
            {!c.isActive && <StatusBadge tone="neutral" label="Inactive" size="sm" />}
          </span>
          <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap">
            {c.vendorName && <span>Vendor: {c.vendorName}</span>}
            {c.phone && <span>{c.phone}</span>}
            <span>{c.employmentType === 'internal' ? appAccess(c).label : 'No login'}</span>
            <span>{plural(c.busy, 'open job')} today</span>
          </span>
          <span className="flex justify-start pt-1">{actions(c)}</span>
        </span>
      )}
    />
  );
}

function FormModal({ title, busy, draft, crew, takenUserIds, currentUserId, onChange, onClose, onSave }: {
  title: string; busy: boolean; draft: Draft; crew: HouseUser[]; takenUserIds: string[]; currentUserId: string | null;
  onChange: (d: Draft) => void; onClose: () => void; onSave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input,select')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const set = (p: Partial<Draft>) => onChange({ ...draft, ...p });
  const linkable = crew.filter(u => !takenUserIds.includes(u.id) || u.id === currentUserId);

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
            <label htmlFor="cl-name" className={labelCls}>Name</label>
            <input id="cl-name" value={draft.name} disabled={busy} placeholder={draft.employmentType === 'outsourced' ? 'BrightNest Crew' : 'Nurul Huda'}
              onChange={e => set({ name: e.target.value })} className={inputCls} />
          </div>

          <div className="flex flex-col gap-[7px]">
            <Select label="Employment" showLabel size="md" value={draft.employmentType} disabled={busy}
              onChange={v => set({ employmentType: v as Employment })}
              options={[{ value: 'internal', label: 'Internal staff' }, { value: 'outsourced', label: 'Outsourced / third-party' }]} />
          </div>

          {draft.employmentType === 'outsourced' && (
            <div className="flex flex-col gap-[7px]">
              <label htmlFor="cl-vendor" className={labelCls}>Vendor / company</label>
              <input id="cl-vendor" value={draft.vendorName} disabled={busy} placeholder="SparkleClean Services"
                onChange={e => set({ vendorName: e.target.value })} className={inputCls} />
            </div>
          )}

          {draft.employmentType === 'internal' && (
            <div className="flex flex-col gap-[7px]">
              <Select label="Link to a cleaner login (optional)" showLabel size="md" value={draft.userId} disabled={busy}
                onChange={v => set({ userId: v })} placeholder="No login link"
                options={linkable.map(u => ({ value: u.id, label: u.name }))} />
            </div>
          )}

          <div className="flex flex-col gap-[7px]">
            <label htmlFor="cl-phone" className={labelCls}>Phone (optional)</label>
            <input id="cl-phone" value={draft.phone} disabled={busy} placeholder="+60 12-345 6789"
              onChange={e => set({ phone: e.target.value })} className={inputCls} />
          </div>
        </div>
        <div className="py-[14px] px-5 mt-2 [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap sticky bottom-0">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!draft.name.trim()} disabledReason="Enter a name first." onClick={onSave}>Save cleaner</Button>
        </div>
      </div>
    </div>
  );
}

/** "Give app access" / "New PIN": the phone number the cleaner signs in with, then their first PIN, shown once. */
function AccessModal({ cleaner, onClose, onDone }: { cleaner: Cleaner; onClose: () => void; onDone: () => void }) {
  const [phone, setPhone] = useState(cleaner.loginPhone ?? cleaner.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [given, setGiven] = useState<{ phone: string; pin: string } | null>(null);
  const problem = phone.trim() ? phoneProblem(phone) : 'Enter the phone number they will sign in with.';
  const fresh = !cleaner.userId;
  const title = given ? `PIN for ${cleaner.name}` : cleaner.loginPhone ? `New PIN for ${cleaner.name}` : `Give ${cleaner.name} app access`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit() {
    if (busy || problem) return;
    setBusy(true); setError('');
    try {
      const r = await api.post<{ phone: string; pin: string }>(`/housekeeping/cleaners/${cleaner.id}/access`, { phone });
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
            <span>Give {cleaner.name} this PIN. It is shown only now.</span>
            <span className="self-start py-3 px-4 rounded-control bg-page border border-solid border-line text-[28px] font-semibold tracking-[0.3em] tabular-nums">{given.pin}</span>
            <span className="text-meta text-muted-ink text-pretty">
              They open <span className="font-semibold text-ink">{window.location.origin}/#/field</span> on their phone and sign in
              with <span className="font-semibold text-ink">{given.phone}</span> and this PIN. They choose their own PIN the first time.
            </span>
          </div>
        ) : (
          <div className="pt-4 px-5 pb-1 flex flex-col gap-4">
            <span className="text-meta text-muted-ink text-pretty">
              {fresh
                ? `This makes a cleaner login for ${cleaner.name}. They sign in to the field app with this phone number and a 6-digit PIN, and see only their own cleaning jobs.`
                : `${cleaner.name} will sign in with this phone number and a new 6-digit PIN. Their old PIN or password stops working and they are signed out on every phone.`}
            </span>
            <PhoneInput label="Phone number they sign in with" value={phone} onChange={setPhone} disabled={busy} required
              error={phone.trim() ? problem : undefined} />
            {error && <div role="alert" className="[border-left:2px_solid_var(--color-critical-line)] bg-critical-bg py-3 px-3.5 text-meta text-danger">{error}</div>}
          </div>
        )}
        <div className="py-[14px] px-5 mt-2 [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap sticky bottom-0">
          {given
            ? <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
            : <>
                <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy} disabled={!!problem} disabledReason={problem} onClick={submit}>
                  {cleaner.loginPhone ? 'Give new PIN' : 'Give app access'}
                </Button>
              </>}
        </div>
      </div>
    </div>
  );
}
