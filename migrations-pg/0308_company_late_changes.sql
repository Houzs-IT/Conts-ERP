-- Owner report stage locks, part 2b: the company's share of a late change (spec
-- docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md, plan
-- docs/superpowers/plans/2026-11-12-owner-report-locks-part2b-company-share.md). chew, 11 Nov 2026: "A：算进下个月";
-- 12 Nov 2026: "你先做出来吧，我测试了才懂".
--
--   company_late_changes  A change that reaches a locked month after its lock (a reservation corrected, a cost changed)
--                         leaves the month as locked. The owner's share of the difference already goes to the next open
--                         month as an owner adjustment (source stage_lock, migration 0302). This table keeps the
--                         company's share: one row per lock per month, on the same month as the owner's adjustment, so
--                         the company's figures for that month (Overall owner report, Yearly report, Finance > Unit P&L,
--                         the unit's Financials) take it. The late update (functions/_lib/ownerLocks.ts syncLate) writes
--                         it; unlocking withdraws what can still move and carries back what is settled.
--                         reference: 'stage-lock:<lock id>', or 'stage-lock-carried:<lock id>' for the balancing row an
--                         unlock leaves. amount: sen, the company's share (live company figure less the locked one).
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0308, dry run first.
-- REVERSAL: the table can be left in place; the code reads it only when it exists.
set local search_path = pos;
set local lock_timeout = '5s';

select demo.drop_views();

CREATE TABLE IF NOT EXISTS company_late_changes (
  id           TEXT PRIMARY KEY,
  unit_id      TEXT NOT NULL REFERENCES units(id),
  month        TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount       INTEGER NOT NULL,
  description  TEXT NOT NULL,
  reference    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS company_late_changes_unit_month ON company_late_changes (unit_id, month);
CREATE INDEX IF NOT EXISTS company_late_changes_reference ON company_late_changes (reference);
ALTER TABLE company_late_changes OWNER TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON company_late_changes TO pos_app;

-- Rebuild the Demo mode overlay (migration 0203) so it covers the new table.
select demo.sync();
