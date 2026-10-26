import { useState, type CSSProperties } from 'react';
import { useApi } from '../../lib/useApi';
import { count, date, dateLong, dateRange, dateShort, monthLabel, rmShort, plural } from '../../lib/format';
import { fmtFigure, LEAD_KEYS, type CalendarData, type FigureKey, type Insights, type Listing, type ReviewCard, type ShowcaseData, type TodayItem } from './model';
import { Fig, Photo, Avatar, Segmented, PriceToggle, MonthNav, useMarquees, useEscape } from './parts';
import { MonthGrid, monthStats, monthStart, monthDays, monthRange } from './CalendarScreen';

type G = (k: FigureKey) => number | null;

/** "in Kuala Lumpur" when every listing is in one city, else nothing. */
export const cityPhrase = (listings: Listing[]) => {
  const cities = [...new Set(listings.map(l => l.city).filter(Boolean))];
  return cities.length === 1 ? ` in ${cities[0]}` : '';
};

const listingSpecs = (l: Listing) => [plural(l.maxGuests, 'guest'), plural(l.bedrooms, 'bedroom'), plural(l.bathrooms, 'bath')].join(' · ');
const ratingLine = (l: Listing) => (l.rating === null ? 'New · no reviews yet' : `★ ${l.rating.toFixed(2)} · ${plural(l.reviews, 'review')}`);

/* 01 Today */

type Mode = 'in' | 'out' | 'up' | 'tn';
const MODE_KEY: Record<Mode, FigureKey> = { in: 'today_in', out: 'today_out', up: 'today_up', tn: 'tn_pct' };
const HEADLINE: Record<Exclude<Mode, 'tn'>, string> = { in: 'guests arriving today', out: 'guests checking out today', up: 'orders on the books' };
const EMPTY: Record<Exclude<Mode, 'tn'>, string> = { in: 'No guests arrive today.', out: 'No guests check out today.', up: 'No stays are on the books yet.' };

export function TodayScreen({ data, g, mode, setMode }: { data: ShowcaseData; g: G; mode: Mode; setMode: (m: Mode) => void }) {
  const t = data.today;
  const list: { items: TodayItem[] } = mode === 'in' ? t.checkIns : mode === 'out' ? t.checkOuts : t.upcoming;
  const when = (it: TodayItem) => (mode === 'up' ? `${dateShort(it.checkIn)} – ${dateShort(it.checkOut)}` : it.time);
  const pct = g('tn_pct') ?? 0;
  return (
    <div className="sc-wrap">
      <div style={{ marginBottom: 28 }}>
        <div className="sc-eyebrow">{dateLong(t.date)}</div>
        <div className="sc-sub" style={{ marginTop: 6 }}>Live operations across <Fig k="listings">{fmtFigure('listings', g('listings'))}</Fig> managed listings{cityPhrase(data.listings)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <Segmented large value={mode} onChange={setMode} options={[
          { key: 'in', label: 'Check-ins', count: fmtFigure('today_in', g('today_in')) },
          { key: 'out', label: 'Check-outs', count: fmtFigure('today_out', g('today_out')) },
          { key: 'up', label: 'Upcoming', count: fmtFigure('today_up', g('today_up')) },
          { key: 'tn', label: 'Tonight', count: `${fmtFigure('tn_pct', g('tn_pct'))}%` },
        ]} />
        {mode !== 'tn' ? (
          <div key={mode} className="sc-rise" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: 'clamp(36px, 5vw, 64px)', fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.05, textAlign: 'center', textWrap: 'balance', margin: '12px 0 16px' } as CSSProperties}>
              <span style={{ color: 'var(--sc-teal)' }}><Fig k={MODE_KEY[mode]}>{fmtFigure(MODE_KEY[mode], g(MODE_KEY[mode]))}</Fig></span> {HEADLINE[mode]}
            </div>
            <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {list.items.map((it, k) => (
                <div key={it.id} className="sc-today-row">
                  <div className="num" style={{ fontSize: 15, fontWeight: 700 }}>{when(it)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{it.guest}{it.guests > 1 ? ` · party of ${it.guests}` : ''}</div>
                    <div className="ellipsis" style={{ fontSize: 14, color: 'var(--sc-muted)', marginTop: 3 }}>{it.listing} · {it.unit}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Avatar name={it.guest} i={k} size={46} style={{ border: '2px solid var(--sc-surface)' }} />
                    <Photo id={it.photoId} fine style={{ width: 34, height: 34, borderRadius: 8, marginLeft: -12, marginTop: 18, border: '2px solid var(--sc-surface)' }} />
                  </div>
                </div>
              ))}
              {!list.items.length && <div className="sc-empty">{EMPTY[mode]}</div>}
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--sc-muted)', marginTop: 8 }}>Showing {list.items.length} of {fmtFigure(MODE_KEY[mode], g(MODE_KEY[mode]))} · pulled live from Airbnb reservations</div>
            </div>
          </div>
        ) : (
          <div className="sc-card dark sc-rise" style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 28, marginTop: 12 }}>
            <div className="sc-eyebrow">Tonight</div>
            <div>
              <div className="sc-big" style={{ fontSize: 'clamp(64px, 9vw, 120px)', letterSpacing: '-0.045em' }}>
                <Fig k="tn_occ">{fmtFigure('tn_occ', g('tn_occ'))}</Fig><span style={{ fontSize: 44, color: 'var(--sc-dark-muted)' }}> / <Fig k="listings">{fmtFigure('listings', g('listings'))}</Fig></span>
              </div>
              <div style={{ fontSize: 18, color: 'var(--sc-dark-soft)', marginTop: 12 }}>listings occupied</div>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'var(--sc-dark-line)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: 'var(--sc-teal-on-dark)' }} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div><div className="sc-big" style={{ fontSize: 48, letterSpacing: '-0.03em' }}><Fig k="tn_pct">{fmtFigure('tn_pct', g('tn_pct'))}</Fig>%</div><div style={{ fontSize: 14, color: 'var(--sc-dark-muted)', marginTop: 4 }}>occupancy tonight</div></div>
              <div><div className="sc-big" style={{ fontSize: 48, letterSpacing: '-0.03em' }}><Fig k="tn_turn">{fmtFigure('tn_turn', g('tn_turn'))}</Fig></div><div style={{ fontSize: 14, color: 'var(--sc-dark-muted)', marginTop: 4 }}>turnovers in progress</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* 02 Listings */

function ListingStrip({ listings, width, speedRef, pill }: { listings: Listing[]; width: number; speedRef: (el: HTMLDivElement | null) => void; pill?: boolean }) {
  const loop = [...listings, ...listings];
  return (
    <div className="sc-marquee-track" ref={speedRef}>
      {loop.map((l, i) => (
        <div key={`${l.id}-${i}`} style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: pill ? 10 : 8 }}>
          <Photo id={l.photoId} label="listing photo" style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 14 }}>
            {pill && <span className="sc-published sm"><span className="sc-dot" style={{ width: 6, height: 6 }} />Published</span>}
          </Photo>
          {pill
            ? <div><div className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{l.name}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{l.unit}{l.rating !== null ? ` · ★ ${l.rating.toFixed(2)}` : ''}</div></div>
            : <div className="ellipsis" style={{ fontSize: 13, fontWeight: 700 }}>{l.name}</div>}
        </div>
      ))}
    </div>
  );
}

export function ListingsScreen({ data, g }: { data: ShowcaseData; g: G }) {
  const [shown, setShown] = useState(14);
  const [preview, setPreview] = useState<Listing | null>(null);
  const mq = useMarquees([{ speed: -0.03 }]);
  const all = data.listings;
  return (
    <div className="sc-wrap wide">
      <div className="sc-eyebrow">Portfolio</div>
      <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 6 }}><Fig k="listings">{fmtFigure('listings', g('listings'))}</Fig> listings</div>
      <div className="sc-sub" style={{ marginTop: 4 }}>All live on Airbnb{cityPhrase(all) ? ` ·${cityPhrase(all).replace(' in', '')}` : ''}. Click a listing to see it as guests do.</div>
      {all.length > 3 && <div className="sc-marquee" {...mq.hover} style={{ margin: '28px -32px 0' }}><ListingStrip listings={all} width={220} speedRef={mq.ref(0)} /></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '28px 24px', marginTop: 28 }}>
        {all.slice(0, shown).map(l => (
          <button key={l.id} type="button" onClick={() => setPreview(l)} style={{ textAlign: 'left', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Photo id={l.photoId} label="listing photo" style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 16 }}>
              <span className="sc-published"><span className="sc-dot" />Published</span>
            </Photo>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{l.name}</div>
              <div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 2 }}>{l.unit}{l.city ? ` · ${l.city}` : ''}</div>
              <div style={{ fontSize: 13, marginTop: 4, fontWeight: 600 }}>{ratingLine(l)}</div>
            </div>
          </button>
        ))}
      </div>
      {!all.length && <div className="sc-empty">No units are listed yet. List a unit on the Units screen and it appears here.</div>}
      {shown < all.length && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 36 }}>
          <button type="button" className="sc-chip" style={{ height: 42, padding: '0 20px', fontWeight: 700 }} onClick={() => setShown(n => n + 14)}>Showing {shown} of {fmtFigure('listings', g('listings'))} · Load more</button>
        </div>
      )}
      {preview && <ListingPreview l={preview} g={g} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ListingPreview({ l, g, onClose }: { l: Listing; g: G; onClose: () => void }) {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop');
  useEscape(onClose);
  const room = l.airbnbId ? `airbnb.com/rooms/${l.airbnbId}` : 'airbnb.com';
  const place = `Entire serviced apartment${l.city ? ` in ${l.city}` : ''}`;
  return (
    <div className="sc-layer" role="dialog" aria-label={`${l.name} as guests see it`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 24, height: 44 }}>
        <button type="button" aria-label="Close" onClick={onClose} style={{ position: 'absolute', left: 0, width: 44, height: 44, borderRadius: '50%', border: '1px solid var(--sc-control)', background: 'var(--sc-surface)', cursor: 'pointer', fontSize: 18 }}>×</button>
        <div className="sc-seg" style={{ background: 'var(--sc-stripe-a)' }}>
          {(['desktop', 'mobile'] as const).map(m => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} style={{ padding: '9px 18px' }}>{m === 'desktop' ? 'Desktop' : 'Mobile'}</button>)}
        </div>
        <div style={{ position: 'absolute', right: 0, fontSize: 12, color: 'var(--sc-muted)', display: 'flex', alignItems: 'center', gap: 6 }}><span className="sc-dot" />Live Airbnb listing</div>
      </div>
      {mode === 'desktop' ? (
        <div className="sc-pop" style={{ maxWidth: 1160, margin: '0 auto', background: 'var(--sc-surface)', borderRadius: 16, boxShadow: '0 24px 60px rgba(28,27,25,0.14)', overflow: 'hidden' }}>
          <div style={{ height: 40, background: 'var(--sc-chrome)', borderBottom: '1px solid var(--sc-line)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px' }}>
            {[0, 1, 2].map(i => <span key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--sc-control)' }} />)}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}><div style={{ width: 420, maxWidth: '100%', height: 26, borderRadius: 8, background: 'var(--sc-surface)', border: '1px solid var(--sc-line)', fontSize: 12, color: 'var(--sc-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{room}</div></div>
          </div>
          <div style={{ padding: '28px 56px 44px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}><div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em' }}>{l.name}</div><div style={{ display: 'flex', gap: 18, fontSize: 13, fontWeight: 700, textDecoration: 'underline' }}>Share<span>Save</span></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gridTemplateRows: '190px 190px', gap: 8, marginTop: 20, borderRadius: 14, overflow: 'hidden' }}>
              <Photo id={l.photoId} label="main photo" style={{ gridRow: 'span 2' }} />
              <Photo /><Photo /><Photo /><Photo />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 56, marginTop: 30, alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{place}</div>
                <div style={{ fontSize: 15, color: 'var(--sc-ink-2)', marginTop: 4 }}>{listingSpecs(l)}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>{ratingLine(l)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderTop: '1px solid var(--sc-line)', borderBottom: '1px solid var(--sc-line)', padding: '20px 0', marginTop: 22 }}>
                  <div className="sc-logo-tile" style={{ width: 44, height: 44, borderRadius: '50%' }}>TC</div>
                  <div><div style={{ fontSize: 15, fontWeight: 700 }}>Hosted by The Conts</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>{fmtFigure('rev_count', g('rev_count'))} reviews across {fmtFigure('listings', g('listings'))} homes</div></div>
                </div>
              </div>
              <div style={{ border: '1px solid var(--sc-line)', borderRadius: 16, padding: 24, boxShadow: '0 6px 20px rgba(28,27,25,0.08)' }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>Add dates for prices</div>
                <div style={{ border: '1px solid var(--sc-disabled)', borderRadius: 12, marginTop: 18, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--sc-disabled)' }}>
                    <div style={{ padding: '10px 12px', borderRight: '1px solid var(--sc-disabled)' }}><div style={{ fontSize: 10, fontWeight: 800 }}>CHECK-IN</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>Add date</div></div>
                    <div style={{ padding: '10px 12px' }}><div style={{ fontSize: 10, fontWeight: 800 }}>CHECKOUT</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>Add date</div></div>
                  </div>
                  <div style={{ padding: '10px 12px' }}><div style={{ fontSize: 10, fontWeight: 800 }}>GUESTS</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>1 guest</div></div>
                </div>
                <div style={{ marginTop: 16, height: 48, borderRadius: 12, background: 'var(--sc-teal)', color: 'var(--sc-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800 }}>Check availability</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="sc-pop" style={{ width: 390, height: 800, maxWidth: '100%', margin: '0 auto', borderRadius: 52, border: '10px solid var(--sc-ink)', background: 'var(--sc-surface)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(28,27,25,0.2)' }}>
          <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>9:41<span style={{ display: 'flex', gap: 4 }}><span style={{ width: 16, height: 9, borderRadius: 2, background: 'var(--sc-ink)' }} /><span style={{ width: 22, height: 10, borderRadius: 3, border: '1.5px solid var(--sc-ink)' }} /></span></div>
          <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', fontSize: 18, flexShrink: 0 }}><span>←</span><span style={{ display: 'flex', gap: 18 }}><span>⇪</span><span>♡</span></span></div>
          <Photo id={l.photoId} label="listing photo" style={{ height: 300 }} />
          <div style={{ flex: 1, marginTop: -20, background: 'var(--sc-surface)', borderRadius: '22px 22px 0 0', position: 'relative', padding: '24px 22px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, textWrap: 'balance' } as CSSProperties}>{l.name}</div>
            <div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>{place}</div>
            <div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>{listingSpecs(l)}</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>{ratingLine(l)}</div>
          </div>
          <div style={{ height: 84, flexShrink: 0, borderTop: '1px solid var(--sc-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>
            <div><div style={{ fontSize: 14, fontWeight: 800 }}>Add dates for prices</div>{l.rating !== null && <div style={{ fontSize: 12, fontWeight: 700 }}>★ {l.rating.toFixed(2)}</div>}</div>
            <div style={{ height: 46, padding: '0 20px', borderRadius: 12, background: 'var(--sc-teal)', color: 'var(--sc-surface)', display: 'flex', alignItems: 'center', fontSize: 14, fontWeight: 800 }}>Check availability</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* 04 Reviews */

function ReviewBox({ r, i }: { r: ReviewCard; i: number }) {
  const [a, b] = r.stay ? r.stay.split('|') : [];
  return (
    <div style={{ border: '1px solid var(--sc-line)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--sc-surface)', height: '100%' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Avatar name={r.guest} i={i} size={40} />
        <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{r.guest}</div><div className="ellipsis" style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{a && b ? dateRange(a, b) : date(r.reviewedAt)} · {r.listing}</div></div>
      </div>
      <div style={{ color: 'var(--sc-star)', fontSize: 14, letterSpacing: 2 }}>★★★★★</div>
      <div style={{ fontSize: 14, lineHeight: 1.55, textWrap: 'pretty' } as CSSProperties}>{r.text}</div>
    </div>
  );
}

export function ReviewsScreen({ data, ins, g, one }: { data: ShowcaseData; ins: Insights | null; g: G; one: boolean }) {
  const mq = useMarquees([{ speed: 0.025 }, { speed: -0.03 }]);
  const fig = (k: FigureKey, own: number | null | undefined) => (one ? fmtFigure(k, own ?? null) : fmtFigure(k, g(k)));
  const recent = one ? ins?.recentReviews ?? [] : data.reviews.slice(0, 6);
  const loop = one ? [] : data.reviews.slice(6);
  return (
    <section className="sc-card">
      <div className="sc-eyebrow">Guest reviews</div>
      <div className="sc-grid-3" style={{ marginTop: 20, paddingBottom: 28, borderBottom: '1px solid var(--sc-line)' }}>
        <div><div className="sc-big" style={{ fontSize: 72, letterSpacing: '-0.045em' }}><Fig k="rev_count" portfolio={!one}>{fig('rev_count', ins?.reviews.count)}</Fig></div><div style={{ fontSize: 14, color: 'var(--sc-muted)', marginTop: 10 }}>reviews received on Airbnb</div></div>
        <div><div className="sc-big" style={{ fontSize: 72, letterSpacing: '-0.045em' }}><Fig k="rev_five" portfolio={!one}>{fig('rev_five', ins?.reviews.fiveStar)}</Fig>%</div><div style={{ fontSize: 14, color: 'var(--sc-muted)', marginTop: 10 }}>of stays rated 5 stars</div></div>
        <div><div className="sc-big" style={{ fontSize: 72, letterSpacing: '-0.045em', display: 'flex', alignItems: 'baseline', gap: 8 }}><Fig k="rev_rating" portfolio={!one}>{fig('rev_rating', ins?.reviews.rating)}</Fig><span style={{ fontSize: 32, color: 'var(--sc-star)' }}>★</span></div><div style={{ fontSize: 14, color: 'var(--sc-muted)', marginTop: 10 }}>overall rating out of 5</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '26px 0 16px', gap: 12, flexWrap: 'wrap' }}>
        <div className="sc-h2">Recent 5-star reviews</div>
        <div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Only 5-star reviews shown · newest first</div>
      </div>
      <div className="sc-grid-3" style={{ gap: 16 }}>{recent.map((r, i) => <ReviewBox key={r.id} r={r} i={i} />)}</div>
      {!recent.length && <div className="sc-empty">No 5-star reviews with a comment yet.</div>}
      {!one && data.listings.length > 3 && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '32px 0 4px', gap: 12, flexWrap: 'wrap' }}><div className="sc-h2">Homes behind these reviews</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{fmtFigure('listings', g('listings'))} listings live on Airbnb</div></div>
          <div className="sc-marquee" {...mq.hover} style={{ margin: '12px -36px 0' }}><ListingStrip listings={data.listings} width={260} speedRef={mq.ref(0)} pill /></div>
        </>
      )}
      {loop.length >= 3 && (
        <div className="sc-marquee" {...mq.hover} style={{ margin: '20px -36px 0' }}>
          <div className="sc-marquee-track" ref={mq.ref(1)}>
            {[...loop, ...loop].map((r, i) => <div key={`${r.id}-${i}`} style={{ width: 340, flexShrink: 0, display: 'flex' }}><ReviewBox r={r} i={i + 6} /></div>)}
          </div>
        </div>
      )}
    </section>
  );
}

/* 05 Occupancy */

export function OccupancyScreen({ ins, g, one, unit, showPrice, setShowPrice, month, setMonth, today }: {
  ins: Insights | null; g: G; one: boolean; unit: Listing | null; showPrice: boolean; setShowPrice: (v: boolean) => void; month: string; setMonth: (m: string) => void; today: string;
}) {
  const cal = useApi<CalendarData>(one && unit ? `/showcase/calendar?from=${monthStart(month)}&days=${monthDays(month)}&unitId=${unit.id}` : null);
  const o = ins?.occupancy;
  const fig = (k: FigureKey, own: number | null | undefined) => (one ? fmtFigure(k, own ?? null) : fmtFigure(k, g(k)));
  const stay = one ? o?.avgStay ?? null : g('occ_stay');
  const small = [
    { v: o ? o.bookedPerListing.toFixed(1) : '-', l: 'avg booked nights / 30d' },
    { v: o ? o.blockedPerListing.toFixed(1) : '-', l: 'avg blocked nights' },
    { v: o ? o.unbookedPerListing.toFixed(1) : '-', l: 'avg unbooked nights' },
    { v: <><Fig k="occ_stay" portfolio={!one}>{stay === null ? '-' : stay.toFixed(1)}</Fig> nights</>, l: 'average length of stay' },
    { v: o ? o.checkInsPerListing.toFixed(1) : '-', l: 'avg check-ins / listing' },
  ];
  const months = o?.months ?? [];
  const ms = unit ? monthStats(cal.data, unit.id, month) : null;
  const { min, max } = monthRange(today);
  return (
    <>
      <section className="sc-card">
        <div className="sc-eyebrow">Occupancy &amp; reliability</div>
        <div className="sc-two-up" style={{ marginTop: 20, border: '1px solid var(--sc-line)', borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ padding: 28 }}><div className="sc-big" style={{ fontSize: 'clamp(56px, 7vw, 88px)', letterSpacing: '-0.05em' }}><Fig k="occ_rate" portfolio={!one}>{fig('occ_rate', o?.rate)}</Fig>%</div><div className="sc-sub" style={{ marginTop: 10 }}>average occupancy rate</div></div>
          <div className="sc-two-up-b" style={{ padding: 28, background: 'var(--sc-teal-panel)' }}><div className="sc-big" style={{ fontSize: 'clamp(56px, 7vw, 88px)', letterSpacing: '-0.05em', color: 'var(--sc-teal)' }}><Fig k="occ_cancel" portfolio={!one}>{fig('occ_cancel', o?.cancel)}</Fig>%</div><div className="sc-sub" style={{ marginTop: 10 }}>cancellation rate</div></div>
        </div>
        <div className="sc-grid-5" style={{ marginTop: 28 }}>
          {small.map(s => <div key={s.l}><div className="num" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>{s.v}</div><div className="sc-label">{s.l}</div></div>)}
        </div>
      </section>
      <section className="sc-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
          <div><div className="sc-eyebrow">Year-round daily occupancy</div><div className="sc-sub" style={{ marginTop: 8 }}>Share of listings booked on an average day{months.length ? `, ${monthLabel(months[0].month)} – ${monthLabel(months[months.length - 1].month)}` : ''}</div></div>
          <div className="sc-big" style={{ fontSize: 64, letterSpacing: '-0.04em' }}><Fig k="occ_year" portfolio={!one}>{fig('occ_year', o?.year)}</Fig>%</div>
        </div>
        <div className="sc-grid-12" style={{ marginTop: 26 }}>
          {months.map(m => <div key={m.month} style={{ borderTop: '3px solid var(--sc-teal)', paddingTop: 10 }}><div style={{ fontSize: 12, color: 'var(--sc-muted)', fontWeight: 600 }}>{monthLabel(m.month).slice(0, 3)}</div><div className="num" style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{m.occupancy}%</div></div>)}
        </div>
      </section>
      {one && unit && ms && (
        <section className="sc-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
            <div><div className="sc-eyebrow">Monthly calendar</div><div className="sc-sub" style={{ marginTop: 8 }}>{unit.name} · {unit.unit}</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><MonthNav month={month} min={min} max={max} onChange={setMonth} /><PriceToggle on={showPrice} onChange={setShowPrice} /></div>
          </div>
          <div className="sc-grid-4" style={{ margin: '24px 0' }}>
            <div><div className="sc-big" style={{ fontSize: 40, letterSpacing: '-0.04em', color: 'var(--sc-teal)' }}>{ms.occupancy}%</div><div className="sc-label" style={{ marginTop: 6 }}>occupancy in {monthLabel(month, { long: true })}</div></div>
            <div><div className="sc-big" style={{ fontSize: 40, letterSpacing: '-0.04em' }}>{ms.nights}</div><div className="sc-label" style={{ marginTop: 6 }}>nights booked</div></div>
            <div><div className="sc-big" style={{ fontSize: 40, letterSpacing: '-0.04em' }}>{ms.stays}</div><div className="sc-label" style={{ marginTop: 6 }}>reservations</div></div>
            {showPrice && <div><div className="sc-big" style={{ fontSize: 40, letterSpacing: '-0.04em' }}>{rmShort(ms.revenue)}</div><div className="sc-label" style={{ marginTop: 6 }}>total revenue this month</div></div>}
          </div>
          <MonthGrid data={cal.data} unitId={unit.id} month={month} showPrice={showPrice} compact />
        </section>
      )}
    </>
  );
}

/* 06 Lead Time */

const BUCKETS = [['0–2 days', 'var(--sc-lead-0)'], ['3–7 days', 'var(--sc-lead-1)'], ['8–14 days', 'var(--sc-lead-2)'], ['15–30 days', 'var(--sc-lead-3)'], ['30+ days', 'var(--sc-lead-4)']] as const;

export function LeadScreen({ ins, g, one }: { ins: Insights | null; g: G; one: boolean }) {
  const [sort, setSort] = useState<'lead' | 'bookings' | 'rate'>('lead');
  const pct = (i: number) => (one ? ins?.lead.buckets[i] ?? 0 : g(LEAD_KEYS[i]) ?? 0);
  const rows = [...(ins?.lead.rows ?? [])].sort((a, b) => (sort === 'lead' ? b.lead - a.lead : sort === 'rate' ? b.rate - a.rate : b.bookings - a.bookings));
  const maxLead = Math.max(1, ...rows.map(r => r.lead));
  const avg = one ? ins?.lead.avg ?? null : g('lead_avg');
  return (
    <>
      <section className="sc-card sc-lead-hero">
        <div>
          <div className="sc-eyebrow">Booking lead time</div>
          <div className="sc-big" style={{ fontSize: 'clamp(64px, 8vw, 96px)', letterSpacing: '-0.05em', marginTop: 16 }}><Fig k="lead_avg" portfolio={!one}>{avg === null ? '-' : avg.toFixed(1)}</Fig><span style={{ fontSize: 36, letterSpacing: '-0.02em' }}> days</span></div>
          <div className="sc-sub" style={{ marginTop: 12, maxWidth: 340 }}>On average, guests book our units this far ahead of their check-in date.</div>
        </div>
        <div>
          <div style={{ display: 'flex', height: 44, borderRadius: 12, overflow: 'hidden', gap: 3 }}>
            {BUCKETS.map(([, c], i) => pct(i) > 0 && (
              <div key={i} style={{ flex: pct(i), minWidth: 0, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sc-surface)', fontSize: 13, fontWeight: 800 }}>
                <Fig k={LEAD_KEYS[i]} portfolio={!one}>{fmtFigure(LEAD_KEYS[i], pct(i))}%</Fig>
              </div>
            ))}
          </div>
          <div className="sc-grid-5" style={{ gap: 10, marginTop: 14 }}>
            {BUCKETS.map(([l, c]) => <div key={l} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--sc-muted)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c, marginTop: 3, flexShrink: 0 }} />{l}</div>)}
          </div>
        </div>
      </section>
      <section className="sc-card flush">
        <div style={{ padding: '22px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--sc-line)', gap: 12, flexWrap: 'wrap' }}>
          <div className="sc-h2">Lead time by property</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--sc-muted)' }}>Sort by
            {([['lead', 'Lead time'], ['bookings', 'Bookings'], ['rate', 'Rate']] as const).map(([k, l]) => <button key={k} type="button" className="sc-chip sm" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}
          </div>
        </div>
        <div className="sc-lead-grid sc-thead"><div>Property</div><div>Avg lead time</div><div>Bookings</div><div style={{ textAlign: 'right' }}>Avg nightly rate</div></div>
        {rows.map(r => (
          <div key={r.unitId} className="sc-lead-grid sc-trow">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
              <Photo id={r.photoId} fine style={{ width: 40, height: 40, borderRadius: 8 }} />
              <div style={{ minWidth: 0 }}><div className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{r.name}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{r.unit}</div></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div className="sc-bar"><span style={{ width: `${Math.round((r.lead / maxLead) * 100)}%` }} /></div><div className="num" style={{ fontSize: 14, fontWeight: 800, width: 64, textAlign: 'right' }}>{r.lead.toFixed(1)} d</div></div>
            <div className="num" style={{ fontSize: 14 }}>{count(r.bookings)}</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>{rmShort(r.rate * 100)}</div>
          </div>
        ))}
        {!rows.length && <div className="sc-empty">No bookings checked in during this range.</div>}
      </section>
    </>
  );
}

/* 07 Page Views */

export function ViewsScreen({ g }: { g: G }) {
  const pv = g('views_pv'), imp = g('views_imp');
  return (
    <div className="sc-wrap">
      <section className="sc-card dark">
        <div className="sc-eyebrow">Airbnb exposure · per listing</div>
        <div className="sc-two-up" style={{ gap: 40, marginTop: 22 }}>
          <div><div className="sc-big" style={{ fontSize: 'clamp(64px, 8vw, 96px)', letterSpacing: '-0.05em' }}><Fig k="views_pv">{fmtFigure('views_pv', pv)}</Fig></div><div style={{ fontSize: 15, color: 'var(--sc-dark-soft)', marginTop: 12 }}>average listing page views</div></div>
          <div><div className="sc-big" style={{ fontSize: 'clamp(64px, 8vw, 96px)', letterSpacing: '-0.05em' }}><Fig k="views_imp">{fmtFigure('views_imp', imp)}</Fig></div><div style={{ fontSize: 15, color: 'var(--sc-dark-soft)', marginTop: 12 }}>average first-page search impressions</div></div>
        </div>
        {pv !== null && imp !== null && (
          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--sc-dark-line)', fontSize: 18, lineHeight: 1.5, color: 'var(--sc-dark-text)', maxWidth: 760, textWrap: 'pretty' } as CSSProperties}>
            A unit listed with The Conts is seen in Airbnb search about <b style={{ color: 'var(--sc-surface)' }}>{fmtFigure('views_imp', imp)}</b> times and opened by about <b style={{ color: 'var(--sc-surface)' }}>{fmtFigure('views_pv', pv)}</b> people every month.
          </div>
        )}
      </section>
    </div>
  );
}
