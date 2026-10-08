import { useState } from 'react';
import Icon from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { masked } from '../../lib/format';
import { bankName } from '../../lib/vocabulary';
import { Section, type Owner } from './shared';

/**
 * IC / passport and bank account show only their last four characters, matching the Payouts screen's
 * promise. "Show" asks the server for the full value once; every reveal is in the audit log
 * (GET /api/owners/:id/reveal). "Hide" puts the mask back; nothing is kept after leaving the page.
 */
export function PayoutDetails({ owner }: { owner: Owner }) {
  const toast = useToast();
  const [shown, setShown] = useState<{ ic?: string; bank?: string }>({});
  const [busy, setBusy] = useState<'ic' | 'bank' | null>(null);

  async function reveal(field: 'ic' | 'bank') {
    if (shown[field] !== undefined) { setShown(s => ({ ...s, [field]: undefined })); return; }
    setBusy(field);
    try {
      const r = await api.get<{ value: string }>(`/owners/${encodeURIComponent(owner.id)}/reveal`, { field });
      setShown(s => ({ ...s, [field]: r.value }));
    } catch (e) {
      toast({ tone: 'critical', title: 'Not shown.', body: e instanceof Error ? e.message : 'Try again in a moment.' });
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
    <Section title="Payout details">
      <div className="flex flex-col">
        {row('IC / passport', ic, owner.icLast4 ? 'ic' : undefined)}
        {row('Bank', bankName(owner.bankName) ?? 'Not on file')}
        {row('Account', acct, owner.bankAccountLast4 ? 'bank' : undefined)}
        {row('Account holder', owner.accountHolder ?? 'Not on file')}
      </div>
      <span className="text-caption text-muted-ink">Only the last four digits are shown. Showing the full number is recorded in the audit log.</span>
    </Section>
  );
}
