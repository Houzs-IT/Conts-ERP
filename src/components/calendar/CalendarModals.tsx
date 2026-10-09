import { useState, type ReactNode } from 'react';
import { Button } from '../Button';
import { Field } from '../Field';
import ChannelMark from '../ChannelMark';
import { date, count } from '../../lib/format';
import { Select } from '../Select';
import Icon from '../Icon';
import { UnitPicker } from '../booking/UnitPicker';
import { CHANNEL } from '../../lib/vocabulary';
import type { BookingChannel } from '../../lib/types';
import { type CalendarUnit } from './types';

// Channels a bulk rate push can target. Direct is the web rate itself.
const PUSH: BookingChannel[] = ['direct', 'airbnb', 'booking_com', 'agoda'];

function CentreModal({ title, sub, onClose, onSave, saveLabel, canSave, children }: { title: string; sub?: string; onClose: () => void; onSave: () => void; saveLabel: string; canSave: boolean; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[440px] bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <form onSubmit={e => { e.preventDefault(); if (canSave) onSave(); }}>
          <div className="pt-[22px] px-[22px] pb-1"><h2 className="m-0 text-title font-semibold">{title}</h2>{sub && <p className="mt-[5px] mx-0 mb-0 text-copy text-muted-ink">{sub}</p>}</div>
          <div className="px-[22px] py-4 flex flex-col gap-[14px]">{children}</div>
          <div className="px-[22px] py-[14px] [border-top:1px_solid_var(--color-line)] bg-page rounded-b-card flex justify-end gap-[9px]">
            <Button size="sm" variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSave} disabledReason="Fill the fields first">{saveLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SetPriceModal({ m, onClose, onSave }: { m: { unit: CalendarUnit; channel: string; dayIso: string; current: number }; onClose: () => void; onSave: (rm: number) => void }) {
  const [v, setV] = useState(m.current > 0 ? String(Math.round(m.current / 100)) : '');
  const label = m.channel === 'web' ? 'Web rate' : CHANNEL[m.channel as BookingChannel].label;
  return (
    <CentreModal title="Set price" sub={`${m.unit.unitNumber} · ${label} · ${date(m.dayIso)}`} onClose={onClose} saveLabel="Set price" canSave={v !== '' && Number(v) >= 0} onSave={() => onSave(Number(v))}>
      <Field label="Price (RM / night)" type="number" min={0} step="0.01" numeric value={v} onChange={e => setV(e.target.value)} help="Pushed to the connected channel for this night. Confirmed bookings keep their original rate." />
    </CentreModal>
  );
}

export function BlockWizard({ units, initial, onClose, onSave }: {
  units: CalendarUnit[]; initial: { unitId?: string; from?: string; to?: string };
  onClose: () => void; onSave: (v: { unitId: string; from: string; to: string; reason: string }) => void;
}) {
  const [unit, setUnit] = useState(initial.unitId ?? '');
  const [fromD, setFromD] = useState(initial.from ?? ''); const [toD, setToD] = useState(initial.to ?? ''); const [reason, setReason] = useState('');
  const valid = !!unit && fromD !== '' && toD !== '' && toD > fromD && reason.trim() !== '';
  return (
    <CentreModal title="Block wizard" sub="Hold nights so no channel can sell them." onClose={onClose} saveLabel="Block dates" canSave={valid} onSave={() => onSave({ unitId: unit, from: fromD, to: toD, reason: reason.trim() })}>
      <UnitPicker units={units} value={unit} onChange={setUnit} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" type="date" value={fromD} onChange={e => setFromD(e.target.value)} />
        <Field label="To" type="date" value={toD} min={fromD || undefined} onChange={e => setToD(e.target.value)} />
      </div>
      <Field label="Reason" placeholder="e.g. Plumbing works" value={reason} onChange={e => setReason(e.target.value)} help="Required. Shown on the block. A unit linked to Channex has the nights closed on the booking sites." />
    </CentreModal>
  );
}

/** Up to this many units on the board, Rate update starts with all of them ticked. */
const PRESELECT_MAX = 12;
const groupByBuilding = (units: CalendarUnit[]) => {
  const m = new Map<string, CalendarUnit[]>();
  for (const u of units) { const l = m.get(u.propertyName) ?? []; l.push(u); m.set(u.propertyName, l); }
  return [...m.entries()];
};

interface RateLine { from: string; to: string; price: string; minStay: string; stop: 'same' | 'close' | 'open' }
export interface RateUpdateValue { unitIds: string[]; channels: BookingChannel[]; lines: { from: string; to: string; priceSen?: number; minStay?: number; stopSell?: boolean }[] }

/** Several date ranges, each with its own price / minimum stay / stop sell, saved together: one save is one
 *  batch for Channex, however many ranges it holds. */
export function RateUpdate({ units, initial, onClose, onSave }: {
  units: CalendarUnit[]; initial: { unitIds?: string[]; from?: string; to?: string }; onClose: () => void;
  onSave: (v: RateUpdateValue) => void;
}) {
  // Opened from the toolbar with a long board, nothing starts ticked: a price meant for one building must not
  // reach all 139 units because the operator did not untick the rest.
  const startAll = units.length <= PRESELECT_MAX;
  const [unitSel, setUnitSel] = useState<Record<string, boolean>>(Object.fromEntries(units.map(u => [u.id, initial.unitIds ? initial.unitIds.includes(u.id) : startAll])));
  const groups = groupByBuilding(units);
  const [chanSel, setChanSel] = useState<Record<string, boolean>>({ direct: true, airbnb: true, booking_com: true, agoda: true });
  const blank = (from = '', to = ''): RateLine => ({ from, to, price: '', minStay: '', stop: 'same' });
  const [lines, setLines] = useState<RateLine[]>([blank(initial.from ?? '', initial.to ?? '')]);
  const setLine = (i: number, p: Partial<RateLine>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const unitIds = units.filter(u => unitSel[u.id]).map(u => u.id);
  const channels = PUSH.filter(c => chanSel[c]);
  const hasPrice = (l: RateLine) => l.price !== '' && Number(l.price) >= 0;
  const minStayOk = (l: RateLine) => l.minStay === '' || (Number.isInteger(Number(l.minStay)) && Number(l.minStay) >= 1 && Number(l.minStay) <= 60);
  const lineOk = (l: RateLine) => l.from !== '' && l.to !== '' && l.to >= l.from && minStayOk(l) && (hasPrice(l) || l.minStay !== '' || l.stop !== 'same');
  const anyPrice = lines.some(hasPrice);
  const valid = unitIds.length > 0 && lines.every(lineOk) && (!anyPrice || channels.length > 0);
  const pill = (on: boolean) => `inline-flex items-center gap-[6px] h-8 px-3 rounded-pill cursor-pointer [font-family:inherit] text-copy border border-solid ${on ? 'font-semibold border-gold bg-gold-tint text-ink' : 'font-medium border-line bg-card text-muted-ink'}`;

  return (
    <CentreModal title="Rate update" sub="Set prices, minimum stay or stop sell for one or more date ranges, saved together." onClose={onClose} saveLabel="Save" canSave={valid}
      onSave={() => onSave({
        unitIds, channels,
        lines: lines.map(l => ({
          from: l.from, to: l.to,
          ...(hasPrice(l) ? { priceSen: Math.round(Number(l.price) * 100) } : {}),
          ...(l.minStay !== '' ? { minStay: Number(l.minStay) } : {}),
          ...(l.stop !== 'same' ? { stopSell: l.stop === 'close' } : {}),
        })),
      })}>
      <div className="flex flex-col gap-[7px]">
        <div className="flex items-baseline justify-between gap-3">
          <label className="text-meta font-medium text-muted-ink">Units · {count(unitIds.length)} of {count(units.length)}</label>
          {units.length > 1 && (
            <button type="button" onClick={() => setUnitSel(Object.fromEntries(units.map(u => [u.id, unitIds.length !== units.length])))}
              className="bg-transparent border-none p-0 cursor-pointer font-sans text-meta font-medium text-[var(--color-text-accent)]">
              {unitIds.length === units.length ? 'Clear all' : 'Select all'}
            </button>
          )}
        </div>
        <div className={`flex flex-col gap-2.5 ${units.length > 12 ? 'max-h-[30vh] overflow-y-auto pr-1 [scrollbar-width:thin]' : ''}`}>
          {groups.map(([name, us]) => {
            const allOn = us.every(u => unitSel[u.id]);
            return (
              <div key={name} className="flex flex-col gap-1.5">
                {groups.length > 1 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-meta font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{name}</span>
                    <button type="button" onClick={() => setUnitSel(s => ({ ...s, ...Object.fromEntries(us.map(u => [u.id, !allOn])) }))}
                      className="flex-none bg-transparent border-none p-0 cursor-pointer font-sans text-meta font-medium text-muted-ink hover:text-ink">
                      {allOn ? 'None' : `All ${us.length}`}
                    </button>
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {us.map(u => { const on = !!unitSel[u.id]; return (
                    <button key={u.id} type="button" aria-pressed={on} onClick={() => setUnitSel(s => ({ ...s, [u.id]: !on }))} className={pill(on)}>{u.unitNumber}</button>
                  ); })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 max-h-[46vh] overflow-y-auto">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-col gap-2.5 p-3 border border-solid border-line rounded-card">
            <div className="flex items-center justify-between">
              <span className="text-meta font-semibold text-muted-ink">Range {i + 1}</span>
              {lines.length > 1 && <Button variant="tertiary" size="sm" type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Remove</Button>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" type="date" value={l.from} onChange={e => setLine(i, { from: e.target.value })} />
              <Field label="To" type="date" value={l.to} min={l.from || undefined} onChange={e => setLine(i, { to: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Price (RM)" type="number" min={0} step="0.01" numeric value={l.price} onChange={e => setLine(i, { price: e.target.value })} help="Empty keeps it." />
              <Field label="Min stay" type="number" min={1} max={60} numeric value={l.minStay} onChange={e => setLine(i, { minStay: e.target.value })} help={minStayOk(l) ? '1 removes it.' : '1 to 60 nights.'} />
              <Select label="Stop sell" showLabel size="md" value={l.stop} onChange={v => setLine(i, { stop: v as RateLine['stop'] })}
                options={[{ value: 'same', label: 'Keep' }, { value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }]} />
            </div>
          </div>
        ))}
        {lines.length < 20 && (
          <div className="self-start"><Button variant="secondary" size="sm" type="button" icon={<Icon name="Plus" size="sm" />} onClick={() => setLines(ls => [...ls, blank()])}>Add another range</Button></div>
        )}
      </div>

      {anyPrice && (
        <div className="flex flex-col gap-[7px]">
          <label className="text-meta font-medium text-muted-ink">Prices apply to</label>
          <div className="flex gap-2 flex-wrap">
            {PUSH.map(c => { const on = !!chanSel[c]; return (
              <button key={c} type="button" aria-pressed={on} onClick={() => setChanSel(s => ({ ...s, [c]: !on }))} className={pill(on)}>
                <ChannelMark ch={c} size={16} muted={!on} />{c === 'direct' ? 'Web / Direct' : CHANNEL[c].label}
              </button>
            ); })}
          </div>
        </div>
      )}
    </CentreModal>
  );
}
