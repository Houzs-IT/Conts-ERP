-- REVERSAL: alter table scm.so_amendment_lines drop column zero_price_intended;
-- An approved SO amendment / VO set a priced line to RM 0 when the editor sent the 0 an unpriced SKU seeds into the
-- price box (ported from Houzs HC-0095). zero_price_intended = the operator typed the 0; the apply honours a requested 0
-- only when it is true, otherwise the line keeps its stored price. Existing rows get false.
select demo.drop_views();
set local lock_timeout = '5s';

alter table scm.so_amendment_lines add column if not exists zero_price_intended boolean not null default false;

notify pgrst, 'reload schema';

select demo.sync();
