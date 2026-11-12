import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { date, dateShort, time, todayMyt, count } from '../../lib/format';
import { resolve, addDays, LEAD_KEYS, type FigureKey, type Insights, type Live, type ShowcaseData } from './model';
import { FigureContext, PropertyDropdown, DateRangePicker, useDisplayFont } from './parts';
import { CalendarScreen } from './CalendarScreen';
import { TodayScreen, ListingsScreen, ReviewsScreen, OccupancyScreen, LeadScreen, ViewsScreen } from './screens';
import { useSwitch, useExit, SwitchButton, CurtainLayer } from './Switch';
import { OWNER, UNITS } from './sampleOwner';
import Icon from '../../components/Icon';
import './showcase.css';
import './owner-portal.css';

const PAGES = [['today', 'Today'], ['list', 'Listings'], ['cal', 'Calendar'], ['rev', 'Reviews'], ['occ', 'Occupancy'], ['lead', 'Lead Time'], ['views', 'Page Views']] as const;
type Page = typeof PAGES[number][0];
const FILTERED: Page[] = ['rev', 'occ', 'lead'];
const RANGES = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']] as const;

/** Owner Showcase (CONTS-0006): a full-screen presentation sales staff open in front of a prospective owner, with
 *  live figures from the reservations, reviews and listings. Showcase control was removed (owner, 2 Nov 2026). */
export default function OwnerShowcasePage() {
  const [params, setParams] = useSearchParams();
  const page = (PAGES.some(p => p[0] === params.get('page')) ? params.get('page') : 'today') as Page;
  const setPage = (p: Page) => setParams(prev => { const n = new URLSearchParams(prev); n.set('page', p); return n; }, { replace: true });

  const today = todayMyt();
  const [mode, setMode] = useState<'in' | 'out' | 'up' | 'tn'>('in');
  const [prop, setProp] = useState('all');
  const [range, setRange] = useState<string>('30');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(addDays(today, -1));
  const [showPrice, setShowPrice] = useState(true);
  const [month, setMonth] = useState(today.slice(0, 7));

  const main = useApi<ShowcaseData>('/showcase');
  const data = main.data;
  const one = prop !== 'all';
  const ins = useApi<Insights>(FILTERED.includes(page) ? `/showcase/insights?from=${from}&to=${to}${one ? `&unitId=${prop}` : ''}` : null);
  const { poll } = main;
  // The curtain names the one sample owner, so nobody mistakes the Owner view for a real owner's account.
  const sw = useSwitch('/performance/showcase/owner', { from: 'Portfolio', to: 'Owner', sub: `${OWNER.name} · sample owner · ${UNITS.length} units · sample data` });
  useDisplayFont();

  useEffect(() => {
    document.title = 'Owner Showcase · The Conts';
    // Only while the tab is looked at, and never on top of a read still on its way.
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 120_000);
    return () => window.clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exit = useExit();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.sc-popover')) exit(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The figures for the range on screen: the portfolio's own over the chosen dates, where the insights are loaded.
  const live: Live | null = useMemo(() => {
    if (!data) return null;
    const i = !one && ins.data ? ins.data : null;
    if (!i) return data.live;
    return {
      ...data.live,
      rev_count: i.reviews.count, rev_five: i.reviews.fiveStar, rev_rating: i.reviews.rating,
      occ_rate: i.occupancy.rate, occ_cancel: i.occupancy.cancel, occ_stay: i.occupancy.avgStay, occ_year: i.occupancy.year,
      lead_avg: i.lead.avg, ...Object.fromEntries(LEAD_KEYS.map((k, n) => [k, i.lead.buckets[n]])),
    } as Live;
  }, [data, ins.data, one]);
  const g = (k: FigureKey) => (live ? resolve(k, live, {}) : null);
  const viewsShown = g('views_pv') !== null || g('views_imp') !== null;
  const pages = PAGES.filter(p => p[0] !== 'views' || viewsShown);
  const shownPage: Page = page === 'views' && !viewsShown ? 'today' : page;

  const listings = data?.listings ?? [];
  const unit = one ? listings.find(l => l.id === prop) ?? null : null;
  const totalLabel = data ? count(data.listings.length) : '';
  const applyRange = (k: string) => { const n = Number(k); setRange(k); setFrom(addDays(today, -n)); setTo(addDays(today, -1)); };

  return (
    <FigureContext.Provider value={{ edit: false, live: live ?? ({} as Live), ov: {}, open: () => {} }}>
      <div className="sc sc-enter">
        <header className="sc-header">
          <div className="sc-logo"><div className="sc-logo-tile">TC</div><div className="sc-logo-word">The Conts</div></div>
          <nav className="sc-tabs" aria-label="Showcase pages">
            {pages.map(([k, l]) => (
              <button key={k} type="button" className="sc-tab" aria-current={shownPage === k ? 'page' : undefined} onClick={() => setPage(k)}>
                <span className="sc-tab-num">0{PAGES.findIndex(p => p[0] === k) + 1}</span>{l}
              </button>
            ))}
          </nav>
          <div className="sc-head-right">
            {data && <div className="sc-sync"><span className="sc-dot" />Updated {time(data.generatedAt)}</div>}
            <SwitchButton current="Portfolio" next="Owner" rolled={sw.rolled} onClick={sw.go} />
            <button type="button" className="sc-exit" onClick={exit} aria-label="Exit the showcase"><Icon name="X" size="sm" />Exit</button>
          </div>
        </header>

        {FILTERED.includes(shownPage) && data && (
          <div className="sc-filters">
            <PropertyDropdown listings={listings} value={prop} onChange={setProp} allLabel={`All properties (${totalLabel})`} totalLabel={totalLabel} />
            <div className="sc-divider" />
            {RANGES.map(([k, l]) => <button key={k} type="button" className="sc-chip" aria-pressed={range === k} onClick={() => applyRange(k)}>{l}</button>)}
            <DateRangePicker from={from} to={to} today={today} onApply={(f, t) => { setFrom(f); setTo(t); setRange('custom'); }} />
            <div className="sc-scope">{dateShort(from)} – {date(to)} · {unit ? unit.name : `${totalLabel} listings`}</div>
          </div>
        )}

        <main className="sc-main">
          {!data ? (
            <div className="sc-empty" style={{ paddingTop: 120 }}>{main.error ?? 'Loading the showcase...'}</div>
          ) : (
            <div key={`${shownPage}|${prop}|${from}|${to}`} className="sc-rise">
              {shownPage === 'today' && <TodayScreen data={data} g={g} mode={mode} setMode={setMode} />}
              {shownPage === 'list' && <ListingsScreen data={data} g={g} />}
              {shownPage === 'cal' && <CalendarScreen listings={listings} today={data.today.date} listingsShown={g('listings') ?? listings.length} showPrice={showPrice} setShowPrice={setShowPrice} month={month} setMonth={setMonth} />}
              {(shownPage === 'rev' || shownPage === 'occ' || shownPage === 'lead') && (
                <div className="sc-wrap sc-stack">
                  {ins.error && <div className="sc-empty">{ins.error}</div>}
                  {shownPage === 'rev' && <ReviewsScreen data={data} ins={ins.data} g={g} one={one} />}
                  {shownPage === 'occ' && <OccupancyScreen ins={ins.data} g={g} one={one} unit={unit} showPrice={showPrice} setShowPrice={setShowPrice} month={month} setMonth={setMonth} today={data.today.date} />}
                  {shownPage === 'lead' && <LeadScreen ins={ins.data} g={g} one={one} />}
                </div>
              )}
              {shownPage === 'views' && <ViewsScreen g={g} />}
            </div>
          )}
        </main>

        <CurtainLayer curtain={sw.curtain} />
      </div>
    </FigureContext.Provider>
  );
}
