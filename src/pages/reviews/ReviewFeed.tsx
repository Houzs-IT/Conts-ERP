import { useEffect, useRef, useState } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/States';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { DateField } from '../../components/inputs/DateField';
import { api, errorMessage } from '../../lib/api';
import { count, plural } from '../../lib/format';
import { useUrlState, SearchBox, FilterSelect, BusyBar } from '../finance/listKit';
import { ReviewCard, type Review } from './ReviewCard';
import { BAD_REVIEW_MAX } from '../../lib/reviewRules';

interface Page {
  data: Review[]; total: number; channexConnected: boolean;
  units: { id: string; label: string; propertyId: string | null }[]; buildings: { id: string; label: string }[];
}
const PAGE = 50;
const CHANNELS = [{ value: 'airbnb', label: 'Airbnb' }, { value: 'booking_com', label: 'Booking.com' }, { value: 'agoda', label: 'Agoda' }, { value: 'direct', label: 'Direct' }];

/** All reviews and Bad reviews: newest first, every filter in the address. Pages of 50 load as the list is scrolled
 *  to its end (or with Show more), so nothing is cut off: the count above always says how many match. */
export function ReviewFeed({ bad, canReply }: { bad: boolean; canReply: boolean }) {
  const url = useUrlState();
  const f = {
    q: url.get('q'), channel: url.get('channel'), propertyId: url.get('propertyId'), unitId: url.get('unitId'),
    rating: bad ? '' : url.get('rating'), reply: url.get('reply'), from: url.get('from'), to: url.get('to'), matched: url.get('matched'),
  };
  const key = JSON.stringify({ ...f, bad });
  const [rows, setRows] = useState<Review[] | null>(null);
  const [meta, setMeta] = useState<Omit<Page, 'data'> | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(key);

  async function load(p: number) {
    setBusy(true);
    const at = key;
    try {
      const res = await api.get<Page>('/reviews', { ...f, bad: bad ? '1' : '', page: p, pageSize: PAGE });
      if (live.current !== at) return;
      setRows(prev => (p === 1 ? res.data : [...(prev ?? []), ...res.data]));
      setMeta({ total: res.total, channexConnected: res.channexConnected, units: res.units, buildings: res.buildings });
      setPage(p);
      setError(null);
    } catch (e) {
      if (live.current === at) setError(errorMessage(e, 'Reviews could not be loaded.'));
    } finally { if (live.current === at) setBusy(false); }
  }
  useEffect(() => { live.current = key; void load(1); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const more = (rows?.length ?? 0) < (meta?.total ?? 0);
  // Loads the next page when the end of the list comes into view.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || !more) return undefined;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !busy) void load(page + 1); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = Object.entries(f).some(([, v]) => v);
  const set = (patch: Record<string, string | null>) => url.set(patch);
  const units = (meta?.units ?? []);
  const visibleUnits = f.propertyId ? units.filter(u => u.propertyId === f.propertyId) : units;

  return (
    <>
      {bad && <p className="m-0 text-copy text-muted-ink">Every review of {BAD_REVIEW_MAX} stars or fewer, newest first.</p>}
      <div className="grid grid-cols-2 md:flex md:flex-wrap gap-2">
        <SearchBox className="col-span-2 md:flex-[2_1_240px]" label="Search reviews" placeholder="Search guest, unit, reservation or words in the review" value={f.q} onChange={v => set({ q: v || null })} />
        <FilterSelect className="md:flex-[1_1_150px]" label="Channel" all="All channels" value={f.channel} onChange={v => set({ channel: v || null })} options={CHANNELS} />
        <FilterSelect className="md:flex-[1_1_170px]" label="Building" all="All buildings" value={f.propertyId} onChange={v => set({ propertyId: v || null, unitId: null })}
          options={(meta?.buildings ?? []).map(b => ({ value: b.id, label: b.label }))} />
        <FilterSelect className="md:flex-[1_1_190px]" label="Unit" all="All units" value={f.unitId} onChange={v => set({ unitId: v || null })}
          options={visibleUnits.map(u => ({ value: u.id, label: u.label }))} />
        {!bad && (
          <FilterSelect className="md:flex-[1_1_130px]" label="Rating" all="Any rating" value={f.rating} onChange={v => set({ rating: v || null })}
            options={[5, 4, 3, 2, 1].map(n => ({ value: String(n), label: `${n} ${n === 1 ? 'star' : 'stars'}` }))} />
        )}
        <FilterSelect className="md:flex-[1_1_170px]" label="Reply" all="Any reply state" value={f.reply} onChange={v => set({ reply: v || null })}
          options={[{ value: 'needs_reply', label: 'Needs reply' }, { value: 'replied', label: 'Replied' }, { value: 'not_posted', label: 'Saved, not posted' }]} />
        <div className="md:w-[160px]"><DateField aria-label="Reviewed from" value={f.from} onChange={v => set({ from: v || null })} max={f.to || undefined} /></div>
        <div className="md:w-[160px]"><DateField aria-label="Reviewed to" value={f.to} onChange={v => set({ to: v || null })} min={f.from || undefined} /></div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap text-meta text-muted-ink">
        <span>{meta ? (rows && rows.length < meta.total ? `Showing ${count(rows.length)} of ${plural(meta.total, bad ? 'bad review' : 'review')}` : plural(meta.total, bad ? 'bad review' : 'review')) : 'Loading…'}</span>
        <span className="flex items-center gap-3">
          <button type="button" onClick={() => set({ matched: f.matched === 'no' ? null : 'no' })}
            className="bg-transparent border-none p-0 cursor-pointer text-ink-2 underline [font-family:inherit] text-meta">
            {f.matched === 'no' ? 'Show every review' : 'Only reviews with no reservation matched'}
          </button>
          {filtered && <button type="button" onClick={() => set({ q: null, channel: null, propertyId: null, unitId: null, rating: null, reply: null, from: null, to: null, matched: null })}
            className="bg-transparent border-none p-0 cursor-pointer text-ink-2 underline [font-family:inherit] text-meta">Clear filters</button>}
        </span>
      </div>

      {error && <StaleBanner message={`Showing the last reviews we have. ${error}`} onRetry={() => load(1)} />}
      {rows === null ? (
        <Card><TableSkeleton rows={4} cols={3} /></Card>
      ) : rows.length === 0 ? (
        filtered
          ? <EmptyState kind="filtered" title={bad ? 'No bad reviews match these filters.' : 'No reviews match these filters.'} action={{ label: 'Clear filters', onClick: () => set({ q: null, channel: null, propertyId: null, unitId: null, rating: null, reply: null, from: null, to: null, matched: null }) }} />
          : bad
            ? <EmptyState icon="Star" title="No bad reviews" body={`No guest has given ${BAD_REVIEW_MAX} stars or fewer.`} />
            : <EmptyState icon="Star" title="No reviews yet"
                body={meta?.channexConnected ? 'Reviews arrive from Airbnb and Booking.com through Channex once guests leave them.' : 'Reviews arrive from Airbnb and Booking.com through Channex, which is not connected on this system.'} />
      ) : (
        <div className="relative flex flex-col gap-3">
          <BusyBar on={busy} />
          {rows.map(r => <Card key={r.id}><ReviewCard review={r} canReply={canReply} /></Card>)}
          <div ref={end} />
          {more && <Button variant="secondary" className="self-center" loading={busy} onClick={() => load(page + 1)}>Show more ({count((meta?.total ?? 0) - rows.length)} left)</Button>}
        </div>
      )}
    </>
  );
}
