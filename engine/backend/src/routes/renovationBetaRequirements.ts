import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess } from "../middleware/auth";
import { activeCompanySql } from "../scm/lib/companyScope";
import type { Db } from "../services/renovation/load";
import { loadCategoryScope } from "../services/categoryAccess";
import {
  BOARD_CATEGORY_CODES, REQUIREMENT_LINE_LIMIT, buildRequirementBoard, type RequirementLineRow, type RequirementProjectRow,
} from "../services/renovation/requirementBoard";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();

const db = (c: Ctx): Db => c.env.DB as unknown as Db;

const BOARD_CATEGORY_LIST = BOARD_CATEGORY_CODES.map((code) => `'${code}'`).join(", ");

const LIVE_RENOVATION_PROJECTS = (companyScope: string): string =>
  `p.project_kind = 'renovation' AND p.archived_at IS NULL${companyScope}`;

const PROJECTS_SQL = (companyScope: string): string =>
  `SELECT p.id::int AS project_id, p.code AS project_code, p.name AS project_name, p.brand
     FROM projects p
    WHERE ${LIVE_RENOVATION_PROJECTS(companyScope)}
    ORDER BY p.code`;

const LINES_SQL = (companyScope: string): string =>
  `SELECT i.id::text AS id, p.id::int AS project_id, i.item_code, i.description, i.remark, i.qty, i.uom,
          coalesce(nullif(trim(to_jsonb(i)->>'room'), ''), nullif(trim((SELECT l.room FROM scm.reno_doc_lines l WHERE l.so_item_id = i.id LIMIT 1)), ''), nullif(trim(i.location), '')) AS room,
          cg.code AS cat_code, sc.code AS sub_code,
          EXISTS (SELECT 1 FROM scm.purchase_order_items pi JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id
                   WHERE pi.so_item_id = i.id AND po.status::text <> 'CANCELLED') AS is_on_po
     FROM scm.mfg_sales_order_items i
     JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
     JOIN projects p ON p.id = so.project_id
     LEFT JOIN LATERAL (SELECT pr.category_group, pr.sub_category FROM scm.mfg_products pr
                         WHERE pr.code = i.item_code AND pr.company_id = so.company_id ORDER BY (pr.status::text = 'ACTIVE') DESC LIMIT 1) prod ON true
     JOIN scm.product_category_groups cg ON cg.code = prod.category_group
     LEFT JOIN scm.product_sub_categories sc ON sc.group_code = cg.code AND sc.code = prod.sub_category
    WHERE ${LIVE_RENOVATION_PROJECTS(companyScope)} AND so.status::text <> 'CANCELLED'
      AND NOT coalesce(i.cancelled, false) AND cg.code IN (${BOARD_CATEGORY_LIST})
    ORDER BY p.code, so.so_date NULLS LAST, i.doc_no, i.line_no NULLS LAST
    LIMIT ${REQUIREMENT_LINE_LIMIT}`;

app.get("/requirements", requirePageAccess("projects.list"), async (c) => {
  try {
    const companyScope = activeCompanySql(c, "p.company_id");
    const [projects, lines, scope] = await Promise.all([
      db(c).prepare(PROJECTS_SQL(companyScope)).all<RequirementProjectRow>(),
      db(c).prepare(LINES_SQL(companyScope)).all<RequirementLineRow>(),
      loadCategoryScope(db(c), c.get("user")),
    ]);
    return c.json(buildRequirementBoard(projects.results ?? [], lines.results ?? [], scope));
  } catch (error) {
    console.error("[renovation-beta] requirement board read failed", error);
    return c.json({ error: "renovation_read_failed", message: "The renovation lines could not be read. Try again." }, 500);
  }
});

export default app;
