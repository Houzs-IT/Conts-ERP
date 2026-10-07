-- The supply chain engine's built-in system staff row. The engine maps every signed-in person onto this
-- one identity inside supply chain and stamps documents with it (created_by is a foreign key to scm.staff),
-- so without the row no sales order can be saved: the first end-to-end test on staging failed on
-- mfg_sales_orders_created_by_staff_id_fk. Houzs creates it once with scripts/scm-schema/seed-scm-staff.mjs;
-- a fresh structure-only copy does not have it. The id is fixed in the engine's code.
-- REVERSAL: DELETE FROM scm.staff WHERE id = '00000000-0000-4000-8000-000000000001';
INSERT INTO scm.staff (id, staff_code, name, role, initials, color, active)
VALUES ('00000000-0000-4000-8000-000000000001', 'SYSTEM', 'The Conts ERP', 'super_admin', 'TC', '#8a6a2f', true)
ON CONFLICT (id) DO NOTHING;
