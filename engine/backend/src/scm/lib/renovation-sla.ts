/* Package template SLA (owner, 19 Nov 2026): a sales order line that came from a template carries how many days after
   the project starts it is processed and delivered (reno_doc_lines.processing_after_days / delivery_after_days). Once the
   project is started (projects.works_started_on, the Start project button), those days become the line plan's processing
   and delivery dates, marked from_sla. A plan date typed by hand clears the mark (betaLines.saveLinePlan), and such a
   line is never re-dated; a line still on its SLA follows the start date when it moves. One statement, so the start
   route, an applied variation order and a converted quotation all date their lines the same way. */

import type { RenoDb } from './renovation-db';

/** $1 = the project id. Returns one row per line plan written. */
export const FILL_SLA_DATES_SQL = `
  with p as (
    select id, company_id, works_started_on as d from public.projects where id = $1 and works_started_on is not null
  ), lines as (
    select l.so_item_id, l.processing_after_days as pa, l.delivery_after_days as da, p.d, p.company_id
      from p
      join scm.mfg_sales_orders o on o.project_id = p.id and o.so_kind = 'RENOVATION' and o.status::text <> 'CANCELLED'
      join scm.reno_doc_sections s on s.so_doc_no = o.doc_no
      join scm.reno_doc_lines l on l.section_id = s.id
      join scm.mfg_sales_order_items i on i.id = l.so_item_id
     where l.so_item_id is not null and not coalesce(i.cancelled, false)
       and (l.processing_after_days is not null or l.delivery_after_days is not null)
  )
  insert into scm.reno_beta_line_plans (so_item_id, company_id, order_on, deliver_on, from_sla, updated_at)
  select so_item_id, company_id, d + pa, d + da, true, now() from lines
  on conflict (so_item_id) do update
     set order_on = coalesce(excluded.order_on, scm.reno_beta_line_plans.order_on),
         deliver_on = coalesce(excluded.deliver_on, scm.reno_beta_line_plans.deliver_on),
         from_sla = true, updated_at = now()
   where scm.reno_beta_line_plans.from_sla
      or (scm.reno_beta_line_plans.order_on is null and scm.reno_beta_line_plans.deliver_on is null)
  returning so_item_id`;


/** Dates the project's SLA lines, when it is started; 0 when it is not (or has no such line). */
export async function fillSlaDates(db: RenoDb, projectId: number | null | undefined): Promise<number> {
  if (projectId == null) return 0;
  const rows = await db.q<{ so_item_id: string }>(FILL_SLA_DATES_SQL, [projectId]);
  return rows.length;
}
