// Conts only (not part of Houzs's code): "Post now" for a payment voucher (finance phase 1, spec 3.6, 21 Oct 2026).
//
// Houzs walks every voucher through prepare -> check -> approve (approve posts the GL), one button each. Conts's
// finance often does all three alone, so a person holding all three keys may do them in one request. Nothing is
// skipped: each step goes through its own door, with its own rules and its own who-and-when stamp; a step already
// done is not done again. The first refusal is returned as it is, and stops the rest.
//
// The refusals that can be known before the first step are asked first, so they change nothing: a refused one-step
// action must not leave an approval that never posted, a formal number used up, or money reserved on Daily Bank.
import type { Context } from "hono";
import {
  approvePaymentVoucherHandler, checkPaymentVoucherHandler, submitPaymentVoucherHandler,
} from "../scm/routes/payment-vouchers";
import { hasHouzsPerm } from "../scm/lib/houzs-perms";
import { NOT_THIS_COMPANY, requireActiveCompanyId, scopeToCompanyId } from "../scm/lib/companyScope";
import { beforeLedgerStartMessage, isBeforeLedgerStart, loadLedgerSettings } from "../acc/ledger-settings";
import { resolveRoles } from "../acc/rules";

/** The Supabase client the auth middleware puts on the context; the engine's own helpers take it untyped. */
type Db = Parameters<typeof loadLedgerSettings>[0];
type Ctx = Context<{ Variables: { supabase: Db } }>;

const KEYS = ["scm.payment_voucher.write", "scm.payment_voucher.check", "scm.payment_voucher.approve"] as const;

type Voucher = {
  status: string; pv_number: string | null; voucher_date: string; credit_account_code: string | null;
  submitted_at: string | null; checked_at: string | null;
};

/** What would refuse this voucher later, asked before any step runs; null when nothing would. */
async function preflight(c: Ctx, sb: Db, companyId: number, pv: Voucher): Promise<Response | null> {
  // A posted or cancelled voucher: the first door says so in its own words.
  if (pv.status !== "DRAFT") return null;
  const settings = await loadLedgerSettings(sb, companyId);
  if (!settings.ok) return c.json({ error: "load_failed", reason: "ledger settings" }, 500);
  if (isBeforeLedgerStart(pv.voucher_date, settings.settings)) {
    return c.json({ error: beforeLedgerStartMessage(settings.settings.ledgerStartDate!) }, 409);
  }
  const lines = await sb.from("payment_voucher_lines").select("pv_id").eq("pv_id", c.req.param("id")).limit(1);
  if (lines.error) return c.json({ error: "load_failed", reason: lines.error.message }, 500);
  if ((lines.data ?? []).length === 0) return c.json({ error: "no_lines", message: "Voucher has no lines to post" }, 400);
  // The check mints the formal number from the bank's letter (payment-vouchers.ts mintFormalPvNo); the cash drawer
  // has a fixed one, and a voucher already numbered keeps its number.
  if (!pv.checked_at && /-Draft-/.test(String(pv.pv_number ?? ""))) {
    const code = String(pv.credit_account_code ?? "");
    const roles = await resolveRoles(sb, companyId);
    if (code !== roles.CASH) {
      const letter = await sb.from("acc_bank_letters").select("letter").eq("company_id", companyId).eq("account_code", code).maybeSingle();
      if (letter.error) return c.json({ error: "load_failed", reason: letter.error.message }, 500);
      if (!(letter.data as { letter?: string } | null)?.letter) {
        return c.json({
          error: "bank_letter_missing",
          message: `${code} has no series letter yet — set one on the Voucher numbering card (Reconciliation setup), then post again.`,
        }, 409);
      }
    }
  }
  return null;
}

/** POST /payment-vouchers/:id/post-now — prepare, check, approve and post, skipping the steps already done. */
export async function postNowHandler(c: Ctx): Promise<Response> {
  if (!KEYS.every((k) => hasHouzsPerm(c, k))) {
    return c.json({ error: "Post now needs the prepare, check and approve permissions together." }, 403);
  }
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get("supabase");
  const { data, error } = await scopeToCompanyId(
    sb.from("payment_vouchers").select("status, pv_number, voucher_date, credit_account_code, submitted_at, checked_at").eq("id", c.req.param("id")),
    co.companyId,
  ).maybeSingle();
  if (error) return c.json({ error: "load_failed", reason: error.message }, 500);
  if (!data) return c.json(NOT_THIS_COMPANY, 404);
  const pv = data as Voucher;

  const refused = await preflight(c, sb, co.companyId, pv);
  if (refused) return refused;

  if (!pv.submitted_at) {
    const r = await submitPaymentVoucherHandler(c);
    if (!r.ok) return r;
  }
  if (!pv.checked_at) {
    const r = await checkPaymentVoucherHandler(c);
    if (!r.ok) return r;
  }
  return approvePaymentVoucherHandler(c);
}
