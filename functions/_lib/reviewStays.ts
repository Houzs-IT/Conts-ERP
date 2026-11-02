/** A finished guest stay that could have left a review, for reservation row `r`: not cancelled, not a no-show or an
 *  unanswered inquiry, and not an owner stay or a maintenance block. Callers add the checkout cut-off. */
export const STAY_SQL = `r.state NOT IN ('cancelled','no_show','inquiry','pending') AND r.channel NOT IN ('maintenance_block','owner_stay')`;
