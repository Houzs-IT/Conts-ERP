import { createMiddleware } from "hono/factory";
import type { Env, Variables } from "../env";
import { seesProcurement } from "../../lib/procurement-visible";

type Ctx = { get(key: "seesProcurement"): boolean | undefined };

/* Mounted on the whole /api/scm tree ahead of every router, because each router's supabaseAuth swaps `user` for the
   shared scm.staff identity and page_access is lost after that. */
export const procurementFlag = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  if (c.get("seesProcurement") === undefined) c.set("seesProcurement", seesProcurement(c.get("user")));
  await next();
});

/** True only when the flag was worked out and says no; unset means visible. */
export const procurementHidden = (c: Ctx): boolean => c.get("seesProcurement") === false;

export const PROCUREMENT_HIDDEN_MESSAGE = "Purchase documents are not available to your account.";

/** Refuses a whole purchase-side endpoint for a caller who must not see procurement. */
export const requireProcurementVisible = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  if (procurementHidden(c)) return c.json({ error: "forbidden", message: PROCUREMENT_HIDDEN_MESSAGE }, 403);
  await next();
});
