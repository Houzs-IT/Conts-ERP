-- REVERSAL: DELETE FROM scm.stock_allocation_recompute_lock WHERE lock_key = 'GLOBAL';
-- The stock allocation claims this one row before it runs. Conts's schema was copied without it, so the allocator
-- read an empty table as another run in progress and has never run: no line ever turned ready from stock.
INSERT INTO scm.stock_allocation_recompute_lock (lock_key) VALUES ('GLOBAL') ON CONFLICT (lock_key) DO NOTHING;
