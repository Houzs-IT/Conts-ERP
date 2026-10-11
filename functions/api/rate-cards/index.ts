import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isBasis, isAggregation, isRounding, isRateRuleType, toCardPayload, type CardRow } from '../../_lib/rate-cards';
import { strOrNull, intOrNull, flag, genId } from '../../_lib/scm-util';
import { checkSen, checkInt, invalid, type Fields } from '../../_lib/validate';

const LIST_SQL = `
  SELECT c.id, c.name, c.carrier_company_id, c.carrier_label, c.basis, c.aggregation, c.min_charge_sen, c.cap_sen,
         c.rounding, c.is_active, c.notes, t.name AS carrier_name,
         (SELECT COUNT(*) FROM delivery_rate_rules r WHERE r.card_id = c.id) AS rule_count
  FROM delivery_rate_cards c LEFT JOIN threepl_companies t ON t.id = c.carrier_company_id`;

/** GET /api/rate-cards?active=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const active = url.searchParams.get('active');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (active === '1' || active === '0') { where.push('c.is_active = ?'); args.push(Number(active)); }
  if (search) { where.push('(lower(c.name) LIKE ? OR lower(coalesce(c.carrier_label, \'\')) LIKE ? OR lower(coalesce(t.name, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }
  const rows = await all<CardRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY c.name`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toCardPayload) });
};

interface RuleInput { ruleType?: unknown; tierPosition?: unknown; bracketMin?: unknown; bracketMax?: unknown; zone?: unknown; amountSen?: unknown }

/** Field checks shared by create and update; every key is optional so a PATCH passes when it leaves one out. */
export function cardFieldProblems(b: Record<string, unknown>) {
  const fields: Fields = {};
  checkSen(fields, 'minChargeSen', b.minChargeSen, { label: 'Minimum charge' });
  checkSen(fields, 'capSen', b.capSen, { label: 'Charge cap' });
  const min = Number(b.minChargeSen), cap = Number(b.capSen);
  if (!fields.minChargeSen && !fields.capSen && b.minChargeSen != null && b.capSen != null && b.minChargeSen !== '' && b.capSen !== '' && cap < min) fields.capSen = 'The charge cap cannot be below the minimum charge.';
  if (Array.isArray(b.rules)) (b.rules as RuleInput[]).forEach((r, i) => {
    checkInt(fields, `rules.${i}.tierPosition`, r?.tierPosition, { label: 'Position', min: 0 });
    checkInt(fields, `rules.${i}.bracketMin`, r?.bracketMin, { label: 'Bracket min', min: 0 });
    checkInt(fields, `rules.${i}.bracketMax`, r?.bracketMax, { label: 'Bracket max', min: 0 });
    checkSen(fields, `rules.${i}.amountSen`, r?.amountSen, { label: 'Amount' });
  });
  return invalid(fields);
}

/** Insert a card's rules from the request payload (used by create + replace). */
export async function insertRules(env: Env, cardId: string, raw: unknown): Promise<void> {
  const rules = Array.isArray(raw) ? (raw as RuleInput[]) : [];
  let sort = 0;
  for (const r of rules) {
    if (!isRateRuleType(r.ruleType)) continue;
    await run(env, `INSERT INTO delivery_rate_rules (id, card_id, rule_type, tier_position, bracket_min, bracket_max, zone, amount_sen, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      genId('rr'), cardId, r.ruleType, intOrNull(r.tierPosition), intOrNull(r.bracketMin), intOrNull(r.bracketMax), strOrNull(r.zone), Math.max(0, intOrNull(r.amountSen) ?? 0), sort++);
  }
}

/** POST /api/rate-cards — create a card (+ optional rules). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit rate cards.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const name = String(b.name ?? '').trim();
  if (!name) return fail('VALIDATION', 'Enter a card name.', 422, { name: 'Enter a card name.' });
  const bad = cardFieldProblems(b); if (bad) return bad;
  const carrierCompanyId = strOrNull(b.carrierCompanyId);
  if (carrierCompanyId && !await one(env, 'SELECT 1 AS x FROM threepl_companies WHERE id = ?', carrierCompanyId)) return fail('VALIDATION', 'Unknown carrier.', 422, { carrierCompanyId: 'Unknown carrier.' });
  const id = genId('rc');
  const now = nowIso();
  await run(env, `INSERT INTO delivery_rate_cards (id, name, carrier_company_id, carrier_label, basis, aggregation, min_charge_sen, cap_sen, rounding, is_active, notes, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, carrierCompanyId, strOrNull(b.carrierLabel), isBasis(b.basis) ? b.basis : 'SET', isAggregation(b.aggregation) ? b.aggregation : 'UNIT',
    intOrNull(b.minChargeSen), intOrNull(b.capSen), isRounding(b.rounding) ? b.rounding : 'NONE', flag(b.isActive) ?? 1, strOrNull(b.notes), now, now);
  await insertRules(env, id, b.rules);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate_card.create', entityTable: 'delivery_rate_cards', entityId: id, after: { name } });
  return json({ id }, 201);
};
