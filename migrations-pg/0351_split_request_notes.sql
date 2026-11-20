-- 0351_split_request_notes: the five utility payment requests split into one per bill on 20 Nov 2026 (#1089) still
-- carry the note they were sent with, "9 Tenaga Nasional Berhad bills from a scan on the Utility bills screen.", while
-- each now holds one bill (chew, 20 Nov 2026: "帮我改"). Each note now names its one bill and its unit and says the
-- others became requests of their own. Only the note changes: no line, amount, file or status.
--
-- The requests: PRQ-2611-016, 019, 025, 026 and 037, each with one bill left on it in Property OS and a note that
-- still counts several bills. Anything else, or not exactly five of them, stops the migration and changes nothing.
--
-- REVERSAL: the old notes are kept in public.pos_migrations' audit only by this comment; each was
--   '<N> <provider> bills from a scan on the Utility bills screen.' (N and provider as in the new note).

set local lock_timeout = '5s';

do $$
declare n integer;
begin
  with kept as (
    -- The bill left on each request is the one Property OS still links to it (pos.expenses.payment_request_id); a
    -- request that came back (037, rejected) keeps its old lines in the engine until Send again, so its line is the one
    -- for that bill's unit.
    select r.id, r.note, l.description, coalesce(u.building || ' ' || nullif(u.unit_code, ''), '') as unit,
           (regexp_match(r.note, '^([0-9]+) (.+) bills from a scan on the Utility bills screen\.$')) as m
      from scm.payment_requests r
      join lateral (select e.unit_id from pos.expenses e where e.payment_request_id = r.id::text) e on true
      join lateral (select x.description, x.unit_id from scm.payment_request_lines x
                     where x.request_id = r.id and x.unit_id = e.unit_id order by x.sort limit 1) l on true
      left join public.conts_units u on u.id = l.unit_id
     where r.request_no in ('PRQ-2611-016', 'PRQ-2611-019', 'PRQ-2611-025', 'PRQ-2611-026', 'PRQ-2611-037')
       and r.source_key like 'utility:%'
       and (select count(*) from pos.expenses y where y.payment_request_id = r.id::text) = 1
  )
  update scm.payment_requests r
     set note = left(format('%s%s, from a scan on the Utility bills screen. The other %s %s bills of that scan were split into requests of their own on 20 Nov 2026, one request per bill.',
                            k.description, case when k.unit <> '' then ' (' || k.unit || ')' else '' end, (k.m)[1]::int - 1, (k.m)[2]), 500)
    from kept k
   where r.id = k.id and k.m is not null and (k.m)[1]::int > 1;
  get diagnostics n = row_count;
  if n <> 5 then
    raise exception '0351: expected to change 5 request notes, found %; nothing changed', n;
  end if;
end $$;
