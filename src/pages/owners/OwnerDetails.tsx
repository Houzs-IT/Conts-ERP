import { useId, useState, type TextareaHTMLAttributes } from 'react';
import Icon from '../../components/Icon';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PhoneInput, phoneProblem } from '../../components/inputs';
import { PhoneText } from '../../components/PhoneText';
import { useToast } from '../../components/Toast';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { masked, titleCase } from '../../lib/format';
import { DetailRow, useReveal } from './PayoutDetails';
import { Modal, addressLines, type Owner } from './shared';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Who the owner is and how to reach them: name, legal name, IC / passport (masked, Show is audited), phone, email,
 * mailing address, an alternate contact and notes. Edit saves through PATCH /api/owners/:id, which writes each changed
 * field to the History. `ready` is false until migration 0110 adds the address columns: the address and alternate
 * contact are then left out of the card and the form.
 */
export function OwnerDetails({ owner, ready, canEdit, onSaved }: { owner: Owner; ready: boolean; canEdit?: boolean; onSaved?: () => void }) {
  const [editing, setEditing] = useState(false);
  const { shown, busy, reveal, reset } = useReveal(owner.id);
  const none = <span className="text-faint">Not on file</span>;
  const ic = shown.ic !== undefined ? (shown.ic || 'Not on file') : owner.icLast4 ? masked(owner.icLast4) : null;
  const address = addressLines(owner.address);
  const alt = owner.altContact;

  return (
    <Card>
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Owner details</h2>
          {canEdit && <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(true)}>Edit</Button>}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-8">
          <div className="flex flex-col">
            <DetailRow label="Name" value={titleCase(owner.displayName)} />
            <DetailRow label="Legal name" value={owner.legalName || none} />
            <DetailRow label="IC / passport" value={ic ?? none}
              reveal={owner.icLast4 ? { shown: shown.ic !== undefined, busy: busy === 'ic', onToggle: () => void reveal('ic') } : undefined} />
            <DetailRow label="Phone" value={owner.phone ? <PhoneText value={owner.phone} /> : none} />
            <DetailRow label="Email" value={owner.email ? <a href={`mailto:${owner.email}`} className="text-ink underline underline-offset-2">{owner.email}</a> : none} />
          </div>
          <div className="flex flex-col">
            {ready && <DetailRow label="Mailing address" value={address.length ? address.join('\n') : none} />}
            {ready && (
              <DetailRow label="Alternate contact" value={alt ? (
                <span className="flex flex-col items-end gap-0.5">
                  <span>{[alt.name, alt.relation && `(${alt.relation})`].filter(Boolean).join(' ') || 'No name'}</span>
                  {alt.phone && <PhoneText value={alt.phone} />}
                </span>
              ) : none} />
            )}
            <DetailRow label="Notes" value={owner.notes || none} />
          </div>
        </div>
        <span className="text-caption text-muted-ink">
          The IC / passport number shows only its last four characters; showing it in full is recorded in the history.
          {!ready && ' Mailing address and an alternate contact can be recorded here once the database update for them is applied.'}
        </span>
      </div>
      {editing && <EditDetails owner={owner} ready={ready} onClose={() => setEditing(false)} onSaved={() => { reset(); setEditing(false); onSaved?.(); }} />}
    </Card>
  );
}

function EditDetails({ owner, ready, onClose, onSaved }: { owner: Owner; ready: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const a = owner.address, c = owner.altContact;
  const [f, setF] = useState({
    displayName: owner.displayName, legalName: owner.legalName ?? '', ic: '', phone: owner.phone ?? '', email: owner.email ?? '',
    address: a?.lines ?? '', postcode: a?.postcode ?? '', city: a?.city ?? '', stateOrRegion: a?.state ?? '', country: a?.country ?? 'Malaysia',
    alternateContact: c?.name ?? '', alternateContactRelation: c?.relation ?? '', alternateContactPhone: c?.phone ?? '', notes: owner.notes ?? '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));

  const problems: Record<string, string | undefined> = {
    displayName: f.displayName.trim() ? undefined : 'Enter the owner name.',
    email: f.email.trim() && !EMAIL.test(f.email.trim()) ? 'Email does not look right. Check it, or leave it blank.' : undefined,
    phone: phoneProblem(f.phone),
    alternateContactPhone: ready ? phoneProblem(f.alternateContactPhone) : undefined,
  };
  const err = (k: string) => fields[k] ?? problems[k];
  const canSubmit = !busy && !Object.values(problems).some(Boolean);

  async function save() {
    setBusy(true); setFields({});
    // Country alone is not an address: it is saved only with something else of the address.
    const hasAddress = [f.address, f.postcode, f.city, f.stateOrRegion].some(v => v.trim());
    const body: Record<string, string> = {
      displayName: f.displayName, legalName: f.legalName, phone: f.phone, email: f.email, notes: f.notes,
      ...(f.ic.trim() ? { ic: f.ic.trim() } : {}),
      ...(ready ? {
        address: f.address, postcode: f.postcode, city: f.city, stateOrRegion: f.stateOrRegion, country: hasAddress ? f.country : '',
        alternateContact: f.alternateContact, alternateContactRelation: f.alternateContactRelation, alternateContactPhone: f.alternateContactPhone,
      } : {}),
    };
    try {
      const r = await api.patch<{ changed: boolean }>(`/owners/${encodeURIComponent(owner.id)}`, body);
      toast({ tone: 'success', title: r.changed ? 'Owner details saved.' : 'Nothing changed.', body: r.changed ? 'Each change is in the history below.' : undefined });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Owner details were not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Edit owner details" sub={`${titleCase(owner.displayName)}: name, contact details${ready ? ', address' : ''} and notes.`} onClose={onClose}
      submitLabel={busy ? 'Saving...' : 'Save details'} canSubmit={canSubmit} onSubmit={() => void save()}>
      <Field label="Owner name" maxLength={120} value={f.displayName} onChange={set('displayName')} error={err('displayName')} />
      <Field label="Legal name" placeholder="As on the IC, passport or company registration" maxLength={160} value={f.legalName} onChange={set('legalName')} error={err('legalName')} />
      <Field label="IC or passport" placeholder={owner.icLast4 ? `${masked(owner.icLast4)} (leave empty to keep)` : 'Accepts both formats'} maxLength={30}
        value={f.ic} onChange={set('ic')} error={err('ic')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PhoneInput label="Phone" value={f.phone} onChange={v => setF(s => ({ ...s, phone: v }))} error={err('phone')} />
        <Field label="Email" type="email" placeholder="owner@email.com" maxLength={160} value={f.email} onChange={set('email')} error={err('email')}
          help={owner.portalInvited ? 'Their owner portal sign-in email does not change with this.' : undefined} />
      </div>
      {ready && <>
        <TextArea label="Mailing address" placeholder={'Unit, building, street\nArea'} rows={3} maxLength={300} value={f.address} onChange={set('address')} error={err('address')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Postcode" inputMode="numeric" maxLength={12} value={f.postcode} onChange={set('postcode')} error={err('postcode')} />
          <Field label="City" maxLength={80} value={f.city} onChange={set('city')} error={err('city')} />
          <Field label="State" placeholder="e.g. Selangor" maxLength={80} value={f.stateOrRegion} onChange={set('stateOrRegion')} error={err('stateOrRegion')} />
          <Field label="Country" maxLength={80} value={f.country} onChange={set('country')} error={err('country')} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Alternate contact" placeholder="Someone to reach if the owner cannot be" maxLength={120} value={f.alternateContact} onChange={set('alternateContact')} error={err('alternateContact')} />
          <Field label="Relationship" placeholder="e.g. wife, son, agent" maxLength={60} value={f.alternateContactRelation} onChange={set('alternateContactRelation')} error={err('alternateContactRelation')} />
        </div>
        <PhoneInput label="Alternate contact phone" value={f.alternateContactPhone} onChange={v => setF(s => ({ ...s, alternateContactPhone: v }))} error={err('alternateContactPhone')} />
      </>}
      <TextArea label="Notes" rows={3} maxLength={2000} value={f.notes} onChange={set('notes')} error={err('notes')} />
      <p className="m-0 text-meta text-muted-ink">Each change is recorded in the history; the IC / passport number itself is not.</p>
    </Modal>
  );
}

function TextArea({ label, error, ...rest }: { label: string; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id} className="text-meta font-medium text-muted-ink">{label}</label>
      <textarea id={id} aria-invalid={!!error} {...rest}
        className="block w-full box-border px-3 py-[10px] border border-solid border-line rounded-control outline-none bg-card text-ink font-sans text-copy font-normal h-auto resize-y leading-[1.5]" />
      {error && <span className="text-meta text-critical">{error}</span>}
    </div>
  );
}
