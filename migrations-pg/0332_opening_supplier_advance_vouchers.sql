-- REVERSAL: alter table scm.payment_vouchers drop column if exists opening_balance;
-- Opening supplier advances (chew, 17 Nov 2026: the system takes the minus lines): a supplier's line on AutoCount's creditor ageing that
-- is a payment not yet knocked off (a minus on the list) is imported as an opening payment voucher, posted and
-- posting nothing (its money is in the OPENING journal), holding a supplier advance that knocks off the supplier's
-- later bills as any advance does (acc_supplier_advances / pv_allocations need a voucher). A customer's minus
-- (paid ahead) is a customer credit (customer_credits, source_type OPENING), which needs no change here.
-- The voucher's number is OB-<AutoCount's number> (pv_number is unique already); the flag marks it as opening paper:
-- no journal, and the opening check counts its advance against the supplier's control.
-- APPLY: by the migrate-production workflow, only=0332, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.payment_vouchers add column if not exists opening_balance boolean not null default false;

notify pgrst, 'reload schema';
