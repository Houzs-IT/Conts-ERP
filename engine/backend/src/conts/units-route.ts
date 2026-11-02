// Conts only (not part of Houzs's code): the Property OS units, for a payment voucher's Rental lines (chew 2 Nov 2026;
// SOP 3.2; plan 2026-11-02-voucher-purpose Task 3). Mounted under /accounting, behind the Ledger guard.
//   GET /accounting/units  → { units: [{ id, building, unitNumber }] }, sorted by building then number
// Units are shared masters (public.conts_units, a read-only view over pos.units): no company column.

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;

export const listUnitsHandler = async (c: Ctx): Promise<Response> => {
  const { data, error } = await c.get('supabase').schema('public').from('conts_units').select('id, building, unit_number').limit(5000);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const units = ((data ?? []) as Array<{ id: string; building: string | null; unit_number: string | null }>)
    .map((u) => ({ id: String(u.id), building: String(u.building ?? ''), unitNumber: String(u.unit_number ?? '') }))
    .sort((a, b) => a.building.localeCompare(b.building) || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  return c.json({ units });
};
