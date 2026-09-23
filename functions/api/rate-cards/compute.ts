import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { ruleToSpec, type CardRow, type RuleRow } from '../../_lib/rate-cards';
import { computeDeliveryCost, type DeliveryFacts, type RateCardSpec } from '../../_lib/rate-card-compute';

/** POST /api/rate-cards/compute { cardId, facts, perTrip? } — price a drop/trip against a card
 *  using the pure engine. Read-only preview; the same math trips will reconcile against. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const cardId = String(b.cardId ?? '').trim();
  if (!cardId) return fail('VALIDATION', 'Pick a rate card.', 422, { cardId: 'Pick a rate card.' });
  const card = await one<CardRow>(env, 'SELECT id, basis, aggregation, min_charge_sen, cap_sen, rounding FROM delivery_rate_cards WHERE id = ?', cardId);
  if (!card) return fail('NOT_FOUND', 'That rate card does not exist.', 404);
  const rules = await all<RuleRow>(env, 'SELECT id, card_id, rule_type, tier_position, bracket_min, bracket_max, zone, amount_sen, sort_order FROM delivery_rate_rules WHERE card_id = ?', cardId);
  const spec: RateCardSpec = {
    basis: card.basis as 'SET' | 'ITEM', aggregation: card.aggregation as RateCardSpec['aggregation'],
    minChargeSen: card.min_charge_sen, capSen: card.cap_sen, rounding: card.rounding as RateCardSpec['rounding'],
    rules: rules.map(ruleToSpec),
  };
  const facts = (b.facts ?? {}) as DeliveryFacts;
  const breakdown = computeDeliveryCost(spec, facts, { perTrip: b.perTrip === true });
  return json({ data: breakdown });
};
