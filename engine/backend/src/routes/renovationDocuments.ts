/* GET /api/renovation/:id/documents and /:id/procurement-status (below) — every transaction document of a renovation project (owner, 14 Oct 2026,
   "batch 4"; migration 0116): quotations, sales orders, POs (with their category, supplier, dates and receipt
   state), goods receipts, delivery orders, sales invoices and returns. The rule is in
   services/renovation/documents.ts. Answers { ready: false } before migration 0116 is applied; the project page
   then keeps its older Documents list. Mounted before /:id in routes/renovation.ts. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requirePageAccess } from "../middleware/auth";
import { activeCompanySql } from "../scm/lib/companyScope";
import type { Db } from "../services/renovation/load";
import { readProjectDocuments } from "../services/renovation/documents";
import { readStatusLines } from "../services/renovation/procurementStatus";
import { docFlowColumnsReady } from "../scm/routes/renovation-doc-flow";

type Ctx = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();
const db = (c: Ctx) => c.env.DB as unknown as Db;

app.get("/:id/documents", requirePageAccess("projects.list"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  try {
    const p = await db(c).prepare(`SELECT company_id::int AS company_id FROM projects WHERE id = ? AND project_kind = 'renovation'${activeCompanySql(c)}`)
      .bind(id).first<{ company_id: number }>();
    if (!p) return c.json({ error: "not_found" }, 404);
    if (!(await docFlowColumnsReady(db(c)))) return c.json({ ready: false, projectId: id });
    return c.json({ ready: true, projectId: id, ...(await readProjectDocuments(db(c), id, Number(p.company_id))) });
  } catch (e) {
    console.error("[renovation] documents read failed", e);
    return c.json({ error: "renovation_read_failed", message: "The project's documents could not be read. Try again." }, 409);
  }
});

/* GET /:id/procurement-status (owner, 15 Oct 2026): every item line of the project with whether it is ordered,
   received and delivered, and the goods receipts / delivery orders that did it. The Procurement details card counts
   them per sub-category (services/renovation/procurementStatus.ts). */
app.get("/:id/procurement-status", requirePageAccess("projects.list"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  try {
    const p = await db(c).prepare(`SELECT company_id::int AS company_id FROM projects WHERE id = ? AND project_kind = 'renovation'${activeCompanySql(c)}`)
      .bind(id).first<{ company_id: number }>();
    if (!p) return c.json({ error: "not_found" }, 404);
    if (!(await docFlowColumnsReady(db(c)))) return c.json({ ready: false, projectId: id, lines: [] });
    return c.json({ ready: true, projectId: id, lines: await readStatusLines(db(c), id, Number(p.company_id)) });
  } catch (e) {
    console.error("[renovation] procurement status read failed", e);
    return c.json({ error: "renovation_read_failed", message: "Where the goods stand could not be read. Try again." }, 409);
  }
});

export default app;
