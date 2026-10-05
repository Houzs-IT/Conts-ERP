import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import PageHeader from '../components/PageHeader';
import { TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { api, notifyFailure, ApiFailure } from '../lib/api';
import { useToast } from '../components/Toast';
import { cx } from '../lib/design-tokens';

interface Listing { id: string; title: string; type: string; city: string; maxGuests: number; linkedTo: string | null }
interface Payload {
  channelId: string | null; listings: Listing[];
  buildings: { id: string; name: string }[]; owners: { id: string; name: string }[]; units: { id: string; label: string }[];
}
interface Details { currency: string | null; baseRate: number | null; weekendRate: number | null; minStay: number }
/** What staff choose for one listing. `unit` is '' for a new unit, otherwise the existing unit to link. */
interface Row {
  on: boolean; unit: string; buildingId: string; unitCode: string; ownerId: string;
  base: string; weekend: string; minStay: string;
  details: 'none' | 'loading' | 'ready' | 'failed'; currency: string | null;
  result?: 'working' | 'done' | { error: string };
}
const BLANK: Row = { on: false, unit: '', buildingId: '', unitCode: '', ownerId: '', base: '', weekend: '', minStay: '1', details: 'none', currency: null };

const toSen = (s: string) => { const n = Number(s); return s.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
const input = 'h-8 px-2 rounded-control border border-solid border-line bg-card text-[13px] [font:inherit] min-w-0';

/** Brings the listings of the connected Airbnb account into Conts in one sitting: each ticked listing becomes
 *  a unit (or is matched to one that exists), priced as it is on Airbnb today, and is linked so its price,
 *  calendar and bookings follow Conts from then on. */
export default function AirbnbImportPage() {
  const { data, loading, error, reload } = useApi<Payload>('/integrations/channex/airbnb-import');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [search, setSearch] = useState('');
  const [allBuilding, setAllBuilding] = useState('');
  const [allOwner, setAllOwner] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const stop = useRef(false);

  const listings = data?.listings ?? [];
  const row = (id: string) => rows[id] ?? BLANK;
  const patch = (id: string, p: Partial<Row>) => setRows(r => ({ ...r, [id]: { ...(r[id] ?? BLANK), ...p } }));
  const open = listings.filter(l => !l.linkedTo && row(l.id).result !== 'done');
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? listings.filter(l => `${l.title} ${l.city}`.toLowerCase().includes(q)) : listings;
  }, [listings, search]);
  const ticked = open.filter(l => row(l.id).on);

  /** Why a ticked listing cannot go yet, or null when it is ready. */
  function missing(id: string): string | null {
    const r = row(id);
    if (r.details === 'loading') return 'Reading its price from Airbnb';
    if (!toSen(r.base)) return 'Enter the nightly price';
    if (r.weekend.trim() !== '' && !toSen(r.weekend)) return 'Weekend price is not valid';
    const n = Number(r.minStay);
    if (!Number.isInteger(n) || n < 1 || n > 60) return 'Minimum nights must be 1 to 60';
    if (!r.unit && !r.buildingId) return 'Pick a building';
    if (!r.unit && !r.ownerId) return 'Pick an owner';
    return null;
  }
  const notReady = ticked.filter(l => missing(l.id));

  /** Fills a listing's price and minimum nights from Airbnb, once, leaving anything already typed. */
  async function loadDetails(id: string) {
    patch(id, { details: 'loading' });
    try {
      const d = await api.get<Details>('/integrations/channex/airbnb-import/listing', { listingId: id });
      setRows(r => {
        const cur = r[id] ?? BLANK;
        // A price in another currency is not a ringgit price; leave it for staff to enter.
        const rm = !d.currency || d.currency === 'MYR';
        return { ...r, [id]: {
          ...cur, details: 'ready', currency: d.currency,
          base: cur.base || (rm && d.baseRate ? (d.baseRate / 100).toFixed(2) : ''),
          weekend: cur.weekend || (rm && d.weekendRate ? (d.weekendRate / 100).toFixed(2) : ''),
          minStay: String(d.minStay || 1),
        } };
      });
    } catch { patch(id, { details: 'failed' }); }
  }
  function tick(id: string, on: boolean) {
    patch(id, { on, ...(on && !row(id).unit && !row(id).buildingId ? { buildingId: allBuilding, ownerId: allOwner } : {}) });
    if (on && row(id).details === 'none') void loadDetails(id);
  }
  async function tickAll() {
    const todo = shown.filter(l => !l.linkedTo && row(l.id).result !== 'done');
    setRows(r => {
      const next = { ...r };
      for (const l of todo) { const cur = next[l.id] ?? BLANK; next[l.id] = { ...cur, on: true, buildingId: cur.buildingId || allBuilding, ownerId: cur.ownerId || allOwner }; }
      return next;
    });
    // One at a time, so a long list does not flood Airbnb with requests.
    for (const l of todo) if (row(l.id).details === 'none') await loadDetails(l.id);
  }
  function applyToTicked() {
    setRows(r => {
      const next = { ...r };
      for (const l of ticked) { const cur = next[l.id] ?? BLANK; if (!cur.unit) next[l.id] = { ...cur, buildingId: allBuilding || cur.buildingId, ownerId: allOwner || cur.ownerId }; }
      return next;
    });
  }

  async function signIn() {
    setSigningIn(true);
    try {
      const r = await api.post<{ url?: string; channelId?: string }>('/integrations/channex/airbnb-import/sign-in', {});
      if (r.url) window.location.href = r.url; else reload();
    } catch (e) { notifyFailure(e); } finally { setSigningIn(false); }
  }

  async function run() {
    setConfirming(false);
    stop.current = false;
    const todo = ticked.filter(l => !missing(l.id));
    setRunning({ done: 0, total: todo.length });
    let ok = 0, failed = 0;
    for (const [i, l] of todo.entries()) {
      if (stop.current) break;
      const r = row(l.id);
      patch(l.id, { result: 'working' });
      try {
        await api.post('/integrations/channex/airbnb-import', {
          listingId: l.id, title: l.title, maxGuests: l.maxGuests || 2,
          ...(r.unit ? { unitId: r.unit } : { buildingId: r.buildingId, unitCode: r.unitCode.trim(), ownerId: r.ownerId }),
          baseRate: toSen(r.base), weekendRate: toSen(r.weekend), minStay: Number(r.minStay),
        });
        patch(l.id, { result: 'done', on: false });
        ok++;
      } catch (e) {
        patch(l.id, { result: { error: e instanceof ApiFailure ? e.message : 'Could not be brought in.' } });
        failed++;
      }
      setRunning({ done: i + 1, total: todo.length });
    }
    setRunning(null);
    toast(failed
      ? { tone: 'warning', title: `${ok} brought in, ${failed} not.`, body: 'The ones that failed are marked in the list with the reason. Nothing was changed on Airbnb for them.' }
      : { tone: 'success', title: `${ok} ${ok === 1 ? 'listing' : 'listings'} brought in.`, body: 'Prices and open dates now follow Conts, and existing bookings are being loaded.' });
    reload();
  }

  const linkedCount = listings.filter(l => l.linkedTo || row(l.id).result === 'done').length;

  return (
    <>
      <PageHeader title="Import from Airbnb"
        sub={data?.channelId ? `${linkedCount} of ${listings.length} listings linked to a unit.` : 'Bring every listing of your Airbnb account into Conts in one sitting.'}
        right={<Button size="sm" variant="secondary" onClick={() => navigate('/properties')}>Back to properties</Button>} />

      {loading && !data && <Card><TableSkeleton rows={6} /></Card>}
      {error && !data && <Card><div className="p-6 flex items-center gap-3 text-[13.5px]"><span>{error}</span><Button size="sm" variant="secondary" onClick={reload}>Try again</Button></div></Card>}

      {data && !data.channelId && (
        <Card>
          <div className="p-6 max-w-[640px] flex flex-col gap-3 text-[13.5px]">
            {params.get('signin') === 'failed' && <span className="text-[var(--color-critical-fg)]">The Airbnb sign-in was cancelled or did not complete, so nothing was connected.</span>}
            <span>Sign in with the Airbnb host account. Signing in only lets Conts read the listings: nothing on Airbnb changes until you bring a listing in.</span>
            <span className="text-muted-ink">Airbnb allows one management software per account. If another one is connected, Airbnb refuses the sign-in until it is removed there.</span>
            <div><Button variant="primary" loading={signingIn} onClick={() => void signIn()}>Sign in to Airbnb</Button></div>
          </div>
        </Card>
      )}

      {data?.channelId && (
        <Card>
          <div className="p-5 flex flex-wrap items-end gap-3 [border-bottom:1px_solid_var(--color-line)]">
            <label className="flex flex-col gap-1 text-[12px] text-muted-ink">Find
              <input className={cx(input, 'w-[200px]')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Listing name or city" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted-ink">Building for new units
              <select className={cx(input, 'w-[200px]')} value={allBuilding} onChange={e => setAllBuilding(e.target.value)}>
                <option value="">Choose…</option>
                {data.buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted-ink">Owner for new units
              <select className={cx(input, 'w-[200px]')} value={allOwner} onChange={e => setAllOwner(e.target.value)}>
                <option value="">Choose…</option>
                {data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <Button size="sm" variant="secondary" disabled={!ticked.length || (!allBuilding && !allOwner)} disabledReason="Tick listings and choose a building or owner" onClick={applyToTicked}>Apply to ticked</Button>
            <Button size="sm" variant="secondary" disabled={!!running} onClick={() => void tickAll()}>Tick all shown</Button>
          </div>
          <div className="px-5 py-3 text-[12.5px] text-muted-ink [border-bottom:1px_solid_var(--color-line-soft)]">
            Prices and minimum nights are read from Airbnb when you tick a listing. Only the standing price is read: a special price set on single nights in Airbnb's calendar is replaced by the price here.
            Add a missing building or owner on the Properties and Owners screens first.
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px] min-w-[1240px]">
              <thead>
                <tr className="text-left text-[11.5px] text-muted-ink">
                  {['', 'Airbnb listing', 'Unit in Conts', 'Building', 'Unit code', 'Owner', 'Night (RM)', 'Fri/Sat (RM)', 'Min nights', ''].map((h, i) => <th key={i} className="font-medium px-3 py-2.5 [border-bottom:1px_solid_var(--color-line)] whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map(l => {
                  const r = row(l.id), isDone = !!l.linkedTo || r.result === 'done', why = r.on ? missing(l.id) : null;
                  const fixed = isDone || !!running;
                  return (
                    <tr key={l.id} className={cx('[border-bottom:1px_solid_var(--color-line-soft)] align-top', isDone && 'opacity-60')}>
                      <td className="px-3 py-2.5"><input type="checkbox" aria-label={`Bring in ${l.title}`} disabled={fixed} checked={r.on && !isDone} onChange={e => tick(l.id, e.target.checked)} /></td>
                      <td className="px-3 py-2.5 min-w-[220px] max-w-[300px]">
                        <div className="font-semibold">{l.title}</div>
                        <div className="text-[12px] text-muted-ink">{[l.type, l.city, l.maxGuests ? `up to ${l.maxGuests} guests` : ''].filter(Boolean).join(' · ')}</div>
                        {r.on && r.currency && r.currency !== 'MYR' && <div className="text-[12px] text-[var(--color-critical-fg)]">Priced in {r.currency} on Airbnb. Enter the price in RM.</div>}
                        {r.on && r.details === 'failed' && <div className="text-[12px] text-[var(--color-critical-fg)]">Could not read its price from Airbnb. Enter it by hand.</div>}
                      </td>
                      {isDone ? (
                        <td colSpan={7} className="px-3 py-2.5 text-muted-ink">Linked to {l.linkedTo ?? 'its new unit'}</td>
                      ) : !r.on ? (
                        <td colSpan={7} className="px-3 py-2.5 text-faint">Not ticked</td>
                      ) : (
                        <>
                          <td className="px-3 py-2">
                            <select className={cx(input, 'w-[170px]')} disabled={fixed} value={r.unit} onChange={e => patch(l.id, { unit: e.target.value })}>
                              <option value="">New unit</option>
                              {data.units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {r.unit ? <span className="text-faint">as the unit</span> : (
                              <select className={cx(input, 'w-[150px]')} disabled={fixed} value={r.buildingId} onChange={e => patch(l.id, { buildingId: e.target.value })}>
                                <option value="">Choose…</option>
                                {data.buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2">{r.unit ? null : <input className={cx(input, 'w-[100px]')} disabled={fixed} value={r.unitCode} onChange={e => patch(l.id, { unitCode: e.target.value })} placeholder="A-12-03" />}</td>
                          <td className="px-3 py-2">
                            {r.unit ? null : (
                              <select className={cx(input, 'w-[150px]')} disabled={fixed} value={r.ownerId} onChange={e => patch(l.id, { ownerId: e.target.value })}>
                                <option value="">Choose…</option>
                                {data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2"><input className={cx(input, 'w-[86px] text-right')} inputMode="decimal" disabled={fixed} value={r.base} onChange={e => patch(l.id, { base: e.target.value })} placeholder={r.details === 'loading' ? '…' : '0.00'} aria-label="Nightly price" /></td>
                          <td className="px-3 py-2"><input className={cx(input, 'w-[86px] text-right')} inputMode="decimal" disabled={fixed} value={r.weekend} onChange={e => patch(l.id, { weekend: e.target.value })} placeholder="same" aria-label="Weekend price" /></td>
                          <td className="px-3 py-2"><input className={cx(input, 'w-[56px] text-right')} inputMode="numeric" disabled={fixed} value={r.minStay} onChange={e => patch(l.id, { minStay: e.target.value })} aria-label="Minimum nights" /></td>
                        </>
                      )}
                      <td className="px-3 py-2.5 whitespace-nowrap max-w-[220px]">
                        {isDone ? <Badge tone="success" label="Linked" />
                          : r.result === 'working' ? <Badge tone="info" label="Bringing in…" />
                          : typeof r.result === 'object' ? <span className="text-[12px] text-[var(--color-critical-fg)] whitespace-normal">{r.result.error}</span>
                          : why ? <span className="text-[12px] text-muted-ink whitespace-normal">{why}</span> : null}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={10} className="px-5 py-8 text-center text-muted-ink">{listings.length ? 'No listing matches that search.' : 'This Airbnb account has no listings.'}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="p-5 flex flex-wrap items-center justify-between gap-3 [border-top:1px_solid_var(--color-line)]">
            {running ? (
              <>
                <span className="text-[13.5px]">Bringing in {running.done} of {running.total}. Keep this page open.</span>
                <Button size="sm" variant="secondary" onClick={() => { stop.current = true; }}>Stop after this one</Button>
              </>
            ) : confirming ? (
              <>
                <span className="text-[13.5px] max-w-[640px]">
                  Bring in {ticked.length} {ticked.length === 1 ? 'listing' : 'listings'}? From then on their price, open dates and minimum nights on Airbnb follow Conts, starting with the prices in this list.
                </span>
                <span className="flex gap-2.5">
                  <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
                  <Button size="sm" variant="primary" onClick={() => void run()}>Yes, bring them in</Button>
                </span>
              </>
            ) : (
              <>
                <span className="text-[13px] text-muted-ink">
                  {ticked.length === 0 ? 'Tick the listings to bring in.' : notReady.length ? `${notReady.length} of ${ticked.length} ticked ${notReady.length === 1 ? 'listing needs' : 'listings need'} a building, owner or price.` : `${ticked.length} ready.`}
                </span>
                <Button variant="primary" disabled={!ticked.length || notReady.length > 0} disabledReason={ticked.length ? 'Complete the ticked listings first' : 'Tick at least one listing'} onClick={() => setConfirming(true)}>
                  Bring in {ticked.length || ''} {ticked.length === 1 ? 'listing' : 'listings'}
                </Button>
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
