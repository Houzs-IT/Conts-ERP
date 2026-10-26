import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { at, useChat, CaseTrail, toListing, toCalendar } from './portalParts';
import { useSearchParams } from 'react-router-dom';
import { rm, rmShort, count, dateShort, monthLabel, weekdayDate, todayMyt, nights as nightsLabel, plural } from '../../lib/format';
import { addDays, daysBetween, type CalendarStay, type Listing } from './model';
import { Avatar, Photo, Segmented, MonthNav, useEscape } from './parts';
import { MonthGrid, monthStats, monthDays } from './CalendarScreen';
import { ListingPreview } from './screens';
import { useSwitch, useExit, SwitchButton, CurtainLayer } from './Switch';
import { OwnerPhone } from './OwnerPhone';
import { sampleOwner, monthShift, occupancy, STATUS_WORD, UNITS, OWNER, MANAGER, GUARANTEE, type SampleCase } from './sampleOwner';
import './showcase.css';
import './owner-portal.css';

const PAGES = [['listings', 'My listings'], ['calendar', 'Calendar'], ['reviews', 'Reviews'], ['perf', 'Performance'], ['service', 'Service cases'], ['payments', 'Payments'], ['support', 'Support']] as const;
type Page = typeof PAGES[number][0];
const HEADS: Record<Page, [string, string, string]> = {
  listings: ['Owner portal', `Welcome back, ${OWNER.first}`, '3 units managed by The Conts · all live on Airbnb'],
  calendar: ['Calendar', 'Who is staying', 'Real Airbnb reservations on your units. Click a stay for details.'],
  reviews: ['Reviews', 'What guests say', 'Every review your units received on Airbnb.'],
  perf: ['Performance', 'How your units perform', 'Live from Airbnb, updated daily.'],
  service: ['Service cases', 'Every visit, on record', 'Each case links to our ERP with a full audit trail and photos.'],
  payments: ['Payments', 'Your income', 'Monthly statements, guaranteed return and total payout.'],
  support: ['Support', 'Talk to us', 'Message your owner relations manager directly.'],
};
const TOPICS = ['Question about my payout', 'Report an issue in my unit', 'Change my blocked dates', 'Request a monthly report'];
const BUCKETS = [[16, '0–2 days', 'var(--sc-lead-0)'], [29, '3–7 days', 'var(--sc-lead-1)'], [25, '8–14 days', 'var(--sc-lead-2)'], [18, '15–30 days', 'var(--sc-lead-3)'], [12, '30+ days', 'var(--sc-lead-4)']] as const;
const FONT_ID = 'sc-manrope';

/** The owner portal shown as part of the Owner Showcase: what an owner sees after joining The Conts, with a fixed
 *  sample owner (sampleOwner.ts). Desktop, or the phone app on iOS and Android side by side. */
export default function OwnerPortalPage() {
  const today = todayMyt();
  const data = useMemo(() => sampleOwner(today), [today]);
  const [params, setParams] = useSearchParams();
  const page = (PAGES.some(p => p[0] === params.get('tab')) ? params.get('tab') : 'listings') as Page;
  const device = params.get('device') === 'mobile' ? 'mobile' : 'desktop';
  const setParam = (k: string, v: string | null) => setParams(prev => { const n = new URLSearchParams(prev); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const [unit, setUnit] = useState('all');
  const [calUnit, setCalUnit] = useState('u0');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [sel, setSel] = useState<CalendarStay | null>(null);
  const [preview, setPreview] = useState<Listing | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ label: string; caption: string } | null>(null);
  const [bill, setBill] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const { chat, send } = useChat(data.chat);
  const chatRef = useRef<HTMLDivElement>(null);
  const sw = useSwitch('/performance/showcase', { from: 'Owner', to: 'Portfolio', sub: 'The Conts · every listing' });
  const exit = useExit();
  // Esc leaves, as on the showcase; an open drawer, modal or preview closes first (useEscape stops the key there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exit(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    document.title = 'Owner portal · The Conts';
    if (!document.getElementById(FONT_ID)) {
      const l = document.createElement('link');
      l.id = FONT_ID; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
      document.head.appendChild(l);
    }
  }, []);
  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat, page]);

  const scope = unit === 'all' ? UNITS : UNITS.filter(u => u.id === unit);
  const scopeIds = scope.map(u => u.id);
  const cal = useMemo(() => toCalendar(data.stays, today), [data, today]);
  const occ30 = occupancy(data.stays, scopeIds, addDays(today, -30), today);
  const rating = scope.reduce((s, u) => s + u.rating, 0) / scope.length;
  const reviewCount = scope.reduce((s, u) => s + u.reviews, 0);
  const five = unit === 'all' ? 91.4 : 89 + UNITS.findIndex(u => u.id === unit) * 2.1;
  const cases = data.cases.filter(c => unit === 'all' || c.unitId === unit);
  const kase = caseId ? data.cases.find(c => c.id === caseId) ?? null : null;
  const head = HEADS[page];
  const chips = page === 'calendar'
    ? UNITS.map(u => ({ id: u.id, label: u.unit, on: calUnit === u.id, pick: () => setCalUnit(u.id) }))
    : [{ id: 'all', label: `All my units (${UNITS.length})`, on: unit === 'all', pick: () => setUnit('all') }, ...UNITS.map(u => ({ id: u.id, label: u.unit, on: unit === u.id, pick: () => setUnit(u.id) }))];
  const st = bill !== null ? data.statements[bill] : null;
  const unitOf = (id: string) => UNITS.find(u => u.id === id)!;
  const ytd = data.statements.filter(s => s.month.startsWith(today.slice(0, 4))).reduce((n, s) => n + s.payout, 0);
  const ms = monthStats(cal, calUnit, month);

  return (
    <div className="sc sc-enter">
      <header className="sc-op-header">
        <div className="sc-logo" style={{ height: 68 }}><div className="sc-logo-tile">TC</div><div className="sc-logo-word">The Conts</div><span className="sc-op-pill">OWNER</span></div>
        <nav className="sc-op-tabs" aria-label="Owner portal pages">
          {PAGES.map(([k, l]) => <button key={k} type="button" className="sc-op-tab" aria-current={page === k ? 'page' : undefined} onClick={() => setParam('tab', k === 'listings' ? null : k)}>{l}</button>)}
        </nav>
        <div className="sc-op-right">
          <Segmented value={device} onChange={v => setParam('device', v === 'mobile' ? 'mobile' : null)} options={[{ key: 'desktop', label: 'Desktop' }, { key: 'mobile', label: 'Mobile' }]} />
          <div className="sc-op-avatar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="sc-avatar" style={{ width: 34, height: 34, fontSize: 13, background: 'var(--sc-tint-4)' }}>{OWNER.initials}</div><div className="sc-op-name">{OWNER.name}</div></div>
          <SwitchButton current="Owner" next="Portfolio" rolled={sw.rolled} onClick={sw.go} />
          <button type="button" className="sc-exit" onClick={exit} aria-label="Exit the showcase">✕ Exit</button>
        </div>
      </header>

      {device === 'mobile' ? (
        <div className="sc-phones">
          {(['ios', 'android'] as const).map(p => (
            <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--sc-ink-2)' }}>{p === 'ios' ? 'iOS' : 'ANDROID'}</div>
              <OwnerPhone platform={p} data={data} today={today} />
            </div>
          ))}
          <div className="sc-sample-note" style={{ flexBasis: '100%' }}>Sample owner account, shown as an example. The figures are illustrations, not a real owner's.</div>
        </div>
      ) : (
        <main key={`${page}|${unit}|${calUnit}`} className="sc-op-main sc-rise">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div className="sc-eyebrow">{head[0]}</div>
              <div style={{ fontSize: 'clamp(28px, 4vw, 36px)', fontWeight: 800, letterSpacing: '-0.03em', marginTop: 6 }}>{head[1]}</div>
              <div className="sc-sub" style={{ marginTop: 4 }}>{head[2]}</div>
            </div>
            {['calendar', 'reviews', 'perf', 'service'].includes(page) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{chips.map(c => <button key={c.id} type="button" className="sc-chip" style={{ fontWeight: 700 }} aria-pressed={c.on} onClick={c.pick}>{c.label}</button>)}</div>
            )}
          </div>

          {page === 'listings' && (
            <div className="sc-op-grid-3">
              {UNITS.map(u => {
                const next = data.stays.filter(s => s.unitId === u.id && s.checkIn > today).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
                return (
                  <button key={u.id} type="button" onClick={() => setPreview(toListing(u))} style={{ textAlign: 'left', border: '1px solid var(--sc-line)', background: 'var(--sc-surface)', borderRadius: 20, padding: '12px 12px 18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <Photo label="listing photo" style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 14 }}><span className="sc-published" style={{ top: 12, left: 12 }}><span className="sc-dot" />Live on Airbnb</span></Photo>
                    <div style={{ padding: '0 6px' }}><div style={{ fontSize: 16, fontWeight: 700 }}>{u.name}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 2 }}>{u.unit} · ★ {u.rating.toFixed(2)} · {plural(u.reviews, 'review')}</div></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 6px 0', borderTop: '1px solid var(--sc-subtle)', margin: '0 6px' }}>
                      <div><div style={{ fontSize: 20, fontWeight: 800 }}>{occupancy(data.stays, [u.id], `${today.slice(0, 7)}-01`, addDays(`${today.slice(0, 7)}-01`, monthDays(today.slice(0, 7))))}%</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>occupancy · {monthLabel(today).slice(0, 3)}</div></div>
                      <div><div style={{ fontSize: 14, fontWeight: 800, marginTop: 4 }}>{next ? weekdayDate(next.checkIn) : '-'}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>next check-in</div></div>
                    </div>
                    <div style={{ padding: '0 6px', fontSize: 13, fontWeight: 700, color: 'var(--sc-teal)' }}>View on Airbnb · desktop &amp; mobile →</div>
                  </button>
                );
              })}
            </div>
          )}

          {page === 'calendar' && (
            <div className="sc-month-layout" style={{ display: 'grid', gap: 20, alignItems: 'start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <MonthNav month={month} min={monthShift(today, -1)} max={monthShift(today, 1)} onChange={setMonth} />
                  <div className="sc-cal-legend"><span><i style={{ background: 'var(--sc-faint)' }} />Completed</span><span><i style={{ background: 'var(--sc-teal-deep)' }} />In stay</span><span><i style={{ background: 'var(--sc-teal-mid)' }} />Confirmed</span></div>
                </div>
                <MonthGrid data={cal} unitId={calUnit} month={month} showPrice onSelect={setSel} selected={sel?.id ?? null} />
              </div>
              <div style={{ background: 'var(--sc-surface)', border: '1px solid var(--sc-line)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div><div style={{ fontSize: 14, fontWeight: 800 }}>{unitOf(calUnit).name}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{unitOf(calUnit).unit}</div></div>
                <div style={{ borderTop: '1px solid var(--sc-subtle)', paddingTop: 16 }}><div className="sc-big" style={{ fontSize: 48, letterSpacing: '-0.04em', color: 'var(--sc-teal)' }}>{ms.occupancy}%</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 6 }}>occupancy in {monthLabel(month, { long: true })}</div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div><div style={{ fontSize: 24, fontWeight: 800 }}>{ms.nights}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>nights booked</div></div>
                  <div><div style={{ fontSize: 24, fontWeight: 800 }}>{ms.stays}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>reservations</div></div>
                </div>
                <div style={{ borderTop: '1px solid var(--sc-subtle)', paddingTop: 16 }}><div style={{ fontSize: 24, fontWeight: 800 }}>{rmShort(ms.revenue)}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>booked revenue this month</div></div>
              </div>
            </div>
          )}

          {page === 'reviews' && (
            <div className="sc-card">
              <div className="sc-grid-3" style={{ paddingBottom: 28, borderBottom: '1px solid var(--sc-line)' }}>
                <Big v={count(reviewCount)} l="reviews on your units" />
                <Big v={`${five.toFixed(1)}%`} l="of stays rated 5 stars" />
                <Big v={<>{rating.toFixed(2)}<span style={{ fontSize: 32, color: 'var(--sc-star)' }}>★</span></>} l="overall rating out of 5" />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '26px 0 16px', gap: 12, flexWrap: 'wrap' }}><div className="sc-h2">Recent 5-star reviews</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Only 5-star reviews shown · newest first</div></div>
              <div className="sc-grid-3" style={{ gap: 16 }}>
                {data.reviews.filter(r => unit === 'all' || r.unitId === unit).map((r, k) => (
                  <div key={k} style={{ border: '1px solid var(--sc-line)', borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Avatar name={r.guest} i={k} size={40} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{r.guest}</div><div className="ellipsis" style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{dateShort(r.from)} – {dateShort(r.to)} · {unitOf(r.unitId).unit}</div></div></div>
                    <div style={{ color: 'var(--sc-star)', fontSize: 14, letterSpacing: 2 }}>★★★★★</div>
                    <div style={{ fontSize: 14, lineHeight: 1.55 }}>{r.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {page === 'perf' && (
            <>
              <div className="sc-op-grid-3" style={{ gap: 20 }}>
                <div className="sc-op-card"><div className="sc-eyebrow">Occupancy</div><div className="sc-big" style={{ fontSize: 64, letterSpacing: '-0.045em', marginTop: 14 }}>{occ30}%</div><div className="sc-label" style={{ fontSize: 14, marginTop: 8 }}>last 30 days</div></div>
                <div className="sc-op-card"><div className="sc-eyebrow">Cancellation rate</div><div className="sc-big" style={{ fontSize: 64, letterSpacing: '-0.045em', marginTop: 14, color: 'var(--sc-teal)' }}>1.4%</div><div className="sc-label" style={{ fontSize: 14, marginTop: 8 }}>of confirmed bookings</div></div>
                <div className="sc-op-card"><div className="sc-eyebrow">Guest rating</div><div className="sc-big" style={{ fontSize: 64, letterSpacing: '-0.045em', marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 6 }}>{rating.toFixed(2)}<span style={{ fontSize: 28, color: 'var(--sc-star)' }}>★</span></div><div className="sc-label" style={{ fontSize: 14, marginTop: 8 }}>{count(reviewCount)} reviews · {five.toFixed(1)}% five-star</div></div>
              </div>
              <div className="sc-op-card sc-grid-4">
                {[[`${(3.6 + scope.length * 0.1).toFixed(1)} nights`, 'average length of stay'], [String(Math.round(occ30 * 0.3)), 'nights booked / 30 days'], [rmShort(Math.round(scope.reduce((s, u) => s + u.base, 0) / scope.length) + 1200), 'average nightly rate'], [count(scope.length * 1150), 'listing page views / month']].map(([v, l]) => (
                  <div key={l}><div className="num" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em' }}>{v}</div><div className="sc-label">{l}</div></div>
                ))}
              </div>
              <div className="sc-op-card sc-lead-hero">
                <div><div className="sc-eyebrow">Booking lead time</div><div className="sc-big" style={{ fontSize: 72, letterSpacing: '-0.05em', marginTop: 14 }}>11.2<span style={{ fontSize: 28 }}> days</span></div><div className="sc-label" style={{ fontSize: 14, marginTop: 8 }}>Guests book your units this far ahead on average.</div></div>
                <div>
                  <div style={{ display: 'flex', height: 40, borderRadius: 12, overflow: 'hidden', gap: 3 }}>{BUCKETS.map(([p, , c]) => <div key={c} style={{ flex: p, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sc-surface)', fontSize: 13, fontWeight: 800 }}>{p}%</div>)}</div>
                  <div className="sc-grid-5" style={{ gap: 10, marginTop: 12 }}>{BUCKETS.map(([, l, c]) => <div key={l} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--sc-muted)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}</div>)}</div>
                </div>
              </div>
            </>
          )}

          {page === 'service' && (
            <>
              <div className="sc-op-card sc-grid-4">
                {[[cases.length, 'service cases this month'], [cases.filter(c => c.cat === 'Housekeeping').length * 6, 'linen changes this month'], ['2h 41m', 'average time to fix'], [cases.filter(c => !c.done).length, 'open right now']].map(([v, l]) => (
                  <div key={String(l)}><div className="num" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>{v}</div><div className="sc-label">{l}</div></div>
                ))}
              </div>
              <div className="sc-card flush sc-scroll-x">
                <div className="sc-op-case-grid" style={{ padding: '14px 24px', fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sc-line)' }}>
                  <div>Case</div><div>Issue</div><div>Unit</div><div>Opened</div><div>Time to fix</div><div>Status</div>
                </div>
                {cases.map(c => (
                  <button key={c.id} type="button" className="sc-op-case-grid" onClick={() => setCaseId(c.id)} style={{ width: '100%', padding: '14px 24px', alignItems: 'center', border: 'none', borderBottom: '1px solid var(--sc-subtle)', background: 'var(--sc-surface)', textAlign: 'left', cursor: 'pointer', fontSize: 14 }}>
                    <div className="num" style={{ fontWeight: 800 }}>{c.id}</div>
                    <div><div style={{ fontWeight: 700 }}>{c.title}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{c.cat}</div></div>
                    <div className="ellipsis" style={{ color: 'var(--sc-ink-2)' }}>{unitOf(c.unitId).name}</div>
                    <div style={{ color: 'var(--sc-ink-2)' }}>{at(c.trail[0].at)}</div>
                    <div style={{ fontWeight: 700 }}>{c.ttf}</div>
                    <div><span className={`sc-status ${c.done ? 'ok' : 'open'}`}>{c.done ? 'Resolved' : 'In progress'}</span></div>
                  </button>
                ))}
              </div>
            </>
          )}

          {page === 'payments' && (
            <>
              <div className="sc-op-pay-top">
                <div className="sc-card dark" style={{ padding: 28 }}><div className="sc-eyebrow">Guaranteed return</div><div className="sc-big" style={{ fontSize: 'clamp(30px, 3.4vw, 48px)', letterSpacing: '-0.04em', marginTop: 14, whiteSpace: 'nowrap' }}>{rmShort(GUARANTEE)}</div><div style={{ fontSize: 14, color: 'var(--sc-dark-soft)', marginTop: 8 }}>per month across your 3 units · topped up when bookings fall short</div></div>
                <PayStat l="Total paid out" v={rmShort(data.statements[0].acc)} s={`since ${monthLabel(data.statements[data.statements.length - 1].month)}`} />
                <PayStat l={`Income ${today.slice(0, 4)} to date`} v={rmShort(ytd)} s="accumulated net income" />
                <PayStat l="Next payout" v={dateShort(`${monthShift(today, 1)}-07`)} s={`${monthLabel(today, { long: true }).split(' ')[0]} statement · processing`} />
              </div>
              <div className="sc-card flush sc-scroll-x">
                <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--sc-line)' }} className="sc-h2">Monthly statements</div>
                <div className="sc-op-statement-grid" style={{ padding: '12px 24px', fontSize: 11, fontWeight: 700, color: 'var(--sc-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--sc-line)' }}>
                  <div>Month</div><div>Nights</div><div style={{ textAlign: 'right' }}>Gross</div><div style={{ textAlign: 'right' }}>Fees &amp; costs</div><div style={{ textAlign: 'right' }}>Top-up</div><div style={{ textAlign: 'right' }}>Payout</div><div style={{ textAlign: 'right' }}>Accumulated</div><div>Status</div><div />
                </div>
                {data.statements.map((m, k) => (
                  <div key={m.month} className="sc-op-statement-grid num" style={{ padding: '13px 24px', alignItems: 'center', borderBottom: '1px solid var(--sc-subtle)', fontSize: 14 }}>
                    <div style={{ fontWeight: 700 }}>{monthLabel(m.month)}</div><div>{m.nights}</div>
                    <div style={{ textAlign: 'right' }}>{rmShort(m.gross)}</div><div style={{ textAlign: 'right', color: 'var(--sc-muted)' }}>− {rmShort(m.costs)}</div>
                    <div style={{ textAlign: 'right', color: m.topup ? 'var(--sc-teal)' : 'var(--sc-disabled)' }}>{m.topup ? `+ ${rmShort(m.topup)}` : '-'}</div>
                    <div style={{ textAlign: 'right', fontWeight: 800 }}>{rmShort(m.payout)}</div><div style={{ textAlign: 'right', color: 'var(--sc-ink-2)' }}>{rmShort(m.acc)}</div>
                    <div><span className={`sc-status ${m.processing ? 'open' : 'ok'}`}>{m.processing ? 'Processing' : 'Paid'}</span></div>
                    <button type="button" onClick={() => setBill(k)} style={{ border: 'none', background: 'transparent', fontSize: 13, fontWeight: 700, color: 'var(--sc-teal)', cursor: 'pointer', textAlign: 'right' }}>View bill</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {page === 'support' && (
            <div className="sc-op-support">
              <div style={{ borderRight: '1px solid var(--sc-line)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="sc-avatar" style={{ width: 48, height: 48, background: 'var(--sc-tint-1)' }}>{MANAGER.initials}</div><div><div style={{ fontSize: 15, fontWeight: 800 }}>{MANAGER.name}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Your owner relations manager</div></div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sc-green-ink)', fontWeight: 700 }}><span className="sc-dot" />Online · replies in ~5 min</div>
                <div style={{ borderTop: '1px solid var(--sc-subtle)', paddingTop: 16, fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick topics</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{TOPICS.map(t => <button key={t} type="button" onClick={() => send(t)} style={{ height: 38, border: '1px solid var(--sc-line)', borderRadius: 12, background: 'var(--sc-surface)', textAlign: 'left', padding: '0 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{t}</button>)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div ref={chatRef} style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--sc-page)' }}>
                  {chat.map((m, k) => (
                    <div key={k} style={{ display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: m.me ? 'flex-end' : 'flex-start' }}>
                        <div className={`sc-bubble ${m.me ? 'me' : 'them'}`}>{m.text}</div>
                        <div style={{ fontSize: 11, color: 'var(--sc-faint)' }}>{m.me ? 'You' : 'Aina'} · {at(m.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid var(--sc-line)', padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input className="sc-input" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { send(draft); setDraft(''); } }} placeholder="Write a message to The Conts..." aria-label="Message" />
                  <button type="button" className="sc-btn-dark" disabled={!draft.trim()} onClick={() => { send(draft); setDraft(''); }}>Send</button>
                </div>
              </div>
            </div>
          )}

          <div className="sc-sample-note">Sample owner account, shown as an example. The figures are illustrations, not a real owner's.</div>
        </main>
      )}

      {sel && <StayDrawer stay={sel} onClose={() => setSel(null)} />}
      {kase && <CaseDrawer c={kase} onClose={() => setCaseId(null)} onPhoto={(label, caption) => setPhoto({ label, caption })} />}
      {photo && <div className="sc-lightbox" onClick={() => setPhoto(null)} role="dialog" aria-label={photo.caption}><div className="sc-lightbox-photo" style={{ width: 'min(860px, 86vw)', aspectRatio: '4 / 3' }}>{photo.label} · case photo</div><div style={{ color: 'var(--sc-surface)', fontSize: 14, fontWeight: 700 }}>{photo.caption}</div></div>}
      {st && (
        <BillModal onClose={() => setBill(null)} title={`${monthLabel(st.month)} statement`} sub={`${OWNER.name} · 3 units · ${st.nights} nights booked`}
          onAsk={() => { setBill(null); setParam('tab', 'support'); send(`Question about my ${monthLabel(st.month)} statement.`); }}
          lines={[
            ['Gross booking revenue', rm(st.gross), 'strong'], ['Airbnb host fee (3%)', `− ${rm(Math.round(st.gross * 0.03))}`, ''], ['Management fee (15%)', `− ${rm(Math.round(st.gross * 0.15))}`, ''],
            ['Cleaning & linen', `− ${rm(st.costs - Math.round(st.gross * 0.18) - 18000)}`, ''], ['Maintenance (service cases)', `− ${rm(18000)}`, ''],
            ['Net income', rm(st.net), 'strong'], ['Guaranteed return top-up', st.topup ? `+ ${rm(st.topup)}` : 'Not needed', 'teal'],
          ]} payout={rm(st.payout)} acc={rm(st.acc)} />
      )}
      {preview && <ListingPreview l={preview} hostLine="Professional hosting, cleaning and maintenance" onClose={() => setPreview(null)} />}
      <CurtainLayer curtain={sw.curtain} />
    </div>
  );
}

function Big({ v, l }: { v: ReactNode; l: string }) {
  return <div><div className="sc-big" style={{ fontSize: 'clamp(48px, 6vw, 72px)', letterSpacing: '-0.045em', display: 'flex', alignItems: 'baseline', gap: 8 }}>{v}</div><div style={{ fontSize: 14, color: 'var(--sc-muted)', marginTop: 10 }}>{l}</div></div>;
}
function PayStat({ l, v, s }: { l: string; v: string; s: string }) {
  return <div className="sc-op-card"><div style={{ fontSize: 13, color: 'var(--sc-muted)', fontWeight: 600 }}>{l}</div><div className="num" style={{ fontSize: 'clamp(22px, 2.3vw, 32px)', fontWeight: 800, letterSpacing: '-0.03em', marginTop: 10, whiteSpace: 'nowrap' }}>{v}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: 6 }}>{s}</div></div>;
}

function StayDrawer({ stay, onClose }: { stay: CalendarStay; onClose: () => void }) {
  useEscape(onClose);
  const u = UNITS.find(x => x.id === stay.unitId)!;
  const n = daysBetween(stay.checkIn, stay.checkOut);
  const rows: [string, string][] = [['Property', u.name], ['Unit', u.unit], ['Check-in', `${weekdayDate(stay.checkIn)}, 3:00 PM`], ['Check-out', `${weekdayDate(stay.checkOut)}, 11:00 AM`], ['Nights', nightsLabel(n)], ['Guests', `${stay.guests} ${stay.guests === 1 ? 'adult' : 'adults'}`], ['Status', STATUS_WORD[stay.status]], ['Booking value', rm(stay.total)]];
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 29 }} />
      <div className="sc-side" style={{ width: 380, zIndex: 30, boxShadow: 'var(--sc-shadow-drawer)' }} role="dialog" aria-label={`Reservation ${stay.code}`}>
        <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--sc-line)' }}><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reservation {stay.code}</div><button type="button" className="sc-close" aria-label="Close" onClick={onClose}>×</button></div>
        <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--sc-line)' }}><Avatar name={stay.guest} i={stay.code.charCodeAt(2)} size={52} /><div><div style={{ fontSize: 20, fontWeight: 800 }}>{stay.guest}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>Verified Airbnb guest</div></div></div>
        <div style={{ padding: '8px 24px', flex: 1, overflow: 'auto' }}>{rows.map(([l, v]) => <div key={l} className="sc-drawer-row" style={{ gap: 16 }}><span>{l}</span><span style={{ textAlign: 'right' }}>{v}</span></div>)}</div>
      </div>
    </>
  );
}

function CaseDrawer({ c, onClose, onPhoto }: { c: SampleCase; onClose: () => void; onPhoto: (label: string, caption: string) => void }) {
  useEscape(onClose);
  const u = UNITS.find(x => x.id === c.unitId)!;
  return (
    <>
      <div className="sc-scrim-dim" onClick={onClose} />
      <div className="sc-side" style={{ width: 560 }} role="dialog" aria-label={`Service case ${c.id}`}>
        <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--sc-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', letterSpacing: '0.05em' }}>SERVICE CASE {c.id}</div><div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{c.title}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 2 }}>{u.name} · {u.unit}</div></div>
          <button type="button" className="sc-close" style={{ width: 36, height: 36, flexShrink: 0 }} aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {[['Status', c.done ? 'Resolved' : 'In progress', c.done ? 'var(--sc-green-ink)' : 'var(--sc-amber-ink)'], ['Time to fix', c.ttf, ''], ['Operator', c.operator, '']].map(([l, v, col]) => (
              <div key={l} style={{ background: 'var(--sc-page)', borderRadius: 14, padding: 14 }}><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{l}</div><div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color: col || undefined }}>{v}</div></div>
            ))}
          </div>
          <div><div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>Audit trail</div><CaseTrail c={c} /></div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>Photos</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {c.photos.map(p => <button key={p} type="button" onClick={() => onPhoto(p, `${c.id} · ${c.title}`)} className="sc-photo" style={{ aspectRatio: '1', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'flex-end', padding: 8 }}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'var(--sc-surface)', position: 'relative' }}>{p}</span></button>)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function BillModal({ title, sub, lines, payout, acc, onClose, onAsk }: { title: string; sub: string; lines: [string, string, string][]; payout: string; acc: string; onClose: () => void; onAsk: () => void }) {
  useEscape(onClose);
  return (
    <>
      <div className="sc-scrim-dim" style={{ background: 'rgba(28,27,25,0.3)' }} onClick={onClose} />
      <div className="sc-modal" role="dialog" aria-label={title}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}><div><div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', letterSpacing: '0.05em' }}>OWNER STATEMENT</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{title}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>{sub}</div></div><button type="button" className="sc-close" style={{ width: 36, height: 36, flexShrink: 0 }} aria-label="Close" onClick={onClose}>×</button></div>
        <div style={{ marginTop: 22, borderTop: '1px solid var(--sc-line)' }}>
          {lines.map(([l, v, k]) => <div key={l} className="num" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--sc-subtle)', fontSize: 14, gap: 12 }}><span style={{ color: k === 'strong' ? 'var(--sc-ink)' : k === 'teal' ? 'var(--sc-teal)' : 'var(--sc-muted)' }}>{l}</span><span style={{ fontWeight: k === 'strong' ? 800 : k === 'teal' ? 700 : 600 }}>{v}</span></div>)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18 }}><span style={{ fontSize: 15, fontWeight: 800 }}>Payout to owner</span><span className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>{payout}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--sc-muted)', marginTop: 6 }}><span>Accumulated payout to date</span><span className="num" style={{ fontWeight: 700, color: 'var(--sc-ink)' }}>{acc}</span></div>
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button type="button" className="sc-btn-line" style={{ flex: 1 }} disabled title="A real owner downloads the statement PDF here; the sample has none.">Download PDF</button>
          <button type="button" className="sc-btn-dark" style={{ flex: 1, height: 44, fontSize: 13 }} onClick={onAsk}>Ask about this bill</button>
        </div>
      </div>
    </>
  );
}
