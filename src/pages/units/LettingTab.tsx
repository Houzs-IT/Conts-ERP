import { useState } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { MoneyInput, DateField } from '../../components/inputs';
import { StatusBadge } from '../../components/StatusBadge';
import { SearchSelect } from '../../components/Select';
import Icon from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { date, rm, titleCase } from '../../lib/format';
import type { Tone } from '../../lib/types';
import { CentreModal, Labeled, Select } from './shared';

/** Agent to let (staff sheet UNIT, 17 Oct 2026): we find a long-term tenant for the owner. One record per search or
 *  tenancy; a rented unit is flagged 90 days before its agreement ends so it can be let again for next year. */

export type LettingStatus = 'looking' | 'rented' | 'closed';
export interface Letting {
  id: string; unitId: string; unitLabel: string; buildingId: string; building: string; ownerId: string; ownerName: string;
  status: LettingStatus; tenantName: string | null; tenantPhone: string | null; startsOn: string | null; endsOn: string | null;
  monthlyRent?: number | null; agentFee?: number | null; notes: string | null; daysLeft: number | null; remind: boolean; updatedAt: string;
}
export interface LettingsPayload { ready: boolean; remindDays: number; data: Letting[] }

export const LETTING_STATUS: Record<LettingStatus, { label: string; tone: Tone }> = {
  looking: { label: 'Looking for a tenant', tone: 'warning' },
  rented: { label: 'Rented', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};
export const leftText = (d: number | null) => (d == null ? '' : d < 0 ? `ended ${-d} ${d === -1 ? 'day' : 'days'} ago` : d === 0 ? 'ends today' : `ends in ${d} ${d === 1 ? 'day' : 'days'}`);

interface Draft { unitId: string; status: LettingStatus; tenantName: string; tenantPhone: string; startsOn: string; endsOn: string; monthlyRent: number | null; agentFee: number | null; notes: string }
const draftOf = (l: Letting | null, unitId: string): Draft => ({
  unitId: l?.unitId ?? unitId, status: l?.status ?? 'looking', tenantName: l?.tenantName ?? '', tenantPhone: l?.tenantPhone ?? '',
  startsOn: l?.startsOn ?? '', endsOn: l?.endsOn ?? '', monthlyRent: l?.monthlyRent ?? null, agentFee: l?.agentFee ?? null, notes: l?.notes ?? '',
});

/** Add or edit one record. With `units`, a unit is picked first (the Agent to let list); from a unit it is fixed. */
export function LettingModal({ letting, unitId, units, onClose, onSaved }: {
  letting: Letting | null; unitId?: string; units?: { id: string; label: string; hint?: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(draftOf(letting, unitId ?? ''));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => { setD(x => ({ ...x, ...p })); setFields({}); };
  const rented = d.status === 'rented';
  const local: Record<string, string> = {};
  if (!d.unitId) local.unitId = 'Pick the unit.';
  if (rented && !d.tenantName.trim()) local.tenantName = 'Enter the tenant.';
  if (rented && !d.startsOn) local.startsOn = 'Enter when the agreement starts.';
  if (rented && !d.endsOn) local.endsOn = 'Enter when it ends, so you are reminded to let it again.';
  if (rented && !d.monthlyRent) local.monthlyRent = 'Enter the monthly rent.';
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) local.endsOn = 'The agreement ends before it starts.';
  const err = { ...fields };
  async function save() {
    setBusy(true);
    const body = { status: d.status, tenantName: d.tenantName.trim() || null, tenantPhone: d.tenantPhone.trim() || null, startsOn: d.startsOn || null,
      endsOn: d.endsOn || null, monthlyRent: d.monthlyRent, agentFee: d.agentFee, notes: d.notes.trim() || null };
    try {
      if (letting) await api.patch(`/lettings/${letting.id}`, body);
      else await api.post('/lettings', { ...body, unitId: d.unitId });
      toast({ tone: 'success', title: letting ? 'Letting updated.' : 'Letting recorded.', body: rented ? `Reminder ${90} days before ${date(d.endsOn)}.` : LETTING_STATUS[d.status].label });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e) });
    } finally { setBusy(false); }
  }
  return (
    <CentreModal title={letting ? `Letting: ${letting.unitLabel}` : 'Record a unit to let'} sub="A unit we are finding a long-term tenant for, on the owner's behalf." onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={Object.keys(local).length > 0} disabledReason={Object.values(local)[0]} onClick={() => void save()}>{letting ? 'Save' : 'Record'}</Button></>}>
      {units && !letting && (
        <Labeled label="Unit">
          <SearchSelect label="Unit" size="md" value={d.unitId} placeholder="Search units" onChange={v => set({ unitId: v })} options={units.map(u => ({ value: u.id, label: u.label, hint: u.hint }))} />
        </Labeled>
      )}
      <Labeled label="Status">
        <Select label="Status" value={d.status} onChange={v => set({ status: v as LettingStatus })}
          options={(Object.keys(LETTING_STATUS) as LettingStatus[]).map(k => ({ value: k, label: LETTING_STATUS[k].label }))} />
      </Labeled>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
        <Field label="Tenant" placeholder="Tenant's name" value={d.tenantName} maxLength={160} error={err.tenantName ?? (rented ? local.tenantName : undefined)} onChange={e => set({ tenantName: e.target.value })} />
        <Field label="Tenant phone" placeholder="Optional" value={d.tenantPhone} maxLength={40} error={err.tenantPhone} onChange={e => set({ tenantPhone: e.target.value })} />
        <DateField label="Agreement starts" value={d.startsOn} onChange={v => set({ startsOn: v })} error={err.startsOn} />
        <DateField label="Agreement ends" value={d.endsOn} min={d.startsOn || undefined} onChange={v => set({ endsOn: v })} error={err.endsOn ?? (d.endsOn ? local.endsOn : undefined)} help="Reminded 90 days before." />
        <MoneyInput label="Monthly rent (RM)" placeholder="e.g. 1,800.00" valueSen={d.monthlyRent} onChangeSen={v => set({ monthlyRent: v })} error={err.monthlyRent} />
        <MoneyInput label="Our agent fee (RM)" placeholder="e.g. 900.00" valueSen={d.agentFee} onChangeSen={v => set({ agentFee: v })} error={err.agentFee} />
      </div>
      <Field label="Notes" placeholder="Optional" value={d.notes} maxLength={2000} onChange={e => set({ notes: e.target.value })} />
    </CentreModal>
  );
}

/** The unit's Agent to let tab: its records, newest first, and Record / Edit. */
export default function LettingTab({ unitId, canEdit, money }: { unitId: string; canEdit: boolean; money: boolean }) {
  const { data, loading, error, reload } = useApi<LettingsPayload>(`/lettings?unitId=${encodeURIComponent(unitId)}`);
  const [modal, setModal] = useState<null | { letting: Letting | null }>(null);
  const list = data?.data ?? [];
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Agent to let</span>
          <span className="text-meta text-muted-ink">Finding a long-term tenant for the owner. Once rented, you are reminded 90 days before the agreement ends to let it again. <a href="#/properties/agent-to-let" className="text-gold-ink">All units to let</a></span>
        </div>
        {canEdit && data?.ready !== false && <Button size="sm" variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setModal({ letting: null })}>Record a letting</Button>}
      </div>
      {loading && !data ? <div className="p-5 text-copy text-muted-ink">Loading…</div>
        : error ? <div className="p-5 text-copy text-muted-ink">{error}</div>
        : data?.ready === false ? <div className="p-5 text-copy text-muted-ink">Agent to let needs the latest database update.</div>
        : list.length === 0 ? <div className="p-5 text-copy text-muted-ink">This unit is not being let for the owner.</div>
        : list.map(l => (
          <div key={l.id} className="flex flex-wrap items-start justify-between gap-3 py-4 px-5 [border-top:1px_solid_var(--color-line-soft)] first:[border-top:none]">
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={LETTING_STATUS[l.status].tone} label={LETTING_STATUS[l.status].label} />
                {l.remind && <StatusBadge tone="critical" label={`Let it again: ${leftText(l.daysLeft)}`} />}
              </span>
              {l.tenantName && <span className="text-copy font-medium">{titleCase(l.tenantName)}{l.tenantPhone ? ` · ${l.tenantPhone}` : ''}</span>}
              {(l.startsOn || l.endsOn) && <span className="text-meta text-muted-ink">{l.startsOn ? date(l.startsOn) : '?'} to {l.endsOn ? date(l.endsOn) : '?'}{l.status === 'rented' && l.daysLeft != null && !l.remind ? ` · ${leftText(l.daysLeft)}` : ''}</span>}
              {money && (l.monthlyRent != null || l.agentFee != null) && <span className="text-meta text-muted-ink">{l.monthlyRent != null ? `Rent ${rm(l.monthlyRent)} a month` : ''}{l.monthlyRent != null && l.agentFee != null ? ' · ' : ''}{l.agentFee != null ? `Agent fee ${rm(l.agentFee)}` : ''}</span>}
              {l.notes && <span className="text-meta text-muted-ink whitespace-pre-line">{l.notes}</span>}
            </div>
            {canEdit && <Button size="sm" variant="secondary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setModal({ letting: l })}>Edit</Button>}
          </div>
        ))}
      {modal && <LettingModal letting={modal.letting} unitId={unitId} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </Card>
  );
}
