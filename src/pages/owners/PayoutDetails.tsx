import { useState } from 'react';
import Icon from '../../components/Icon';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { PhoneInput, phoneProblem } from '../../components/inputs';
import { PhoneText } from '../../components/PhoneText';
import { useToast } from '../../components/Toast';
import { api, errorMessage } from '../../lib/api';
import { masked, titleCase } from '../../lib/format';
import { bankName } from '../../lib/vocabulary';
import { BANKS } from '../units/shared';
import { Section, Modal, type Owner } from './shared';

/** Full IC / bank number on request. "Show" asks the server once and every reveal is in the audit log
 *  (GET /api/owners/:id/reveal); "Hide" puts the mask back; nothing is kept after leaving the page. */
function useReveal(ownerId: string) {
  const toast = useToast();
  const [shown, setShown] = useState<{ ic?: string; bank?: string }>({});
  const [busy, setBusy] = useState<'ic' | 'bank' | null>(null);
  async function reveal(field: 'ic' | 'bank') {
    if (shown[field] !== undefined) { setShown(s => ({ ...s, [field]: undefined })); return; }
    setBusy(field);
    try {
      const r = await api.get<{ value: string }>(`/owners/${encodeURIComponent(ownerId)}/reveal`, { field });
      setShown(s => ({ ...s, [field]: r.value }));
    } catch (e) {
      toast({ tone: 'critical', title: 'Not shown.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(null); }
  }
  return { shown, busy, reveal };
}

function Row({ label, value, reveal }: { label: string; value: React.ReactNode; reveal?: { on: boolean; busy: boolean; toggle: () => void } }) {
  return (
    <div className="flex items-start justify-between gap-3 py-[7px] [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
      <span className="text-meta text-muted-ink flex-none">{label}</span>
      <span className="flex items-center gap-2 min-w-0 text-right">
        <span className="text-copy text-ink tabular-nums [overflow-wrap:anywhere]">{value}</span>
        {reveal && (
          <button type="button" onClick={reveal.toggle} disabled={reveal.busy}
            aria-label={reveal.on ? `Hide ${label}` : `Show full ${label}`}
            title={reveal.on ? 'Hide' : 'Show the full number. This is recorded in the audit log.'}
            className="inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer font-sans text-meta font-medium text-gold-ink">
            <Icon name={reveal.on ? 'EyeOff' : 'Eye'} size="sm" />
            {reveal.on ? 'Hide' : 'Show'}
          </button>
        )}
      </span>
    </div>
  );
}

const notOnFile = <span className="text-muted-ink">Not on file</span>;

/** The owner's own details: the only place they are changed (the Units screen shows them read-only). */
export function OwnerDetails({ owner, canEdit, onSaved }: { owner: Owner; canEdit: boolean; onSaved: () => void }) {
  const { shown, busy, reveal } = useReveal(owner.id);
  const [editing, setEditing] = useState(false);
  const ic = shown.ic !== undefined ? (shown.ic || 'Not on file') : owner.icLast4 ? masked(owner.icLast4) : null;
  return (
    <Section title="Details" action={canEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(true)}>Edit</Button> : undefined}>
      <div className="flex flex-col">
        <Row label="Name" value={titleCase(owner.displayName)} />
        <Row label="Legal name" value={owner.legalName || notOnFile} />
        <Row label="IC / passport" value={ic ?? notOnFile} reveal={owner.icLast4 ? { on: shown.ic !== undefined, busy: busy === 'ic', toggle: () => reveal('ic') } : undefined} />
        <Row label="Phone" value={owner.phone ? <PhoneText value={owner.phone} /> : notOnFile} />
        <Row label="Email" value={owner.email || notOnFile} />
        <Row label="Address" value={owner.address || notOnFile} />
        {owner.notes && <Row label="Notes" value={owner.notes} />}
      </div>
      {editing && <DetailsModal owner={owner} ic={shown.ic} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />}
    </Section>
  );
}

function DetailsModal({ owner, ic, onClose, onSaved }: { owner: Owner; ic?: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    displayName: owner.displayName, legalName: owner.legalName ?? '', ic: ic ?? (owner.icLast4 ? masked(owner.icLast4) : ''),
    phone: owner.phone ?? '', email: owner.email ?? '', address: owner.address ?? '', notes: owner.notes ?? '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  const emailBad = f.email.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  const ok = f.displayName.trim() !== '' && !emailBad && !phoneProblem(f.phone) && !busy;
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/owners/${encodeURIComponent(owner.id)}`, { details: f });
      toast({ tone: 'success', title: 'Owner details saved.' });
      onSaved();
    } catch (e) {
      const body = (e as { fields?: Record<string, string> }).fields;
      if (body) setFields(body);
      toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }
  return (
    <Modal title="Edit owner details" sub="Used on statements, reports and the owner portal. Payout details are edited separately." onClose={onClose} submitLabel={busy ? 'Saving…' : 'Save details'} canSubmit={ok} onSubmit={save}>
      <Field label="Name" value={f.displayName} onChange={set('displayName')} error={fields.displayName ?? (f.displayName.trim() ? undefined : 'Enter the owner\'s name.')} />
      <Field label="Legal name" placeholder="As on the IC or company registration" value={f.legalName} onChange={set('legalName')} error={fields.legalName} />
      <Field label="IC / passport" value={f.ic} onChange={set('ic')} help={owner.icLast4 && !ic ? 'Shown masked. Type a new number to replace it, or leave it as it is.' : undefined} error={fields.ic} />
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <PhoneInput label="Phone" value={f.phone} onChange={v => setF(s => ({ ...s, phone: v }))} error={fields.phone} />
        <Field label="Email" type="email" value={f.email} onChange={set('email')} error={fields.email ?? (emailBad ? 'Enter an email like name@example.com, or leave it empty.' : undefined)} />
      </div>
      <Field label="Address" value={f.address} onChange={set('address')} error={fields.address} />
      <Field label="Notes" placeholder="For staff only" value={f.notes} onChange={set('notes')} error={fields.notes} />
    </Modal>
  );
}

/** Where the owner's payouts go. The only place payout details are changed; Units and Payouts link here
 *  (#/owners/:id?edit=payout opens the editor). Numbers show their last four only; "Show" is audited. */
export function PayoutDetails({ owner, canEdit, onSaved, startEditing }: { owner: Owner; canEdit: boolean; onSaved: () => void; startEditing?: boolean }) {
  const { shown, busy, reveal } = useReveal(owner.id);
  const [editing, setEditing] = useState(!!startEditing && canEdit);
  const acct = shown.bank !== undefined ? (shown.bank || 'Not on file') : owner.bankAccountLast4 ? masked(owner.bankAccountLast4) : null;
  return (
    <Section title="Payout details" action={canEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(true)}>Edit</Button> : undefined}>
      <div className="flex flex-col">
        <Row label="Bank" value={bankName(owner.bankName) ?? notOnFile} />
        <Row label="Account" value={acct ?? notOnFile} reveal={owner.bankAccountLast4 ? { on: shown.bank !== undefined, busy: busy === 'bank', toggle: () => reveal('bank') } : undefined} />
        <Row label="Account holder" value={owner.accountHolder ?? notOnFile} />
      </div>
      <span className="text-caption text-muted-ink">Only the last four digits are shown. Showing the full number is recorded in the audit log.</span>
      {editing && <PayoutModal owner={owner} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />}
    </Section>
  );
}

function PayoutModal({ owner, onClose, onSaved }: { owner: Owner; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [bank, setBank] = useState(owner.bankName ?? '');
  const [account, setAccount] = useState('');
  const [holder, setHolder] = useState(owner.accountHolder ?? owner.displayName);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const digits = account.replace(/[\s-]/g, '');
  const accountBad = digits !== '' && !/^\d{6,20}$/.test(digits);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/owners/${encodeURIComponent(owner.id)}`, { payout: { bankName: bank, bankAccount: digits, accountHolder: holder } });
      toast({ tone: 'success', title: 'Payout details saved.', body: 'The next payout goes to this account.' });
      onSaved();
    } catch (e) {
      const body = (e as { fields?: Record<string, string> }).fields;
      if (body) setFields(body);
      toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }
  const banks = [...new Set([...BANKS, ...(owner.bankName && !BANKS.includes(owner.bankName) ? [owner.bankName] : [])])];
  return (
    <Modal title="Edit payout details" sub={`Where ${titleCase(owner.displayName)}'s payouts are sent. Every change is recorded.`} onClose={onClose}
      submitLabel={busy ? 'Saving…' : 'Save payout details'} canSubmit={!busy && !accountBad && bank !== ''} onSubmit={save}>
      <div className="flex flex-col gap-[7px]">
        <span className="text-meta font-medium text-muted-ink">Bank</span>
        <Select size="md" label="Bank" value={bank} onChange={setBank} options={[{ value: '', label: 'Choose a bank' }, ...banks.map(b => ({ value: b, label: bankName(b) ?? b }))]} />
      </div>
      <Field label="Account number" inputMode="numeric" placeholder={owner.bankAccountLast4 ? `Now ${masked(owner.bankAccountLast4)}; type a new number to replace it` : 'e.g. 5141 2345 6789'}
        value={account} onChange={e => setAccount(e.target.value)} error={fields.bankAccount ?? (accountBad ? 'Enter the account number: 6 to 20 digits.' : undefined)}
        help={owner.bankAccountLast4 ? 'Leave empty to keep the current account number.' : undefined} />
      <Field label="Account holder" value={holder} onChange={e => setHolder(e.target.value)} error={fields.accountHolder} />
    </Modal>
  );
}
