import { useState } from 'react';
import { Button } from './Button';
import { useApi } from '../lib/useApi';
import { api, notifyFailure } from '../lib/api';
import { cx } from '../lib/design-tokens';

interface Listing { id: string; title: string; type: string; city: string; maxGuests: number; linkedTo: string | null }

/** Lists the listings of the connected Airbnb account and links the chosen one to the unit. */
export default function AirbnbListingPicker({ unitId, channelId, onDone, onCancel }: { unitId: string; channelId: string; onDone: () => void; onCancel: () => void }) {
  const { data, loading, error, reload } = useApi<{ listings: Listing[] }>(`/units/${unitId}/channels/airbnb-listings?channelId=${encodeURIComponent(channelId)}`);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const listings = data?.listings ?? [];
  const chosen = listings.find(l => l.id === pick);

  async function link() {
    if (!chosen) return;
    setBusy(true);
    try {
      await api.post(`/units/${unitId}/channels/airbnb-map`, { channelId, listingId: chosen.id, listingTitle: chosen.title });
      onDone();
    } catch (e) { notifyFailure(e); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[13px] text-muted-ink">Pick the Airbnb listing that is this unit. Airbnb takes about 30 seconds to confirm the link.</span>
      {loading && !data && <span className="text-[13px] text-muted-ink">Loading your Airbnb listings…</span>}
      {error && <div className="flex items-center gap-3 text-[13px]"><span className="text-[var(--color-text-critical,#B42318)]">{error}</span><Button size="sm" variant="secondary" onClick={reload}>Try again</Button></div>}
      {data && listings.length === 0 && <span className="text-[13px]">No listings found on this Airbnb account.</span>}
      <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
        {listings.map(l => (
          <label key={l.id} className={cx('flex items-start gap-3 p-3 border border-solid rounded-card cursor-pointer', pick === l.id ? 'border-gold bg-gold-tint' : 'border-line', l.linkedTo && 'opacity-50 cursor-not-allowed')}>
            <input type="radio" name="airbnb-listing" value={l.id} disabled={!!l.linkedTo} checked={pick === l.id} onChange={() => setPick(l.id)} className="mt-1" />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-semibold">{l.title}</span>
              <span className="text-[12px] text-muted-ink">{[l.type, l.city, l.maxGuests ? `up to ${l.maxGuests} guests` : ''].filter(Boolean).join(' · ')}{l.linkedTo ? ` · already linked to ${l.linkedTo}` : ''}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2.5">
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!chosen} disabledReason="Pick a listing" loading={busy} onClick={() => void link()}>Link this listing</Button>
      </div>
    </div>
  );
}
