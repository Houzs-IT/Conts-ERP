// Conts only (not part of Houzs's code): the Ledger area (finance phase 1, 21 Oct 2026).
// The ledger screens open only for a role that holds `scm.ledger.use` itself; the `*` wildcard
// (Full in the eight supply areas) does not count. The server asks the same way
// (backend/src/conts/ledger-access.ts).
export const LEDGER_KEY = "scm.ledger.use";

export function canUseLedger(permissions: readonly string[] | undefined | null): boolean {
  return (permissions ?? []).includes(LEDGER_KEY);
}
