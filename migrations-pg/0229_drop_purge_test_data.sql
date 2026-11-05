-- REVERSAL: restore the function from migrations 0226 and 0227 if another clear is ever wanted.
-- The owner ran the clear on 6 Nov 2026 (one row in pos.audit_log, action purge_test_data), so the one-off tool goes.
set local search_path = scm, public, extensions;

drop function if exists scm.purge_test_data(boolean, text);
