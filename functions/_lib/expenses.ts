import { type Env, one } from './db';

export const EXPENSE_CATEGORIES = ['internet', 'electricity', 'water', 'cleaning', 'housekeeping', 'maintenance', 'utilities', 'consumables', 'furniture', 'management_fee', 'channel_fee', 'other'];
export const CHARGE_TO = ['owner', 'guest_deposit', 'the_conts', 'warranty'];

/** SQL: true when an owner statement covering this expense's date has been finalised, sent or paid.
 *  Alias `e` is the expense and `u` its unit. */
export const LOCKED_SQL = `EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = u.owner_id AND s.state IN ('finalised','sent','paid')
   AND e.incurred_on >= s.period_start AND e.incurred_on <= s.period_end)`;

/** Is a new or changed expense on this unit and date inside a statement that is already final? */
export async function isPeriodLocked(env: Env, unitId: string, date: string): Promise<boolean> {
  const row = await one(env, `
    SELECT 1 AS x FROM owner_statements s JOIN units u ON u.owner_id = s.owner_id
    WHERE u.id = ? AND s.state IN ('finalised','sent','paid') AND ? >= s.period_start AND ? <= s.period_end LIMIT 1`, unitId, date, date);
  return !!row;
}
