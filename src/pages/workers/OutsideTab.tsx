import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';
import { StaleBanner } from '../../components/DataState';
import { DataTable, type Column } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { Field } from '../../components/Field';
import { PhoneInput, phoneProblem } from '../../components/inputs';
import { PillTabs } from '../../components/ops/OpsUi';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useApi } from '../../lib/useApi';
import { api, notifyFailure } from '../../lib/api';
import { mayWork } from '../../lib/areaAccess';
import { useSession } from '../../lib/session';
import { plural } from '../../lib/format';
import { CLEANER_FALLBACK, type Cleaner } from '../../lib/useCleaners';

/* ------------------------------------------------------------------ *
 * HR > Employees > Outside Companies: the cleaning and repair companies
 * the office hands jobs to. They have no login and no pay record here, so
 * they are not on Employee Master; the assign pickers on Cleaning and
 * Maintenance read this list. (Was Operations > Workers.)
 * ------------------------------------------------------------------ */

type ListKey = 'cleaners' | 'technicians';

interface ListConfig { label: string; noun: string; listUrl: string; api: string; busyLabel: string; busyToday: boolean; vendorLabel: string; vendorPh: string; namePh: string; hint: string; offBody: string }

const LISTS: Record<ListKey, ListConfig> = {
  cleaners: {
    label: 'Cleaners', noun: 'cleaner', listUrl: '/housekeeping/cleaners', api: '/housekeeping/cleaners',
    busyLabel: 'Open jobs today', busyToday: true, vendorLabel: 'Vendor / company', vendorPh: 'SparkleClean Services', namePh: 'BrightNest Crew',
    hint: 'Outside cleaning companies you assign by hand or by rule. No login.',
    offBody: 'They come off the assign picker, so no new cleaning jobs can go to them. Jobs already assigned stay as they are. You can switch them back on at any time.',
  },
  technicians: {
    label: 'Technicians', noun: 'contractor', listUrl: '/maintenance/technicians?all=1', api: '/maintenance/technicians',
    busyLabel: 'Open jobs', busyToday: false, vendorLabel: 'Company', vendorPh: 'Ah Seng Plumbing Sdn Bhd', namePh: 'Ah Seng Plumbing',
    hint: 'Outside companies you give repair jobs to. No login: tell them about the job yourself.',
    offBody: 'They come off "who fixes it", so no new repair jobs can go to them. Jobs already given to them stay as they are. You can switch them back on at any time.',
  },
};

interface Draft { name: string; vendorName: string; phone: string }

export default function OutsideTab() {
  const [params, setParams] = useSearchParams();
  const list: ListKey = params.get('list') === 'technicians' ? 'technicians' : 'cleaners';
  const tabs = (
    <PillTabs<ListKey> value={list} onChange={l => setParams(p => { const n = new URLSearchParams(p); n.set('list', l); return n; }, { replace: true })}
      tabs={[{ value: 'cleaners', label: 'Cleaners' }, { value: 'technicians', label: 'Technicians' }]} />
  );
  return <OutsideList key={list} list={list} tabs={tabs} />;
}

function OutsideList({ list, tabs }: { list: ListKey; tabs: ReactNode }) {
  const cfg = LISTS[list];
  const { data, loading, error, reload } = useApi<{ data: Cleaner[] }>(cfg.listUrl, list === 'cleaners' ? CLEANER_FALLBACK : undefined);
  const toast = useToast();
  const [confirmDialog, ask] = useConfirm();
  const { user } = useSession();
  // Same rule as the roster routes: Operations.
  const mayEdit = mayWork(user, 'operations');
  const [form, setForm] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const outside = (data?.data ?? []).filter(w => w.employmentType === 'outsourced');

  async function save() {
    if (!form) return;
    const name = form.draft.name.trim();
    const vendorName = form.draft.vendorName.trim();
    const phone = form.draft.phone.trim();
    setBusy(true);
    try {
      if (form.id) await api.patch(`${cfg.api}/${form.id}`, { name, vendorName, phone });
      else await api.post(cfg.api, { name, employmentType: 'outsourced', vendorName: vendorName || null, phone: phone || null });
      toast({ tone: 'success', title: form.id ? 'Saved.' : 'Added.', body: vendorName ? `${name} · ${vendorName}` : name });
      setForm(null);
      reload();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }

  async function toggle(w: Cleaner) {
    if (w.isActive && await ask({ title: `Switch off ${w.name}?`, body: cfg.offBody, confirmLabel: 'Switch off', danger: true }) === null) return;
    try {
      await api.patch(`${cfg.api}/${w.id}`, { isActive: !w.isActive });
      toast({ tone: w.isActive ? 'warning' : 'success', title: w.isActive ? `${w.name} switched off.` : `${w.name} switched on.`, body: w.isActive ? 'No new jobs can go to them.' : 'They can be given jobs again.' });
      reload();
    } catch (e) { notifyFailure(e); }
  }

  const edit = (w: Cleaner) => setForm({ id: w.id, draft: { name: w.name, vendorName: w.vendorName ?? '', phone: w.phone ?? '' } });
  const add = () => setForm({ id: null, draft: { name: '', vendorName: '', phone: '' } });

  const actions = (w: Cleaner) => mayEdit ? (
    <span className="flex gap-[7px] items-center justify-end">
      <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => edit(w)}>Edit</Button>
      <Button size="sm" variant="tertiary" icon={<Icon name={w.isActive ? 'UserMinus' : 'UserCheck'} size="sm" />} onClick={() => void toggle(w)}>
        {w.isActive ? 'Switch off' : 'Switch on'}
      </Button>
    </span>
  ) : null;

  const columns = useMemo<Column<Cleaner>[]>(() => [
    { key: 'name', label: 'Name', value: w => w.name, hideable: false, width: 200, render: w => <span className="font-semibold">{w.name}</span> },
    { key: 'vendor', label: cfg.vendorLabel, value: w => w.vendorName, width: 180 },
    { key: 'phone', label: 'Phone', type: 'phone', value: w => w.phone, width: 150 },
    { key: 'busy', label: cfg.busyLabel, type: 'number', value: w => w.busy, width: 120 },
    { key: 'active', label: 'Status', type: 'status', value: w => (w.isActive ? 'active' : 'inactive'),
      status: w => ({ label: w.isActive ? 'Active' : 'Switched off', tone: w.isActive ? 'success' : 'neutral' }), width: 120 },
    { key: 'go', label: '', noExport: true, sortable: false, filter: false, width: 220, align: 'right', render: actions },
  ], [cfg, mayEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {confirmDialog}
      <div className="mb-4">{tabs}</div>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <DataTable<Cleaner>
        id={`${list}.outside`} columns={columns} rows={loading && !data ? null : outside} rowKey={w => w.id}
        pageSize={0} noun={[cfg.noun, `${cfg.noun}s`]} exportName={`${list}-outside`}
        rowTone={w => (w.isActive ? null : 'muted')}
        header={
          <div className="pt-5 pb-3 px-5 flex items-center justify-between gap-3 flex-wrap [border-bottom:1px_solid_var(--color-line-soft)]">
            <span className="flex flex-col gap-0.5">
              <span className="text-[16px] font-semibold tracking-[-0.01em]">Outside {cfg.label.toLowerCase()} <span className="text-meta font-normal text-muted-ink tabular-nums">{data ? outside.length : ''}</span></span>
              <span className="text-meta text-muted-ink">{cfg.hint}</span>
            </span>
            {mayEdit && <Button size="sm" variant="primary" icon={<Icon name="UserPlus" size="sm" />} onClick={add}>Add {cfg.noun}</Button>}
          </div>
        }
        empty={{ title: `No outside ${cfg.label.toLowerCase()} yet.`, body: cfg.hint, action: mayEdit ? { label: `Add ${cfg.noun}`, onClick: add } : undefined }}
        renderCard={w => (
          <span className="flex flex-col gap-[3px] min-w-0">
            <span className="flex items-center gap-[9px] flex-wrap">
              <span className="text-copy font-semibold">{w.name}</span>
              {!w.isActive && <StatusBadge tone="neutral" label="Switched off" size="sm" />}
            </span>
            <span className="text-meta text-muted-ink flex gap-x-3 flex-wrap">
              {w.vendorName && <span>{cfg.vendorLabel}: {w.vendorName}</span>}
              {w.phone && <span>{w.phone}</span>}
              <span>{plural(w.busy, 'open job')}{cfg.busyToday ? ' today' : ''}</span>
            </span>
            <span className="flex justify-start pt-1">{actions(w)}</span>
          </span>
        )}
      />

      {form && (
        <Modal title={form.id ? `Edit ${cfg.noun}` : `Add ${cfg.noun}`} onClose={() => !busy && setForm(null)}
          footer={<>
            <Button size="sm" variant="secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!form.draft.name.trim() || !!phoneProblem(form.draft.phone)} disabledReason="Enter a name first." onClick={() => void save()}>Save</Button>
          </>}>
          <div className="flex flex-col gap-4">
            <Field label="Name" value={form.draft.name} onChange={e => setForm({ ...form, draft: { ...form.draft, name: e.target.value } })} placeholder={cfg.namePh} disabled={busy} />
            <Field label={cfg.vendorLabel} value={form.draft.vendorName} onChange={e => setForm({ ...form, draft: { ...form.draft, vendorName: e.target.value } })} placeholder={cfg.vendorPh} disabled={busy} />
            <PhoneInput label="Phone (optional)" value={form.draft.phone} onChange={v => setForm({ ...form, draft: { ...form.draft, phone: v } })} disabled={busy} error={phoneProblem(form.draft.phone)} />
          </div>
        </Modal>
      )}
    </>
  );
}
