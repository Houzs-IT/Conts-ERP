import { useEffect, useRef, useState } from 'react';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useToast } from '../components/Toast';
import { useApi } from '../lib/useApi';
import { useCleaners, type Cleaner, type Employment } from '../lib/useCleaners';
import { api, notifyFailure } from '../lib/api';
import type { Tone } from '../lib/types';

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
const EMPLOYMENT_TONE: Record<Employment, Tone> = { internal: 'info', outsourced: 'warning' };

const inputCls = 'block w-full box-border h-10 px-3 py-0 text-ink bg-white border border-solid border-line rounded-control outline-none [font:inherit]';
const labelCls = 'text-[12px] font-medium text-muted-ink';

interface HouseUser { id: string; name: string; busy: number }

interface Draft { name: string; employmentType: Employment; vendorName: string; phone: string; userId: string }
const emptyDraft = (employmentType: Employment): Draft => ({ name: '', employmentType, vendorName: '', phone: '', userId: '' });

export default function CleanersPage() {
  const { cleaners, loading, error, reload } = useCleaners(false);
  const { data: crewData } = useApi<{ data: HouseUser[] }>('/housekeeping/crew?scope=housekeeping', { data: [] });
  const toast = useToast();

  const [added, setAdded] = useState<Cleaner[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Cleaner>>>({});
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; id?: string; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);

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
    patch(c.id, { isActive: !c.isActive });
    toast({ tone: c.isActive ? 'warning' : 'success', title: c.isActive ? 'Cleaner deactivated.' : 'Cleaner reactivated.', body: `${c.name}${c.isActive ? ' is off the assign picker.' : ' is back on the roster.'}` });
    try { await api.patch(`/housekeeping/cleaners/${c.id}`, { isActive: !c.isActive }); } catch (e) { notifyFailure(e); }
  }

  function openEdit(c: Cleaner) {
    setModal({ mode: 'edit', id: c.id, draft: { name: c.name, employmentType: c.employmentType, vendorName: c.vendorName ?? '', phone: c.phone ?? '', userId: c.userId ?? '' } });
  }

  return (
    <>
      <PageHeader
        title="Cleaners"
        sub={`${roster.length} on the roster · ${activeCount} active · ${internal.length} internal, ${outsourced.length} outsourced`}
        right={
          <div className="flex gap-[9px] flex-wrap">
            <Button variant="secondary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setModal({ mode: 'create', draft: emptyDraft('outsourced') })}>
              Add outsourced
            </Button>
            <Button variant="primary" icon={<Icon name="UserPlus" size="sm" />} onClick={() => setModal({ mode: 'create', draft: emptyDraft('internal') })}>
              Add internal cleaner
            </Button>
          </div>
        }
      />

      {error && <StaleBanner message={`Showing the last roster we have. ${error}`} onRetry={reload} />}

      {loading && roster.length === 0 ? (
        <Card><TableSkeleton rows={4} cols={4} /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          <RosterSection title="Internal staff" hint="Your own housekeepers — they log in and get push jobs." tone="info" cleaners={internal} onEdit={openEdit} onToggle={toggleActive} />
          <RosterSection title="Outsourced / third-party" hint="Vendor crews you assign by hand or by rule — no login." tone="warning" cleaners={outsourced} onEdit={openEdit} onToggle={toggleActive} />
        </div>
      )}

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

function RosterSection({ title, hint, tone, cleaners, onEdit, onToggle }: {
  title: string; hint: string; tone: Tone; cleaners: Cleaner[]; onEdit: (c: Cleaner) => void; onToggle: (c: Cleaner) => void;
}) {
  return (
    <Card>
      <div className="py-[13px] px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line)]">
        <span className="text-[16px] font-semibold flex items-center gap-2"><Badge tone={tone} label={String(cleaners.length)} size="sm" />{title}</span>
        <span className="text-[12px] text-muted-ink">{hint}</span>
      </div>
      {cleaners.length === 0 ? (
        <div className="py-[26px] px-[22px] text-[13px] text-muted-ink">None yet.</div>
      ) : (
        cleaners.map(c => (
          <div key={c.id} className={`flex gap-[18px] py-[13px] px-5 flex-wrap items-center [border-bottom:1px_solid_var(--color-line-soft)] ${c.isActive ? '' : 'opacity-[0.6]'}`}>
            <div className="flex-1 min-w-[220px] flex flex-col gap-[3px]">
              <div className="flex items-center gap-[9px] flex-wrap">
                <span className="text-[14px] font-semibold">{c.name}</span>
                <Badge tone={EMPLOYMENT_TONE[c.employmentType]} label={EMPLOYMENT_LABEL[c.employmentType]} size="sm" />
                {!c.isActive && <Badge tone="neutral" label="Inactive" size="sm" />}
              </div>
              <div className="text-[12.5px] text-muted-ink flex gap-[16px] flex-wrap">
                {c.vendorName && <span>Vendor: {c.vendorName}</span>}
                {c.phone && <span>{c.phone}</span>}
                <span>{c.employmentType === 'internal' ? (c.userId ? 'Linked login' : 'No login link') : 'No login'}</span>
                <span>{c.busy} open job{c.busy === 1 ? '' : 's'} today</span>
              </div>
            </div>
            <div className="flex gap-[7px] items-center">
              <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => onEdit(c)}>Edit</Button>
              <Button size="sm" variant="tertiary" icon={<Icon name={c.isActive ? 'UserMinus' : 'UserCheck'} size="sm" />} onClick={() => onToggle(c)}>
                {c.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          </div>
        ))
      )}
    </Card>
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
      className="fixed inset-0 z-[60] grid place-items-center p-6 bg-[var(--color-surface-scrim)] [animation:fade-in_var(--motion-standard)_var(--ease-out)_both]">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0" />
      <div ref={ref} className="relative w-full max-w-[460px] max-h-[88vh] overflow-y-auto bg-card rounded-card shadow-[var(--shadow-overlay)] animate-dialog">
        <div className="pt-5 px-[22px] pb-1 flex items-start justify-between gap-3">
          <h2 className="m-0 text-[18px] leading-[1.3] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" disabled={busy} className="bg-transparent border-none p-1 cursor-pointer text-muted-ink flex"><Icon name="X" size="sm" /></button>
        </div>
        <div className="pt-[14px] px-[22px] pb-1 flex flex-col gap-[14px]">
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="cl-name" className={labelCls}>Name</label>
            <input id="cl-name" value={draft.name} disabled={busy} placeholder={draft.employmentType === 'outsourced' ? 'BrightNest Crew' : 'Nurul Huda'}
              onChange={e => set({ name: e.target.value })} className={inputCls} />
          </div>

          <div className="flex flex-col gap-[7px]">
            <label htmlFor="cl-emp" className={labelCls}>Employment</label>
            <select id="cl-emp" value={draft.employmentType} disabled={busy}
              onChange={e => set({ employmentType: e.target.value as Employment })} className={inputCls}>
              <option value="internal">Internal staff</option>
              <option value="outsourced">Outsourced / third-party</option>
            </select>
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
              <label htmlFor="cl-user" className={labelCls}>Link to a housekeeper login (optional)</label>
              <select id="cl-user" value={draft.userId} disabled={busy}
                onChange={e => set({ userId: e.target.value })} className={inputCls}>
                <option value="">No login link</option>
                {linkable.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-[7px]">
            <label htmlFor="cl-phone" className={labelCls}>Phone (optional)</label>
            <input id="cl-phone" value={draft.phone} disabled={busy} placeholder="+60 12-345 6789"
              onChange={e => set({ phone: e.target.value })} className={inputCls} />
          </div>
        </div>
        <div className="py-[14px] px-[22px] mt-2 [border-top:1px_solid_var(--color-line)] bg-page flex items-center justify-end gap-[9px] flex-wrap sticky bottom-0">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!draft.name.trim()} disabledReason="Enter a name first." onClick={onSave}>Save cleaner</Button>
        </div>
      </div>
    </div>
  );
}
