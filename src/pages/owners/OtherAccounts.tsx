import { useState } from 'react';
import Icon from '../../components/Icon';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { masked, plural, titleCase } from '../../lib/format';
import { bankName, BANK_NAME } from '../../lib/vocabulary';
import type { OwnerBankAccount, OwnerBankAccountInput } from '../../lib/types';
import { BANKS } from '../units/shared';
import { Section, Modal, type Owner } from './shared';
import { DetailRow } from './PayoutDetails';

/** The owner's extra bank accounts, for owners paid to more than one bank. A unit picks one on its own page ("Pays to");
 *  a unit that picks none is paid to the main account above. Staff only: the list carries the last four digits, and
 *  "Show" asks the server for the full number (audited), as for the main account. */
export function OtherAccounts({ owner, canEdit }: { owner: Owner; canEdit?: boolean }): JSX.Element | null {
  const toast = useToast();
  const base = `/owners/${encodeURIComponent(owner.id)}/accounts`;
  const { data, loading, error, reload } = useApi<{ data: OwnerBankAccount[] }>(base);
  const [form, setForm] = useState<OwnerBankAccount | 'new' | null>(null);
  const [removing, setRemoving] = useState<OwnerBankAccount | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const accounts = data?.data ?? [];

  async function reveal(id: string): Promise<void> {
    if (shown[id] !== undefined) { setShown(({ [id]: _hidden, ...rest }) => rest); return; }
    setBusy(id);
    try {
      const { value } = await api.get<{ value: string }>(`${base}/${encodeURIComponent(id)}/reveal`);
      setShown(s => ({ ...s, [id]: value }));
    } catch (e) {
      toast({ tone: 'critical', title: 'Not shown.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(null); }
  }
  async function remove(a: OwnerBankAccount): Promise<void> {
    try {
      await api.del(`${base}/${encodeURIComponent(a.id)}`);
      toast({ tone: 'success', title: 'Account removed.' });
      setRemoving(null); reload();
    } catch (e) {
      setRemoving(null);
      toast({ tone: 'critical', title: 'Account was not removed.', body: errorMessage(e, 'Try again in a moment.') });
    }
  }
  const saved = (): void => { setForm(null); setShown({}); reload(); };

  // A viewer who cannot edit sees the list only if there is one; the main account above stays as it is.
  if (!canEdit && accounts.length === 0) return null;
  return (
    <Section title="Other accounts" action={canEdit ? <Button size="sm" variant="tertiary" icon={<Icon name="Plus" size="sm" />} onClick={() => setForm('new')}>Add account</Button> : undefined}>
      {error && !data ? <span className="text-meta text-critical">{error}</span>
        : loading && !data ? <div className="skeleton h-12" />
        : accounts.length === 0 ? <span className="text-caption text-muted-ink">None. Add one if this owner is paid to more than one bank. A unit then picks which account it pays to.</span>
        : accounts.map(a => (
          <div key={a.id} className="flex flex-col gap-1 py-1 [border-top:1px_solid_var(--color-line-soft)] first:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-copy font-medium min-w-0 truncate">{a.label || bankName(a.bankName) || a.bankName}</span>
              {canEdit && (
                <span className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="tertiary" icon={<Icon name="Pencil" size="sm" />} onClick={() => setForm(a)}>Edit</Button>
                  <Button size="sm" variant="tertiary" icon={<Icon name="Trash2" size="sm" />} onClick={() => setRemoving(a)}>Remove</Button>
                </span>
              )}
            </div>
            <DetailRow label="Bank" value={bankName(a.bankName) ?? a.bankName} />
            <DetailRow label="Account" value={shown[a.id] ?? masked(a.last4)} reveal={canEdit ? { shown: shown[a.id] !== undefined, busy: busy === a.id, onToggle: () => void reveal(a.id) } : undefined} />
            <DetailRow label="Account holder" value={a.accountHolder} />
            <span className="text-caption text-muted-ink">{a.inUse ? `Used by ${plural(a.inUse, 'unit')}.` : 'No unit pays to this account yet.'}</span>
          </div>
        ))}
      {form && <AccountForm owner={owner} base={base} account={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={saved} />}
      <ConfirmDialog onClose={() => setRemoving(null)} spec={removing && {
        title: `Remove the ${removing.label || bankName(removing.bankName) || 'bank'} account ${masked(removing.last4)}?`,
        body: 'It can no longer be chosen for a unit. You can add it again later.',
        confirmLabel: 'Remove account', busyLabel: 'Removing...', danger: true,
        onConfirm: () => remove(removing),
      }} />
    </Section>
  );
}

/** Adds or changes one extra account. The number starts empty on a change: left empty it keeps what is stored. */
function AccountForm({ owner, base, account, onClose, onSaved }: { owner: Owner; base: string; account: OwnerBankAccount | null; onClose: () => void; onSaved: () => void }): JSX.Element {
  const toast = useToast();
  const [bank, setBank] = useState(account?.bankName ?? '');
  const [holder, setHolder] = useState(account?.accountHolder ?? '');
  const [number, setNumber] = useState('');
  const [label, setLabel] = useState(account?.label ?? '');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const codes = BANKS.includes(bank) || !bank ? BANKS : [bank, ...BANKS];
  async function save(): Promise<void> {
    setBusy(true); setFields({});
    const body: OwnerBankAccountInput = { label: label.trim(), bankName: bank, accountHolder: holder.trim(), ...(number.trim() ? { accountNumber: number.trim() } : {}) };
    try {
      if (account) await api.patch(`${base}/${encodeURIComponent(account.id)}`, body);
      else await api.post(base, body);
      toast({ tone: 'success', title: account ? 'Account saved.' : 'Account added.', body: 'Pick it on a unit, under "Pays to".' });
      onSaved();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Account was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setBusy(false); }
  }
  return (
    <Modal title={account ? 'Edit account' : 'Add account'} sub={`Another bank account for ${titleCase(owner.displayName)}. A unit pays to it only when you pick it on the unit.`} onClose={onClose}
      submitLabel={busy ? 'Saving...' : 'Save account'} canSubmit={!busy && !!bank && !!holder.trim() && (!!account || !!number.trim())} onSubmit={() => void save()}>
      <Field label="Name for this account (optional)" placeholder="e.g. Regalia" maxLength={60} value={label} onChange={e => setLabel(e.target.value)} error={fields.label} />
      <Select showLabel size="md" label="Bank" value={bank} onChange={setBank} placeholder="Choose the bank"
        options={codes.map(c => ({ value: c, label: BANK_NAME[c.toUpperCase()] ? `${bankName(c)} (${c})` : c }))} />
      {fields.bankName && <span className="text-meta text-critical -mt-2">{fields.bankName}</span>}
      <Field label="Account number" placeholder={account ? `${masked(account.last4)} (leave empty to keep)` : 'Account number'} inputMode="numeric" autoComplete="off" maxLength={30}
        value={number} onChange={e => setNumber(e.target.value)} error={fields.accountNumber} />
      <Field label="Account holder" placeholder="Name on the account" maxLength={120} value={holder} onChange={e => setHolder(e.target.value)} error={fields.accountHolder} />
      <p className="m-0 text-meta text-muted-ink">The change is recorded in the history; the number itself is not.</p>
    </Modal>
  );
}
