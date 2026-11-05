-- September 2026 owner statements for the 6 owners who had a provisional (system-made) September statement.
-- chew, 5 Nov 2026: September follows the September owner report (OWNER REPORT SEP26, sheet 整体报告), paid, like
-- June to August; the report replaces these drafts. The other 95 owners were imported on 5 Nov through the database
-- tool, which refuses deletes, hence this migration. Data only: no schema change. Run with only=0218.
-- Rows are built by importPayoutHistory (functions/_lib/hostplatformImportDb.ts) from the report; the check at the end
-- refuses the run unless the rows are exactly those.
-- REVERSAL: none automatic (the drafts can be regenerated from Property OS: Owner statements, Generate).
set local search_path = pos, public;
do $g$ begin
  if (select count(*) from owner_statements where id in ('411a6b21-fd43-4ca2-9449-b5f97534fba0', 'cb2cf02a-47d4-4a78-a190-c0a095f316e7', 'b9146414-4945-4a11-8d8a-bf04a4e99002', '8f114a6c-724a-43cd-bfce-3233dbcd1e49', '4125e4f4-a0aa-48c0-864c-611bcb0998fc', '9590f9c1-03c9-46e2-95a2-a3d1c98529fb') and state = 'provisional' and source = 'generated') <> 6
  then raise exception 'The 6 September drafts are no longer all provisional; nothing changed.'; end if;
  if exists (select 1 from owner_statements where id in ('wb-stmt-e9ca31e8a1a38889-202609', 'wb-stmt-4e95d799c12b225e-202609', 'wb-stmt-fb0aaabfc5b937bb-202609', 'wb-stmt-c026bbcbfdaf47ee-202609', 'wb-stmt-e6b1b96c859f3b27-202609', 'wb-stmt-870cd4cc96e92bbc-202609')) then raise exception 'September report statements for these owners already exist.'; end if;
end $g$;
-- The drafts give way to the report. Their adjustments are released first (they are settled again below); lines,
-- units and documents of a statement go with it (on delete cascade). Drafts have no payouts.
update owner_adjustments set statement_id = null where statement_id in ('411a6b21-fd43-4ca2-9449-b5f97534fba0', 'cb2cf02a-47d4-4a78-a190-c0a095f316e7', 'b9146414-4945-4a11-8d8a-bf04a4e99002', '8f114a6c-724a-43cd-bfce-3233dbcd1e49', '4125e4f4-a0aa-48c0-864c-611bcb0998fc', '9590f9c1-03c9-46e2-95a2-a3d1c98529fb');
delete from owner_statements where id in ('411a6b21-fd43-4ca2-9449-b5f97534fba0', 'cb2cf02a-47d4-4a78-a190-c0a095f316e7', 'b9146414-4945-4a11-8d8a-bf04a4e99002', '8f114a6c-724a-43cd-bfce-3233dbcd1e49', '4125e4f4-a0aa-48c0-864c-611bcb0998fc', '9590f9c1-03c9-46e2-95a2-a3d1c98529fb');
create temporary table sep_in on commit drop as select $j${"u":[["hp-unit-691ae3157c036403937c0bff","CONTINEW B18-08"],["hp-unit-691ae379e8e36203e7765f22","CONTINEW B23A-06"],["wb-unit-sv2-tower-c-d-c1710","SV2 Tower C&D C1710"],["hp-unit-691bd550e2a5ef03db402275","Trion KL B56-05"],["hp-unit-6a460a229bc91d040632c6f2","SKYLINE KL C27-05"],["hp-unit-6a3b8523e9569d03ef07141f","SKYLINE KL D49-03A"]],"s":[["wb-stmt-e9ca31e8a1a38889-202609","wb-owner-01b36ecf5e5cb443",443470,104175,149295,0,190000,"3199"],["wb-stmt-4e95d799c12b225e-202609","wb-owner-fed0ce7b5e773b69",418587,7057,111530,0,300000,"3065"],["wb-stmt-fb0aaabfc5b937bb-202609","wb-owner-e04cf59c94113449",0,0,12760,412760,400000,"4020"],["wb-stmt-c026bbcbfdaf47ee-202609","wb-owner-e966c42891c9d603",502042,7063,184979,0,310000,"2225"],["wb-stmt-e6b1b96c859f3b27-202609","wb-owner-df99a15796887ff9",453266,58841,119425,0,275000,"0517"],["wb-stmt-870cd4cc96e92bbc-202609","wb-owner-d62754d3815a9c1d",662863,143364,74085,0,445414,"9900"]],"l":[[0,0,0,"g",443470],[0,1,0,"c",-69800],[0,2,0,"u",-79495],[0,3,0,"f",-104175],[1,0,1,"g",418587],[1,1,1,"c",-53800],[1,2,1,"u",-57730],[1,3,1,"f",-7057],[2,0,2,"g",0],[2,1,2,"u",-12760],[2,2,2,"t",412760],[3,0,3,"g",502042],[3,1,3,"c",-93800],[3,2,3,"u",-91179],[3,3,3,"f",-7063],[4,0,4,"g",453266],[4,1,4,"c",-77800],[4,2,4,"u",-41625],[4,3,4,"f",-58841],[5,0,5,"g",662863],[5,1,5,"c",-10000],[5,2,5,"u",-64085],[5,3,5,"f",-143364]]}$j$::jsonb j;
insert into owner_statements (id, owner_id, period_start, period_end, state, gross_booking_value, management_fee, expenses_total, adjustments_total, net_payout, currency, generated_at, created_at, source)
select s->>0, s->>1, '2026-09-01', '2026-09-30', 'paid', (s->>2)::int, (s->>3)::int, (s->>4)::int, (s->>5)::int, (s->>6)::int, 'MYR', '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z', 'owner_workbook'
from sep_in, jsonb_array_elements(j->'s') s;
insert into statement_lines (id, statement_id, unit_id, line_type, category, description, occurred_on, amount, reference, sort_order)
select (j->'s'->((l->>0)::int)->>0) || '-' || (l->>1), j->'s'->((l->>0)::int)->>0, j->'u'->((l->>2)::int)->>0,
  case l->>3 when 'g' then 'gross' when 'f' then 'management_fee' when 't' then 'adjustment' else 'expense' end,
  case l->>3 when 'c' then 'cleaning' when 'u' then 'utilities' when 'a' then 'other' when 'm' then 'other' when 't' then 'workbook_payout' end,
  (j->'u'->((l->>2)::int)->>1) || ': ' || case l->>3 when 'g' then 'Gross Income for 2026-09' when 'c' then 'Cleaning' when 'u' then 'Utilities'
    when 'a' then 'Additional deductions' when 'm' then 'Miscellaneous charges' when 'f' then 'company and agent share' when 't' then 'guaranteed rent top-up' end || ' (owner workbook)',
  '2026-09-30', (l->>4)::int, 'Owner workbook', (l->>1)::int
from sep_in, jsonb_array_elements(j->'l') l;
insert into payouts (id, statement_id, owner_id, amount, currency, state, method, bank_last4, created_at, source)
select replace(s->>0, 'wb-stmt-', 'wb-payout-'), s->>0, s->>1, (s->>6)::int, 'MYR', 'paid', 'bank_transfer', nullif(s->>7, 'false'), '2026-09-30T15:59:59.000Z', 'owner_workbook'
from sep_in, jsonb_array_elements(j->'s') s where (s->>6)::int > 0;
-- Credits and charges up to September were inside those payouts (as the import does).
update owner_adjustments a set state = 'settled', updated_at = '2026-11-05T00:00:00.000Z',
  statement_id = (select s.id from owner_statements s where s.owner_id = a.owner_id and s.period_start = substr(a.occurred_on, 1, 7) || '-01' and s.id like 'wb-stmt-%'),
  settled_note = 'Included in the owner workbook payout for ' || substr(a.occurred_on, 1, 7)
where a.source = 'owner_workbook' and a.kind in ('credit','charge') and a.state = 'open' and a.statement_id is null and a.occurred_on <= '2026-09-30' and a.owner_id in (select s->>1 from sep_in, jsonb_array_elements(j->'s') s)
  and exists (select 1 from owner_statements s where s.owner_id = a.owner_id and s.period_start = substr(a.occurred_on, 1, 7) || '-01' and s.id like 'wb-stmt-%');
-- Refuse to commit unless the rows are exactly what the import code produced.
do $c$ declare ls text; ss text; begin
  select md5(string_agg(concat_ws('|', id, statement_id, unit_id, line_type, coalesce(category, ''), description, amount, sort_order), E'\n' order by id collate "C")) into ls
    from statement_lines where statement_id in ('wb-stmt-e9ca31e8a1a38889-202609', 'wb-stmt-4e95d799c12b225e-202609', 'wb-stmt-fb0aaabfc5b937bb-202609', 'wb-stmt-c026bbcbfdaf47ee-202609', 'wb-stmt-e6b1b96c859f3b27-202609', 'wb-stmt-870cd4cc96e92bbc-202609');
  select md5(string_agg(concat_ws('|', id, owner_id, gross_booking_value, management_fee, expenses_total, adjustments_total, net_payout), E'\n' order by id collate "C")) into ss
    from owner_statements where id in ('wb-stmt-e9ca31e8a1a38889-202609', 'wb-stmt-4e95d799c12b225e-202609', 'wb-stmt-fb0aaabfc5b937bb-202609', 'wb-stmt-c026bbcbfdaf47ee-202609', 'wb-stmt-e6b1b96c859f3b27-202609', 'wb-stmt-870cd4cc96e92bbc-202609');
  if ls is distinct from '2354b67a2ff73ac0ef2cb002e74b3cfc' or ss is distinct from 'e4b072290238f36acb92d96f17ad869e' then raise exception 'Sep import check failed: lines % statements %', ls, ss; end if;
end $c$;
