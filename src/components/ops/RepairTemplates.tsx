import { SearchSelect, Select } from '../Select';
import { useApi } from '../../lib/useApi';
import { cx } from '../../lib/design-tokens';
import { FormRow, INPUT, CATEGORY } from './OpsUi';

/* GET /api/maintenance/templates (functions/api/maintenance/templates.ts) */
export interface RepairTemplate {
  id: string; name: string; category: string; urgency: 'normal' | 'urgent'; assigneeKind: 'in_house' | 'contractor' | null;
  technicianId: string | null; technicianName: string | null; contractorName: string | null;
  estimatedCost: number | null; blocksUnit: boolean; instructions: string | null; archived: boolean; archivedAt: string | null;
  steps: { label: string }[]; parts: { skuId: string; code: string; name: string; unitLabel: string; qty: number; active: boolean }[];
  usedCount: number; updatedAt: string;
}
export interface TemplatesPayload { data: RepairTemplate[]; canEdit: boolean }
/* GET /api/maintenance/technicians */
export interface Technicians { data: { id: string; name: string; phone: string | null }[]; contractors: string[] }

export const useTemplates = (archived = false) => useApi<TemplatesPayload>(`/maintenance/templates${archived ? '?archived=1' : ''}`);
export const useTechnicians = (on = true) => useApi<Technicians>(on ? '/maintenance/technicians' : null);

/** "Use template": picking one fills the form it sits in; every field stays editable. */
export function TemplatePicker({ templates, value, onPick }: { templates: RepairTemplate[] | null; value: string; onPick: (t: RepairTemplate | null) => void }) {
  const live = (templates ?? []).filter(t => !t.archived);
  return (
    <FormRow label="Use template (optional)" hint={live.length ? 'Fills the fields below. You can still change any of them.' : templates ? 'No templates yet. Add them under Maintenance > Templates.' : undefined}>
      <SearchSelect label="Use template" value={value} size="md" placeholder={templates ? 'Search templates' : 'Loading templates'}
        allLabel="No template" onChange={v => onPick(live.find(t => t.id === v) ?? null)}
        options={live.map(t => ({ value: t.id, label: t.name, group: CATEGORY[t.category] ?? t.category, hint: t.urgency === 'urgent' ? 'Urgent' : undefined }))} />
    </FormRow>
  );
}

export type AssigneeKind = '' | 'in_house' | 'contractor';
export interface Assignee { kind: AssigneeKind; technicianId: string; contractor: string }

/** Who does the work: an in-house technician picked by ACCOUNT (the job shows on their phone), or a contractor by name. */
export function AssigneeFields({ value, onChange, technicians, allowNone = true, error, label = 'Assign to' }: {
  value: Assignee; onChange: (v: Assignee) => void; technicians: Technicians | null; allowNone?: boolean; error?: string | null; label?: string;
}) {
  const kinds = [...(allowNone ? [{ value: '', label: 'Nobody yet' }] : []), { value: 'in_house', label: 'In-house technician' }, { value: 'contractor', label: 'Contractor' }];
  const listId = 'repair-contractor-names';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-3">
      <FormRow label={label}>
        <select className={INPUT} value={value.kind} aria-label="In-house or contractor" onChange={e => onChange({ ...value, kind: e.target.value as AssigneeKind })}>
          {kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </FormRow>
      {value.kind === 'in_house' && (
        <FormRow label="Technician" error={error} hint={technicians && !technicians.data.length ? 'No technician accounts yet. Add one under Users and roles.' : 'The job shows on this person\'s phone.'}>
          <Select label="Technician" size="md" value={value.technicianId} onChange={v => onChange({ ...value, technicianId: v })} placeholder="Pick a technician"
            options={(technicians?.data ?? []).map(t => ({ value: t.id, label: t.name }))} className="w-full" />
        </FormRow>
      )}
      {value.kind === 'contractor' && (
        <FormRow label="Contractor" error={error}>
          <input className={cx(INPUT)} list={listId} value={value.contractor} onChange={e => onChange({ ...value, contractor: e.target.value })} placeholder="Company or person" maxLength={80} />
          <datalist id={listId}>{(technicians?.contractors ?? []).map(c => <option key={c} value={c} />)}</datalist>
        </FormRow>
      )}
    </div>
  );
}

/** The assignee a template suggests. */
export const assigneeOf = (t: RepairTemplate): Assignee => ({
  kind: t.assigneeKind ?? '', technicianId: t.assigneeKind === 'in_house' ? t.technicianId ?? '' : '', contractor: t.assigneeKind === 'contractor' ? t.contractorName ?? '' : '',
});

/** The body fields for POST/PATCH /api/maintenance/issues from an Assignee, or a message when it is incomplete. */
export function assigneeBody(a: Assignee): { body: Record<string, string>; error: string | null } {
  if (a.kind === 'in_house') return a.technicianId ? { body: { assigneeUserId: a.technicianId }, error: null } : { body: {}, error: 'Pick the technician.' };
  if (a.kind === 'contractor') return a.contractor.trim() ? { body: { assigneeName: a.contractor.trim(), assigneeKind: 'contractor' }, error: null } : { body: {}, error: 'Name the contractor.' };
  return { body: {}, error: null };
}
