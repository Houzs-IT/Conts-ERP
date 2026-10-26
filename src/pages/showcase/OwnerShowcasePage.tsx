import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { date, dateShort, time, todayMyt, count } from '../../lib/format';
import { resolve, activeCount, addDays, LEAD_KEYS, type FigureKey, type Insights, type Live, type ShowcaseData } from './model';
import { useOverrides } from './useOverrides';
import { FigureContext, FigureEditor, PropertyDropdown, DateRangePicker } from './parts';
import { CalendarScreen } from './CalendarScreen';
import { TodayScreen, ListingsScreen, ReviewsScreen, OccupancyScreen, LeadScreen, ViewsScreen } from './screens';
import './showcase.css';

const PAGES = [['today', 'Today'], ['list', 'Listings'], ['cal', 'Calendar'], ['rev', 'Reviews'], ['occ', 'Occupancy'], ['lead', 'Lead Time'], ['views', 'Page Views']] as const;
type Page = typeof PAGES[number][0];
const FILTERED: Page[] = ['rev', 'occ', 'lead'];
const RANGES = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']] as const;
const FONT_ID = 'sc-manrope';

/** Owner Showcase (CONTS-0006): a full-screen presentation sales staff open in front of a prospective owner, with
 *  live figures from the reservations, reviews and listings, and any figure Showcase control has replaced.
 *  ?edit=1 is the control panel's visual editor: every replaceable figure is underlined and editable in place. */
export default function OwnerShowcasePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const edit = params.get('edit') === '1';
  const embedded = window.parent !== window;
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
  const [editor, setEditor] = useState<{ k: FigureKey; x: number; y: number; mode: 'edit' | 'menu' } | null>(null);

  const main = useApi<ShowcaseData>('/showcase');
  const data = main.data;
  const one = prop !== 'all';
  const ins = useApi<Insights>(FILTERED.includes(page) ? `/showcase/insights?from=${from}&to=${to}${one ? `&unitId=${prop}` : ''}` : null);
  const ovs = useOverrides(data?.overrides);
  const { reload } = main;

  useEffect(() => {
    document.title = 'Owner Showcase · The Conts';
    if (!document.getElementById(FONT_ID)) {
      const l = document.createElement('link');
      l.id = FONT_ID; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
      document.head.appendChild(l);
    }
    const t = window.setInterval(reload, 120_000);
    return () => window.clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exit = () => {
    if (embedded) { window.parent.postMessage('tc-exit', window.location.origin); return; }
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1); else navigate('/performance/showcase-control');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editor && !edit && !document.querySelector('.sc-popover')) exit(); };
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
  const g = (k: FigureKey) => (live ? resolve(k, live, ovs.ov) : null);
  const viewsShown = edit || g('views_pv') !== null || g('views_imp') !== null;
  const pages = PAGES.filter(p => p[0] !== 'views' || viewsShown);
  const shownPage: Page = page === 'views' && !viewsShown ? 'today' : page;

  const open = (k: FigureKey, e: MouseEvent, m: 'edit' | 'menu') => setEditor({ k, mode: m, x: Math.max(8, Math.min(e.clientX, window.innerWidth - 290)), y: Math.max(8, Math.min(e.clientY + 14, window.innerHeight - 260)) });
  const listings = data?.listings ?? [];
  const unit = one ? listings.find(l => l.id === prop) ?? null : null;
  const totalLabel = data ? count(data.listings.length) : '';
  const applyRange = (k: string) => { const n = Number(k); setRange(k); setFrom(addDays(today, -n)); setTo(addDays(today, -1)); };

  return (
    <FigureContext.Provider value={{ edit, live: live ?? ({} as Live), ov: ovs.ov, open }}>
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
            {data && <div className="sc-sync"><span className="sc-dot" />Synced with Airbnb · {time(data.generatedAt)}</div>}
            {edit && <span className="sc-edit-pill">Edit mode · {activeCount(ovs.ov)} {activeCount(ovs.ov) === 1 ? 'override' : 'overrides'}</span>}
            {!edit && <button type="button" className="sc-exit" onClick={exit} aria-label="Exit the showcase">✕ Exit</button>}
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

        {editor && live && (
          <FigureEditor {...editor} live={live} ov={ovs.ov} onClose={() => setEditor(null)}
            onApply={v => { void ovs.apply(editor.k, v); setEditor(null); }}
            onUseStored={() => { void ovs.setActive(editor.k, true); setEditor(null); }}
            onLive={() => { if (ovs.ov[editor.k]) void ovs.setActive(editor.k, false); setEditor(null); }}
            onEdit={() => setEditor({ ...editor, mode: 'edit' })} />
        )}
      </div>
    </FigureContext.Provider>
  );
}
