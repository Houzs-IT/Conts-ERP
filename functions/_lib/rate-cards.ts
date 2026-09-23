/** Delivery Rate Cards, ported from 2990's SCM. Card header + priced rules. Money integer sen.
 *  The pricing math lives in rate-card-compute.ts. */
import type { RateRuleType, RateRuleSpec } from './rate-card-compute';
import { RATE_RULE_TYPES } from './rate-card-compute';

export const BASES = ['SET', 'ITEM'] as const;
export const AGGREGATIONS = ['UNIT', 'DROP', 'CUSTOMER', 'TRIP'] as const;
export const ROUNDINGS = ['NONE', 'NEAREST_10C', 'NEAREST_RM'] as const;

export const isBasis = (v: unknown): v is typeof BASES[number] => typeof v === 'string' && (BASES as readonly string[]).includes(v);
export const isAggregation = (v: unknown): v is typeof AGGREGATIONS[number] => typeof v === 'string' && (AGGREGATIONS as readonly string[]).includes(v);
export const isRounding = (v: unknown): v is typeof ROUNDINGS[number] => typeof v === 'string' && (ROUNDINGS as readonly string[]).includes(v);
export const isRateRuleType = (v: unknown): v is RateRuleType => typeof v === 'string' && (RATE_RULE_TYPES as readonly string[]).includes(v);

export interface CardRow {
  id: string; name: string; carrier_company_id: string | null; carrier_label: string | null;
  basis: string; aggregation: string; min_charge_sen: number | null; cap_sen: number | null;
  rounding: string; is_active: number; notes: string | null; carrier_name?: string | null; rule_count?: number;
}
export interface RuleRow {
  id: string; card_id: string; rule_type: string; tier_position: number | null; bracket_min: number | null;
  bracket_max: number | null; zone: string | null; amount_sen: number; sort_order: number;
}

export function toCardPayload(r: CardRow) {
  return {
    id: r.id, name: r.name, carrierCompanyId: r.carrier_company_id ?? '', carrierLabel: r.carrier_label ?? '',
    carrierName: r.carrier_name ?? '', basis: r.basis, aggregation: r.aggregation,
    minChargeSen: r.min_charge_sen, capSen: r.cap_sen, rounding: r.rounding, isActive: r.is_active === 1,
    notes: r.notes ?? '', ruleCount: r.rule_count ?? 0,
  };
}

export function toRulePayload(r: RuleRow) {
  return {
    id: r.id, ruleType: r.rule_type, tierPosition: r.tier_position, bracketMin: r.bracket_min,
    bracketMax: r.bracket_max, zone: r.zone ?? '', amountSen: r.amount_sen, sortOrder: r.sort_order,
  };
}

/** Row -> the pure engine's RateRuleSpec. */
export function ruleToSpec(r: RuleRow): RateRuleSpec {
  return { ruleType: r.rule_type as RateRuleType, tierPosition: r.tier_position, bracketMin: r.bracket_min, bracketMax: r.bracket_max, zone: r.zone, amountSen: r.amount_sen };
}
