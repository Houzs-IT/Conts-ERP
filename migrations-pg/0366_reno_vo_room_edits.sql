-- VO room editor (owner, 23 Nov 2026): a draft VO keeps the contract-line edits staff made in place
-- ({ lines: [...], adds: [...] }); its add and omit lines are rebuilt from them on save and at approval.
-- Null = a VO built line by line in the Add and Omit layout.

alter table scm.reno_variation_orders add column if not exists edits jsonb;

notify pgrst, 'reload schema';
