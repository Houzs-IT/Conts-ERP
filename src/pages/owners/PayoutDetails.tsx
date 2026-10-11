import { useState, type ReactNode } from 'react';
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

/** The full IC / passport or bank account number, asked for one at a time. Every reveal is in the audit log
 *  (GET /api/owners/:id/reveal); asking again hides it, and nothing is kept after leaving the page. */
export function useReveal(ownerId: string) {
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
  return { shown, busy, reveal, reset: () => setShown({}) };
}

/** One label and value line; with `reveal`, a Show / Hide button for a masked number. */
export function DetailRow({ label, value, reveal }: { label: string; value: ReactNode; reveal?: { shown: boolean; busy: boolean; onToggle: () => void } }) {
  return (
    <div className="flex items-start justify-between gap-3 py-[7px] [border-bottom:1px_solid_var(--color-line-soft)] last:border-b-0">
      <span className="text-meta text-muted-ink shrink-0">{label}</span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-copy text-ink tabular-nums text-right [overflow-wrap:anywhere] whitespace-pre-line">{value}</span>
        {reveal && (
          <button type="button" onClick={reveal.onToggle} disabled={reveal.busy}
            aria-label={reveal.shown ? `Hide ${label}` : `Show full ${label}`}
            title={reveal.shown ? 'Hide' : 'Show the full number. This is recorded in the history.'}
            className="inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer font-sans text-meta font-medium text-gold-ink">
            <Icon name={reveal.shown ? 'EyeOff' : 'Eye'} size="sm" />
            {reveal.shown ? 'Hide' : 'Show'}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * The bank account shows only its last four characters, matching the Payouts screen's promise. "Show" asks the
 * server for the full value once (useReveal). The IC / passport number is the owner's identity, so it lives on the
 * Owner details card (OwnerDetails.tsx), not here.
 */
export function PayoutDetails({ owner, canEdit, onSaved }: { owner: Owner; canEdit?: boolean; onSaved?: () => void }) {
  const [editing, setEditing] = useState(false);
  const { shown, busy, reveal, reset } = useReveal(owner.id);

  const acct = shown.bank !== undefined ? (shown.bank || 'Not on file') : owner.bankAccountLast4 ? masked(owner.bankAccountLast4) : 'Not on file';
  return (
    <Section title="Payout details" action={canEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setEditing(true)}>Edit</Button> : undefined}>
      <div className="flex flex-col">
        <DetailRow label="Bank" value={bankName(owner.bankName) ?? 'Not on file'} />
        <DetailRow label="Account" value={acct} reveal={owner.bankAccountLast4 ? { shown: shown.bank !== undefined, busy: busy === 'bank', onToggle: () => void reveal('bank') } : undefined} />
        <DetailRow label="Account holder" value={owner.accountHolder ?? 'Not on file'} />
      </div>
      <span className="text-caption text-muted-ink">Only the last four digits are shown. Showing the full number is recorded in the history. These details are the owner's, for every unit they own.</span>
      {editing && <EditPayout owner={owner} onClose={() => setEditing(false)} onSaved={() => { reset(); setEditing(false); onSaved?.(); }} />}
    </Section>
  );
}

/** Edits the owner's payout details. The account number starts empty: left empty it keeps what is stored, so the
 *  full number never has to be shown to be kept. */
function EditPayout({ owner, onClose, onSaved }: { owner: Owner; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [bank, setBank] = useState(owner.bankName ?? '');
  const [holder, setHolder] = useState(owner.accountHolder ?? '');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const codes = BANKS.includes(bank) || !bank ? BANKS : [bank, ...BANKS];
  async function save() {
    setBusy(true); setFields({});
    try {
      const r = await api.patch<{ changed: boolean }>(`/owners/${encodeURIComponent(owner.id)}`, {
        bankName: bank, accountHolder: holder, ...(account.trim() ? { bankAccount: account.trim() } : {}),
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
      <p className="m-0 text-meta text-muted-ink">The change is recorded in the history; the number itself is not.</p>
    </Modal>
  );
}
