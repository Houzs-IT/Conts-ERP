-- 0251 added four columns to contract_types without refreshing the demo copy, so Demo mode's view of the table
-- lacked them. Kept as its own file because 0251 was already applied on staging (10 Nov 2026).
--
-- REVERSAL: none needed. Run `select demo.sync();` again after dropping the 0251 columns.
select demo.sync();
