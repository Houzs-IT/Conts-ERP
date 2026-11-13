import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess } from "../middleware/auth";
import { activeCompanySql } from "../scm/lib/companyScope";
import { todayMyt } from "../scm/lib/my-time";
import type { Db } from "../services/renovation/load";
import { MEDIA_ACTION } from "../services/renovation/betaMedia";
import { SITE_TASK_LIMIT, buildSiteTaskBoard, type SiteTaskRow } from "../services/renovation/siteTaskBoard";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx): Db => c.env.DB as unknown as Db;

const SITE_TASKS_SQL = (companyScope: string): string =>
  `SELECT t.id::int AS id, t.project_id::int AS project_id, p.code AS project_code, p.name AS project_name, p.building, p.unit_no, p.brand,
          t.label, t.fulfilment_kind, t.state, sup.name AS supplier_name,
          (SELECT json_agg(json_build_object('id', pp.id::int, 'name', pp.name) ORDER BY pp.name)
             FROM project_trade_task_assignees a JOIN project_people pp ON pp.id = a.person_id WHERE a.task_id = t.id) AS crew,
          t.planned_start::text AS planned_start, t.planned_end::text AS planned_end,
          t.actual_start::text AS actual_start, t.actual_end::text AS actual_end,
          (EXISTS (SELECT 1 FROM project_trade_task_lines l WHERE l.task_id = t.id AND l.purchase_order_item_id IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM project_trade_task_lines l JOIN scm.purchase_order_items poi ON poi.id = l.purchase_order_item_id
                             WHERE l.task_id = t.id AND poi.received_qty < poi.qty)) AS po_fully_received,
          photo.last_at AS last_photo_at
     FROM project_trade_tasks t
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN scm.suppliers sup ON sup.id = t.supplier_id
     LEFT JOIN (SELECT from_value, replace(max(created_at), ' ', 'T') || 'Z' AS last_at FROM project_activity
                 WHERE action = ? AND from_value LIKE 'task:%' AND archived_at IS NULL GROUP BY from_value) photo
            ON photo.from_value = 'task:' || t.id
    WHERE p.project_kind = 'renovation' AND p.archived_at IS NULL${companyScope}
    ORDER BY (t.state IN ('done', 'skipped')), coalesce(t.planned_start, t.planned_end) NULLS LAST, p.code, t.seq
    LIMIT ${SITE_TASK_LIMIT}`;

app.get("/site-tasks", requirePageAccess("projects.list"), async (c) => {
  try {
    const result = await db(c).prepare(SITE_TASKS_SQL(activeCompanySql(c, "p.company_id"))).bind(MEDIA_ACTION).all<SiteTaskRow>();
    return c.json(buildSiteTaskBoard(result.results ?? [], todayMyt()));
  } catch (error) {
    console.error("[renovation-beta] site task board read failed", error);
    return c.json({ error: "renovation_read_failed", message: "The site tasks could not be read. Try again." }, 500);
  }
});

export default app;
