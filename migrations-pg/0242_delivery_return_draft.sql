-- REVERSAL: Postgres cannot drop an enum label; leave DRAFT in place and make sure no delivery_returns row carries it.
-- Delivery Returns show a Draft status (owner, 6 Nov 2026), as Delivery Orders and Sales Invoices do. Only the vocabulary:
-- a return still starts at RECEIVED and books its stock on create.
select demo.drop_views();
set local lock_timeout = '5s';

alter type scm.delivery_return_status add value if not exists 'DRAFT' before 'PENDING';

select demo.sync();
