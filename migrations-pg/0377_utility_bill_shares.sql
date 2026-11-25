-- REVERSAL: alter table pos.expenses drop column split_of; alter table pos.utility_bill_scans drop column payable_sen;
--   (a bill already split keeps its parts as separate bills; only the link between them goes)
-- GRANTS: none - new columns on existing tables keep the tables' grants.
--
-- One utility bill for two or more units (chew, 25 Nov 2026: "如果一张utility其实是两个unit的呢？... 每次手动填金额,然后要
-- 确定两个都可以选择扣不扣owner， pay back这些"). A scanned bill is recorded as one part per unit, each a bill of its own on
-- its unit (deducted from that owner or not, paid back to that owner or not), the page the same.
--
--   expenses.split_of             on a part for another unit: the bill it was split from (the part on the bill's own
--                                 unit, whose page the scan links). Null on every other bill.
--   utility_bill_scans.payable_sen what the company pays the provider for the page: the whole bill less the parts their
--                                 owners paid. Null on a page not split (the whole bill, or nothing when the owner paid).
alter table pos.expenses add column if not exists split_of text references pos.expenses(id) on delete set null;
create index if not exists expenses_split_of on pos.expenses (split_of) where split_of is not null;
alter table pos.utility_bill_scans add column if not exists payable_sen integer;
-- Demo mode mirrors every pos column (0203): its views take the new ones.
select demo.sync();
