import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { date, monthLabel } from '../../lib/format';
import { META, fmtFigure, photoUrl, daysBetween, type FigureKey, type Live, type Overrides, type Listing } from './model';

/** What every overridable figure needs: whether the page is the control panel's visual editor, and the figures. */
export interface FigureCtx {
  edit: boolean; live: Live; ov: Overrides;
  open: (key: FigureKey, e: MouseEvent, mode: 'edit' | 'menu') => void;
}
export const FigureContext = createContext<FigureCtx>({ edit: false, live: {} as Live, ov: {}, open: () => {} });

/** A number Showcase control can replace. In the visual editor it is underlined (dotted when live, solid amber when
 *  overridden); click edits it, right-click offers Back to live / Apply override. Only portfolio figures are editable. */
export function Fig({ k, children, portfolio = true }: { k: FigureKey; children: ReactNode; portfolio?: boolean }) {
  const f = useContext(FigureContext);
  if (!f.edit || !portfolio) return <>{children}</>;
  const over = !!f.ov[k]?.active;
  return (
    <span className={`sc-fig editable${over ? ' overridden' : ''}`} role="button" tabIndex={0} title={`${META[k].label}: click to edit`}
      onClick={e => f.open(k, e, 'edit')} onContextMenu={e => { e.preventDefault(); f.open(k, e, 'menu'); }}
      onKeyDown={e => { if (e.key === 'Enter') f.open(k, e as unknown as MouseEvent, 'edit'); }}>{children}</span>
  );
}

/** The popover behind a figure in the visual editor. */
export function FigureEditor({ k, x, y, mode, live, ov, onApply, onUseStored, onLive, onClose, onEdit }: {
  k: FigureKey; x: number; y: number; mode: 'edit' | 'menu'; live: Live; ov: Overrides;
  onApply: (v: number) => void; onUseStored: () => void; onLive: () => void; onClose: () => void; onEdit: () => void;
}) {
  const stored = ov[k];
  const [val, setVal] = useState(String(stored?.value ?? live[k] ?? ''));
  const [err, setErr] = useState('');
  const apply = () => {
    const n = Number(val.replace(/,/g, '').trim());
    if (!val.trim() || !Number.isFinite(n) || n < 0) { setErr('Enter a number of zero or more.'); return; }
    onApply(n);
  };
  return (
    <>
      <div onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
      <div className="sc-editor sc-pop" style={{ left: x, top: y }} role="dialog" aria-label={META[k].label}>
        <div style={{ fontWeight: 800 }}>{META[k].label}</div>
        <div className="sc-editor-row"><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="sc-dot" style={{ width: 6, height: 6 }} />Live from Airbnb</span><b style={{ color: 'var(--sc-ink)' }}>{fmtFigure(k, live[k])}</b></div>
        {stored && <div className="sc-editor-row"><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="sc-dot" style={{ width: 6, height: 6, background: 'var(--sc-star)' }} />Override</span><b style={{ color: 'var(--sc-amber-ink)' }}>{fmtFigure(k, stored.value)}</b></div>}
        {mode === 'edit' ? (
          <>
            <input className="sc-editor-input num" autoFocus inputMode="decimal" aria-label={`${META[k].label}, override value`} value={val}
              onChange={e => { setVal(e.target.value); setErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') onClose(); }} />
            {err && <div className="sc-editor-error">{err}</div>}
            <button type="button" className="sc-editor-btn primary" onClick={apply}>Apply override</button>
          </>
        ) : (
          <>
            {stored && <button type="button" className="sc-editor-btn" onClick={onUseStored}>Apply override · {fmtFigure(k, stored.value)}</button>}
            <button type="button" className="sc-editor-btn" onClick={onEdit}>Edit value...</button>
          </>
        )}
        <button type="button" className="sc-editor-btn live" onClick={onLive}>↺ Back to live</button>
      </div>
    </>
  );
}

/** A listing photo, or the striped placeholder until the unit has one (Units screen, cover photo). */
export function Photo({ id, style, className = '', fine, children, label }: { id?: string | null; style?: CSSProperties; className?: string; fine?: boolean; children?: ReactNode; label?: string }) {
  const url = photoUrl(id);
  const [broken, setBroken] = useState(false);
  return (
    <div className={`sc-photo${fine ? ' fine' : ''} ${className}`} style={style}>
      {url && !broken ? <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />
        : label ? <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--sc-faint)' }}>{label}</span> : null}
      {children}
    </div>
  );
}

export function Avatar({ name, i, size, style }: { name: string; i: number; size: number; style?: CSSProperties }) {
  const ini = name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'G';
  return <div className="sc-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.33), background: `var(--sc-tint-${i % 6})`, ...style }}>{ini}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, large }: { value: T; options: { key: T; label: ReactNode; count?: ReactNode }[]; onChange: (v: T) => void; large?: boolean }) {
  return (
    <div className={`sc-seg${large ? ' lg' : ''}`} role="group">
      {options.map(o => (
        <button key={o.key} type="button" aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
          {o.label}{o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PriceToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="sc-toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className={`sc-toggle-track${on ? ' on' : ''}`}><span className="sc-toggle-knob" /></span>
      {on ? 'Prices shown' : 'Prices hidden'}
    </button>
  );
}

export function MonthNav({ month, min, max, onChange }: { month: string; min: string; max: string; onChange: (m: string) => void }) {
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  return (
    <div className="sc-monthnav">
      <button type="button" aria-label="Previous month" disabled={month <= min} onClick={() => onChange(shift(-1))}>‹</button>
      <div style={{ fontSize: 13, fontWeight: 700, minWidth: 110, textAlign: 'center', whiteSpace: 'nowrap' }}>{monthLabel(month, { long: true })}</div>
      <button type="button" aria-label="Next month" disabled={month >= max} onClick={() => onChange(shift(1))}>›</button>
    </div>
  );
}

/** The property picker: a search box and every listed property, plus "all" when `allLabel` is given. */
export function PropertyDropdown({ listings, value, onChange, allLabel, totalLabel }: { listings: Listing[]; value: string; onChange: (id: string) => void; allLabel?: string; totalLabel: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const cur = listings.find(l => l.id === value);
  const needle = q.trim().toLowerCase();
  const rows = listings.filter(l => !needle || `${l.name} ${l.unit}`.toLowerCase().includes(needle));
  const pick = (id: string) => { onChange(id); setOpen(false); setQ(''); };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="sc-pill" aria-expanded={open} aria-haspopup="listbox" onClick={() => { setOpen(!open); setQ(''); }}>
        <span className="ellipsis">{cur ? cur.name : allLabel ?? 'Select a property'}</span><span className="sc-caret">▼</span>
      </button>
      {open && (
        <>
          <div className="sc-scrim" onClick={() => setOpen(false)} />
          <div className="sc-popover sc-pop" style={{ width: 380, maxWidth: 'calc(100vw - 32px)' }}>
            <input className="sc-search" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search properties" aria-label="Search properties" />
            <div className="sc-dd-list" role="listbox">
              {allLabel && (
                <button type="button" role="option" aria-selected={value === 'all'} className="sc-dd-row" onClick={() => pick('all')}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--sc-ink)', color: 'var(--sc-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{totalLabel}</div>
                  <div style={{ minWidth: 0, flex: 1 }}><div className="ellipsis" style={{ fontSize: 13, fontWeight: 700 }}>{allLabel}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>Entire portfolio</div></div>
                  <div className="sc-dd-check">{value === 'all' ? '✓' : ''}</div>
                </button>
              )}
              {rows.map(l => (
                <button key={l.id} type="button" role="option" aria-selected={value === l.id} className="sc-dd-row" onClick={() => pick(l.id)}>
                  <Photo id={l.photoId} fine style={{ width: 34, height: 34, borderRadius: 8 }} />
                  <div style={{ minWidth: 0, flex: 1 }}><div className="ellipsis" style={{ fontSize: 13, fontWeight: 700 }}>{l.name}</div><div style={{ fontSize: 12, color: 'var(--sc-muted)' }}>{l.unit}</div></div>
                  <div className="sc-dd-check">{value === l.id ? '✓' : ''}</div>
                </button>
              ))}
              {!rows.length && <div className="sc-empty" style={{ padding: 20 }}>No property matches "{q}".</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const ym = (iso: string) => iso.slice(0, 7);
const monthAdd = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

/** Two months side by side; the first click sets the start, the second the end (a click before the start moves the
 *  start). Days after today cannot be picked: the figures are what already happened. */
export function DateRangePicker({ from, to, today, onApply }: { from: string; to: string; today: string; onApply: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tf, setTf] = useState<string | null>(from);
  const [tt, setTt] = useState<string | null>(to);
  const [left, setLeft] = useState(monthAdd(ym(to), -1));
  const show = () => { setTf(from); setTt(to); setLeft(monthAdd(ym(to), -1)); setOpen(true); };
  const click = (d: string) => { if (!tf || tt) { setTf(d); setTt(null); } else if (d < tf) setTf(d); else setTt(d); };
  const summary = tf && tt ? `${date(tf)} → ${date(tt)} · ${daysBetween(tf, tt)} days` : tf ? 'Select an end date' : 'Select a start date';
  const month = (m: string, k: number) => {
    const [y, mo] = m.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return (
      <div key={m}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 32, marginBottom: 10 }}>
          <button type="button" className="sc-dp-nav" aria-label="Previous month" style={{ visibility: k === 0 ? 'visible' : 'hidden' }} onClick={() => setLeft(monthAdd(left, -1))}>‹</button>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{monthLabel(m, { long: true })}</div>
          <button type="button" className="sc-dp-nav" aria-label="Next month" style={{ visibility: k === 1 ? 'visible' : 'hidden' }} disabled={m >= ym(today)} onClick={() => setLeft(monthAdd(left, 1))}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <div key={i} className="sc-dp-dow">{w}</div>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
          {Array.from({ length: first }, (_, i) => <div key={`b${i}`} className="sc-dp-cell" />)}
          {Array.from({ length: dim }, (_, i) => {
            const d = `${m}-${String(i + 1).padStart(2, '0')}`, dow = (first + i) % 7;
            const isS = d === tf, isE = d === tt, inR = !!tf && !!tt && d > tf && d < tt;
            const band = !!tf && !!tt && tf !== tt && (inR || isS || isE);
            const radius = isS ? '20px 0 0 20px' : isE ? '0 20px 20px 0' : inR && dow === 0 ? '20px 0 0 20px' : inR && dow === 6 ? '0 20px 20px 0' : 0;
            return (
              <div key={d} className={`sc-dp-cell${band ? ' band' : ''}`} style={{ borderRadius: radius }}>
                <button type="button" className={`sc-dp-day${isS || isE ? ' edge' : ''}${d === today && !isS && !isE ? ' today' : ''}`} disabled={d > today} onClick={() => click(d)}>{i + 1}</button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="sc-pill" aria-expanded={open} onClick={() => (open ? setOpen(false) : show())} style={{ padding: '0 16px' }}>
        <span>{date(from)}</span><span style={{ color: 'var(--sc-faint)' }}>→</span><span>{date(to)}</span>
      </button>
      {open && (
        <>
          <div className="sc-scrim" onClick={() => setOpen(false)} />
          <div className="sc-popover sc-dp sc-pop" style={{ maxWidth: 'calc(100vw - 32px)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 32 }}>{month(left, 0)}{month(monthAdd(left, 1), 1)}</div>
            <div className="sc-dp-foot">
              <div style={{ fontSize: 13, color: 'var(--sc-muted)' }}>{summary}</div>
              <button type="button" className="sc-link-btn" style={{ marginLeft: 'auto' }} onClick={() => { setTf(null); setTt(null); }}>Clear</button>
              <button type="button" className="sc-apply" disabled={!tf || !tt} onClick={() => { if (tf && tt) { onApply(tf, tt); setOpen(false); } }}>Apply</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Several strips moving at once: content doubled for a seamless loop, time-based steps (frame gap capped at 50 ms),
 *  hovering any strip pauses them all. `speed` is pixels per millisecond; negative moves right to left. */
export function useMarquees(strips: { speed: number }[]) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const paused = useRef(false);
  const xs = useRef<(number | null)[]>([]);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let last = 0, raf = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 50) : 0; last = now;
      strips.forEach((s, i) => {
        const el = refs.current[i];
        if (!el || paused.current) return;
        const half = el.scrollWidth / 2;
        if (!half) return;
        let x = xs.current[i] ?? (s.speed > 0 ? -half : 0);
        x += dt * s.speed;
        if (s.speed < 0 && -x >= half) x += half;
        if (s.speed > 0 && x >= 0) x -= half;
        xs.current[i] = x;
        el.style.transform = `translateX(${x}px)`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [strips.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    ref: (i: number) => (el: HTMLDivElement | null) => { refs.current[i] = el; },
    hover: { onMouseEnter: () => { paused.current = true; }, onMouseLeave: () => { paused.current = false; } },
  };
}

/** Esc closes the layer on top (listing preview, reservation drawer) before it would leave the showcase. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
}
