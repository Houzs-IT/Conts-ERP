import { type Env, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees, listEmployees } from '../../_lib/hr';
import type { Employee } from '../../_lib/hrFields';
import { hasLeaves, NOT_MIGRATED, readHolidays, leavesInYear, toLeave, balancesFor, type LeaveView } from '../../_lib/leave';
import type { Balance, PublicHoliday } from '../../_lib/leaveRules';

export interface LeavePerson { employee: Pick<Employee, 'id' | 'name' | 'employeeId' | 'cleanerId' | 'technicianId' | 'joinDate'>; balances: Balance[] }
export interface LeavesPayload { year: number; today: string; people: LeavePerson[]; leaves: (LeaveView & { name: string })[]; holidays: PublicHoliday[] }

/** GET /api/leaves?year=YYYY — HR > Workers > Leave: every request in the year (and every pending one), each
 *  in-house person's annual and medical balance, and the public holiday list. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Leave is kept by the office.', 403);
  if (!(await hasEmployees(env)) || !(await hasLeaves(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);

  const today = mytToday();
  const asked = Number(new URL(request.url).searchParams.get('year'));
  const year = Number.isInteger(asked) && asked >= 2020 && asked <= 2100 ? asked : Number(today.slice(0, 4));
  const [everyone, rows, holidays] = await Promise.all([listEmployees(env), leavesInYear(env, year), readHolidays(env)]);
  const leaves = rows.map(r => toLeave(r, holidays));
  const nameOf = new Map(everyone.filter(e => e.id).map(e => [e.id, e.name]));

  const people: LeavePerson[] = everyone
    .filter(e => (e.isActive && e.status === 'active') || (e.id && leaves.some(l => l.employeeId === e.id)))
    .map(e => ({
      employee: { id: e.id, name: e.name, employeeId: e.employeeId, cleanerId: e.cleanerId, technicianId: e.technicianId, joinDate: e.joinDate },
      balances: balancesFor(e, leaves.filter(l => l.employeeId === e.id), year, holidays, today),
    }));
  const payload: LeavesPayload = {
    year, today, people, holidays,
    leaves: leaves.map(l => ({ ...l, name: nameOf.get(l.employeeId) ?? 'Unknown' })),
  };
  return json(payload);
};
