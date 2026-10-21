// Conts only (not part of Houzs's code): "Post now" for a payment voucher (finance phase 1, spec 3.6, 21 Oct 2026).
//
// Houzs walks every voucher through prepare -> check -> approve (approve posts the GL), one button each. Conts's
// finance often does all three alone, so a person holding all three keys may do them in one request. Nothing is
// skipped: each step goes through its own door, with its own rules and its own who-and-when stamp; a step already
// done is not done again. The first refusal is returned as it is, and stops the rest.
import type { Context } from "hono";
import {
  approvePaymentVoucherHandler, checkPaymentVoucherHandler, submitPaymentVoucherHandler,
} from "../scm/routes/payment-vouchers";
import { hasHouzsPerm } from "../scm/lib/houzs-perms";

const KEYS = ["scm.payment_voucher.write", "scm.payment_voucher.check", "scm.payment_voucher.approve"] as const;

type Marks = { submitted_at?: string | null; checked_at?: string | null };

/** POST /payment-vouchers/:id/post-now — prepare, check, approve and post, skipping the steps already done. */
export async function postNowHandler(c: Context): Promise<Response> {
  if (!KEYS.every((k) => hasHouzsPerm(c, k))) {
    return c.json({ error: "Post now needs the prepare, check and approve permissions together." }, 403);
  }
  const sb = c.get("supabase" as never) as { from: (t: string) => any };
  const marks = async (): Promise<Marks | null> => {
    const { data } = await sb.from("payment_vouchers").select("submitted_at, checked_at")
      .eq("id", c.req.param("id")).maybeSingle();
    return (data as Marks | null) ?? null;
  };
  // Each door loads the voucher itself, scoped to the company; this read only decides which doors to skip.
  const first = await marks();
  if (!first?.submitted_at) {
    const r = await submitPaymentVoucherHandler(c);
    if (!r.ok) return r;
  }
  if (!first?.checked_at) {
    const r = await checkPaymentVoucherHandler(c);
    if (!r.ok) return r;
  }
  return approvePaymentVoucherHandler(c);
}
