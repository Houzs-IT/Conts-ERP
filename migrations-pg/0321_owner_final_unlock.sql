-- Owner statement close, part 3: Unlock final (spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md
-- calls 5 and 6, plan docs/superpowers/plans/2026-11-12-owner-report-locks-part3-final.md). chew, 11 Nov 2026 ("可以"):
-- a final statement that is not paid yet goes back to draft when it is unlocked, and its payout is cancelled; made final
-- and sent again, it gets a fresh payout.
--
--   payouts.state   adds 'cancelled': the payout of a statement unlocked before it was paid. It is never transferred,
--                   a payout run skips it, and it counts in neither the money still to pay nor the money paid.
--   access          Make final and Unlock final need no rule here: they are given one by one (ownGrant), so no
--                   department or category baseline opens them; management always has them.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0321, dry run first.
-- REVERSAL: once no payout is cancelled, put the old list of states back (pending, processing, paid, failed).
set local search_path = pos;
set local lock_timeout = '5s';

select demo.drop_views();

ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_state_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_state_check CHECK (state IN ('pending', 'processing', 'paid', 'failed', 'cancelled'));

-- Rebuild the Demo mode overlay (migration 0203).
select demo.sync();
