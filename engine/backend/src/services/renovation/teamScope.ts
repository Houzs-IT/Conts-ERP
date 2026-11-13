/* Dream Crafter project visibility (feedback list, 11 Nov 2026). A renovation project belongs to everyone who handles
   one of its steps: Measure, 3D, 2D, Carpentry, Site PIC, PO (the Beta board's STEPS, renovationBetaBoard.ts). A person
   sees their own projects plus those of everyone who reports to them, at any depth (System > Users > Reports to,
   read through public.conts_staff.manager_id, migration-pg 0299). Before 0299 the view has no manager_id, so the
   reporting line reads as empty and a person sees only their own projects. */

import { calendarMePersonIds } from "./calendarItems";
import type { Db } from "./load";

/** The project_people ids of the caller and of everyone under them in the reporting line. */
export async function teamPersonIds(db: Db, userId: number | null | undefined, email: string | null | undefined): Promise<number[]> {
  if (!email) return calendarMePersonIds(db, userId, email);
  try {
    // UNION (not UNION ALL) drops rows already seen, so a reporting loop ends instead of recursing forever.
    const rows = (await db.prepare(
      `WITH RECURSIVE team AS (
         SELECT s.id::text AS id FROM conts_staff s WHERE lower(s.email) = lower(?)
         UNION
         SELECT s.id::text FROM conts_staff s JOIN team t ON to_jsonb(s)->>'manager_id' = t.id
       )
       SELECT pp.id::int AS id FROM project_people pp WHERE pp.user_id = ? OR pp.pos_user_id IN (SELECT id FROM team)`,
    ).bind(email, userId ?? 0).all<{ id: number }>()).results ?? [];
    return [...new Set(rows.map((r) => Number(r.id)))];
  } catch {
    // No conts_staff view (before migration 0113): the caller's own people, as the calendar finds them.
    return calendarMePersonIds(db, userId, email);
  }
}

/** A WHERE fragment on `projects p`: one of these people handles a step of the project. The ids are inlined (integers
    only) so the fragment can join the board's scope, which every one of its queries reuses without binds. */
export function teamProjectSql(ids: readonly number[]): string {
  const list = ids.filter((id) => Number.isSafeInteger(id)).join(",");
  if (!list) return "FALSE";
  return `(p.designer_person_id IN (${list}) OR p.reno_pic_person_id IN (${list})
    OR EXISTS (SELECT 1 FROM project_beta_design tsd WHERE tsd.project_id = p.id
      AND (tsd.person_3d_ids && ARRAY[${list}]::bigint[] OR tsd.person_2d_ids && ARRAY[${list}]::bigint[]
           OR tsd.person_3d_id IN (${list}) OR tsd.person_2d_id IN (${list})))
    OR EXISTS (SELECT 1 FROM project_beta_appointments tsa WHERE tsa.project_id = p.id AND tsa.person_id IN (${list}))
    OR EXISTS (SELECT 1 FROM project_design_records tsr WHERE tsr.project_id = p.id AND tsr.kind = 'site_measure'
      AND (tsr.person_id IN (${list}) OR EXISTS (SELECT 1 FROM project_design_record_people tsp WHERE tsp.record_id = tsr.id AND tsp.person_id IN (${list})))))`;
}
