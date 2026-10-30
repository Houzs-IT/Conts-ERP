import { type Env, all, json, mytToday } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { layoutKey } from '../../_lib/cleaningPrices';
import { hasDatedUnitPrices, hasServicePrices, serviceBook } from '../../_lib/servicePrices';
import { statementSettings } from '../../_lib/ownerStatement';
import { contractView } from '../../_lib/unitContract';
import { heldContract } from '../../_lib/datedRows';

const figures = (owner: unknown, cost: unknown) => ({ owner: owner == null ? null : Number(owner), cost: cost == null ? null : Number(cost) });

/** GET /api/units/scheduled-changes — everything waiting for its date, soonest first: units' own cleaning and maintenance
 *  prices, new contracts, and the list prices that reach every unit. Amounts for management, contracts for finance and
 *  management (the same people as see them elsewhere). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const today = mytToday();
  const dated = await hasDatedUnitPrices(env);
  const service = await hasServicePrices(env);
  const seePrices = !!session.manage, seeContracts = !!session.manage || can(session, 'finance', 'view');

  const layout = (await hasColumn(env, 'units', 'layout_type').catch(() => false)) ? 'u.layout_type' : 'NULL::text';
  const own = dated ? await all<any>(env, `
    SELECT o.unit_id, o.item_id, o.effective_from, o.owner_price, o.internal_cost, o.updated_at, by_user.full_name AS set_by,
           s.name, s.domain, s.clean_kind, u.unit_number, u.unit_code, u.bedrooms, ${layout} AS layout_type, p.name AS building, ow.display_name AS owner_name
    FROM unit_service_prices o JOIN service_items s ON s.id = o.item_id JOIN units u ON u.id = o.unit_id
    JOIN properties p ON p.id = u.property_id JOIN owners ow ON ow.id = u.owner_id LEFT JOIN users by_user ON by_user.id = o.updated_by
    WHERE o.effective_from > ?`, today) : [];
  const list = service ? await all<any>(env, `
    SELECT s.id, s.name, s.domain, s.clean_kind, s.by_layout, p.effective_from, COUNT(*)::int AS layouts, MIN(p.owner_price) AS owner_price, MIN(p.internal_cost) AS internal_cost,
           MAX(p.created_at) AS set_at, MAX(by_user.full_name) AS set_by
    FROM service_item_prices p JOIN service_items s ON s.id = p.item_id LEFT JOIN users by_user ON by_user.id = p.created_by
    WHERE p.effective_from > ? AND s.active = 1 GROUP BY s.id, s.name, s.domain, s.clean_kind, s.by_layout, p.effective_from`, today) : [];
  const book = own.length || list.length ? await serviceBook(env, [...new Set(own.map(r => String(r.unit_id)))]) : null;

  const waiting = seeContracts ? await all<any>(env, `
    SELECT c.*, u.id AS on_unit, u.unit_number, u.unit_code, u.package, p.name AS building, ow.display_name AS owner_name,
           (SELECT a.actor_label FROM audit_log a WHERE a.entity_id = c.id AND a.action LIKE 'contract.%' ORDER BY a.occurred_at DESC LIMIT 1) AS set_by
    FROM units u JOIN owner_contracts c ON c.id = u.contract_id JOIN properties p ON p.id = u.property_id JOIN owners ow ON ow.id = u.owner_id
    WHERE left(c.starts_on::text, 10) > ?`, today) : [];
  const earlier = waiting.length ? await all<any>(env, 'SELECT * FROM owner_contracts WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(waiting.map(r => r.on_unit))) : [];
  const { defaultFeePct } = waiting.length ? await statementSettings((sql, ...args) => all(env, sql, ...args)) : { defaultFeePct: 0 };

  const rows = [
    ...own.map(r => {
      const now = book!.amounts(r.item_id, r.unit_id, layoutKey(r.layout_type, r.bedrooms), today);
      return {
        id: `own:${r.unit_id}:${r.item_id}:${r.effective_from}`, kind: r.domain, scope: 'unit', unitId: r.unit_id, unitLabel: `${r.building} ${r.unit_code || r.unit_number}`, ownerName: r.owner_name,
        itemId: r.item_id, what: r.name, cleanKind: r.clean_kind, effectiveFrom: r.effective_from, setBy: r.set_by ?? null, setAt: r.updated_at,
        now: seePrices ? figures(now.owner, now.internal) : null, next: seePrices ? figures(r.owner_price, r.internal_cost) : null,
      };
    }),
    ...list.map(r => {
      const now = book!.amounts(r.id, null, 'all', today);
      return {
        id: `list:${r.id}:${r.effective_from}`, kind: r.domain, scope: 'list', unitId: null, unitLabel: 'All units', ownerName: null,
        itemId: r.id, what: r.name, cleanKind: r.clean_kind, effectiveFrom: r.effective_from, setBy: r.set_by ?? null, setAt: r.set_at,
        // A price per layout has no one figure to show.
        layouts: r.by_layout ? r.layouts : null,
        now: seePrices && !r.by_layout ? figures(now.owner, now.internal) : null, next: seePrices && !r.by_layout ? figures(r.owner_price, r.internal_cost) : null,
      };
    }),
    ...waiting.map(r => {
      const before = heldContract({ id: r.id, starts_on: r.starts_on }, earlier.filter(e => e.unit_id === r.on_unit), today);
      return {
        id: `contract:${r.on_unit}:${r.id}`, kind: 'contract', scope: 'unit', unitId: r.on_unit, unitLabel: `${r.building} ${r.unit_code || r.unit_number}`, ownerName: r.owner_name,
        itemId: null, what: 'Contract', cleanKind: null, effectiveFrom: String(r.starts_on).slice(0, 10), setBy: r.set_by ?? null, setAt: r.created_at,
        termsNow: before ? contractView(before, { package: r.package }, defaultFeePct).termsLabel : null,
        termsNext: contractView(r, { package: r.package }, defaultFeePct).termsLabel,
      };
    }),
  ].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.unitLabel.localeCompare(b.unitLabel));
  return json({ dated, mayEdit: seePrices, money: seeContracts, rows });
};
