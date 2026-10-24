/* The client's read-only Client PO page (owner, 24 Oct 2026): GET /api/public/beta-client/:token, no login.
   The signed token (services/renovation/betaClientLink.ts) is the only credential; the project and company are read off
   it, never from the request, and the project is re-checked against that company. A wrong, altered or expired token
   answers the same 404. Minimum data: company name, project name, and the client-buy items without prices, suppliers
   or staff, each with references to its photos (the order line's and the SKU's).

   GET /:token/photos/:ref[?thumb=1] streams one of those photos. The reference is a hash of the storage key
   (betaVoPo.ts photoRef); it is resolved again against the client items of the token's own project, so only a photo
   that the link itself lists can be served, never another project's file, and no storage key or document number is
   ever in the link. */

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { checkRateLimit, clientIp } from "../middleware/rateLimit";
import { readClientLink, type LinkClaim } from "../services/renovation/betaClientLink";
import { clientPhotoIndex, clientView, loadClientItems, loadProjectVos } from "../services/renovation/betaVoPo";
import type { Db } from "../services/renovation/load";
import { thumbKeyFor } from "../services/photoThumbs";

type Ctx = Context<{ Bindings: Env }>;
export const renovationBetaClientPublic = new Hono<{ Bindings: Env }>();

const unknownLink = (c: Ctx): Response =>
  c.json({ error: "unknown_link", message: "This link is not valid or has expired. Please ask us for a new one." }, 404);

const REF = /^[0-9a-f]{24}$/;

/** The token's claim and project, or null when either is not genuine. */
async function linkProject(c: Ctx): Promise<{ claim: LinkClaim; p: { name: string; company_name: string | null } } | null> {
  const secret = (c.env as unknown as { CONTS_SSO_SECRET?: string }).CONTS_SSO_SECRET;
  if (!secret) return null;
  const claim = await readClientLink(secret, c.req.param("token") ?? "");
  if (!claim) return null;
  const p = await (c.env.DB as unknown as Db).prepare(
    `SELECT p.name, (SELECT co.name FROM companies co WHERE co.id = p.company_id) AS company_name
       FROM projects p WHERE p.id = ? AND p.company_id = ? AND p.project_kind = 'renovation'`,
  ).bind(claim.projectId, claim.companyId).first<{ name: string; company_name: string | null }>();
  return p ? { claim, p } : null;
}

renovationBetaClientPublic.get("/:token", async (c) => {
  const limited = await checkRateLimit(c, "beta_client_read", clientIp(c), 120, 900);
  if (limited) return limited;
  const link = await linkProject(c);
  if (!link) return unknownLink(c);
  const { claim, p } = link;
  const db = c.env.DB as unknown as Db;
  try {
    const vo = await loadProjectVos(db, claim.projectId, claim.companyId, false);
    const { items } = await loadClientItems(db, claim.projectId, claim.companyId, vo.vos);
    return c.json({ company: p.company_name, project: p.name, expiresAt: new Date(claim.expiresAt).toISOString(), items: await clientView(items) });
  } catch (e) {
    console.error("[beta-client] read failed", e);
    return c.json({ error: "read_failed", message: "The list could not be read. Try again later." }, 503);
  }
});

renovationBetaClientPublic.get("/:token/photos/:ref", async (c) => {
  // No KV rate limit here: a page of thumbnails would spend one KV write per photo (the free plan allows 1,000 a day),
  // and nothing reaches the database before the token's signature checks out, which only a genuine link passes.
  const ref = c.req.param("ref") ?? "";
  if (!REF.test(ref)) return c.json({ error: "not_found" }, 404);
  const link = await linkProject(c);
  if (!link) return unknownLink(c);
  if (!c.env.SO_ITEM_PHOTOS) return c.json({ error: "not_found" }, 404);
  let target;
  try {
    // Only items already on the SO carry photos, so the VOs are not read here.
    const { items } = await loadClientItems(c.env.DB as unknown as Db, link.claim.projectId, link.claim.companyId);
    target = (await clientPhotoIndex(items)).get(ref);
  } catch (e) {
    console.error("[beta-client] photo lookup failed", e);
    return c.json({ error: "read_failed" }, 503);
  }
  if (!target) return c.json({ error: "not_found" }, 404);
  // A thumb is asked for by the listed key; an older photo has none, and then the full photo is the answer.
  const wantThumb = c.req.query("thumb") === "1";
  const thumb = wantThumb ? (target.thumbKey ?? thumbKeyFor(target.key)) : null;
  const obj = (thumb ? await c.env.SO_ITEM_PHOTOS.get(thumb) : null) ?? await c.env.SO_ITEM_PHOTOS.get(target.key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  // Served on the app's own origin without a login, so nothing but a picture goes out.
  const type = (obj.httpMetadata?.contentType ?? "").toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": type,
      // Keys name one fixed object, but a link can expire, so the browser keeps it a day, not for ever.
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
});
