/* The client's read-only Client PO page (owner, 24 Oct 2026): GET /api/public/beta-client/:token, no login.
   The signed token (services/renovation/betaClientLink.ts) is the only credential; the project and company are read off
   it, never from the request, and the project is re-checked against that company. A wrong, altered or expired token
   answers the same 404. Minimum data: company name, project name, and the client-buy items without prices, suppliers,
   staff or photos. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { checkRateLimit, clientIp } from "../middleware/rateLimit";
import { readClientLink } from "../services/renovation/betaClientLink";
import { clientView, loadClientItems, loadProjectVos } from "../services/renovation/betaVoPo";
import type { Db } from "../services/renovation/load";

type Ctx = Context<{ Bindings: Env }>;
export const renovationBetaClientPublic = new Hono<{ Bindings: Env }>();

const unknownLink = (c: Ctx): Response =>
  c.json({ error: "unknown_link", message: "This link is not valid or has expired. Please ask us for a new one." }, 404);

renovationBetaClientPublic.get("/:token", async (c) => {
  const limited = await checkRateLimit(c, "beta_client_read", clientIp(c), 120, 900);
  if (limited) return limited;
  const secret = (c.env as unknown as { CONTS_SSO_SECRET?: string }).CONTS_SSO_SECRET;
  if (!secret) return unknownLink(c);
  const claim = await readClientLink(secret, c.req.param("token") ?? "");
  if (!claim) return unknownLink(c);
  const db = c.env.DB as unknown as Db;
  const p = await db.prepare(
    `SELECT p.name, (SELECT co.name FROM companies co WHERE co.id = p.company_id) AS company_name
       FROM projects p WHERE p.id = ? AND p.company_id = ? AND p.project_kind = 'renovation'`,
  ).bind(claim.projectId, claim.companyId).first<{ name: string; company_name: string | null }>();
  if (!p) return unknownLink(c);
  try {
    const vo = await loadProjectVos(db, claim.projectId, claim.companyId, false);
    const { items } = await loadClientItems(db, claim.projectId, claim.companyId, vo.vos);
    return c.json({ company: p.company_name, project: p.name, expiresAt: new Date(claim.expiresAt).toISOString(), items: clientView(items) });
  } catch (e) {
    console.error("[beta-client] read failed", e);
    return c.json({ error: "read_failed", message: "The list could not be read. Try again later." }, 503);
  }
});
