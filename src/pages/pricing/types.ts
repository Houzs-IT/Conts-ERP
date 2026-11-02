import type { SyncState } from '../../lib/types';
import type { ChannelRule, LevelPrices } from '../../lib/pricing';

/** GET /api/pricing/rules (functions/api/pricing/rules.ts). All money is integer sen. */
export type OtaChannel = 'airbnb' | 'booking_com' | 'agoda';
export type SaleChannel = 'web' | OtaChannel;
export type Level = 'base' | 'weekend' | 'holiday';
export const OTA: OtaChannel[] = ['airbnb', 'booking_com', 'agoda'];
export const SALE_CHANNELS: SaleChannel[] = ['web', 'airbnb', 'booking_com', 'agoda'];
export const LEVELS: Level[] = ['base', 'weekend', 'holiday'];

export interface ChannelRate extends ChannelRule {
  channel: OtaChannel;
  upliftSen: number;
  upliftShare: number | null;
  sync: SyncState | 'not_connected';
}
export interface PricedUnit {
  unitId: string; unitNumber: string; propertyName: string; state: string | null;
  costFloor: number; baseRate: number; weekendRate: number | null; holidayRate: number | null; holidayEve: boolean;
  levels: Record<SaleChannel, LevelPrices>;
  nextHolidays: { date: string; name: string }[];
  rates: ChannelRate[];
}
export interface PricingPayload { units: PricedUnit[]; generatedAt: string; levelsReady: boolean; holidaysReady: boolean }

/** The words the owner sees for each level (docs/VOCABULARY.md: Nightly price, Weekend price, Custom price). */
export const LEVEL_LABEL: Record<Level, string> = { base: 'Nightly price', weekend: 'Weekend price', holiday: 'Holiday price' };
export const LEVEL_HINT: Record<Level, string> = { base: 'Sun to Thu nights', weekend: 'Fri and Sat nights', holiday: 'Public holidays' };

/** A channel rule in a few words: "+18% (default)", "+15%", "+RM 40", "Fixed prices". */
export function ruleText(r: ChannelRule & { upliftShare?: number | null }, rm: (sen: number) => string): string {
  if (r.mode === 'percent') return `${Number(r.percent ?? 0)}% above direct`;
  if (r.mode === 'amount') return `${rm(Number(r.uplift ?? 0))} above direct`;
  if (r.mode === 'fixed') return 'Fixed prices';
  return `${Math.round((r.upliftShare ?? 0) * 100)}% above direct (default)`;
}
