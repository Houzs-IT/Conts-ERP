-- 0210 added pos.unit_bed_sizes without rebuilding the Demo mode overlay (migration 0203), so demo_pos had no view for
-- it and a Demo mode request read and wrote the real table. 0210 already ran on staging, so the rebuild is its own file.
--
-- REVERSAL: none needed; demo.sync() only rebuilds the demo_pos views and demo stores from the pos tables.
select demo.drop_views();
select demo.sync();
