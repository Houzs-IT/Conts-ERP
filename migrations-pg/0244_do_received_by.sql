-- REVERSAL: alter table scm.delivery_orders drop column pod_received_by;
-- Who took the goods on the phone's Draft delivery job (owner, 7 Nov 2026): the name travels with the POD on the DO.
select demo.drop_views();
set local lock_timeout = '5s';

alter table scm.delivery_orders add column if not exists pod_received_by text;

notify pgrst, 'reload schema';

select demo.sync();
