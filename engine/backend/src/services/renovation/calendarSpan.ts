/* Renovation projects on the original Projects calendar (owner, 14 Oct 2026).
   A renovation project has no start / end date, so its bar is computed when the
   calendar is read (nothing is stored): from its created date (Malaysia time) to
   the planned handover; without one, the actual handover; then the SLA due date
   (created + the project type's sla_days, read only if that column exists); else
   RENO_ESTIMATE_DAYS after the start, flagged as an estimate. Exhibition projects
   keep their own start / end dates and never come through here. */

import type { Db } from "./load";

export const RENO_ESTIMATE_DAYS = 45;
export type EndBasis = "planned_handover" | "handed_over" | "sla" | "estimate";
export interface CalendarSpan { start: string; end: string; endBasis: EndBasis; endEstimated: boolean }

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A timestamp's calendar day in Malaysia (UTC+8); a bare YYYY-MM-DD stays as it is. */
function mytDay(x: string | null): string | null {
  if (!x) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const ms = Date.parse(x);
  return Number.isNaN(ms) ? null : isoDay(ms + 8 * 3600e3);
}

export function renovationCalendarSpan(r: { createdAt: string | null; plannedHandover: string | null; handedOverAt: string | null; slaDays: number | null }): CalendarSpan | null {
  const start = mytDay(r.createdAt);
  if (!start) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const planned = mytDay(r.plannedHandover?.slice(0, 10) ?? null);
  const handed = mytDay(r.handedOverAt);
  let end: string;
  let endBasis: EndBasis;
  if (planned) { end = planned; endBasis = "planned_handover"; }
  else if (handed) { end = handed; endBasis = "handed_over"; }
  else if (r.slaDays && r.slaDays > 0) { end = isoDay(startMs + r.slaDays * DAY); endBasis = "sla"; }
  else { end = isoDay(startMs + RENO_ESTIMATE_DAYS * DAY); endBasis = "estimate"; }
  if (end < start) end = start;
  return { start, end, endBasis, endEstimated: endBasis === "estimate" };
}

export function spanOverlaps(s: { start: string; end: string }, from: string, to: string): boolean {
  return s.start <= to.slice(0, 10) && s.end >= from.slice(0, 10);
}

/** Calendar rows for renovation projects without dates, overlapping [from, to]. `scopeWhere` / `coSql` are the
    calendar route's own fragments (alias p) and `scopeBinds` their binds. */
export async function renovationCalendarRows(db: Db, from: string, to: string, scopeWhere: string, scopeBinds: unknown[], coSql: string) {
  const res = await db.prepare(
    `SELECT p.id, p.code, p.name, p.stage, p.status, p.brand, p.organizer, p.venue, p.state, NULL AS event_type_name,
            p.created_at::text AS created_at, p.planned_handover_date::text AS planned_handover_date, p.handed_over_at::text AS handed_over_at,
            to_jsonb(pt)->>'sla_days' AS sla_days
       FROM projects p LEFT JOIN project_types pt ON pt.id = p.project_type_id
      WHERE p.archived_at IS NULL AND p.start_date IS NULL
        AND coalesce(to_jsonb(p)->>'project_kind', 'exhibition') = 'renovation'
        AND substr(p.created_at::text, 1, 10) <= substr(?, 1, 10)${scopeWhere}${coSql}`,
  ).bind(to, ...scopeBinds).all<{
    id: number; code: string; name: string; stage: string; status: string | null; brand: string | null; organizer: string | null;
    venue: string | null; state: string | null; event_type_name: null; created_at: string | null; planned_handover_date: string | null;
    handed_over_at: string | null; sla_days: string | null;
  }>();
  const out = [];
  for (const r of res.results ?? []) {
    const span = renovationCalendarSpan({ createdAt: r.created_at, plannedHandover: r.planned_handover_date, handedOverAt: r.handed_over_at, slaDays: r.sla_days == null ? null : Number(r.sla_days) });
    if (!span || !spanOverlaps(span, from, to)) continue;
    const { created_at: _c, planned_handover_date: _p, handed_over_at: _h, sla_days: _s, ...rest } = r;
    out.push({ ...rest, start_date: span.start, end_date: span.end, end_basis: span.endBasis, end_estimated: span.endEstimated, active_section_name: null, sections_total: 0 });
  }
  return out;
}
