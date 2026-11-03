import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { MoneyInput, PercentInput } from '../../components/inputs';
import { StatusBadge } from '../../components/StatusBadge';
import ChannelMark from '../../components/ChannelMark';
import Icon from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { api, notifyFailure } from '../../lib/api';
import { COMMISSION, type ChannelRule } from '../../lib/pricing';
import { channel as CH } from '../../theme';
import { SYNC } from '../../lib/vocabulary';
import { rm, date } from '../../lib/format';
import { TONE, cx } from '../../lib/design-tokens';
import { EditableMoney } from './EditableMoney';
import { usePhone } from '../finance/listKit';
import { LEVELS, LEVEL_HINT, LEVEL_LABEL, OTA, SALE_CHANNELS, ruleText, type ChannelRate, type Level, type OtaChannel, type PricedUnit, type SaleChannel } from './types';

const label = (c: SaleChannel) => (c === 'web' ? CH.direct.label : CH[c].label);
const mark = (c: SaleChannel) => (c === 'web' ? 'direct' : c);
const rmWhole = (s: number) => rm(s, { cents: false });
const dayText = (d: string) => date(`${d}T12:00:00+08:00`);

function Tag({ text, kind }: { text: string; kind: 'internal' | 'external' }) {
  return (
    <span className={cx(
      'inline-flex items-center h-[18px] px-[7px] py-0 rounded-pill text-caption font-semibold tracking-[0.03em] border border-solid',
      kind === 'external' ? 'bg-gold-tint text-gold-ink border-[var(--color-gold-200)]' : 'bg-muted text-muted-ink border-line',
    )}>{text}</span>
  );
}

/** One unit's prices: the direct price of each level, every channel's resulting price per level (editable: a channel
 *  price typed in switches that channel to fixed prices), how each channel is priced, and the internal cost floor. */
export function UnitPrices({ unit, levelsReady, onSaved }: { unit: PricedUnit; levelsReady: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [ruleFor, setRuleFor] = useState<ChannelRate | null>(null);
  const [busy, setBusy] = useState(false);
  const phone = usePhone();

  async function put(body: Record<string, unknown>, title: string, note?: string) {
    setBusy(true);
    try {
      await api.put('/rates', { unitId: unit.unitId, ...body });
      toast({ tone: 'success', title, body: note ?? 'Nights without a custom price use it on every channel. Connected channels are updated by themselves.' });
      onSaved();
    } catch (e) { notifyFailure(e); }
    finally { setBusy(false); }
  }

  const setDirect = (level: Level, sen: number | null) => {
    if (level === 'base') { if (sen) void put({ baseRate: sen }, 'Nightly price updated.'); return; }
    if (level === 'weekend') void put({ weekendRate: sen }, sen ? 'Weekend price updated.' : 'Weekend price cleared.', sen ? undefined : 'Friday and Saturday nights now use the nightly price.');
    else void put({ holidayRate: sen }, sen ? 'Holiday price updated.' : 'Holiday price cleared.', sen ? 'Public holiday nights without a custom price use it.' : 'Holidays now use the weekend or nightly price.');
  };

  /** A channel price typed into the table: that channel keeps its other levels at what it charges now and takes
   *  this level as a fixed price. */
  const setChannel = (ch: OtaChannel, level: Level, sen: number | null) => {
    const r = unit.rates.find(x => x.channel === ch)!;
    const now = unit.levels[ch];
    const fixed = r.mode === 'fixed'
      ? { fixedBase: r.fixedBase ?? now.base, fixedWeekend: r.fixedWeekend ?? null, fixedHoliday: r.fixedHoliday ?? null }
      : { fixedBase: now.base, fixedWeekend: now.weekend === now.base ? null : now.weekend, fixedHoliday: now.holiday };
    const next = { ...fixed, ...(level === 'base' ? { fixedBase: sen ?? fixed.fixedBase } : level === 'weekend' ? { fixedWeekend: sen } : { fixedHoliday: sen }) };
    void put({ rule: { channel: ch, mode: 'fixed', ...next } }, `${CH[ch].label} ${LEVEL_LABEL[level].toLowerCase()} set.`,
      r.mode === 'fixed' ? undefined : `${CH[ch].label} now has fixed prices of its own; the direct price no longer moves it.`);
  };

  /** One channel's price for one level: Direct and every channel are editable (a channel price switches it to fixed). */
  const priceCell = (c: SaleChannel, level: Level) => {
    const lp = unit.levels[c];
    const value = level === 'holiday' ? lp.holiday : lp[level];
    if (c === 'web') {
      return level === 'holiday' && !levelsReady ? <span className="text-caption text-faint">Not available</span>
        : <EditableMoney sen={value} clearable={level !== 'base'} minSen={1} emptyLabel="Uses weekend or nightly" ariaLabel={`Direct ${LEVEL_LABEL[level].toLowerCase()}`} onCommit={s => setDirect(level, s)} />;
    }
    const r = unit.rates.find(x => x.channel === c)!;
    const keep = value == null ? null : Math.round(value * (1 - COMMISSION[c] / 100));
    return (
      <span className="inline-flex flex-col items-end">
        {!levelsReady ? <span className="tabular-nums">{value == null ? '—' : rmWhole(value)}</span> : (
          <EditableMoney sen={value} clearable={level !== 'base' && r.mode === 'fixed'} minSen={1} muted={value == null}
            emptyLabel="Uses weekend or nightly" ariaLabel={`${CH[c].label} ${LEVEL_LABEL[level].toLowerCase()}`} onCommit={s => setChannel(c, level, s)} />
        )}
        {keep != null && <span className={cx('text-caption tabular-nums px-1.5', keep < unit.costFloor ? TONE.critical.text : 'text-faint')}>keep {rmWhole(keep)}{keep < unit.costFloor ? ' · below floor' : ''}</span>}
      </span>
    );
  };
  const syncOf = (c: OtaChannel) => { const r = unit.rates.find(x => x.channel === c)!; return r.sync === 'not_connected' ? { label: 'Not connected', tone: 'neutral' as const } : SYNC[r.sync]; };
  const ruleButton = (c: OtaChannel) => {
    const r = unit.rates.find(x => x.channel === c)!;
    return (
      <button type="button" onClick={() => setRuleFor(r)} disabled={!levelsReady && r.mode !== 'default' && r.mode !== 'amount'}
        className="inline-flex items-center gap-1 text-caption font-medium text-ink bg-transparent border-0 cursor-pointer underline underline-offset-2 [font-family:inherit] text-right">
        {ruleText(r, rmWhole)}<Icon name="ChevronDown" size="sm" />
      </button>
    );
  };

  const failed = unit.rates.filter(r => r.sync === 'failed').length;

  return (
    <Card style={{ flex: '1 1 520px', minWidth: 0 }}>
      <div className="py-4 px-5 [border-bottom:1px_solid_var(--color-line)] flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-heading font-semibold">{unit.propertyName} {unit.unitNumber}</span>
          <span className="text-meta text-muted-ink">
            {unit.state ?? 'State not recognised'} · Tap a price to change it. It saves straight away and goes to connected channels by itself.
          </span>
          {unit.nextHolidays.length > 0 && (
            <span className="text-caption text-muted-ink">Next holidays: {unit.nextHolidays.map(h => `${h.name} ${dayText(h.date)}`).join(' · ')}</span>
          )}
        </div>
        <Link to={`/reservations/calendar?rates=1&unit=${encodeURIComponent(unit.unitId)}`} className="text-meta font-medium text-ink underline underline-offset-2 whitespace-nowrap">
          Custom prices for dates
        </Link>
      </div>

      {/* Direct price per level, and the internal floor */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-px bg-line [border-bottom:1px_solid_var(--color-line)]">
        {LEVELS.map(level => {
          const sen = level === 'base' ? unit.baseRate : level === 'weekend' ? unit.weekendRate : unit.holidayRate;
          const off = level === 'holiday' && !levelsReady;
          return (
            <div key={level} className="bg-card py-[14px] px-5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2"><span className="text-meta text-muted-ink">{LEVEL_LABEL[level]}</span><Tag text="SELL" kind="external" /></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption text-faint">{LEVEL_HINT[level]}{level !== 'base' && sen == null ? (level === 'weekend' ? ' · uses nightly' : ' · uses weekend or nightly') : ''}</span>
                {off ? <span className="text-caption text-faint">Needs a database update</span> : (
                  <EditableMoney sen={sen} ariaLabel={LEVEL_LABEL[level].toLowerCase()} minSen={1} clearable={level !== 'base'}
                    tone={level === 'base' && sen != null && sen <= 0 ? 'warn' : undefined} onCommit={s => setDirect(level, s)} />
                )}
              </div>
              {level === 'base' && unit.baseRate <= 0 && <span className={cx('text-meta font-medium', TONE.critical.text)}>No nightly price. Set one before selling this unit.</span>}
              {level === 'holiday' && levelsReady && (
                <label className="flex items-center gap-2 text-caption text-muted-ink cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-ink" checked={unit.holidayEve} disabled={busy}
                    onChange={e => void put({ holidayEve: e.target.checked }, e.target.checked ? 'Holiday eves use the holiday price.' : 'Only the holiday night uses the holiday price.')} />
                  Also the night before each holiday
                </label>
              )}
            </div>
          );
        })}
        <div className="bg-card py-[14px] px-5 flex flex-col gap-1.5">
          <div className="flex items-center gap-2"><span className="text-meta text-muted-ink">Cost floor</span><Tag text="INTERNAL" kind="internal" /></div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-faint">Never sent to a channel</span>
            <EditableMoney sen={unit.costFloor} ariaLabel="cost floor" tone="floor" onCommit={s => s != null && void put({ costFloor: s }, 'Cost floor updated.', 'Internal only. The floor is never sent to a channel.')} />
          </div>
        </div>
      </div>

      <div className="py-2.5 px-5 [border-bottom:1px_solid_var(--color-line)] text-caption text-muted-ink">
        Which price a night gets: a <span className="font-medium text-ink">custom price</span> set for that date on the Calendar, else the <span className="font-medium text-ink">holiday price</span> on a public holiday, else the <span className="font-medium text-ink">weekend price</span> on Friday and Saturday, else the <span className="font-medium text-ink">nightly price</span>.
      </div>

      {/* Every channel's price per level: one table on wider screens, a block per channel on a phone. */}
      {phone ? (
        <div className="flex flex-col" aria-label="Prices per channel">
          {SALE_CHANNELS.map(c => {
            const s = c === 'web' ? null : syncOf(c);
            return (
              <section key={c} className="py-3 px-4 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <ChannelMark ch={mark(c)} size={18} /><span className="text-copy font-semibold">{label(c)}</span>
                  <span className="flex-1" />
                  {s ? <StatusBadge tone={s.tone} label={s.label} size="sm" /> : <span className="text-caption text-faint">Your site</span>}
                </span>
                {c !== 'web' && <span className="flex justify-end">{ruleButton(c)}</span>}
                {LEVELS.map(level => (
                  <span key={level} className="flex items-center justify-between gap-3 min-h-11">
                    <span className="flex flex-col"><span className="text-copy">{LEVEL_LABEL[level]}</span><span className="text-caption text-faint">{LEVEL_HINT[level]}</span></span>
                    {priceCell(c, level)}
                  </span>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-copy" aria-label="Prices per channel">
          <thead>
            <tr className="[border-bottom:1px_solid_var(--color-line)]">
              <th scope="col" className="text-left font-medium text-meta text-muted-ink py-2.5 px-5 w-[150px] sticky left-0 bg-card">Price</th>
              {SALE_CHANNELS.map(c => {
                const s = c === 'web' ? null : syncOf(c);
                return (
                  <th key={c} scope="col" className="text-right font-medium text-meta py-2.5 px-3 align-top">
                    <span className="inline-flex flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1.5 text-ink"><ChannelMark ch={mark(c)} size={16} />{label(c)}</span>
                      {s ? <StatusBadge tone={s.tone} label={s.label} size="sm" /> : <span className="text-caption text-faint font-normal">Your site</span>}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {LEVELS.map(level => (
              <tr key={level} className="[border-bottom:1px_solid_var(--color-line-soft)]">
                <th scope="row" className="text-left font-normal py-2 px-5 sticky left-0 bg-card">
                  <span className="flex flex-col"><span className="text-copy">{LEVEL_LABEL[level]}</span><span className="text-caption text-faint">{LEVEL_HINT[level]}</span></span>
                </th>
                {SALE_CHANNELS.map(c => <td key={c} className="text-right py-2 px-3">{priceCell(c, level)}</td>)}
              </tr>
            ))}
            <tr>
              <th scope="row" className="text-left font-normal py-2.5 px-5 sticky left-0 bg-card"><span className="text-meta text-muted-ink">How it is priced</span></th>
              <td className="text-right py-2.5 px-3 text-caption text-faint">The prices above</td>
              {OTA.map(c => <td key={c} className="text-right py-2.5 px-3">{ruleButton(c)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      )}

      <div className="py-[10px] px-5 flex gap-4 flex-wrap text-caption text-muted-ink">
        <span className="inline-flex items-center gap-1.5"><Tag text="SELL" kind="external" /> what the guest pays on the channel</span>
        <span>keep: what you get after the channel's service fee</span>
        {failed > 0 && <span className={TONE.critical.text}>{failed} channel{failed === 1 ? '' : 's'} failed to update; see Channex on Integrations.</span>}
      </div>

      {ruleFor && <RuleModal unit={unit} rate={ruleFor} levelsReady={levelsReady} onClose={() => setRuleFor(null)}
        onSave={async rule => { await put({ rule: { channel: ruleFor.channel, ...rule } }, `${CH[ruleFor.channel].label} pricing updated.`); setRuleFor(null); }} />}
    </Card>
  );
}

type RuleDraft = { mode: ChannelRule['mode']; percent: number | null; uplift: number | null; fixedBase: number | null; fixedWeekend: number | null; fixedHoliday: number | null };

/** How one channel is priced for one unit: its default share, a percentage or an amount above the direct price, or
 *  fixed prices of its own per level. Shows the prices it would charge before saving. */
function RuleModal({ unit, rate, levelsReady, onClose, onSave }: { unit: PricedUnit; rate: ChannelRate; levelsReady: boolean; onClose: () => void; onSave: (r: Partial<RuleDraft>) => Promise<void> }) {
  const now = unit.levels[rate.channel];
  const share = Math.round((rate.upliftShare ?? ({ airbnb: 0.12, booking_com: 0.18, agoda: 0.16 } as const)[rate.channel]) * 100);
  const [d, setD] = useState<RuleDraft>({
    mode: rate.mode, percent: rate.mode === 'percent' ? Number(rate.percent) : share, uplift: rate.mode === 'amount' ? Number(rate.uplift ?? rate.upliftSen) : rate.upliftSen,
    fixedBase: rate.mode === 'fixed' ? rate.fixedBase ?? now.base : now.base,
    fixedWeekend: rate.mode === 'fixed' ? rate.fixedWeekend ?? null : now.weekend === now.base ? null : now.weekend,
    fixedHoliday: rate.mode === 'fixed' ? rate.fixedHoliday ?? null : now.holiday,
  });
  const [busy, setBusy] = useState(false);
  const direct = unit.levels.web;
  const onTop = (x: number | null) => (x == null ? null : d.mode === 'percent' ? x + Math.round(x * (d.percent ?? 0) / 100) : d.mode === 'amount' ? x + (d.uplift ?? 0) : x + Math.round(x * share / 100));
  const preview: Record<Level, number | null> = d.mode === 'fixed'
    ? { base: d.fixedBase, weekend: d.fixedWeekend ?? d.fixedBase, holiday: d.fixedHoliday }
    : { base: onTop(direct.base), weekend: onTop(direct.weekend), holiday: onTop(direct.holiday) };
  const ok = d.mode === 'fixed' ? !!d.fixedBase && d.fixedBase > 0 : d.mode === 'percent' ? d.percent != null && d.percent >= 0 && d.percent <= 300 : d.mode === 'amount' ? d.uplift != null && d.uplift >= 0 : true;
  const modes: { key: RuleDraft['mode']; title: string; sub: string; needs?: boolean }[] = [
    { key: 'default', title: `Default: ${share}% above the direct price`, sub: 'Moves with the direct price.' },
    { key: 'percent', title: 'A percentage above the direct price', sub: 'Moves with the direct price on every level.', needs: true },
    { key: 'amount', title: 'An amount above the direct price', sub: 'The same ringgit amount on every level.' },
    { key: 'fixed', title: `Fixed ${CH[rate.channel].label} prices`, sub: 'Its own nightly, weekend and holiday price; the direct price no longer moves it.', needs: true },
  ];
  return (
    <Modal title={`${CH[rate.channel].label} prices for ${unit.unitNumber}`} sub="Nights with a custom price on the Calendar keep it." onClose={() => !busy && onClose()} width={560}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!ok} disabledReason="Fill in the price first."
          onClick={async () => {
            setBusy(true);
            await onSave(d.mode === 'percent' ? { mode: 'percent', percent: d.percent } : d.mode === 'amount' ? { mode: 'amount', uplift: d.uplift } : d.mode === 'fixed' ? { mode: 'fixed', fixedBase: d.fixedBase, fixedWeekend: d.fixedWeekend, fixedHoliday: d.fixedHoliday } : { mode: 'default' });
            setBusy(false);
          }}>Save</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="How it is priced" className="flex flex-col gap-2">
          {modes.map(m => {
            const off = m.needs && !levelsReady;
            return (
              <label key={m.key} className={cx('flex items-start gap-2.5 p-3 rounded-control border border-solid cursor-pointer', d.mode === m.key ? 'border-gold bg-gold-tint' : 'border-line bg-card', off && 'opacity-50 cursor-not-allowed')}>
                <input type="radio" name="mode" className="mt-[3px] accent-ink" checked={d.mode === m.key} disabled={off} onChange={() => setD(x => ({ ...x, mode: m.key }))} />
                <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="text-copy font-medium">{m.title}</span>
                  <span className="text-meta text-muted-ink">{off ? 'Needs a database update first.' : m.sub}</span>
                  {d.mode === 'percent' && m.key === 'percent' && <div className="max-w-[160px] mt-1"><PercentInput aria-label="Percent above direct" value={d.percent} onChange={v => setD(x => ({ ...x, percent: v }))} max={300} /></div>}
                  {d.mode === 'amount' && m.key === 'amount' && <div className="max-w-[160px] mt-1"><MoneyInput aria-label="Amount above direct" valueSen={d.uplift} onChangeSen={v => setD(x => ({ ...x, uplift: v }))} minSen={0} /></div>}
                  {d.mode === 'fixed' && m.key === 'fixed' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
                      <MoneyInput label="Nightly" valueSen={d.fixedBase} onChangeSen={v => setD(x => ({ ...x, fixedBase: v }))} minSen={1} />
                      <MoneyInput label="Weekend" valueSen={d.fixedWeekend} onChangeSen={v => setD(x => ({ ...x, fixedWeekend: v || null }))} placeholder="Nightly" />
                      <MoneyInput label="Holiday" valueSen={d.fixedHoliday} onChangeSen={v => setD(x => ({ ...x, fixedHoliday: v || null }))} placeholder="Weekend or nightly" />
                    </div>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-control bg-page p-3">
          {LEVELS.map(l => (
            <span key={l} className="flex flex-col gap-0.5">
              <span className="text-caption text-muted-ink">{LEVEL_LABEL[l]}</span>
              <span className="text-copy font-semibold tabular-nums">{preview[l] == null ? <span className="text-faint font-normal">{l === 'holiday' ? 'Weekend or nightly' : '—'}</span> : rmWhole(preview[l]!)}</span>
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}
