-- 0363_staff_receipt_owner_recovery: what a staff claim (Claim to me, or a receipt paid from petty cash) spent on a unit
-- that the unit's owner pays back, as 0352 does for payment requests (chew, 23 Nov 2026: the tick "The owner pays this
-- back" on claims too). Ticked by the person handing it in or set by finance before the check.
--
--   scm.staff_receipt_recoveries          one row per receipt and unit: what that unit's owner pays back. Kept apart
--                                         from the lines, which finance rewrites while checking.
--   pos.owner_recovery_day(unit, owner)   the day a recovery is charged on: today in Kuala Lumpur, or the first day of
--                                         the next month whose O2 is not locked for the unit and whose statement for
--                                         the owner is not final (the rule 0352 uses; 0352's function is left as is).
--   pos.charge_owner_receipt_recoveries() once the receipt is CHECKED (finance accepted the cost) — and through its paid
--                                         states TOPPED_UP and PAID_BACK — each recovery becomes an open O2 charge on
--                                         the unit's owner (pos.owner_adjustments). A receipt in any other state
--                                         (back to HANDED_IN when a check is undone, REJECTED, REPAID, WRITTEN_OFF,
--                                         REPLACED) takes back a charge still open, on no closed statement and kept by
--                                         no O2 lock; any other stays for finance. Security definer, owned by the
--                                         migration's role: the engine cannot write pos, and Property OS cannot read scm.
--   Triggers on the receipt (status) and on the recoveries (a new or changed amount or unit) call it.
--
-- REVERSAL: drop trigger staff_receipts_owner_recovery on scm.staff_receipts;
--   drop trigger staff_receipt_recoveries_charge on scm.staff_receipt_recoveries;
--   drop function scm.staff_receipt_recovery_trigger(); drop function pos.charge_owner_receipt_recoveries(uuid);
--   drop function pos.owner_recovery_day(text, text); drop table scm.staff_receipt_recoveries;
--   (the O2 charges already made stay; delete them by hand if needed)

set local lock_timeout = '5s';

create table scm.staff_receipt_recoveries (
  receipt_id uuid not null references scm.staff_receipts(id) on delete cascade,
  unit_id text not null,
  amount_sen bigint not null check (amount_sen > 0),
  set_by text,
  set_at timestamptz not null default now(),
  adjustment_id text,
  primary key (receipt_id, unit_id)
);
alter table scm.staff_receipt_recoveries owner to scm_engine;
alter table scm.staff_receipt_recoveries enable row level security;
revoke all on scm.staff_receipt_recoveries from anon, authenticated;
grant all on scm.staff_receipt_recoveries to service_role, pos_app;

create or replace function pos.owner_recovery_day(p_unit text, p_owner text)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_month text := to_char(v_day, 'YYYY-MM');
  v_occurred text := to_char(v_day, 'YYYY-MM-DD');
begin
  while exists (select 1 from pos.owner_report_locks k where k.unit_id = p_unit and k.stage = 'o2' and k.month = v_month)
     or exists (select 1 from pos.owner_statements s where s.owner_id = p_owner and s.state in ('finalised', 'sent', 'paid')
                  and substr(s.period_start::text, 1, 7) = v_month) loop
    v_month := to_char((v_month || '-01')::date + interval '1 month', 'YYYY-MM');
    v_occurred := v_month || '-01';
  end loop;
  return v_occurred;
end $$;
revoke all on function pos.owner_recovery_day(text, text) from public;

create or replace function pos.charge_owner_receipt_recoveries(p_receipt uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  rct record;
  rec record;
  v_owner text;
  v_what text;
  v_stamp text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_adj text;
begin
  select r.id, r.receipt_no, r.status, r.vendor_name, r.note into rct from scm.staff_receipts r where r.id = p_receipt;
  if not found then return; end if;

  if rct.status in ('CHECKED', 'TOPPED_UP', 'PAID_BACK') then
    v_what := coalesce(nullif(btrim(rct.vendor_name), ''), nullif(btrim(rct.note), ''), 'staff claim');
    for rec in select x.* from scm.staff_receipt_recoveries x where x.receipt_id = p_receipt and x.adjustment_id is null loop
      select u.owner_id into v_owner from pos.units u where u.id = rec.unit_id;
      continue when v_owner is null;   -- no owner to charge yet: tried again on the next change
      v_adj := gen_random_uuid()::text;
      insert into pos.owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source,
                                         created_by, created_at, updated_at)
      values (v_adj, v_owner, rec.unit_id, 'charge', -rec.amount_sen::integer,
              left(format('Paid by the company, recovered from the owner: %s (%s)', v_what, rct.receipt_no), 300),
              pos.owner_recovery_day(rec.unit_id, v_owner), rct.receipt_no, 'open', 'manual',
              (select u.id from pos.users u where u.id = rec.set_by), v_stamp, v_stamp);
      update scm.staff_receipt_recoveries set adjustment_id = v_adj where receipt_id = rec.receipt_id and unit_id = rec.unit_id;
    end loop;
  else
    -- No longer accepted: an open charge on no closed statement and kept by no O2 lock goes; any other stays for finance.
    for rec in select x.* from scm.staff_receipt_recoveries x where x.receipt_id = p_receipt and x.adjustment_id is not null loop
      delete from pos.owner_adjustments a
       where a.id = rec.adjustment_id and a.state = 'open'
         and (a.statement_id is null or exists (select 1 from pos.owner_statements s where s.id = a.statement_id and s.state = 'provisional'))
         and not exists (select 1 from pos.owner_report_locks k where k.stage = 'o2'
                           and k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id)));
      if found then
        update scm.staff_receipt_recoveries set adjustment_id = null where receipt_id = rec.receipt_id and unit_id = rec.unit_id;
      end if;
    end loop;
  end if;
end $$;
revoke all on function pos.charge_owner_receipt_recoveries(uuid) from public;

create or replace function scm.staff_receipt_recovery_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'staff_receipts' then
    if (new.status in ('CHECKED', 'TOPPED_UP', 'PAID_BACK')) is distinct from (old.status in ('CHECKED', 'TOPPED_UP', 'PAID_BACK')) then
      perform pos.charge_owner_receipt_recoveries(new.id);
    end if;
  else
    perform pos.charge_owner_receipt_recoveries(new.receipt_id);
  end if;
  return null;
end $$;
revoke all on function scm.staff_receipt_recovery_trigger() from public;

create trigger staff_receipts_owner_recovery after update of status on scm.staff_receipts
  for each row execute function scm.staff_receipt_recovery_trigger();
-- Only a new or changed amount or unit: the function's own write of adjustment_id must not call it again (a second charge).
create trigger staff_receipt_recoveries_charge after insert or update of amount_sen, unit_id on scm.staff_receipt_recoveries
  for each row execute function scm.staff_receipt_recovery_trigger();
