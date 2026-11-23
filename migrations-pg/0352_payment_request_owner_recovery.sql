-- 0352_payment_request_owner_recovery: money a payment request pays out that the owner pays back (chew, 20 Nov 2026:
-- "payment request 时这个钱是要和 owner 收回"; ticked by the person asking or by finance, the whole line or an amount
-- typed by hand).
--
--   scm.payment_request_recoveries   one row per request and unit: what that unit's owner pays back. Kept apart from
--                                    the lines, which a voucher or an AP invoice rewrites (conts/voucher-sync.ts,
--                                    request-ap-invoice.ts), so finance's changes there never lose it.
--   pos.charge_owner_recoveries()    once the request is PAID, each recovery becomes an open O2 charge on the unit's
--                                    owner (pos.owner_adjustments, the owner's alone, after the split), dated the day
--                                    it is paid in Kuala Lumpur, or the first day of the next month whose O2 is not
--                                    locked and whose statement is not final. A request that stops being PAID (its
--                                    voucher cancelled) takes back a charge still open and on no closed statement.
--                                    Run as its owner: the engine cannot write pos, and Property OS cannot read scm.
--   Triggers on the request (status) and on the recoveries (a change after it is paid) call it.
--
-- REVERSAL: drop trigger payment_requests_owner_recovery on scm.payment_requests;
--   drop trigger payment_request_recoveries_charge on scm.payment_request_recoveries;
--   drop function scm.payment_request_recovery_trigger(); drop function pos.charge_owner_recoveries(uuid);
--   drop table scm.payment_request_recoveries;   (the O2 charges already made stay; delete them by hand if needed)

set local lock_timeout = '5s';

create table scm.payment_request_recoveries (
  request_id uuid not null references scm.payment_requests(id) on delete cascade,
  unit_id text not null,
  amount_sen bigint not null check (amount_sen > 0),
  set_by text,
  set_at timestamptz not null default now(),
  adjustment_id text,
  primary key (request_id, unit_id)
);
alter table scm.payment_request_recoveries owner to scm_engine;
alter table scm.payment_request_recoveries enable row level security;
revoke all on scm.payment_request_recoveries from anon, authenticated;
grant all on scm.payment_request_recoveries to service_role, pos_app;

create or replace function pos.charge_owner_recoveries(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  req record;
  rec record;
  v_owner text;
  v_day date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_month text;
  v_occurred text;
  stamp text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  adj text;
begin
  select r.id, r.request_no, r.status, r.payee_name into req from scm.payment_requests r where r.id = p_request;
  if not found then return; end if;

  if req.status = 'PAID' then
    for rec in select x.* from scm.payment_request_recoveries x where x.request_id = p_request and x.adjustment_id is null loop
      select u.owner_id into v_owner from pos.units u where u.id = rec.unit_id;
      continue when v_owner is null;   -- no owner to charge yet: tried again on the next change
      -- The paid day, or the first day of the next month the owner's O2 is open in and no final statement covers.
      v_month := to_char(v_day, 'YYYY-MM');
      v_occurred := to_char(v_day, 'YYYY-MM-DD');
      while exists (select 1 from pos.owner_report_locks k where k.unit_id = rec.unit_id and k.stage = 'o2' and k.month = v_month)
         or exists (select 1 from pos.owner_statements s where s.owner_id = v_owner and s.state in ('finalised', 'sent', 'paid')
                      and substr(s.period_start::text, 1, 7) = v_month) loop
        v_month := to_char((v_month || '-01')::date + interval '1 month', 'YYYY-MM');
        v_occurred := v_month || '-01';
      end loop;
      adj := gen_random_uuid()::text;
      insert into pos.owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source,
                                         created_by, created_at, updated_at)
      values (adj, v_owner, rec.unit_id, 'charge', -rec.amount_sen::integer,
              left(format('Paid by the company, recovered from the owner: %s (%s)', req.payee_name, req.request_no), 300),
              v_occurred, req.request_no, 'open', 'manual',
              (select u.id from pos.users u where u.id = rec.set_by), stamp, stamp);
      update scm.payment_request_recoveries set adjustment_id = adj where request_id = rec.request_id and unit_id = rec.unit_id;
    end loop;
  else
    -- No longer paid: an open charge on no closed statement and kept by no O2 lock goes; any other stays for finance.
    for rec in select x.* from scm.payment_request_recoveries x where x.request_id = p_request and x.adjustment_id is not null loop
      delete from pos.owner_adjustments a
       where a.id = rec.adjustment_id and a.state = 'open'
         and (a.statement_id is null or exists (select 1 from pos.owner_statements s where s.id = a.statement_id and s.state = 'provisional'))
         and not exists (select 1 from pos.owner_report_locks k where k.stage = 'o2'
                           and k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id)));
      if found then
        update scm.payment_request_recoveries set adjustment_id = null where request_id = rec.request_id and unit_id = rec.unit_id;
      end if;
    end loop;
  end if;
end $$;
revoke all on function pos.charge_owner_recoveries(uuid) from public;

create or replace function scm.payment_request_recovery_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'payment_requests' then
    if new.status is distinct from old.status and (new.status = 'PAID' or old.status = 'PAID') then
      perform pos.charge_owner_recoveries(new.id);
    end if;
  else
    perform pos.charge_owner_recoveries(new.request_id);
  end if;
  return null;
end $$;
revoke all on function scm.payment_request_recovery_trigger() from public;

create trigger payment_requests_owner_recovery after update of status on scm.payment_requests
  for each row execute function scm.payment_request_recovery_trigger();
-- Only a new or changed amount: the function's own write of adjustment_id must not call it again (a second charge).
create trigger payment_request_recoveries_charge after insert or update of amount_sen, unit_id on scm.payment_request_recoveries
  for each row execute function scm.payment_request_recovery_trigger();
