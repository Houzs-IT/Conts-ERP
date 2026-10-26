import { useMemo, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { rm, rmShort, count, monthLabel, weekdayDate, weekdayShort, dateShort, year, nights as nightsLabel } from '../../lib/format';
import { addDays, daysBetween, type CalendarData, type CalendarStay, type Listing } from './model';
import { Photo, Avatar, Segmented, PriceToggle, MonthNav, PropertyDropdown, useEscape } from './parts';

const W = 96, DAYS = 21;

export const monthStart = (m: string) => `${m}-01`;
export const monthDays = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
export const monthRange = (today: string) => ({ min: shiftMonth(today.slice(0, 7), -1), max: shiftMonth(today.slice(0, 7), 2) });

/** The stay bars of one property over one month, as the Calendar's Month view and the Occupancy page show them. */
export function MonthGrid({ data, unitId, month, showPrice, onSelect, selected, compact }: {
  data: CalendarData | null; unitId: string; month: string; showPrice: boolean; onSelect?: (s: CalendarStay) => void; selected?: string | null; compact?: boolean;
}) {
  const today = data?.today ?? '';
  const first = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).getUTCDay();
  const dim = monthDays(month);
  const stays = (data?.stays ?? []).filter(s => s.unitId === unitId);
  const rates = data?.rates[unitId] ?? [];
  const cells: JSX.Element[] = [];
  for (let k = 0; k < first; k++) cells.push(<div key={`b${k}`} style={{ minHeight: compact ? 104 : 116, borderRight: '1px solid var(--sc-subtle)', borderBottom: '1px solid var(--sc-subtle)', background: 'var(--sc-page)' }} />);
  for (let day = 1; day <= dim; day++) {
    const d = `${month}-${String(day).padStart(2, '0')}`, dow = (first + day - 1) % 7;
    const stay = stays.find(s => s.checkIn <= d && d < s.checkOut);
    const out = stays.find(s => s.checkOut === d);
    const start = !!stay && d === stay.checkIn, end = !!stay && addDays(d, 1) === stay.checkOut;
    const lead = !!stay && (start || dow === 0 || day === 1);
    const past = d < today;
    cells.push(
      <div key={d} onClick={stay && onSelect ? () => onSelect(stay) : undefined}
        style={{ minHeight: compact ? 104 : 116, borderRight: '1px solid var(--sc-subtle)', borderBottom: '1px solid var(--sc-subtle)', background: past ? 'var(--sc-page)' : 'var(--sc-surface)', padding: '10px 0', display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8, cursor: stay && onSelect ? 'pointer' : 'default' }}>
        <div style={{ padding: '0 10px' }}><span className={`sc-mnum${d === today ? ' today' : past ? ' past' : ''}`}>{day}</span></div>
        {!compact && out && <div style={{ padding: '0 10px', fontSize: 11, fontWeight: 700, color: 'var(--sc-out)', whiteSpace: 'nowrap' }}>Out 11am</div>}
        {stay && (
          <div className={`sc-mbar ${stay.status}`} style={{ margin: `0 ${end ? 10 : 0}px 0 ${start ? 10 : 0}px`, borderRadius: `${start ? 8 : 0}px ${end ? 8 : 0}px ${end ? 8 : 0}px ${start ? 8 : 0}px`, boxShadow: selected === stay.id ? '0 0 0 2px var(--sc-ink)' : undefined }}>
            <div className="ellipsis" style={{ fontSize: 12, fontWeight: 700 }}>{lead ? stay.guest : ''}</div>
            <div className="num" style={{ fontSize: 11, opacity: 0.85, whiteSpace: 'nowrap' }}>{lead && showPrice ? rm(stay.total) : ''}</div>
          </div>
        )}
        {!compact && start && <div style={{ padding: '0 10px', fontSize: 11, fontWeight: 700, color: 'var(--sc-teal)', whiteSpace: 'nowrap' }}>In 3pm</div>}
        {!stay && showPrice && rates[day - 1] ? <div className="num" style={{ padding: '0 10px', marginTop: 'auto', fontSize: 12, color: 'var(--sc-faint)' }}>{rmShort(rates[day - 1])}</div> : null}
      </div>,
    );
  }
  while (cells.length % 7) cells.push(<div key={`e${cells.length}`} style={{ minHeight: compact ? 104 : 116, borderRight: '1px solid var(--sc-subtle)', borderBottom: '1px solid var(--sc-subtle)', background: 'var(--sc-page)' }} />);
  return (
    <div style={{ background: 'var(--sc-surface)', border: '1px solid var(--sc-line)', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--sc-line)' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => <div key={w} style={{ padding: compact ? '10px 12px' : 12, fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{w}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>{cells}</div>
    </div>
  );
}

/** A month's figures for one property: occupancy, nights, reservations and booked revenue (night split). */
export function monthStats(data: CalendarData | null, unitId: string, month: string) {
  const dim = monthDays(month), from = monthStart(month), end = addDays(from, dim);
  const stays = (data?.stays ?? []).filter(s => s.unitId === unitId && s.checkIn < end && s.checkOut > from);
  let nights = 0, revenue = 0;
  for (const s of stays) {
    const n = Math.max(0, daysBetween(s.checkIn > from ? s.checkIn : from, s.checkOut < end ? s.checkOut : end));
    nights += n; revenue += s.total * (n / Math.max(1, daysBetween(s.checkIn, s.checkOut)));
  }
  return { occupancy: Math.round((nights / dim) * 100), nights, stays: stays.length, revenue: Math.round(revenue) };
}

export function ReservationDrawer({ stay, listing, showPrice, onClose }: { stay: CalendarStay; listing?: Listing; showPrice: boolean; onClose: () => void }) {
  const n = daysBetween(stay.checkIn, stay.checkOut);
  useEscape(onClose);
  return (
    <div className="sc-drawer" role="dialog" aria-label={`Reservation ${stay.code}`}>
      <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--sc-line)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reservation {stay.code}</div>
        <button type="button" className="sc-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--sc-line)' }}>
        <Avatar name={stay.guest} i={stay.code.charCodeAt(0)} size={52} />
        <div><div style={{ fontSize: 20, fontWeight: 800 }}>{stay.guest}</div><div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 2 }}>Verified Airbnb guest · Airbnb</div></div>
      </div>
      <div style={{ padding: '8px 24px', flex: 1, overflow: 'auto' }}>
        <div style={{ padding: '14px 0', borderBottom: '1px solid var(--sc-subtle)' }}>
          <div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Property</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{listing?.name}</div>
          <div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>{listing?.unit}</div>
        </div>
        <div className="sc-drawer-row"><span>Check-in</span><span>{weekdayDate(stay.checkIn)}, 3:00 PM</span></div>
        <div className="sc-drawer-row"><span>Check-out</span><span>{weekdayDate(stay.checkOut)}, 11:00 AM</span></div>
        <div className="sc-drawer-row"><span>Nights</span><span>{nightsLabel(n)}</span></div>
        <div className="sc-drawer-row"><span>Guests</span><span>{stay.guests} {stay.guests === 1 ? 'adult' : 'adults'}</span></div>
        <div className="sc-drawer-row"><span>Status</span><span>{stay.status === 'completed' ? 'Completed' : stay.status === 'in_stay' ? 'In stay' : 'Confirmed'}</span></div>
        <div className="sc-drawer-row" style={{ borderBottom: 'none' }}><span>Total payout</span><span style={{ fontWeight: 800 }}>{showPrice ? rm(stay.total) : 'Hidden'}</span></div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="sc-cal-legend">
      <span><i style={{ background: 'var(--sc-faint)' }} />Completed</span>
      <span><i style={{ background: 'var(--sc-teal-deep)' }} />In stay</span>
      <span><i style={{ background: 'var(--sc-teal-mid)' }} />Confirmed</span>
    </div>
  );
}

export function CalendarScreen({ listings, today, listingsShown, showPrice, setShowPrice, month, setMonth }: {
  listings: Listing[]; today: string; listingsShown: number; showPrice: boolean; setShowPrice: (v: boolean) => void; month: string; setMonth: (m: string) => void;
}) {
  const [view, setView] = useState<'timeline' | 'month'>('timeline');
  const [prop, setProp] = useState('all');
  const [sel, setSel] = useState<CalendarStay | null>(null);
  const monthProp = prop === 'all' ? listings[0]?.id ?? '' : prop;
  const from = addDays(today, -1);
  const tl = useApi<CalendarData>(view === 'timeline' ? `/showcase/calendar?from=${from}&days=${DAYS}${prop !== 'all' ? `&unitId=${prop}` : ''}` : null);
  const mo = useApi<CalendarData>(view === 'month' && monthProp ? `/showcase/calendar?from=${monthStart(month)}&days=${monthDays(month)}&unitId=${monthProp}` : null);
  const byId = useMemo(() => new Map(listings.map(l => [l.id, l])), [listings]);
  const { min, max } = monthRange(today);
  const rows = prop === 'all' ? listings : listings.filter(l => l.id === prop);
  const title = view === 'month' ? 'Month view' : prop === 'all' ? `${count(listingsShown)} listings` : '1 listing';
  const ms = monthStats(mo.data, monthProp, month);
  const mProp = byId.get(monthProp);

  return (
    <div style={{ padding: '24px 32px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginRight: 8, whiteSpace: 'nowrap' }}>{title}</div>
        <Segmented value={view} onChange={v => { setView(v); setSel(null); }} options={[{ key: 'timeline', label: 'Timeline' }, { key: 'month', label: 'Month' }]} />
        <PropertyDropdown listings={listings} value={view === 'month' ? monthProp : prop} onChange={id => { setProp(id); setSel(null); }}
          allLabel={view === 'timeline' ? 'All properties' : undefined} totalLabel={count(listingsShown)} />
        {view === 'timeline'
          ? <div className="sc-pill" style={{ cursor: 'default', fontWeight: 600 }}>{dateShort(from)} – {dateShort(addDays(from, DAYS - 1))} {year(addDays(from, DAYS - 1))}</div>
          : <MonthNav month={month} min={min} max={max} onChange={setMonth} />}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <Legend />
          <PriceToggle on={showPrice} onChange={setShowPrice} />
        </div>
      </div>

      {view === 'timeline' ? (
        <Timeline data={tl.data} rows={rows} showPrice={showPrice} selected={sel?.id ?? null} onSelect={setSel} />
      ) : (
        <div className="sc-month-layout" style={{ display: 'grid', gap: 20, alignItems: 'start' }}>
          <MonthGrid data={mo.data} unitId={monthProp} month={month} showPrice={showPrice} onSelect={setSel} selected={sel?.id ?? null} />
          <div style={{ background: 'var(--sc-surface)', border: '1px solid var(--sc-line)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Photo id={mProp?.photoId} fine style={{ width: 48, height: 48, borderRadius: 10 }} />
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 800 }}>{mProp?.name}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{mProp?.unit}</div></div>
            </div>
            <div style={{ borderTop: '1px solid var(--sc-subtle)', paddingTop: 18 }}>
              <div className="sc-big" style={{ fontSize: 48, letterSpacing: '-0.04em', color: 'var(--sc-teal)' }}>{ms.occupancy}%</div>
              <div style={{ fontSize: 13, color: 'var(--sc-muted)', marginTop: 6 }}>occupancy in {monthLabel(month, { long: true })}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div><div style={{ fontSize: 24, fontWeight: 800 }}>{ms.nights}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>nights booked</div></div>
              <div><div style={{ fontSize: 24, fontWeight: 800 }}>{ms.stays}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>reservations</div></div>
            </div>
            {showPrice && <div style={{ borderTop: '1px solid var(--sc-subtle)', paddingTop: 18 }}><div style={{ fontSize: 24, fontWeight: 800 }}>{rmShort(ms.revenue)}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>booked revenue this month</div></div>}
          </div>
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--sc-muted)', marginTop: 12 }}>Every bar is a real Airbnb reservation. Click one to see guest and stay details.</div>
      {sel && <ReservationDrawer stay={sel} listing={byId.get(sel.unitId)} showPrice={showPrice} onClose={() => setSel(null)} />}
    </div>
  );
}

function Timeline({ data, rows, showPrice, selected, onSelect }: { data: CalendarData | null; rows: Listing[]; showPrice: boolean; selected: string | null; onSelect: (s: CalendarStay) => void }) {
  const dates = data?.dates ?? [];
  const today = data?.today ?? '';
  const bands: { label: string; width: number; first: boolean }[] = [];
  dates.forEach((d, i) => {
    const label = monthLabel(d, { long: true }), last = bands[bands.length - 1];
    if (last && last.label === label) last.width += W; else bands.push({ label, width: W, first: i > 0 });
  });
  const sep = (d: string, i: number) => (i === 0 ? 'transparent' : d.endsWith('-01') ? 'var(--sc-control)' : 'var(--sc-past)');
  const byUnit = new Map<string, CalendarStay[]>();
  for (const s of data?.stays ?? []) { const l = byUnit.get(s.unitId) ?? []; l.push(s); byUnit.set(s.unitId, l); }
  return (
    <div style={{ background: 'var(--sc-surface)', border: '1px solid var(--sc-line)', borderRadius: 16, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--sc-line)' }}>
        <div style={{ height: 84, borderBottom: '1px solid var(--sc-line)', display: 'flex', alignItems: 'flex-end', padding: '0 16px 12px', fontSize: 12, fontWeight: 700, color: 'var(--sc-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Property · 21-day occ.</div>
        {rows.map(l => {
          const booked = new Set<string>();
          for (const s of byUnit.get(l.id) ?? []) for (let d = s.checkIn; d < s.checkOut; d = addDays(d, 1)) booked.add(d);
          const occ = dates.length ? Math.round((dates.filter(d => booked.has(d)).length / dates.length) * 100) : 0;
          return (
            <div key={l.id} style={{ height: 60, borderBottom: '1px solid var(--sc-subtle)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}>
              <Photo id={l.photoId} fine style={{ width: 36, height: 36, borderRadius: 8 }} />
              <div style={{ minWidth: 0, flex: 1 }}><div className="ellipsis" style={{ fontSize: 13, fontWeight: 700 }}>{l.name}</div><div className="ellipsis" style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{l.unit}</div></div>
              <div className="num" style={{ fontSize: 13, fontWeight: 800, color: 'var(--sc-teal)' }}>{occ}%</div>
            </div>
          );
        })}
      </div>
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <div style={{ width: dates.length * W }}>
          <div style={{ height: 32, display: 'flex', borderBottom: '1px solid var(--sc-subtle)' }}>
            {bands.map(b => <div key={b.label} style={{ width: b.width, flexShrink: 0, borderLeft: `1px solid ${b.first ? 'var(--sc-control)' : 'transparent'}`, padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>{b.label}</div>)}
          </div>
          <div style={{ height: 52, borderBottom: '1px solid var(--sc-line)', display: 'flex' }}>
            {dates.map((d, i) => {
              const t = d === today;
              return (
                <div key={d} style={{ width: W, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderLeft: `1px solid ${sep(d, i)}`, background: t ? 'var(--sc-teal-row)' : 'transparent' }}>
                  <div style={{ fontSize: 12, color: 'var(--sc-muted)', fontWeight: 600 }}>{weekdayShort(d)}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, minWidth: 30, height: 28, padding: '0 6px', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t ? 'var(--sc-teal)' : 'transparent', color: t ? 'var(--sc-surface)' : 'var(--sc-ink)' }}>{Number(d.slice(8, 10))}</div>
                </div>
              );
            })}
          </div>
          {rows.map(l => {
            const stays = byUnit.get(l.id) ?? [];
            const rates = data?.rates[l.id] ?? [];
            return (
              <div key={l.id} style={{ height: 60, borderBottom: '1px solid var(--sc-subtle)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ display: 'flex', height: '100%' }}>
                  {dates.map((d, i) => {
                    const booked = stays.some(s => s.checkIn <= d && d < s.checkOut);
                    const out = stays.some(s => s.checkOut === d);
                    return (
                      <div key={d} className="num" style={{ width: W, flexShrink: 0, borderLeft: `1px solid ${sep(d, i)}`, background: d === today ? 'var(--sc-teal-row)' : 'transparent', fontSize: 12, color: 'var(--sc-faint)', display: 'flex', alignItems: 'center', justifyContent: out ? 'flex-end' : 'center', padding: '0 10px' }}>
                        {!booked && showPrice && rates[i] ? rmShort(rates[i]) : ''}
                      </div>
                    );
                  })}
                </div>
                {stays.map(s => {
                  const start = daysBetween(dates[0], s.checkIn), end = daysBetween(dates[0], s.checkOut);
                  let left = (start + 0.5) * W + 3;
                  const right = (end + 0.5) * W - 3;
                  const cut = left < 0;
                  if (cut) left = 0;
                  const width = right - left;
                  if (width <= 0) return null;
                  return (
                    <button key={s.id} type="button" className={`sc-stay ${s.status}${selected === s.id ? ' selected' : ''}`} style={{ left, width, borderRadius: cut ? '0 8px 8px 0' : 8 }} onClick={() => onSelect(s)}>
                      <span className="ellipsis" style={{ fontSize: 13, fontWeight: 700 }}>{s.guest}</span>
                      {showPrice && width > 170 && <span className="num" style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>{rm(s.total)}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
