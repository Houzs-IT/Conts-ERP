import { useEffect, useState } from 'react';
import { Card } from '../../components/Card';
import { Select } from '../../components/Select';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, errorMessage } from '../../lib/api';
import { masked } from '../../lib/format';
import { bankName } from '../../lib/vocabulary';
import type { OwnerBankAccount } from '../../lib/types';

/** Which of the owner's bank accounts this unit's money is paid to. Shown only when the owner has extra accounts, so a
 *  unit whose owner has one account looks as it always did. The main account is "none chosen" (null on the server). */
export function PaysTo({ unitId, ownerId, accountId, mainAccount, canEdit, onSaved }: {
  unitId: string; ownerId: string; accountId: string | null; mainAccount?: string; canEdit: boolean; onSaved: () => void;
}): JSX.Element | null {
  const toast = useToast();
  const { data } = useApi<{ data: OwnerBankAccount[] }>(`/owners/${encodeURIComponent(ownerId)}/accounts`);
  const [value, setValue] = useState(accountId ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValue(accountId ?? ''); }, [accountId, unitId]);
  const accounts = data?.data ?? [];
  if (accounts.length === 0) return null;

  const nameOf = (a: OwnerBankAccount): string => `${bankName(a.bankName) ?? a.bankName} ${masked(a.last4)}${a.label ? ` (${a.label})` : ''}`;
  const options = [
    // With no main account on file there is nothing to pay to, so it cannot be picked (it stays shown if already set).
    { value: '', label: `Owner's main account${mainAccount ? ` (${mainAccount})` : ' (none on file)'}`, disabled: !mainAccount && value !== '' },
    ...accounts.map(a => ({ value: a.id, label: nameOf(a) })),
  ];
  async function change(next: string): Promise<void> {
    const before = value;
    setValue(next); setSaving(true);
    try {
      await api.patch(`/units/${encodeURIComponent(unitId)}/bank-account`, { accountId: next || null });
      toast({ tone: 'success', title: 'Pays to saved.', body: 'Statements and the transfer file use it from now on.' });
      onSaved();
    } catch (e) {
      setValue(before);
      toast({ tone: 'critical', title: 'Pays to was not saved.', body: errorMessage(e, 'Try again in a moment.') });
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <div className="p-5 flex flex-col gap-2 max-w-[520px]">
        {canEdit
          ? <Select showLabel size="md" label="Pays to" value={value} onChange={v => void change(v)} options={options} disabled={saving} />
          : <div className="flex flex-col gap-1.5"><span className="text-meta font-medium text-muted-ink">Pays to</span><span className="text-copy text-ink">{options.find(o => o.value === value)?.label}</span></div>}
        <span className="text-caption text-muted-ink">{saving ? 'Saving...' : "The bank account this unit's owner payout is transferred to."}</span>
      </div>
    </Card>
  );
}
