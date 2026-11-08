/**
 * The OT / short flag on a Working Hours row (Hookka #434). "Short" asks whether the person did a full day, and a clean
 * punch (clocked in and out) answers that: the number in the box may be a saved, copied ("Copy yesterday") or
 * department-split value that says nothing about the day. Without a usable punch the entered total is judged. OT still
 * follows the entered total, so hours keyed by hand for overtime are not hidden.
 */
export interface FlagPunch { clockOutAt: string | null; forgotOut: boolean; hours: number }

export function hoursFlag(enteredTotal: number, standard: number, punch: FlagPunch | null | undefined): 'OT' | 'short' | null {
  if (enteredTotal > standard) return 'OT';
  const punched = punch && !punch.forgotOut && punch.clockOutAt ? punch.hours : null;
  const judged = punched ?? enteredTotal;
  return judged > 0 && judged < standard ? 'short' : null;
}
