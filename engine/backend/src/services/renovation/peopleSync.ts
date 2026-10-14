/* People come from the company's user accounts (owner, 14 Oct 2026: "no separate contact maintenance").

   project_people stays the table every project row points at. Each Property OS staff account (the view
   public.conts_staff, migration 0113) gets one row here, linked by pos_user_id, and that row follows the
   account's name and active state. Rows not linked to an account (the people imported from Notion) keep
   their name on old records but are no longer offered in the pickers.

   An unlinked person is linked to an account only when the names are exactly equal ignoring case and spacing,
   and only one person and one account carry that name; anything else gets a new row, so nobody's history is
   silently merged into the wrong account. */

import type { Db } from "./load";

export interface StaffRow { id: string; name: string; email: string; department: string | null; position: string | null; active: boolean }
export interface SyncPersonRow { id: number; name: string; active: boolean; pos_user_id: string | null }

export type SyncOp =
  | { kind: "insert"; userId: string; name: string; active: boolean }
  | { kind: "link"; personId: number; userId: string; name: string; active: boolean }
  | { kind: "refresh"; personId: number; name: string; active: boolean };

const tidy = (s: string | null | undefined) => String(s ?? "").trim().replace(/\s+/g, " ");
const key = (s: string) => tidy(s).toLowerCase();

export function planPeopleSync(staff: readonly StaffRow[], people: readonly SyncPersonRow[]): SyncOp[] {
  const ops: SyncOp[] = [];
  const linked = new Map(people.filter((p) => p.pos_user_id).map((p) => [p.pos_user_id!, p]));
  const countBy = <T>(list: readonly T[], k: (x: T) => string) => list.reduce((m, x) => m.set(k(x), (m.get(k(x)) ?? 0) + 1), new Map<string, number>());
  const unlinked = people.filter((p) => !p.pos_user_id);
  const unlinkedNames = countBy(unlinked, (p) => key(p.name));
  const staffNames = countBy(staff.filter((s) => !linked.has(s.id)), (s) => key(s.name));

  for (const s of staff) {
    const name = tidy(s.name) || tidy(s.email);
    const mine = linked.get(s.id);
    if (mine) {
      if (mine.name !== name || mine.active !== s.active) ops.push({ kind: "refresh", personId: mine.id, name, active: s.active });
      continue;
    }
    const k = key(s.name);
    const match = k && unlinkedNames.get(k) === 1 && staffNames.get(k) === 1 ? unlinked.find((p) => key(p.name) === k) : undefined;
    ops.push(match ? { kind: "link", personId: match.id, userId: s.id, name, active: s.active } : { kind: "insert", userId: s.id, name, active: s.active });
  }

  const present = new Set(staff.map((s) => s.id));
  for (const p of people) {
    if (p.pos_user_id && !present.has(p.pos_user_id) && p.active) ops.push({ kind: "refresh", personId: p.id, name: p.name, active: false });
  }
  return ops;
}

/** "Name · Position · Department", skipping what is not set. */
export function personLabelOf(p: { name: string; position?: string | null; department?: string | null }): string {
  return [p.name, p.position, p.department].map(tidy).filter(Boolean).join(" · ");
}

/** Whether the staff view of migration 0113 is there to read. */
export async function staffViewReady(db: Db): Promise<boolean> {
  const r = await db.prepare(`SELECT to_regclass('public.conts_staff') IS NOT NULL AS ready`).first<{ ready: boolean }>();
  return !!r?.ready;
}

/** Brings the company's people in line with the user accounts. False (and no writes) before migration 0113. */
export async function syncPeopleFromUsers(db: Db, companyId: number): Promise<boolean> {
  if (!(await staffViewReady(db))) return false;
  const staff = (await db.prepare(`SELECT id, full_name AS name, email, department, position, active FROM conts_staff`).all<StaffRow>()).results ?? [];
  const people = (await db.prepare(
    `SELECT id::int AS id, name, active, pos_user_id FROM project_people WHERE company_id = ? ORDER BY id`,
  ).bind(companyId).all<SyncPersonRow>()).results ?? [];
  for (const op of planPeopleSync(staff, people)) {
    if (op.kind === "insert") {
      // Two pickers opening at once may both insert; the unique index keeps one.
      await db.prepare(
        `INSERT INTO project_people (company_id, name, active, pos_user_id) VALUES (?, ?, ?, ?)
         ON CONFLICT (company_id, pos_user_id) WHERE pos_user_id IS NOT NULL DO NOTHING`,
      ).bind(companyId, op.name, op.active, op.userId).run();
    } else if (op.kind === "link") {
      await db.prepare(
        `UPDATE project_people SET pos_user_id = ?, name = ?, active = ?, updated_at = now() WHERE id = ? AND company_id = ? AND pos_user_id IS NULL`,
      ).bind(op.userId, op.name, op.active, op.personId, companyId).run();
    } else {
      await db.prepare(`UPDATE project_people SET name = ?, active = ?, updated_at = now() WHERE id = ? AND company_id = ?`)
        .bind(op.name, op.active, op.personId, companyId).run();
    }
  }
  return true;
}
