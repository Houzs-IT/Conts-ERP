-- REVERSAL (revert the code first): alter table pos.tasks drop column if exists cleaning_billed_sen; select demo.sync();
-- GRANTS: none - a new column keeps the table grants; demo.sync() keeps the demo views' grants.
--
-- What an outside cleaning job is billed to its client at (chew, 27 Nov 2026). A job on an invoice line of its own is
-- billed its amount; jobs under one lump sum (a package: the jobs carry RM 0, the office types the total) share it
-- evenly, the odd sen on the first job. Profit by job reads it in place of the job's amount (functions/_lib/jobProfit).
-- Null = not billed. Written by functions/_lib/cleaningBilling.ts whenever an invoice's jobs change.

alter table pos.tasks add column if not exists cleaning_billed_sen integer;
-- Demo mode mirrors every pos column (0203): its views take the new one.
select demo.sync();
