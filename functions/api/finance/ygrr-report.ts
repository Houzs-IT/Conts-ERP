import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { loadInputs, computeMonthsWithYearToDate, statementSettings, unitForMonth, type Query } from '../../_lib/ownerStatement';
import { monthEndExclusive } from '../../_lib/revenue';
import type { YgrrPayload, YgrrRow } from '../../../src/lib/ygrrReport';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const shiftMonth = (month: string, by: number): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  const index = year * 12 + monthNumber - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'This report is available to finance and management.', 403);
  const thisMonth = todayMyt().slice(0, 7);
  const month = new URL(request.url).searchParams.get('month') || thisMonth;
  if (!MONTH.test(month) || month < '2020-01' || month > thisMonth) return fail('VALIDATION', `Choose a month from 2020-01 to ${thisMonth}.`, 422);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));

  const query: Query = (sql, ...args) => all(env, sql, ...args);
  const settings = await statementSettings(query);
  const inputs = await loadInputs(query, `${months[0]}-01`, monthEndExclusive(month));
  const computed = await computeMonthsWithYearToDate(query, inputs, months, settings);
  const unitById = new Map(inputs.units.map(unit => [unit.id, unit]));
  const shareOf = new Map<string, number>();
  for (const [computedMonth, unitMonths] of computed) for (const unitMonth of unitMonths) shareOf.set(`${unitMonth.unitId}|${computedMonth}`, unitMonth.ownerShare);

  const rows: YgrrRow[] = [];
  for (const unitMonth of computed.get(month) ?? []) {
    const { yearly } = unitMonth;
    if (unitMonth.terms.model !== 'management_yearly_guarantee' || !yearly) continue;
    const unit = unitById.get(unitMonth.unitId);
    if (!unit) continue;
    const contractId = unitForMonth(unit, month).contract_id;
    const shares = months
      .filter(m => m >= yearly.yearFrom && m <= month && unitForMonth(unit, m).contract_id === contractId)
      .map(m => ({ month: m, ownerShare: shareOf.get(`${unit.id}|${m}`) ?? 0 }));
    rows.push({
      unitId: unit.id, building: unit.property_name, number: unit.unit_number, owner: unit.owner_name,
      ownerPct: unitMonth.terms.ownerPct ?? 0, annual: yearly.annual, due: yearly.due,
      yearFrom: yearly.yearFrom, yearTo: yearly.yearTo, shares, topUp: yearly.trueUp ? unitMonth.topUp : 0,
    });
  }
  rows.sort((a, b) => a.building.localeCompare(b.building) || a.number.localeCompare(b.number, 'en', { numeric: true }));
  const payload: YgrrPayload = { month, months, rows };
  return json(payload);
};
