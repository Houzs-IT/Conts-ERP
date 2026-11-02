import { type Env, run } from './db';
import {
  OTA_CHANNELS, SALES_CHANNELS, PRICE_LEVELS, DEFAULT_RULE, levelPrices,
  type ChannelRule, type LevelPrices, type OtaChannel, type PriceLevel, type SalesChannel, type UnitLevels,
} from './channelPrice';
import type { UnitPricing } from './unitPricing';

/** Changing a unit's price levels and channel rules: one at a time from the Pricing page (PUT /api/rates) and for many
 *  units at once (POST /api/pricing/batch). Both go through applyOps and saveSettings, so they validate and store the
 *  same way. All money is integer sen. */

export interface PriceSettings { levels: UnitLevels; rules: Record<OtaChannel, ChannelRule> }

/** One change. channel 'web' is the direct price:
 *    set     the level's price to `value` (a channel: its fixed price for that level; it switches to fixed prices,
 *            starting from what it charges now on every level, so the other levels keep their price)
 *    pct     move the level's current price by `value` percent (-90 to 300), rounded to the ringgit
 *    clear   empty the weekend or holiday level (direct, or a fixed channel), so it falls back to the level below
 *    percent a channel only: `value` percent above the direct price (0 to 300), on every level
 *    amount  a channel only: `value` sen above the direct price, on every level
 *    default a channel only: back to its default share of the direct price */
export type OpAction = 'set' | 'pct' | 'clear' | 'percent' | 'amount' | 'default';
export interface Op { channel: SalesChannel; level?: PriceLevel; action: OpAction; value?: number | null }

const MAX_SEN = 10_000_000;   // RM 100,000 a night
const roundRinggit = (sen: number) => Math.max(100, Math.round(sen / 100) * 100);
const cloneSettings = (s: PriceSettings): PriceSettings => ({ levels: { ...s.levels }, rules: Object.fromEntries(OTA_CHANNELS.map(c => [c, { ...s.rules[c] }])) as Record<OtaChannel, ChannelRule> });

export const settingsOf = (p: UnitPricing): PriceSettings => ({ levels: { ...p.levels }, rules: { ...p.rules } });

/** Every channel's price per level under some settings. */
export const gridOf = (s: PriceSettings): Record<SalesChannel, LevelPrices> =>
  Object.fromEntries(SALES_CHANNELS.map(ch => [ch, levelPrices(ch, s.levels, ch === 'web' ? DEFAULT_RULE : s.rules[ch as OtaChannel])])) as Record<SalesChannel, LevelPrices>;

/** Checks a list of changes before anything is applied: the message is for the screen. */
export function checkOps(ops: unknown, holidayEve: unknown): string | null {
  if (!Array.isArray(ops)) return 'Say what to change.';
  if (!ops.length && typeof holidayEve !== 'boolean') return 'Add at least one change.';
  if (ops.length > 24) return 'Make at most 24 changes at a time.';
  for (const [i, o] of (ops as Op[]).entries()) {
    const at = ops.length > 1 ? ` (change ${i + 1})` : '';
    if (!o || !(SALES_CHANNELS as readonly string[]).includes(o.channel)) return `Pick a channel${at}.`;
    if (!['set', 'pct', 'clear', 'percent', 'amount', 'default'].includes(o.action)) return `Pick what to do${at}.`;
    const channelOnly = o.action === 'percent' || o.action === 'amount' || o.action === 'default';
    if (channelOnly && o.channel === 'web') return `Direct has no markup; set its price instead${at}.`;
    if (!channelOnly && !(PRICE_LEVELS as readonly string[]).includes(o.level ?? '')) return `Pick the nightly, weekend or holiday price${at}.`;
    if (o.action === 'clear' && o.level === 'base') return `The nightly price cannot be emptied${at}.`;
    const v = o.value;
    if (o.action === 'set' && !(Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_SEN)) return `Enter a price above RM 0.00${at}.`;
    if (o.action === 'pct' && !(typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 300 && v !== 0)) return `Enter a change between -90% and +300%${at}.`;
    if (o.action === 'percent' && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 300)) return `Enter 0% to 300% above the direct price${at}.`;
    if (o.action === 'amount' && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_SEN)) return `Enter an amount of RM 0.00 or more${at}.`;
  }
  return null;
}

/** The current price of a level (with its fallback) for a direct or fixed level. */
const levelNow = (base: number, weekend: number | null | undefined, holiday: number | null | undefined, level: PriceLevel) =>
  level === 'base' ? base : level === 'weekend' ? weekend ?? base : holiday ?? base;

/** The settings after the changes (checked by checkOps first). Direct changes are applied before channel changes,
 *  so a channel switched to fixed prices in the same batch starts from the new direct prices. Returns an error
 *  message when the result is not a price the unit can sell at. */
export function applyOps(s: PriceSettings, ops: Op[], holidayEve?: boolean): { next: PriceSettings } | { error: string } {
  const next = cloneSettings(s);
  if (typeof holidayEve === 'boolean') next.levels.holidayEve = holidayEve;
  const ordered = [...ops.filter(o => o.channel === 'web'), ...ops.filter(o => o.channel !== 'web')];
  for (const o of ordered) {
    const v = Number(o.value ?? 0);
    if (o.channel === 'web') {
      const L = next.levels, level = o.level!;
      const value = o.action === 'set' ? v : o.action === 'pct' ? roundRinggit(levelNow(L.base, L.weekend, L.holiday, level) * (1 + v / 100)) : null;
      if (level === 'base') { if (value) L.base = value; }
      else if (level === 'weekend') L.weekend = value;
      else L.holiday = value;
      continue;
    }
    const ch = o.channel as OtaChannel;
    if (o.action === 'percent') { next.rules[ch] = { mode: 'percent', percent: Math.round(v * 100) / 100 }; continue; }
    if (o.action === 'amount') { next.rules[ch] = { mode: 'amount', uplift: v }; continue; }
    if (o.action === 'default') { next.rules[ch] = DEFAULT_RULE; continue; }
    let r = next.rules[ch];
    if (r.mode !== 'fixed') {
      // Switching to fixed prices: every level starts at what the channel charges now, so only the level asked
      // for moves. A channel with no holiday price keeps none until one is set.
      const now = levelPrices(ch, next.levels, r);
      r = { mode: 'fixed', fixedBase: now.base, fixedWeekend: now.weekend === now.base ? null : now.weekend, fixedHoliday: now.holiday };
    } else r = { ...r };
    const level = o.level!;
    const value = o.action === 'set' ? v : o.action === 'pct' ? roundRinggit(levelNow(Number(r.fixedBase), r.fixedWeekend, r.fixedHoliday, level) * (1 + v / 100)) : null;
    if (level === 'base') { if (value) r.fixedBase = value; }
    else if (level === 'weekend') r.fixedWeekend = value;
    else r.fixedHoliday = value;
    next.rules[ch] = r;
  }
  if (!(next.levels.base > 0)) return { error: 'This unit has no nightly price yet; set one first.' };
  return { next };
}

/** What changed between two settings, for the preview and the audit: one line per channel and level whose price moved,
 *  plus the holiday eve switch and any channel whose rule changed. */
export function diffSettings(a: PriceSettings, b: PriceSettings) {
  const ga = gridOf(a), gb = gridOf(b);
  const prices: { channel: SalesChannel; level: PriceLevel; from: number | null; to: number | null }[] = [];
  for (const ch of SALES_CHANNELS) for (const level of PRICE_LEVELS) {
    const x = ga[ch][level], y = gb[ch][level];
    if (x !== y) prices.push({ channel: ch, level, from: x, to: y });
  }
  const rules = OTA_CHANNELS.filter(ch => JSON.stringify(a.rules[ch]) !== JSON.stringify(b.rules[ch])).map(ch => ({ channel: ch, from: a.rules[ch], to: b.rules[ch] }));
  const eve = a.levels.holidayEve !== b.levels.holidayEve ? { from: a.levels.holidayEve, to: b.levels.holidayEve } : null;
  return { prices, rules, eve };
}

/** Stores units' new settings in three statements however many units: their levels on units, then each changed
 *  channel rule on channel_uplifts (the default rule is no row). `levelsReady` false (migration 0202 not applied):
 *  only the nightly and weekend price and RM rules can be stored; the caller refuses anything else first. */
export async function saveSettings(env: Env, items: { unitId: string; before: PriceSettings; after: PriceSettings }[], now: string, levelsReady: boolean): Promise<void> {
  if (!items.length) return;
  const levels = items.map(i => ({ id: i.unitId, base: i.after.levels.base, weekend: i.after.levels.weekend, holiday: i.after.levels.holiday, eve: i.after.levels.holidayEve }));
  if (levelsReady) await run(env, `UPDATE units u SET base_rate = x.base, weekend_rate = x.weekend, holiday_rate = x.holiday, holiday_eve = x.eve, updated_at = ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, base int, weekend int, holiday int, eve boolean) WHERE u.id = x.id`, now, JSON.stringify(levels));
  else await run(env, `UPDATE units u SET base_rate = x.base, weekend_rate = x.weekend, updated_at = ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, base int, weekend int) WHERE u.id = x.id`, now, JSON.stringify(levels));
  const changed = items.flatMap(i => OTA_CHANNELS.filter(ch => JSON.stringify(i.before.rules[ch]) !== JSON.stringify(i.after.rules[ch])).map(ch => ({ unit_id: i.unitId, channel: ch, r: i.after.rules[ch] })));
  const gone = changed.filter(c => c.r.mode === 'default').map(c => ({ unit_id: c.unit_id, channel: c.channel }));
  if (gone.length) await run(env, `DELETE FROM channel_uplifts c USING jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, channel text)
    WHERE c.unit_id = x.unit_id AND c.channel = x.channel`, JSON.stringify(gone));
  const kept = changed.filter(c => c.r.mode !== 'default').map(({ unit_id, channel, r }) => ({
    unit_id, channel, uplift: r.mode === 'amount' ? Number(r.uplift ?? 0) : null, mode: r.mode, percent: r.mode === 'percent' ? r.percent : null,
    fixed_base: r.mode === 'fixed' ? r.fixedBase : null, fixed_weekend: r.mode === 'fixed' ? r.fixedWeekend ?? null : null, fixed_holiday: r.mode === 'fixed' ? r.fixedHoliday ?? null : null,
  }));
  if (!kept.length) return;
  if (!levelsReady) {
    await run(env, `INSERT INTO channel_uplifts (unit_id, channel, uplift, updated_at)
      SELECT x.unit_id, x.channel, x.uplift, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, channel text, uplift int)
      ON CONFLICT (unit_id, channel) DO UPDATE SET uplift = excluded.uplift, updated_at = excluded.updated_at`, now, JSON.stringify(kept));
    return;
  }
  await run(env, `
    INSERT INTO channel_uplifts (unit_id, channel, uplift, mode, percent, fixed_base, fixed_weekend, fixed_holiday, updated_at)
    SELECT x.unit_id, x.channel, x.uplift, x.mode, x.percent, x.fixed_base, x.fixed_weekend, x.fixed_holiday, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, channel text, uplift int, mode text, percent numeric, fixed_base int, fixed_weekend int, fixed_holiday int)
    ON CONFLICT (unit_id, channel) DO UPDATE SET uplift = excluded.uplift, mode = excluded.mode, percent = excluded.percent,
      fixed_base = excluded.fixed_base, fixed_weekend = excluded.fixed_weekend, fixed_holiday = excluded.fixed_holiday, updated_at = excluded.updated_at`,
    now, JSON.stringify(kept));
}

/** Whether settings need migration 0202 to be stored. */
export const needsLevels = (s: PriceSettings) => s.levels.holiday !== null || s.levels.holidayEve || OTA_CHANNELS.some(ch => s.rules[ch].mode === 'percent' || s.rules[ch].mode === 'fixed');
