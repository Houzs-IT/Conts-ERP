import { useState, type CSSProperties } from 'react';
import { color, radius, text, channel as CH } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import ChannelMark from '../components/ChannelMark';
import { StaleBanner } from '../components/DataState';
import { useApi } from '../lib/useApi';
import { rm } from '../lib/format';
import type { BookingChannel } from '../lib/types';

const DAYS = 14;
const COL = 60;
const UNIT_COL = 268;
const ALL: BookingChannel[] = ['airbnb','booking_com','agoda','direct','maintenance_block','owner_stay'];

interface Unit { id: string; unitNumber: string; propertyName: string }
interface Block {
  id: string; unitId: string; channel: BookingChannel; state: string;
  guestName: string; checkIn: string; checkOut: string;
  grossBookingValue: number; ref: string | null; label: string; reason: string | null;
}
interface Payload { from: string; to: string; units: Unit[]; blocks: Block[]; generatedAt: string }

const today = new Date('2026-09-16');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);

const FALLBACK: Payload = {
  from: '2026-09-16', to: '2026-09-29', generatedAt: '',
  units: [
    { id: 'u1', unitNumber: '#A-12-03', propertyName: 'Vista Jaya One' },
    { id: 'u2', unitNumber: '#B-08-11', propertyName: 'Arcoris Mont Kiara' },
    { id: 'u3', unitNumber: '#2207', propertyName: 'Tribeca' },
    { id: 'u4', unitNumber: '#15-06', propertyName: 'Scarletz' },
    { id: 'u5', unitNumber: '#A-21-02', propertyName: 'The Establishment' },
    { id: 'u6', unitNumber: '#C-31-14', propertyName: 'Sentral Suites' },
  ],
  blocks: [
    { id: 'b1', unitId: 'u1', channel: 'airbnb', state: 'checked_in', guestName: 'Nadia Abdullah', checkIn: '2026-09-16', checkOut: '2026-09-17', grossBookingValue: 85200, ref: 'ABNB-7741QK', label: 'Airbnb \u00b7 Checked in', reason: null },
    { id: 'b2', unitId: 'u1', channel: 'direct', state: 'confirmed', guestName: 'Aaron Lee', checkIn: '2026-09-17', checkOut: '2026-09-21', grossBookingValue: 113600, ref: 'TC-2026-0916', label: 'Direct \u00b7 Confirmed', reason: null },
    { id: 'b3', unitId: 'u2', channel: 'booking_com', state: 'confirmed', guestName: 'Priya Sundaram', checkIn: '2026-09-17', checkOut: '2026-09-24', grossBookingValue: 161700, ref: 'BDC-5512087', label: 'Booking.com \u00b7 Confirmed', reason: null },
    { id: 'b4', unitId: 'u3', channel: 'agoda', state: 'confirmed', guestName: 'Chen Yu', checkIn: '2026-09-18', checkOut: '2026-09-23', grossBookingValue: 159000, ref: 'AGD-330912', label: 'Agoda \u00b7 Confirmed', reason: null },
    { id: 'b5', unitId: 'u4', channel: 'owner_stay', state: 'confirmed', guestName: 'Chong Wei Han', checkIn: '2026-09-23', checkOut: '2026-09-25', grossBookingValue: 0, ref: 'OWN-0032', label: 'Owner stay', reason: 'Owner staying, agreed 12 Sep' },
    { id: 'b6', unitId: 'u6', channel: 'maintenance_block', state: 'confirmed', guestName: 'AquaFix Sdn Bhd', checkIn: '2026-09-16', checkOut: '2026-09-22', grossBookingValue: 0, ref: 'MNT-0914', label: 'Block \u00b7 Maintenance', reason: 'Plumbing works, AquaFix on site' },
  ],
};

export default function CalendarPage() {
  const [off, setOff] = useState<Partial<Record<BookingChannel, boolean>>>({});
  const from = iso(today);
  const to = iso(addDays(today, DAYS - 1));
  const { data, error, reload } = useApi<Payload>(`/reservations/calendar?from=${from}&to=${to}`, FALLBACK);

  const units = data?.units ?? [];
  const blocks = (data?.blocks ?? []).filter(b => !off[b.channel]);
  const start = new Date(data?.from ?? from);

  /** Column index for a date, clamped to the visible window. */
  const dayIndex = (d: string) => Math.round((new Date(d).getTime() - start.getTime()) / 864e5);

  return (
    <>
      <PageHeader title="Calendar" sub={`${units.length} units &middot; ${new Date(from).getDate()}\u2013${new Date(to).getDate()} ${new Date(to).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })}`} />

      {error && <StaleBanner message={`Showing the last board we have. ${error}`} onRetry={reload} />}

      <Card>
        <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderBottom: `1px solid ${color.border}` }}>
          {ALL.map(k => {
            const on = !off[k];
            const c = CH[k];
            return (
              <button key={k} onClick={() => setOff(o => ({ ...o, [k]: on }))}
                style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px 0 6px', borderRadius: radius.pill, cursor: 'pointer', userSelect: 'none', font: 'inherit',
                  border: `1px solid ${on ? c.fill + '40' : 'transparent'}`, background: on ? c.tint : color.page }}>
                <ChannelMark ch={k} size={22} muted={!on} />
                <span style={{ fontSize: 12.5, fontWeight: on ? 500 : 400, whiteSpace: 'nowrap', color: on ? color.ink : color.textMuted }}>{c.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ overflowX: 'auto' }}>
          {/* Every calendar column is border-box: the width math assumes a declared
              width IS the used width, or the columns drift against the header. */}
          <div style={{ minWidth: UNIT_COL + DAYS * COL }}>
            <div style={{ display: 'flex', background: color.muted, borderBottom: `1px solid ${color.border}` }}>
              <div style={{ width: UNIT_COL, boxSizing: 'border-box', flex: 'none', position: 'sticky', left: 0, zIndex: 3, background: color.muted, padding: '10px 16px', borderRight: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>Unit</div>
              {Array.from({ length: DAYS }, (_, i) => {
                const d = addDays(start, i);
                return (
                  <div key={i} style={{ flex: 1, boxSizing: 'border-box', minWidth: 58, padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, borderLeft: `1px solid ${color.border}`, background: i === 0 ? color.goldTint : 'transparent' }}>
                    <span style={{ fontSize: text.micro, color: color.textMuted }}>{d.toLocaleDateString('en-MY', { weekday: 'short' })}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{d.getDate()}</span>
                  </div>
                );
              })}
            </div>

            {units.map(u => {
              const cells: ({ b: Block; first: boolean; last: boolean } | null)[] = Array(DAYS).fill(null);
              blocks.filter(b => b.unitId === u.id).forEach(b => {
                const s = Math.max(0, dayIndex(b.checkIn));
                const e = Math.min(DAYS, dayIndex(b.checkOut));
                for (let i = s; i < e; i++) cells[i] = { b, first: i === s, last: i === e - 1 };
              });
              return (
                <div key={u.id} style={{ display: 'flex', minHeight: 68, borderBottom: `1px solid ${color.border}` }}>
                  <div style={{ width: UNIT_COL, boxSizing: 'border-box', flex: 'none', position: 'sticky', left: 0, zIndex: 3, background: '#FFFFFF', padding: '10px 16px', borderRight: `1px solid ${color.border}`, display: 'flex', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{u.unitNumber}</span>
                      <span style={{ fontSize: 11.5, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.propertyName}</span>
                    </div>
                  </div>
                  {cells.map((c, i) => {
                    const base: CSSProperties = {
                      position: 'relative', boxSizing: 'border-box', flex: 1, minWidth: 58,
                      borderLeft: `1px solid ${color.borderMuted}`, display: 'flex', alignItems: 'center', padding: '7px 5px',
                    };
                    if (!c) return <div key={i} style={{ ...base, cursor: 'pointer', overflow: 'hidden' }} title={`${u.unitNumber} · available`} />;
                    const ch = CH[c.b.channel];
                    const dashed = ch.border !== 'solid';
                    const nights = dayIndex(c.b.checkOut) - dayIndex(c.b.checkIn);
                    return (
                      <div key={i} title={`${c.b.guestName} · ${c.b.label}${c.b.ref ? ' · ' + c.b.ref : ''}${c.b.reason ? ' · ' + c.b.reason : ''}`}
                        style={{
                          ...base, margin: '11px 0', cursor: 'pointer', background: ch.tint,
                          borderTop: dashed ? `1px ${ch.border} ${ch.fill}` : '1px solid rgba(21,21,21,0.06)',
                          borderBottom: dashed ? `1px ${ch.border} ${ch.fill}` : '1px solid rgba(21,21,21,0.06)',
                          // The 3px accent is an inset shadow, not a border, so every
                          // cell keeps an identical box model and columns cannot drift.
                          boxShadow: c.first ? `inset 3px 0 0 ${ch.fill}` : undefined,
                          borderRadius: c.first && c.last ? 6 : c.first ? '6px 0 0 6px' : c.last ? '0 6px 6px 0' : undefined,
                          borderRight: c.last ? (dashed ? `1px ${ch.border} ${ch.fill}` : '1px solid rgba(21,21,21,0.06)') : undefined,
                        }}>
                        {c.first && (
                          <>
                            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', zIndex: 3, pointerEvents: 'none' }}>
                              <ChannelMark ch={c.b.channel} size={20} />
                            </span>
                            <span style={{ position: 'absolute', left: 35, maxWidth: nights * COL - 45, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none', zIndex: 2, color: ch.ink }}>
                              {c.b.guestName}{c.b.grossBookingValue > 0 ? ` · ${rm(c.b.grossBookingValue, { cents: false })}` : ''}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </>
  );
}
