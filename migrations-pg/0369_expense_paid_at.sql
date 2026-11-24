-- REVERSAL: alter table pos.expenses drop column paid_at; (no row is written; dropping loses only the dates typed in)
-- GRANTS: none - a new column on an existing table keeps the table's grants.
--
-- The day a bill was paid (owner, 24 Nov 2026: utility and cleaning-vendor bills in the expenses list had no way to show
-- paid or not). YYYY-MM-DD, empty = not paid yet. It is not money: it changes no figure on any statement, so it may be
-- set on a bill whose month is already final.
alter table pos.expenses add column if not exists paid_at text;
-- Demo mode mirrors every pos column (0203): its views take the new one.
select demo.sync();
