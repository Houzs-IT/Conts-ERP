import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { isBasis, isAggregation, isRounding, toCardPayload, toRulePayload, type CardRow, type RuleRow } from '../../_lib/rate-cards';
import { insertRules } from './index';
import { strOrNull, intOrNull, flag } from '../../_lib/scm-util';

const CARD_SQL = `
  SELECT c.id, c.name, c.carrier_company_id, c.carrier_label, c.basis, c.aggregation, c.min_charge_sen, c.cap_sen,
         c.rounding, c.is_active, c.notes, t.name AS carrier_name
  FROM delivery_rate_cards c LEFT JOIN threepl_companies t ON t.id = c.carrier_company_id WHERE c.id = ?`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const card = await one<CardRow>(env, CARD_SQL, id);
  if (!card) return fail('NOT_FOUND', 'That rate card does not exist.', 404);
  const rules = await all<RuleRow>(env, 'SELECT id, card_id, rule_type, tier_position, bracket_min, bracket_max, zone, amount_sen, sort_order FROM delivery_rate_rules WHERE card_id = ? ORDER BY sort_order, rule_type', id);
  return json({ data: { ...toCardPayload(card), rules: rules.map(toRulePayload) } });
};

/** PATCH — update the card envelope, and when `rules` is present, REPLACE all its rules. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit rate cards.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM delivery_rate_cards WHERE id = ?', id)) return fail('NOT_FOUND', 'That rate card does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = []; const args: unknown[] = [];
  if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return fail('VALIDATION', 'Enter a card name.', 422, { name: 'Enter a card name.' }); sets.push('name = ?'); args.push(n); }
  if (b.carrierCompanyId !== undefined) { const cc = strOrNull(b.carrierCompanyId); if (cc && !await one(env, 'SELECT 1 AS x FROM threepl_companies WHERE id = ?', cc)) return fail('VALIDATION', 'Unknown carrier.', 422, { carrierCompanyId: 'Unknown carrier.' }); sets.push('carrier_company_id = ?'); args.push(cc); }
  if (b.carrierLabel !== undefined) { sets.push('carrier_label = ?'); args.push(strOrNull(b.carrierLabel)); }
  if (b.basis !== undefined && isBasis(b.basis)) { sets.push('basis = ?'); args.push(b.basis); }
  if (b.aggregation !== undefined && isAggregation(b.aggregation)) { sets.push('aggregation = ?'); args.push(b.aggregation); }
  if (b.minChargeSen !== undefined) { sets.push('min_charge_sen = ?'); args.push(intOrNull(b.minChargeSen)); }
  if (b.capSen !== undefined) { sets.push('cap_sen = ?'); args.push(intOrNull(b.capSen)); }
  if (b.rounding !== undefined && isRounding(b.rounding)) { sets.push('rounding = ?'); args.push(b.rounding); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }
  if (b.isActive !== undefined) { sets.push('is_active = ?'); args.push(flag(b.isActive) ?? 1); }
  if (sets.length) {
    sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
    await run(env, `UPDATE delivery_rate_cards SET ${sets.join(', ')} WHERE id = ?`, ...args);
  }
  if (Array.isArray(b.rules)) {
    await run(env, 'DELETE FROM delivery_rate_rules WHERE card_id = ?', id);
    await insertRules(env, id, b.rules);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate_card.update', entityTable: 'delivery_rate_cards', entityId: id, after: { fields: sets.length, rulesReplaced: Array.isArray(b.rules) } });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete rate cards.', 403);
  const id = String(params.id);
  const cur = await one<{ name: string }>(env, 'SELECT name FROM delivery_rate_cards WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That rate card does not exist.', 404);
  await run(env, 'DELETE FROM delivery_rate_cards WHERE id = ?', id); // rules cascade
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate_card.delete', entityTable: 'delivery_rate_cards', entityId: id, before: { name: cur.name } });
  return new Response(null, { status: 204 });
};
