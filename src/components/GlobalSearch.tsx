import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { color, radius, text, shadow } from '../theme';
import { useApi } from '../lib/useApi';
import { date, dateRange, humanize, titleCase } from '../lib/format';
import { stateLabel } from '../lib/vocabulary';
import type { BookingChannel } from '../lib/types';
import Icon from './Icon';
import ChannelMark from './ChannelMark';

/* ------------------------------------------------------------------ *
 * The search box the top bar opens (`/`, Ctrl+K or Cmd+K, or the search button; on a phone the magnifier).
 * GET /api/search?q= finds rental records (bookings by Airbnb, Booking.com or Agoda reference, guest name, phone or
 * email; guests; units and buildings; owners; maintenance jobs) and, through the supply chain engine, projects,
 * customers, quotations, orders, deliveries, invoices, purchase orders, goods receipts, suppliers, products and
 * service cases. Each kind follows the person's access. Five of each are shown, grouped; "See all" lists up to 50 of
 * one kind. Loaded only when opened, so the entry script stays small.
 * ------------------------------------------------------------------ */

interface SearchResult {
  id: string; label: string; sub: string; kind: string; target: string;
  channel?: BookingChannel; state?: string; checkIn?: string; checkOut?: string; ref?: string | null; date?: string | null;
}

const KIND: Record<string, { icon: string; heading: string }> = {
  reservation: { icon: 'CalendarDays', heading: 'Reservations' },
  guest: { icon: 'User', heading: 'Guests' },
  unit: { icon: 'Building2', heading: 'Units' },
  building: { icon: 'Building', heading: 'Buildings' },
  owner: { icon: 'UserRound', heading: 'Owners' },
  maintenance: { icon: 'Wrench', heading: 'Maintenance jobs' },
  project: { icon: 'FolderKanban', heading: 'Projects' },
  customer: { icon: 'Contact', heading: 'Customers' },
  quotation: { icon: 'FileText', heading: 'Quotations' },
  sales_order: { icon: 'ShoppingCart', heading: 'Sales orders' },
  delivery_order: { icon: 'Truck', heading: 'Delivery orders' },
  sales_invoice: { icon: 'Receipt', heading: 'Sales invoices' },
  service_case: { icon: 'Zap', heading: 'Service cases' },
  purchase_order: { icon: 'ClipboardList', heading: 'Purchase orders' },
  grn: { icon: 'PackageCheck', heading: 'Goods receipts' },
  purchase_invoice: { icon: 'ReceiptText', heading: 'Purchase invoices' },
  supplier: { icon: 'Factory', heading: 'Suppliers' },
  product: { icon: 'Package', heading: 'Products' },
};
const KIND_ORDER = Object.keys(KIND);
/** Shown per kind before "See all" (the server sends one more when there are more). */
const SHOWN = 5;

/** The second line of a result, with dates and states in words ("13 Sep – 16 Sep 2026 · Confirmed"). */
function subline(r: SearchResult) {
  if (r.kind === 'reservation') {
    const parts = [r.checkIn && r.checkOut ? dateRange(r.checkIn, r.checkOut) : null, r.state ? stateLabel('reservation', r.state) : null, r.sub];
    return parts.filter(Boolean).join(' · ');
  }
  if (r.kind === 'unit' && r.state) return `${r.sub} · ${stateLabel('readiness', r.state)}`;
  if (r.kind === 'maintenance' && r.state) return `${r.sub} · ${humanize(r.state)}`;
  return [r.sub, r.date ? date(r.date) : null].filter(Boolean).join(' · ');
}

type Row = { type: 'hit'; r: SearchResult } | { type: 'more'; kind: string };

export default function GlobalSearch({ compact, onClose, go }: {
  compact: boolean; onClose: () => void; go: (target: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  /** "See all" of one kind; null shows every kind, five each. */
  const [only, setOnly] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = window.setTimeout(() => setDebounced(query.trim()), 200); return () => window.clearTimeout(t); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setOnly(null); }, [debounced]);
  const { data, loading } = useApi<SearchResult[]>(`/search?q=${encodeURIComponent(debounced)}${only && debounced ? `&kind=${encodeURIComponent(only)}` : ''}`);

  // The server has already matched; results are only grouped here (filtering again by label used to drop
  // every booking found by its reference, because the reference is not in the label).
  const { rows, notice } = useMemo(() => {
    const list = data ?? [];
    const out: Row[] = [];
    for (const k of KIND_ORDER) {
      if (only && k !== only) continue;
      const of = list.filter(r => r.kind === k);
      const shown = only ? of : of.slice(0, SHOWN);
      out.push(...shown.map(r => ({ type: 'hit' as const, r })));
      if (!only && of.length > SHOWN) out.push({ type: 'more', kind: k });
    }
    return { rows: out, notice: list.find(r => r.kind === 'notice') ?? null };
  }, [data, only]);

  useEffect(() => { setActive(0); }, [debounced, only]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.type === 'more') { setOnly(row.kind); inputRef.current?.focus(); return; }
    onClose();
    go(row.r.target);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (only) setOnly(null); else onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(rows[active]); }
  };

  useEffect(() => { document.getElementById(`gs-row-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const waiting = loading || query.trim() !== debounced;
  const heading = (k: string) => (
    <div style={{ padding: '10px 12px 4px', fontSize: text.caption, fontWeight: 600, letterSpacing: '0.06em', color: color.textMuted, textTransform: 'uppercase' }}>{KIND[k]?.heading ?? k}</div>
  );

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(21,21,21,0.24)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: compact ? '8px' : '12vh 16px 16px' }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search"
        style={{ width: 640, maxWidth: '100%', background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: shadow.overlay, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${color.borderMuted}` }}>
          <Icon name="Search" size="nav" color={color.textMuted} />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder={compact ? 'Search anything' : 'Search anything: reservation ref, guest, phone, unit, project, customer, document no.'} aria-label="Search"
            enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
            style={{ font: 'inherit', flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 16, color: color.ink }} />
          <button type="button" onClick={onClose} aria-label="Close search" style={{ font: 'inherit', fontSize: compact ? text.meta : text.micro, color: color.textMuted, flex: 'none', border: `1px solid ${color.border}`, borderRadius: 4, background: 'none', padding: compact ? '0 12px' : '2px 6px', height: compact ? 36 : undefined, cursor: 'pointer' }}>{compact ? 'Close' : 'Esc'}</button>
        </div>
        {only && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${color.borderMuted}` }}>
            <button type="button" onClick={() => { setOnly(null); inputRef.current?.focus(); }}
              style={{ font: 'inherit', fontSize: text.meta, color: color.inkSecondary, display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', padding: '4px 6px', cursor: 'pointer', borderRadius: radius.control }}>
              <Icon name="ArrowLeft" size="sm" /> All results
            </button>
            <span style={{ fontSize: text.meta, color: color.textMuted }}>{KIND[only]?.heading}</span>
          </div>
        )}
        {/* Never taller than the window (a phone's keyboard takes half of it). */}
        <div style={{ maxHeight: compact ? 'calc(100dvh - 80px)' : 'min(480px, calc(100dvh - 12vh - 90px))', overflowY: 'auto', overscrollBehavior: 'contain', padding: 6 }}>
          {notice && (
            <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '4px 6px 6px', padding: '8px 10px', borderRadius: radius.control, background: 'var(--color-warning)', color: 'var(--color-warning-fg)', fontSize: text.meta }}>
              <Icon name="TriangleAlert" size="sm" />
              <span>{notice.label}. {notice.sub}</span>
            </div>
          )}
          {rows.length === 0 ? (
            <div style={{ padding: '20px 12px', fontSize: text.small, color: color.textMuted }}>
              {waiting ? 'Searching...' : debounced ? `No matches for "${debounced}". Try a reservation reference, a name, a phone number, a unit, a project or a document number.` : 'Type to search.'}
            </div>
          ) : rows.map((row, i) => {
            const k = row.type === 'hit' ? row.r.kind : row.kind;
            const first = i === 0 || (rows[i - 1].type === 'hit' ? (rows[i - 1] as { r: SearchResult }).r.kind : (rows[i - 1] as { kind: string }).kind) !== k;
            if (row.type === 'more') {
              return (
                <button key={`more-${k}`} id={`gs-row-${i}`} type="button" onClick={() => choose(row)} onMouseEnter={() => setActive(i)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px 7px 53px', width: '100%', border: 'none', borderRadius: radius.control, background: i === active ? color.muted : 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left', fontSize: text.meta, fontWeight: 500, color: color.inkSecondary }}>
                  See all {KIND[k]?.heading.toLowerCase()} <Icon name="ChevronRight" size="sm" />
                </button>
              );
            }
            const r = row.r;
            return (
              <Fragment key={`${r.kind}-${r.id}`}>
                {first && !only && heading(k)}
                <button id={`gs-row-${i}`} type="button" onClick={() => choose(row)} onMouseEnter={() => setActive(i)}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', width: '100%', minHeight: 44, border: 'none', borderRadius: radius.control, background: i === active ? color.muted : 'transparent', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                  {r.kind === 'reservation' && r.channel
                    ? <ChannelMark ch={r.channel} size={30} />
                    : <span style={{ width: 30, height: 30, flex: 'none', borderRadius: radius.sm, background: color.sunken, color: color.inkSecondary, display: 'grid', placeItems: 'center' }}><Icon name={KIND[r.kind]?.icon ?? 'Search'} size="sm" /></span>}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: text.copy, fontWeight: 500, color: color.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.kind === 'owner' ? titleCase(r.label) : r.label}</span>
                    <span style={{ fontSize: text.meta, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subline(r)}</span>
                  </span>
                  {r.ref && <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: text.caption, color: color.inkSecondary, background: color.muted, borderRadius: 4, padding: '2px 6px' }}>{r.ref}</span>}
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
