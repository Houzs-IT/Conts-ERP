// Conts only: what a unit's owner pays back on a payment request (migration 0352) or a staff claim (0363), for finance's
// Payment requests screen.
import type { ClaimLine } from "./claimsQueries";

/** The units an owner can pay back on: each unit's lines that are not a maintenance job's (a job's goes to the owner
 *  through the job's Who pays, never here as well; chew, 21 Nov 2026), with their total. */
export function recoveryUnits(lines: ClaimLine[]): Array<[string, { label: string; sen: number }]> {
  const units = new Map<string, { label: string; sen: number }>();
  for (const l of lines) {
    if (!l.unitId || l.maintenanceIssueId) continue;
    const u = units.get(l.unitId) ?? { label: l.targetLabel ?? l.unitId, sen: 0 };
    u.sen += l.amountSen;
    units.set(l.unitId, u);
  }
  return [...units.entries()];
}

/** Whether finance may still set what the owner pays back, as the engine allows: a request until it is paid (0352), a
 *  claim until it is checked (0363). After that the owner is charged, and a charge is changed on the owner's statement. */
export function recoveryOpen(kind: "request" | "claim", status: string): boolean {
  return kind === "request" ? ["SUBMITTED", "PART_PAID", "WITHDRAWN", "REJECTED"].includes(status) : status === "HANDED_IN" || status === "REJECTED";
}
