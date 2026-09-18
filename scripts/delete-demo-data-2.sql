-- Removes everything scripts/demo-data-2.sql added. Run alongside
-- delete-demo-data.sql once real data replaces this placeholder set.
DELETE FROM expenses WHERE id LIKE 'demo-exp-%';
DELETE FROM payouts WHERE id LIKE 'demo-pay-%';
DELETE FROM statement_lines WHERE id LIKE 'demo-line-%';
DELETE FROM owner_statements WHERE id LIKE 'demo-stmt-%';
DELETE FROM owner_contracts WHERE id LIKE 'demo-contract-%';
DELETE FROM automations WHERE id LIKE 'demo-auto-%';
DELETE FROM messages WHERE id LIKE 'demo-msg-%';
DELETE FROM message_threads WHERE id LIKE 'demo-thread-%';
DELETE FROM pricing_rules WHERE id LIKE 'demo-price-%';
DELETE FROM access_credentials WHERE id LIKE 'demo-acc-%';
DELETE FROM inventory_items WHERE id LIKE 'demo-inv-%';
DELETE FROM inspections WHERE id LIKE 'demo-ins-%';
DELETE FROM maintenance_issues WHERE id LIKE 'demo-mnt-%';
DELETE FROM tasks WHERE id LIKE 'demo-task-%';
DELETE FROM reviews WHERE id LIKE 'demo-review-%';
DELETE FROM reservations WHERE id LIKE '77777777-0000-4000-8000-00000000000%' AND id NOT IN ('77777777-0000-4000-8000-000000000001','77777777-0000-4000-8000-000000000002');
DELETE FROM guests WHERE id LIKE '66666666-6666-4666-8666-00000000000%' AND id NOT IN ('66666666-6666-4666-8666-000000000001','66666666-6666-4666-8666-000000000002');
