-- REVERSAL: drop trigger trg_reservations_cancelled_at on pos.reservations; drop function pos.reservations_cancelled_at(); alter table pos.reservations drop column cancelled_at; (the "Cancelled this month" company view keeps its new filters; reset it from Views if wanted)
-- When a reservation was cancelled (owner request R4, 11 Oct 2026: "Cancelled this month" means cancelled during this
-- month, not a cancelled stay that falls in it). ISO instant, like every other *_at column.
--
-- Set by a trigger, not by each writer: a reservation becomes cancelled in the drawer, by Channex, by the HostPlatform
-- import, by closing a repair job (its calendar block) and through any path added later. The stamp is the moment the
-- state changes to cancelled; a reinstated reservation loses it. A row inserted already cancelled (an import of an old
-- cancellation) keeps whatever the insert gives, normally nothing: when it was cancelled is not known, and stamping the
-- import time would put every old cancellation into this month. Readers fall back to the stay dates when it is empty.
set local search_path = pos;

alter table reservations add column if not exists cancelled_at text;

create or replace function reservations_cancelled_at() returns trigger language plpgsql as $$
begin
  if new.state = 'cancelled' then
    if old.state is distinct from 'cancelled' and new.cancelled_at is not distinct from old.cancelled_at then
      new.cancelled_at := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    end if;
  else
    new.cancelled_at := null;
  end if;
  return new;
end $$;
alter function reservations_cancelled_at() owner to pos_app;

drop trigger if exists trg_reservations_cancelled_at on reservations;
create trigger trg_reservations_cancelled_at before update of state on reservations
  for each row execute function reservations_cancelled_at();

-- Reservations already cancelled: the last time the audit log saw one become cancelled (a reinstated and cancelled
-- again stay counts from its latest cancellation, the one that stands). None found: left empty.
update reservations r set cancelled_at = a.at
from (
  select entity_id, max(occurred_at) as at from audit_log
  where entity_table = 'reservations'
    and (action = 'channex.booking_cancelled'
         or (action in ('reservation.status', 'reservation.cancel', 'reservation.block_released') and after_state like '%"state":"cancelled"%'))
  group by entity_id
) a
where a.entity_id = r.id and r.state = 'cancelled' and r.cancelled_at is null;

-- The seeded company view "Cancelled this month" (functions/_lib/tableLayoutSeeds.ts) moves to the cancellation date,
-- only where it is still exactly as seeded: a view someone renamed, changed or saved again is left alone.
update table_layouts t
set layout = jsonb_set(t.layout, '{filters}', '{"view":"cancelled","cancelledFrom":"@month_start","cancelledTo":"@month_end"}'::jsonb)
where t.id = 'seed.bookings.cancelled-this-month' and t.user_id is null and t.name = 'Cancelled this month'
  and t.layout -> 'filters' = '{"view":"cancelled","from":"@month_start","to":"@month_end"}'::jsonb
  and not exists (select 1 from audit_log a where a.entity_table = 'table_layouts' and a.entity_id = t.id and a.action = 'table_view.update');
