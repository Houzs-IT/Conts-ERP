import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { at, useChat, CaseTrail, toListing, toCalendar } from './portalParts';
import { useSearchParams } from 'react-router-dom';
import { rm, count, dateShort, monthLabel, weekdayDate, todayMyt, nights as nightsLabel, plural } from '../../lib/format';
import Icon from '../../components/Icon';
import ChannelMark from '../../components/ChannelMark';
import { addDays, daysBetween, type CalendarStay, type Listing } from './model';
import { Avatar, Photo, Segmented, MonthNav, useEscape, Stars, Star, buildingOf, useDisplayFont } from './parts';
import { MonthGrid, monthStats, monthDays } from './CalendarScreen';
import { ListingPreview } from './screens';
import { useSwitch, useExit, SwitchButton, CurtainLayer } from './Switch';
import { OwnerPhone } from './OwnerPhone';
import { sampleOwner, monthShift, occupancy, STATUS_WORD, UNITS, OWNER, MANAGER, GUARANTEE, type SampleCase, type SampleStatement } from './sampleOwner';
import './showcase.css';
import './owner-portal.css';

const PAGES = [['listings', 'My listings'], ['calendar', 'Calendar'], ['reviews', 'Reviews'], ['perf', 'Performance'], ['service', 'Service cases'], ['payments', 'Payments'], ['support', 'Support']] as const;
type Page = typeof PAGES[number][0];
const HEADS: Record<Page, [string, string, string]> = {
  listings: ['Owner portal', `Welcome back, ${OWNER.first}`, `${UNITS.length} units managed by The Conts · all live on Airbnb`],
  calendar: ['Calendar', 'Who is staying', 'Reservations on your units. Click a stay for details.'],
  reviews: ['Reviews', 'What guests say', 'Every review your units received on Airbnb.'],
  perf: ['Performance', 'How your units perform', 'From your reservations, updated daily.'],
  service: ['Service cases', 'Every visit, on record', 'Each case is tracked by our team with a full trail and photos.'],
  payments: ['Payments', 'Your income', 'Final owner statements, guaranteed return and total payout.'],
  support: ['Support', 'Talk to us', 'Message your owner relations manager directly.'],
};
const TOPICS = ['Question about my payout', 'Report an issue in my unit', 'Change my blocked dates', 'Request a monthly report'];
const BUCKETS = [[16, '0–2 days', 'var(--sc-lead-0)'], [29, '3–7 days', 'var(--sc-lead-1)'], [25, '8–14 days', 'var(--sc-lead-2)'], [18, '15–30 days', 'var(--sc-lead-3)'], [12, '30+ days', 'var(--sc-lead-4)']] as const;
/** Finished service cases shown before "Show more" (open ones always show). */
const DONE_SHOWN = 3;
const SAMPLE_NOTE = `${OWNER.name} is a sample owner. Every unit, guest and figure here is made up to show the owner portal; none is a real owner's.`;

/** The owner portal shown as part of the Owner Showcase: what an owner sees after joining The Conts, with one fixed
 *  sample owner (sampleOwner.ts), always marked Sample data. Desktop, or the phone app on iOS and Android side by side.
 *  Like the real portal, it shows only Final owner statements. */
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
  const [bill, setBill] = useState<SampleStatement | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [draft, setDraft] = useState('');
  const { chat, send } = useChat(data.chat);
  const chatRef = useRef<HTMLDivElement>(null);
  const sw = useSwitch('/performance/showcase', { from: 'Owner', to: 'Portfolio', sub: 'The Conts · every listing' });
  const exit = useExit();
  useDisplayFont();
  // Esc leaves, as on the showcase; an open drawer, modal or preview closes first (useEscape stops the key there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exit(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { document.title = 'Owner portal (sample) · The Conts'; }, []);
  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat, page]);

  const scope = unit === 'all' ? UNITS : UNITS.filter(u => u.id === unit);
  const scopeIds = scope.map(u => u.id);
  const cal = useMemo(() => toCalendar(data.stays, today), [data, today]);
  const occ30 = occupancy(data.stays, scopeIds, addDays(today, -30), today);
  const rating = scope.reduce((s, u) => s + u.rating, 0) / scope.length;
  const reviewCount = scope.reduce((s, u) => s + u.reviews, 0);
  const five = unit === 'all' ? 91.4 : 89 + UNITS.findIndex(u => u.id === unit) * 2.1;
  const cases = data.cases.filter(c => unit === 'all' || c.unitId === unit);
  const openCases = cases.filter(c => !c.done);
  const doneCases = cases.filter(c => c.done).sort((a, b) => b.trail[0].at.localeCompare(a.trail[0].at));
  const kase = caseId ? data.cases.find(c => c.id === caseId) ?? null : null;
  const head = HEADS[page];
  const chips = page === 'calendar'
    ? UNITS.map(u => ({ id: u.id, label: u.unit, on: calUnit === u.id, pick: () => setCalUnit(u.id) }))
    : [{ id: 'all', label: `All my units (${UNITS.length})`, on: unit === 'all', pick: () => setUnit('all') }, ...UNITS.map(u => ({ id: u.id, label: u.unit, on: unit === u.id, pick: () => setUnit(u.id) }))];
  const unitOf = (id: string) => UNITS.find(u => u.id === id)!;
  // Owners see only Final owner statements: the month still being prepared is not listed, only its payout date.
  const finals = data.statements.filter(s => !s.processing);
  const preparing = data.statements.find(s => s.processing);
  const ytd = finals.filter(s => s.month.startsWith(today.slice(0, 4))).reduce((n, s) => n + s.payout, 0);
  const years = [...new Set(finals.map(s => s.month.slice(0, 4)))].sort().reverse();
  const ms = monthStats(cal, calUnit, month);

  return (
    <div className="sc sc-enter">
      <header className="sc-op-header">
        <div className="sc-logo" style={{ height: 64 }}><div className="sc-logo-tile">TC</div><div className="sc-logo-word">The Conts</div><span className="sc-op-pill">OWNER</span></div>
        <nav className="sc-op-tabs" aria-label="Owner portal pages">
          {PAGES.map(([k, l]) => <button key={k} type="button" className="sc-op-tab" aria-current={page === k ? 'page' : undefined} onClick={() => setParam('tab', k === 'listings' ? null : k)}>{l}</button>)}
        </nav>
        <div className="sc-op-right">
          <span className="sc-sample-pill"><Icon name="FlaskConical" size="sm" />Sample data</span>
          <Segmented value={device} onChange={v => setParam('device', v === 'mobile' ? 'mobile' : null)} options={[{ key: 'desktop', label: 'Desktop' }, { key: 'mobile', label: 'Mobile' }]} />
          <div className="sc-op-avatar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="sc-avatar" style={{ width: 32, height: 32, fontSize: 12, background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>{OWNER.initials}</div><div className="sc-op-name">{OWNER.name}</div></div>
          <SwitchButton current="Owner" next="Portfolio" rolled={sw.rolled} onClick={sw.go} />
          <button type="button" className="sc-exit" onClick={exit} aria-label="Exit the showcase"><Icon name="X" size="sm" />Exit</button>
        </div>
      </header>
      <div className="sc-sample-band" role="note" data-sample-mark>
        <Icon name="FlaskConical" size="sm" color="var(--color-info-fg)" /><b>Sample data</b><span>{SAMPLE_NOTE}</span>
      </div>

      {device === 'mobile' ? (
        <div className="sc-phones">
          {(['ios', 'android'] as const).map(p => (
            <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div className="sc-eyebrow">{p === 'ios' ? 'iOS' : 'Android'}</div>
              <OwnerPhone platform={p} data={data} today={today} />
            </div>
          ))}
        </div>
      ) : (
        <main className="sc-op-main">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div className="sc-eyebrow">{head[0]}</div>
              <h1 className="sc-d56" style={{ margin: '6px 0 4px' }}>{head[1]}</h1>
              <div className="sc-sub">{head[2]}</div>
            </div>
            {['calendar', 'reviews', 'perf', 'service'].includes(page) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{chips.map(c => <button key={c.id} type="button" className="sc-chip" aria-pressed={c.on} onClick={c.pick}>{c.label}</button>)}</div>
            )}
          </div>

          {page === 'listings' && (
            <div className="sc-op-grid-3">
              {UNITS.map(u => {
                const next = data.stays.filter(s => s.unitId === u.id && s.checkIn > today).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
                const occ = occupancy(data.stays, [u.id], `${today.slice(0, 7)}-01`, addDays(`${today.slice(0, 7)}-01`, monthDays(today.slice(0, 7))));
                return (
                  <button key={u.id} type="button" onClick={() => setPreview(toListing(u))} className="sc-op-card" style={{ textAlign: 'left', padding: '8px 8px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Photo place={buildingOf(u.unit)} caption style={{ width: '100%', height: 150, borderRadius: 12 }}><span className="sc-published"><span className="sc-dot" />Live on Airbnb</span></Photo>
                    <div style={{ padding: '0 6px', minWidth: 0 }}><div className="ellipsis" style={{ fontSize: 15, fontWeight: 700 }}>{u.name}</div><div className="ellipsis" style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: 2 }}>{u.unit} · <Star /> {u.rating.toFixed(2)} · {plural(u.reviews, 'review')}</div></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '10px 6px 0', borderTop: '1px solid var(--sc-subtle)', margin: '0 6px' }}>
                      <div><div className="sc-big" style={{ fontSize: 19 }}>{occ}%</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>occupancy this month</div></div>
                      <div><div className="sc-big" style={{ fontSize: 19 }}>{next ? weekdayDate(next.checkIn) : '-'}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>next check-in</div></div>
                    </div>
                    <div style={{ padding: '0 6px', fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>View on Airbnb · desktop and mobile <Icon name="ArrowRight" size="sm" /></div>
                  </button>
                );
              })}
            </div>
          )}

          {page === 'calendar' && (
            <div className="sc-month-layout" style={{ display: 'grid', gap: 20, alignItems: 'start' }}>
              <div className="sc-op-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <MonthNav month={month} min={monthShift(today, -1)} max={monthShift(today, 1)} onChange={setMonth} />
                  <div className="sc-cal-legend"><span><i />Upcoming or hosting</span><span><i className="past" />Past</span></div>
                </div>
                <MonthGrid data={cal} unitId={calUnit} month={month} showPrice onSelect={setSel} selected={sel?.id ?? null} />
              </div>
              <div className="sc-op-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Photo place={buildingOf(unitOf(calUnit).unit)} caption style={{ width: '100%', height: 96, borderRadius: 12 }} />
                <div><div style={{ fontSize: 13, fontWeight: 700 }}>{unitOf(calUnit).name}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{unitOf(calUnit).unit}</div></div>
                <div style={{ borderTop: '1px solid var(--sc-subtle)', paddingTop: 14 }}><div className="sc-d40" style={{ color: 'var(--sc-teal)' }}>{ms.occupancy}%</div><div style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: 6 }}>occupancy in {monthLabel(month, { long: true })}</div></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><div className="sc-d26">{ms.nights}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>nights booked</div></div>
                  <div><div className="sc-d26">{ms.stays}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>reservations</div></div>
                </div>
                <div style={{ borderTop: '1px solid var(--sc-subtle)', paddingTop: 14 }}><div className="sc-big num" style={{ fontSize: 19 }}>{rm(ms.revenue)}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>guest totals booked this month</div></div>
              </div>
            </div>
          )}

          {page === 'reviews' && (
            <div className="sc-card">
              <div className="sc-grid-3" style={{ paddingBottom: 22, borderBottom: '1px solid var(--sc-line)' }}>
                <Big v={count(reviewCount)} l="reviews on your units" />
                <Big v={`${five.toFixed(1)}%`} l="of stays rated 5 stars" />
                <Big v={<>{rating.toFixed(2)}<span className="sc-star"><Icon name="Star" size="lg" color="currentColor" style={{ fill: 'currentColor' }} /></span></>} l="overall rating out of 5" />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '18px 0 12px', gap: 12, flexWrap: 'wrap' }}><div className="sc-h2">Recent 5-star reviews</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Only 5-star reviews shown · newest first</div></div>
              <div className="sc-grid-3" style={{ gap: 16 }}>
                {data.reviews.filter(r => unit === 'all' || r.unitId === unit).map((r, k) => (
                  <div key={k} style={{ border: '1px solid var(--sc-line)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Avatar name={r.guest} i={k} size={40} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15 }}>{r.guest}</div><div className="ellipsis" style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{dateShort(r.from)} – {dateShort(r.to)} · {unitOf(r.unitId).unit}</div></div></div>
                    <Stars />
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>{r.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {page === 'perf' && (
            <>
              <div className="sc-op-grid-3">
                <div className="sc-op-card"><div className="sc-eyebrow">Occupancy</div><div className="sc-d56" style={{ marginTop: 12 }}>{occ30}%</div><div className="sc-label" style={{ marginTop: 8 }}>last 30 days</div></div>
                <div className="sc-op-card"><div className="sc-eyebrow">Cancellation rate</div><div className="sc-d56" style={{ marginTop: 12, color: 'var(--sc-teal)' }}>1.4%</div><div className="sc-label" style={{ marginTop: 8 }}>of confirmed reservations</div></div>
                <div className="sc-op-card"><div className="sc-eyebrow">Guest rating</div><div className="sc-d56" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>{rating.toFixed(2)}<span className="sc-star"><Icon name="Star" size="lg" color="currentColor" style={{ fill: 'currentColor' }} /></span></div><div className="sc-label" style={{ marginTop: 8 }}>{count(reviewCount)} reviews · {five.toFixed(1)}% five-star</div></div>
              </div>
              <div className="sc-op-card sc-grid-4">
                {[[`${(3.6 + scope.length * 0.1).toFixed(1)} nights`, 'average length of stay'], [String(Math.round(occ30 * 0.3)), 'nights booked / 30 days'], [rm(Math.round(scope.reduce((s, u) => s + u.base, 0) / scope.length) + 1200), 'Avg nightly price'], [count(scope.length * 1150), 'listing page views / month']].map(([v, l]) => (
                  <div key={l}><div className="sc-d26">{v}</div><div className="sc-label">{l}</div></div>
                ))}
              </div>
              <div className="sc-op-card sc-lead-hero">
                <div><div className="sc-eyebrow">Booking lead time</div><div className="sc-d56" style={{ marginTop: 12 }}>11.2<span className="sc-d26"> days</span></div><div className="sc-label" style={{ marginTop: 8 }}>Guests book your units this far ahead on average.</div></div>
                <div>
                  <div style={{ display: 'flex', height: 40, borderRadius: 12, overflow: 'hidden', gap: 3 }}>{BUCKETS.map(([p, , c]) => <div key={c} style={{ flex: p, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sc-on-color)', fontSize: 13, fontWeight: 700 }}>{p}%</div>)}</div>
                  <div className="sc-grid-5" style={{ gap: 10, marginTop: 12 }}>{BUCKETS.map(([, l, c]) => <div key={l} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--sc-muted)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}</div>)}</div>
                </div>
              </div>
            </>
          )}

          {page === 'service' && (
            <>
              <div className="sc-op-card sc-grid-4">
                {[[openCases.length, 'open right now'], [doneCases.length, 'finished'], ['2h 41m', 'average time to fix'], [cases.filter(c => c.cat === 'Housekeeping').length * 6, 'linen changes this month']].map(([v, l]) => (
                  <div key={String(l)}><div className="sc-d26">{v}</div><div className="sc-label">{l}</div></div>
                ))}
              </div>
              {/* Open cases always show; finished ones fold to the newest three, then Show more. */}
              <div className="sc-card flush sc-scroll-x">
                <div className="sc-section-t">Open</div>
                <CaseHead />
                {openCases.map(c => <CaseRow key={c.id} c={c} unitName={unitOf(c.unitId).name} onOpen={() => setCaseId(c.id)} />)}
                {!openCases.length && <div className="sc-empty" style={{ padding: 24 }}>Nothing open right now.</div>}
              </div>
              {doneCases.length > 0 && (
                <div className="sc-card flush sc-scroll-x">
                  <div className="sc-section-t">Finished</div>
                  <CaseHead />
                  {(allDone ? doneCases : doneCases.slice(0, DONE_SHOWN)).map(c => <CaseRow key={c.id} c={c} unitName={unitOf(c.unitId).name} onOpen={() => setCaseId(c.id)} />)}
                  {doneCases.length > DONE_SHOWN && (
                    <button type="button" className="sc-fold" onClick={() => setAllDone(v => !v)}>
                      {allDone ? 'Show fewer' : `Show more (${doneCases.length - DONE_SHOWN})`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {page === 'payments' && (
            <>
              <div className="sc-op-pay-top">
                <div className="sc-card dark"><div className="sc-eyebrow" style={{ color: 'var(--color-gold)' }}>Guaranteed return</div><div className="sc-d40" style={{ marginTop: 12, whiteSpace: 'nowrap' }}>{rm(GUARANTEE)}</div><div style={{ fontSize: 13, color: 'var(--sc-dark-soft)', marginTop: 8 }}>a month across your {UNITS.length} units · topped up when reservations fall short</div></div>
                <PayStat l="Total paid out" v={rm(finals[0]?.acc ?? 0)} s={finals.length ? `since ${monthLabel(finals[finals.length - 1].month)}` : 'nothing paid yet'} />
                <PayStat l={`Income ${today.slice(0, 4)} to date`} v={rm(ytd)} s="Net Payout to Owner, Final statements" />
                <PayStat l="Next payout" v={dateShort(`${monthShift(today, 1)}-07`)} s={preparing ? `${monthLabel(preparing.month)} owner statement is being prepared` : 'scheduled'} />
              </div>
              <div className="sc-card flush sc-scroll-x">
                <div className="sc-section-t" style={{ fontSize: 15 }}>Monthly statements</div>
                <div className="sc-op-statement-grid sc-thead" style={{ padding: '10px 20px' }}>
                  <div>Month</div><div style={{ textAlign: 'right' }}>Nights</div><div style={{ textAlign: 'right' }}>Gross Income</div><div style={{ textAlign: 'right' }}>Deductions and To Operator</div><div style={{ textAlign: 'right' }}>Owner Adjustments</div><div style={{ textAlign: 'right' }}>Net Payout to Owner</div><div style={{ textAlign: 'right' }}>Accumulated</div><div />
                </div>
                {finals.map(m => (
                  <button key={m.month} type="button" onClick={() => setBill(m)} className="sc-op-statement-grid sc-trow num" style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--sc-subtle)', background: 'var(--sc-surface)', textAlign: 'left', cursor: 'pointer', fontSize: 13 }}>
                    <div style={{ fontWeight: 700 }}>{monthLabel(m.month)}</div><div style={{ textAlign: 'right' }}>{m.nights}</div>
                    <div style={{ textAlign: 'right' }}>{rm(m.gross)}</div><div style={{ textAlign: 'right', color: 'var(--sc-muted)' }}>− {rm(m.costs)}</div>
                    <div style={{ textAlign: 'right', color: m.topup ? 'var(--color-primary)' : 'var(--sc-muted)' }}>{m.topup ? `+ ${rm(m.topup)}` : '-'}</div>
                    <div style={{ textAlign: 'right', fontWeight: 700 }}>{rm(m.payout)}</div><div style={{ textAlign: 'right', color: 'var(--sc-ink-2)' }}>{rm(m.acc)}</div>
                    <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>View</div>
                  </button>
                ))}
              </div>
              {/* Documents by year, the latest year open (as the real portal). */}
              <div className="sc-card flush">
                <div className="sc-section-t" style={{ fontSize: 15 }}>Documents</div>
                {years.map((y, i) => {
                  const list = finals.filter(s => s.month.startsWith(y));
                  return (
                    <details key={y} className="sc-year" open={i === 0}>
                      <summary><span className="chev"><Icon name="ChevronRight" size="sm" /></span><span style={{ flex: 1 }}>{y}</span><span style={{ fontWeight: 400, color: 'var(--sc-muted)' }}>{plural(list.length + (i === 0 ? UNITS.length : 0), 'document')}</span></summary>
                      {list.map(m => <Doc key={m.month} title={`Owner Income Report · ${monthLabel(m.month, { long: true })}`} meta={`Final · ${rm(m.payout)} Net Payout to Owner`} />)}
                      {i === 0 && UNITS.map(u => <Doc key={u.id} title={`Management agreement · ${u.unit}`} meta={`Contract · since ${OWNER.since}`} />)}
                    </details>
                  );
                })}
              </div>
            </>
          )}

          {page === 'support' && (
            <div className="sc-op-support">
              <div style={{ borderRight: '1px solid var(--sc-line)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="sc-avatar" style={{ width: 46, height: 46, background: 'var(--color-gold)', color: 'var(--sc-on-gold)' }}>{MANAGER.initials}</div><div><div style={{ fontSize: 15, fontWeight: 700 }}>{MANAGER.name}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Your owner relations manager</div></div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sc-green-ink)', fontWeight: 700 }}><span className="sc-dot" />Online · replies in about 5 minutes</div>
                <div className="sc-eyebrow" style={{ marginTop: 6 }}>Quick topics</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{TOPICS.map(t => <button key={t} type="button" className="sc-chip" onClick={() => send(t)} style={{ height: 'auto', minHeight: 40, borderRadius: 12, textAlign: 'left', whiteSpace: 'normal' }}>{t}</button>)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div ref={chatRef} style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--sc-page)' }}>
                  {chat.map((m, k) => (
                    <div key={k} style={{ display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: m.me ? 'flex-end' : 'flex-start' }}>
                        <div className={`sc-bubble ${m.me ? 'me' : 'them'}`}>{m.text}</div>
                        <div style={{ fontSize: 11, color: 'var(--sc-muted)' }}>{m.me ? 'You' : 'Aina'} · {at(m.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid var(--sc-line)', padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input className="sc-input" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { send(draft); setDraft(''); } }} placeholder="Message The Conts" aria-label="Message" />
                  <button type="button" className="sc-btn-dark" disabled={!draft.trim()} onClick={() => { send(draft); setDraft(''); }}>Send</button>
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {sel && <StayDrawer stay={sel} onClose={() => setSel(null)} />}
      {kase && <CaseDrawer c={kase} onClose={() => setCaseId(null)} onPhoto={(label, caption) => setPhoto({ label, caption })} />}
      {photo && <div className="sc-lightbox" onClick={() => setPhoto(null)} role="dialog" aria-label={photo.caption}><div className="sc-lightbox-photo" style={{ width: 'min(860px, 86vw)', aspectRatio: '4 / 3', color: 'var(--sc-on-color)' }}>{photo.label}</div><div style={{ color: 'var(--sc-on-color)', fontSize: 13, fontWeight: 700 }}>{photo.caption}</div></div>}
      {bill && (
        <BillModal st={bill} onClose={() => setBill(null)}
          onAsk={() => { const m = bill; setBill(null); setParam('tab', 'support'); send(`Question about my ${monthLabel(m.month)} owner statement.`); }} />
      )}
      {preview && <ListingPreview l={preview} hostLine="Professional hosting, cleaning and maintenance" onClose={() => setPreview(null)} />}
      <CurtainLayer curtain={sw.curtain} />
    </div>
  );
}

function Big({ v, l }: { v: ReactNode; l: string }) {
  return <div><div className="sc-d56" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{v}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 10 }}>{l}</div></div>;
}
function PayStat({ l, v, s }: { l: string; v: string; s: string }) {
  return <div className="sc-op-card"><div className="sc-eyebrow">{l}</div><div className="sc-d26 num" style={{ marginTop: 12, whiteSpace: 'nowrap' }}>{v}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: 8 }}>{s}</div></div>;
}
function Doc({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="sc-doc">
      <Icon name="FileText" size="base" color="var(--sc-muted)" />
      <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700 }} className="ellipsis">{title}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{meta}</div></div>
      <button type="button" className="sc-btn-line" style={{ height: 34, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled title="A real owner downloads the PDF here; the sample has none."><Icon name="Download" size="sm" /><span>Download</span></button>
    </div>
  );
}

function CaseHead() {
  return <div className="sc-op-case-grid sc-thead"><div>Case</div><div>Issue</div><div>Unit</div><div>Opened</div><div>Time to fix</div><div>Status</div></div>;
}
function CaseRow({ c, unitName, onOpen }: { c: SampleCase; unitName: string; onOpen: () => void }) {
  return (
    <button type="button" className="sc-op-case-grid sc-trow" onClick={onOpen} style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--sc-subtle)', background: 'var(--sc-surface)', textAlign: 'left', cursor: 'pointer', fontSize: 13 }}>
      <div className="num" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.id}</div>
      <div style={{ minWidth: 0 }}><div className="ellipsis" style={{ fontWeight: 700 }}>{c.title}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{c.cat}</div></div>
      <div className="ellipsis" style={{ color: 'var(--sc-ink-2)' }}>{unitName}</div>
      <div style={{ color: 'var(--sc-ink-2)' }}>{at(c.trail[0].at)}</div>
      <div style={{ fontWeight: 700 }}>{c.ttf}</div>
      <div><span className={`sc-status ${c.done ? 'ok' : 'open'}`}>{c.done ? 'Resolved' : 'In progress'}</span></div>
    </button>
  );
}

function StayDrawer({ stay, onClose }: { stay: CalendarStay; onClose: () => void }) {
  useEscape(onClose);
  const u = UNITS.find(x => x.id === stay.unitId)!;
  const n = daysBetween(stay.checkIn, stay.checkOut);
  const rows: [string, string][] = [['Unit', `${u.unit} · ${u.name}`], ['Check-in', `${weekdayDate(stay.checkIn)}, 15:00`], ['Checkout', `${weekdayDate(stay.checkOut)}, 11:00`], ['Nights', nightsLabel(n)], ['Guests', `${stay.guests} ${stay.guests === 1 ? 'adult' : 'adults'}`], ['Status', STATUS_WORD[stay.status]], ['Guest total', rm(stay.total)]];
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 29 }} />
      <div className="sc-side" style={{ width: 400, zIndex: 30, boxShadow: 'var(--sc-shadow-drawer)' }} role="dialog" aria-label={`Reservation ${stay.code}`}>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--sc-line)' }}><div className="sc-eyebrow">Reservation {stay.code}</div><button type="button" className="sc-close" aria-label="Close" onClick={onClose}><Icon name="X" size="sm" /></button></div>
        <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--sc-line)' }}><Avatar name={stay.guest} i={stay.code.charCodeAt(2)} size={48} /><div><div style={{ fontSize: 19, fontWeight: 700 }}>{stay.guest}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', display: 'flex', alignItems: 'center', gap: 6 }}><ChannelMark ch="airbnb" size={16} />Verified Airbnb guest</div></div></div>
        <div style={{ padding: '4px 20px', flex: 1, overflow: 'auto' }}>{rows.map(([l, v]) => <div key={l} className="sc-drawer-row"><span>{l}</span><span style={{ textAlign: 'right' }}>{v}</span></div>)}</div>
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
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--sc-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div><div className="sc-eyebrow">Service case {c.id}</div><div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{c.title}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 2 }}>{u.name} · {u.unit}</div></div>
          <button type="button" className="sc-close" aria-label="Close" onClick={onClose}><Icon name="X" size="sm" /></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, background: 'var(--sc-line)', borderRadius: 12, overflow: 'hidden' }}>
            {[['Status', c.done ? 'Resolved' : 'In progress', c.done ? 'var(--sc-green-ink)' : 'var(--sc-amber-ink)'], ['Time to fix', c.ttf, ''], ['Operator', c.operator, '']].map(([l, v, col]) => (
              <div key={l} style={{ background: 'var(--sc-past)', padding: '10px 14px' }}><div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sc-muted)' }}>{l}</div><div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: col || undefined }}>{v}</div></div>
            ))}
          </div>
          <div><div className="sc-h2" style={{ marginBottom: 12 }}>Trail</div><CaseTrail c={c} /></div>
          <div>
            <div className="sc-h2" style={{ marginBottom: 10 }}>Photos</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {c.photos.map(p => <button key={p} type="button" onClick={() => onPhoto(p, `${c.id} · ${c.title}`)} className="sc-photo" style={{ ['--h' as string]: 150, aspectRatio: '1', border: 'none', borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'flex-end', padding: 8 }}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.95)', color: 'var(--sc-on-photo)', position: 'relative' }}>{p}</span></button>)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** One Final owner statement of the sample owner, in the owner statement's own words. */
function BillModal({ st, onClose, onAsk }: { st: SampleStatement; onClose: () => void; onAsk: () => void }) {
  useEscape(onClose);
  const toOperator = Math.round(st.gross * 0.2);
  const deductions = st.costs - toOperator;
  const lines: [string, string, string][] = [
    ['Gross Income', rm(st.gross), 'strong'],
    ['20% To Operator', `− ${rm(toOperator)}`, 'neg'],
    ['Cleaning, linen and maintenance', `− ${rm(deductions)}`, 'neg'],
    ['Payout Before Owner Adjustments', rm(st.net), 'sub'],
    ['Owner Adjustments · guaranteed return top-up', st.topup ? `+ ${rm(st.topup)}` : 'Not needed', st.topup ? 'pos' : 'zero'],
  ];
  return (
    <>
      <div className="sc-scrim-dim" onClick={onClose} />
      <div className="sc-modal" role="dialog" aria-label={`${monthLabel(st.month)} owner statement`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div><div className="sc-eyebrow">Owner statement · Final</div><div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{monthLabel(st.month, { long: true })}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>{OWNER.name} · {UNITS.length} units · {st.nights} nights booked</div></div>
          <button type="button" className="sc-close" aria-label="Close" onClick={onClose}><Icon name="X" size="sm" /></button>
        </div>
        <div className="ds-money" style={{ marginTop: 18 }}>
          {lines.map(([l, v, k]) => <div key={l} className={k === 'sub' ? 'is-sub' : k === 'zero' ? 'is-zero' : k === 'neg' ? 'is-neg' : ''}><span>{l}</span><span style={k === 'pos' ? { color: 'var(--color-primary)' } : undefined}>{v}</span></div>)}
          <div className="is-total"><span>Net Payout to Owner</span><span>{rm(st.payout)}</span></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--sc-muted)', marginTop: 6 }}><span>Accumulated payout to date</span><span className="num" style={{ fontWeight: 700, color: 'var(--sc-ink)' }}>{rm(st.acc)}</span></div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="sc-btn-line" style={{ padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled title="A real owner downloads the statement PDF here; the sample has none."><Icon name="Download" size="sm" />Download PDF</button>
          <button type="button" className="sc-btn-dark" onClick={onAsk}>Ask about this statement</button>
        </div>
      </div>
    </>
  );
}
