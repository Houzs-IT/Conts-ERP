/** Delivery cost pricing engine — ported 1:1 from 2990's SCM apps/api/src/routes/../lib/
 *  delivery-rate-card.ts (Houzs `backend/src/scm/lib/delivery-rate-card.ts`). PURE. Money is
 *  integer sen (2990's `centi` == sen for MYR — same values, renamed). Keep this byte-faithful
 *  to the source; it is the only place a delivery cost is computed. */

export type RateRuleType =
  | 'POSITIONAL_TIER' | 'OVERAGE' | 'SOFA_BRACKET' | 'OUTSTATION' | 'OUTSTATION_TRIP'
  | 'DISPOSE' | 'SETUP' | 'DISMANTLE' | 'SERVICE' | 'PICKUP' | 'INSPECTION' | 'TRANSFER';

export const RATE_RULE_TYPES: RateRuleType[] = [
  'POSITIONAL_TIER', 'OVERAGE', 'SOFA_BRACKET', 'OUTSTATION', 'OUTSTATION_TRIP',
  'DISPOSE', 'SETUP', 'DISMANTLE', 'SERVICE', 'PICKUP', 'INSPECTION', 'TRANSFER',
];

export type AggregationUnit = 'UNIT' | 'DROP' | 'CUSTOMER' | 'TRIP';
export type Rounding = 'NONE' | 'NEAREST_10C' | 'NEAREST_RM';

export interface RateRuleSpec {
  ruleType: RateRuleType;
  tierPosition?: number | null;
  bracketMin?: number | null;
  bracketMax?: number | null;
  zone?: string | null;
  amountSen: number;
}

export interface RateCardSpec {
  basis: 'SET' | 'ITEM';
  aggregation: AggregationUnit;
  minChargeSen?: number | null;
  capSen?: number | null;
  rounding?: Rounding | null;
  rules?: readonly RateRuleSpec[];
}

export interface DeliveryFacts {
  setCount?: number | null;
  itemCount?: number | null;
  sofaCompartments?: readonly number[] | null;
  dropCount?: number | null;
  customerCount?: number | null;
  destinationZone?: string | null;
  destinationZones?: readonly (string | null | undefined)[] | null;
  disposeCount?: number | null;
  setupCount?: number | null;
  dismantleCount?: number | null;
  serviceCount?: number | null;
  pickupCount?: number | null;
  inspectionCount?: number | null;
  transferCount?: number | null;
}

export interface CostLine {
  ruleType: RateRuleType | 'MIN_CHARGE' | 'CAP' | 'ROUNDING';
  label: string;
  amountSen: number;
  detail?: Record<string, unknown>;
}
export interface CostBreakdown { totalSen: number; subtotalSen: number; lines: CostLine[] }

function intOf(v: number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function tierAmountForPosition(tiers: readonly RateRuleSpec[], n: number): RateRuleSpec | null {
  let best: RateRuleSpec | null = null;
  for (const t of tiers) {
    const pos = intOf(t.tierPosition);
    if (pos >= 1 && pos <= n && (best === null || pos > intOf(best.tierPosition))) best = t;
  }
  return best;
}

export function chargingUnitCount(card: Pick<RateCardSpec, 'basis' | 'aggregation'>, facts: DeliveryFacts): number {
  switch (card.aggregation) {
    case 'TRIP': return 1;
    case 'DROP': return intOf(facts.dropCount);
    case 'CUSTOMER': return intOf(facts.customerCount) || intOf(facts.dropCount);
    default: return card.basis === 'ITEM' ? intOf(facts.itemCount) : intOf(facts.setCount);
  }
}

export function chargingUnitLabel(card: Pick<RateCardSpec, 'basis' | 'aggregation'>): string {
  switch (card.aggregation) {
    case 'TRIP': return 'trip';
    case 'DROP': return 'drop';
    case 'CUSTOMER': return 'customer';
    default: return card.basis === 'ITEM' ? 'item' : 'set';
  }
}

/** A multi-zone trip is charged ONCE, for the FARTHEST place — read off the surcharge itself
 *  (distance is not in the system). Ties keep the first seen for determinism. */
export function farthestZone(
  rules: readonly RateRuleSpec[],
  ruleType: 'OUTSTATION' | 'OUTSTATION_TRIP',
  facts: Pick<DeliveryFacts, 'destinationZone' | 'destinationZones'>,
): string | null {
  const candidates = (facts.destinationZones && facts.destinationZones.length > 0) ? facts.destinationZones : [facts.destinationZone];
  let best: { zone: string; amount: number } | null = null;
  for (const raw of candidates) {
    const z = String(raw ?? '').trim().toUpperCase();
    if (!z) continue;
    const rule = rules.find(r => r.ruleType === ruleType && String(r.zone ?? '').toUpperCase() === z);
    const amount = rule ? intOf(rule.amountSen) : 0;
    if (!best || amount > best.amount) best = { zone: z, amount };
  }
  return best ? best.zone : null;
}

export function tripOutstationFeeSen(rules: readonly RateRuleSpec[], destinationZone: string | null | undefined): number {
  if (!destinationZone) return 0;
  const z = String(destinationZone).toUpperCase();
  const r = rules.find(x => x.ruleType === 'OUTSTATION_TRIP' && String(x.zone ?? '').toUpperCase() === z);
  if (!r) return 0;
  const amt = Math.round(Number(r.amountSen) || 0);
  return amt > 0 ? amt : 0;
}

export interface CostOptions { perTrip?: boolean }

/** Price a drop/trip against a rate card. PURE. Order: unit tiers (+overage) → sofa brackets →
 *  outstation → occurrence charges → per-trip outstation fee → min/cap/rounding envelope. */
export function computeDeliveryCost(card: RateCardSpec, facts: DeliveryFacts, opts: CostOptions = {}): CostBreakdown {
  const lines: CostLine[] = [];
  const rules = card.rules ?? [];
  const rulesOf = (t: RateRuleType) => rules.filter(r => r.ruleType === t);

  const unitCount = chargingUnitCount(card, facts);
  const tiers = rulesOf('POSITIONAL_TIER');
  const overage = rulesOf('OVERAGE')[0] ?? null;
  const cap = overage ? intOf(overage.tierPosition) : null;
  const unitLabel = chargingUnitLabel(card);
  const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
  for (let n = 1; n <= unitCount; n++) {
    if (cap !== null && n > cap) {
      lines.push({ ruleType: 'OVERAGE', label: `Overage ${ordinal(n)} ${unitLabel} (beyond cap ${cap})`, amountSen: intOf(overage!.amountSen), detail: { position: n, cap } });
      continue;
    }
    const tier = tierAmountForPosition(tiers, n);
    if (tier) lines.push({ ruleType: 'POSITIONAL_TIER', label: `${ordinal(n)} ${unitLabel}`, amountSen: intOf(tier.amountSen), detail: { position: n, tierPosition: intOf(tier.tierPosition) } });
  }

  const sofaBrackets = rulesOf('SOFA_BRACKET');
  for (const comp of facts.sofaCompartments ?? []) {
    const c = intOf(comp);
    if (c <= 0) continue;
    const bracket = sofaBrackets.find(b => {
      const lo = intOf(b.bracketMin);
      const hi = b.bracketMax === null || b.bracketMax === undefined ? Infinity : intOf(b.bracketMax);
      return c >= lo && c <= hi;
    });
    if (bracket) {
      const hi = bracket.bracketMax === null || bracket.bracketMax === undefined ? '+' : `-${intOf(bracket.bracketMax)}`;
      lines.push({ ruleType: 'SOFA_BRACKET', label: `Sofa ${c}-compartment (${intOf(bracket.bracketMin)}${hi} band)`, amountSen: intOf(bracket.amountSen), detail: { compartments: c, bracketMin: intOf(bracket.bracketMin), bracketMax: bracket.bracketMax ?? null } });
    }
  }

  const farZone = farthestZone(rules, 'OUTSTATION', facts);
  if (farZone) {
    const os = rulesOf('OUTSTATION').find(r => String(r.zone ?? '').toUpperCase() === farZone);
    if (os) lines.push({ ruleType: 'OUTSTATION', label: `Outstation ${farZone}`, amountSen: intOf(os.amountSen), detail: { zone: farZone, ...(facts.destinationZones ? { pickedFrom: [...facts.destinationZones] } : {}) } });
  }

  const occurrence: Array<[RateRuleType, number, string]> = [
    ['DISPOSE', intOf(facts.disposeCount), 'Dispose'], ['SETUP', intOf(facts.setupCount), 'Setup'],
    ['DISMANTLE', intOf(facts.dismantleCount), 'Dismantle'], ['SERVICE', intOf(facts.serviceCount), 'Service'],
    ['PICKUP', intOf(facts.pickupCount), 'Pickup'], ['INSPECTION', intOf(facts.inspectionCount), 'Inspection'],
    ['TRANSFER', intOf(facts.transferCount), 'Transfer'],
  ];
  for (const [type, count, label] of occurrence) {
    if (count <= 0) continue;
    const rule = rulesOf(type)[0];
    if (!rule) continue;
    const each = intOf(rule.amountSen);
    lines.push({ ruleType: type, label: count > 1 ? `${label} x${count}` : label, amountSen: each * count, detail: { count, eachSen: each } });
  }

  if (opts.perTrip) {
    const tripZone = farthestZone(rules, 'OUTSTATION_TRIP', facts);
    const tripFee = tripOutstationFeeSen(rules, tripZone);
    if (tripFee > 0) lines.push({ ruleType: 'OUTSTATION_TRIP', label: `Outstation trip ${String(tripZone).toUpperCase()}`, amountSen: tripFee, detail: { zone: tripZone, perTrip: true } });
  }

  const subtotalSen = lines.reduce((s, l) => s + l.amountSen, 0);
  let total = subtotalSen;

  const minCharge = card.minChargeSen != null ? intOf(card.minChargeSen) : null;
  if (minCharge != null && total < minCharge) { lines.push({ ruleType: 'MIN_CHARGE', label: 'Minimum charge', amountSen: minCharge - total, detail: { minChargeSen: minCharge } }); total = minCharge; }

  const capSen = card.capSen != null ? intOf(card.capSen) : null;
  if (capSen != null && total > capSen) { lines.push({ ruleType: 'CAP', label: 'Charge cap', amountSen: capSen - total, detail: { capSen } }); total = capSen; }

  const rounding = card.rounding ?? 'NONE';
  if (rounding !== 'NONE' && total > 0) {
    const step = rounding === 'NEAREST_RM' ? 100 : 10;
    let rounded = Math.round(total / step) * step;
    if (capSen != null && rounded > capSen) rounded = Math.floor(total / step) * step;
    if (rounded !== total) { lines.push({ ruleType: 'ROUNDING', label: `Rounding (${rounding === 'NEAREST_RM' ? 'nearest RM' : 'nearest 10 sen'})`, amountSen: rounded - total, detail: { rounding } }); total = rounded; }
  }

  return { totalSen: total, subtotalSen, lines };
}
