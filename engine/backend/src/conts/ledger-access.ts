// Conts only (not part of Houzs's code): the Ledger area (finance phase 1, 21 Oct 2026).
//
// Property OS's Ledger level arrives with the sign-on and becomes `scm.ledger.use` plus the payment
// voucher keys. The ledger routes ask for `scm.ledger.use` LITERALLY: the `*` wildcard does not count,
// because `*` is also what Full in the eight supply areas gives (an operations manager, say), and that
// person must not open the company's books by it.
import type { MiddlewareHandler } from "hono";
import { hasPermissionLiterally } from "../services/permissions";
import type { ContsLevel } from "./access";

export const LEDGER_KEY = "scm.ledger.use";

const LADDER: Record<ContsLevel, string[]> = {
  none: [],
  view: [LEDGER_KEY],
  edit: [LEDGER_KEY, "scm.payment_voucher.create", "scm.payment_voucher.write"],
  full: [
    LEDGER_KEY, "scm.payment_voucher.create", "scm.payment_voucher.write",
    "scm.payment_voucher.check", "scm.payment_voucher.approve", "scm.payment_voucher.post", "scm.payment_voucher.cancel",
  ],
};

export const ledgerPermissions = (level: ContsLevel): string[] => [...LADDER[level]];

export interface OpenPath { method?: string; path: RegExp }

/** Under /accounting, what other screens use without the Ledger: the official receipts (the sales
 *  payment panel issues them, their files ride on /receipts/:id/files) and the account list the
 *  credit notes screen picks from. Each still has its own checks. */
export const ACCOUNTING_OPEN_PATHS: readonly OpenPath[] = [
  { path: /\/accounting\/receipts(\/|$)/ },
  { method: "GET", path: /\/accounting\/accounts$/ },
];

type GuardUser = { permissions?: readonly string[]; permissions_set?: ReadonlySet<string> } | undefined;

export function requireLedgerAccess(opts: { except?: readonly OpenPath[] } = {}): MiddlewareHandler {
  return async (c, next) => {
    const open = opts.except?.some((o) => (!o.method || o.method === c.req.method) && o.path.test(c.req.path));
    if (open) return next();
    const user = c.get("user") as GuardUser;
    const granted = user?.permissions_set ?? user?.permissions ?? [];
    if (!hasPermissionLiterally(granted, LEDGER_KEY)) return c.json({ error: "Your role cannot open the accounts." }, 403);
    await next();
  };
}
