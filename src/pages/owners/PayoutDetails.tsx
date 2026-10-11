import { useState } from 'react';
import Icon from '../../components/Icon';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { useToast } from '../../components/Toast';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { masked, titleCase } from '../../lib/format';
import { bankName, BANK_NAME } from '../../lib/vocabulary';
import { BANKS } from '../units/shared';
import { Section, Modal, type Owner } from './shared';

/**
 * IC / passport and bank account show only their last four characters, matching the Payouts screen's
 * promise. "Show" asks the server for the full value once; every reveal is in the audit log
 * (GET /api/owners/:id/reveal). "Hide" puts the mask back; nothing is kept after leaving the page.
 */
export function PayoutDetails({ owner, canEdit, onSaved }: { owner: Owner; canEdit?: boolean; onSaved?: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState<{ ic?: string; bank?: string }>({});
  const [busy, setBusy] = useState<'ic' | 'bank' | null>(null);

  async function reveal(field: 'ic' | 'bank') {
    if (shown[field] !== undefined) { setShown(s => ({ ...s, [field]: undefined })); return; }
    setBusy(field);
    try {
      const r = await api.get<{ value: string }>(`/owners/${encodeURIComponent(owner.id)}/reveal`, { field });
      setShown(s => ({ ...s, [field]: r.value }));
    } catch (e) {
      toast({ tone: 'critical', title: 'Not shown.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(null); }
  }

  const row = (label: string, value: string, field?: 'ic' | 'bank') => (
    <div className="flex items-center justify-between gap-3 py-[7px] [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
      <span className="text-meta text-muted-ink">{label}</span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-copy text-ink tabular-nums truncate">{value}</span>
        {field && (
          <button type="button" onClick={() => reveal(field)} disabled={busy === field}
            aria-label={shown[field] !== undefined ? `Hide ${label}` : `Show full ${label}`}
            title={shown[field] !== undefined ? 'Hide' : 'Show the full number. This is recorded in the audit log.'}
            className="inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer font-sans text-meta font-medium text-gold-ink">
            <Icon name={shown[field] !== undefined ? 'EyeOff' : 'Eye'} size="sm" />
            {shown[field] !== undefined ? 'Hide' : 'Show'}
          </button>
        )}
      </span>
    </div>
  );

  const ic = shown.ic !== undefined ? (shown.ic || 'Not on file') : owner.icLast4 ? masked(owner.icLast4) : 'Not on file';
  const acct = shown.bank !== undefined ? (shown.bank || 'Not on file') : owner.bankAccountLast4 ? masked(owner.bankAccountLast4) : 'Not on file';
  return (
    <Section title="Payout details" action={canEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(true)}>Edit</Button> : undefined}>
      <div className="flex flex-col">
        {row('IC / passport', ic, owner.icLast4 ? 'ic' : undefined)}
        {row('Bank', bankName(owner.bankName) ?? 'Not on file')}
        {row('Account', acct, owner.bankAccountLast4 ? 'bank' : undefined)}
        {row('Account holder', owner.accountHolder ?? 'Not on file')}
      </div>
      <span className="text-caption text-muted-ink">Only the last four digits are shown. Showing the full number is recorded in the audit log. These details are the owner's, for every unit they own.</span>
      {editing && <EditPayout owner={owner} onClose={() => setEditing(false)} onSaved={() => { setShown({}); setEditing(false); onSaved?.(); }} />}
    </Section>
  );
}

/** Edits the owner's payout details. The account and IC numbers start empty: left empty they keep what is stored, so
 *  the full numbers never have to be shown to be kept. */
function EditPayout({ owner, onClose, onSaved }: { owner: Owner; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [bank, setBank] = useState(owner.bankName ?? '');
  const [holder, setHolder] = useState(owner.accountHolder ?? '');
  const [account, setAccount] = useState('');
  const [ic, setIc] = useState('');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const codes = BANKS.includes(bank) || !bank ? BANKS : [bank, ...BANKS];
  async function save() {
    setBusy(true); setFields({});
    try {
      const r = await api.patch<{ changed: boolean }>(`/owners/${encodeURIComponent(owner.id)}`, {
        bankName: bank, accountHolder: holder, ...(account.trim() ? { bankAccount: account.trim() } : {}), ...(ic.trim() ? { ic: ic.trim() } : {}),
      });
      toast({ tone: 'success', title: r.changed ? 'Payout details saved.' : 'Nothing changed.', body: r.changed ? `${titleCase(owner.displayName)}'s statements and payouts use them from now on.` : undefined });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Payout details were not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }
  return (
    <Modal title="Edit payout details" sub={`Where ${titleCase(owner.displayName)} is paid. Applies to every unit they own.`} onClose={onClose}
      submitLabel={busy ? 'Saving...' : 'Save details'} canSubmit={!busy} onSubmit={() => void save()}>
      <Select showLabel size="md" label="Bank" value={bank} onChange={setBank} placeholder="Choose the bank"
        options={codes.map(c => ({ value: c, label: BANK_NAME[c.toUpperCase()] ? `${bankName(c)} (${c})` : c }))} />
      {fields.bankName && <span className="text-meta text-critical -mt-2">{fields.bankName}</span>}
      <Field label="Account number" placeholder={owner.bankAccountLast4 ? `${masked(owner.bankAccountLast4)} (leave empty to keep)` : 'Account number'} inputMode="numeric" maxLength={30}
        value={account} onChange={e => setAccount(e.target.value)} error={fields.bankAccount} />
      <Field label="Account holder" placeholder="Name on the account" maxLength={120} value={holder} onChange={e => setHolder(e.target.value)} error={fields.accountHolder} />
      <Field label="IC or passport" placeholder={owner.icLast4 ? `${masked(owner.icLast4)} (leave empty to keep)` : 'Accepts both formats'} maxLength={30}
        value={ic} onChange={e => setIc(e.target.value)} error={fields.ic} />
      <p className="m-0 text-meta text-muted-ink">The change is recorded in the audit log; the numbers themselves are not.</p>
    </Modal>
  );
}
