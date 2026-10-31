-- One-off fix of the 79 imported renovation sales orders, in place (owner, 31 Oct 2026, option A).
-- Run once against production inside one transaction; it opens no accounts and changes no amounts or numbers.
--
-- 1. Contract headings that were really a size or a note printed at the top of a PDF page
--    ("W : 1.5 F X D : 2 FT X H : 9 FT", "* NO LIGHT", ...): the note goes back onto the line above it and that
--    heading's lines join the section before. Each fix is made on the SO's contract and on its quotation revision.
-- 2. The SO's rooms become areas of the home, named by the system's own room rule (roomSectionHeadings in
--    engine/backend/src/scm/shared/renovation-property.ts, SO order from generateRooms): Common area, Living hall,
--    Bedroom 1..N, Bathroom 1..M. Master bedroom = Bedroom 1, master bathroom = Bathroom 1, as in the PDFs'
--    "MASTER / BEDROOM 2 / BEDROOM 3" numbering. A line naming no room (kitchen, yard, entrance, whole house) is
--    Common area. The contract's own section headings stay as printed.

create function pg_temp.area_one(t text) returns text language sql immutable as $$
  select case
    when t ~ 'MASTER\s*(BED\s*)?(ROOM\s*)?(TOILET|BATH)' then 'Bathroom 1'
    when t ~ '\m(TOILET|BATH\s*ROOM|BATH|WASH\s*ROOM|WC)\s*0?[1-9]\M'
      then 'Bathroom ' || substring(t from '\m(?:TOILET|BATH\s*ROOM|BATH|WASH\s*ROOM|WC)\s*0?([1-9])\M')
    when t ~ '\mMASTER\M' then 'Bedroom 1'
    when t ~ '\m(BED\s*ROOM|BEDRM|ROOM|BR)\s*0?[1-9]\M'
      then 'Bedroom ' || substring(t from '\m(?:BED\s*ROOM|BEDRM|ROOM|BR)\s*0?([1-9])\M')
    when t ~ '\m(TOILET|BATH\s*ROOM|WASH\s*ROOM|WC\M)' then 'BATH?'
    when t ~ '\mBED\s*ROOM' then 'BED?'
    when t ~ '\m(LIVING|SOFA|DINING|DININING|FAMILY\s*(HALL|AREA))|\mTV\s*(AREA|WALL)' then 'Living hall'
  end
$$;
-- wording that names two places ("MASTER & LIVING", "TOILET & MASTER TOILET") is Common area
create function pg_temp.area_many(t text) returns text language sql immutable as $$
  select case when count(distinct a) = 1 then max(a) when count(distinct a) > 1 then 'Common area' end
    from (select pg_temp.area_one(p) as a from regexp_split_to_table(t, '\s*(&|\+|,|\mAND\M)\s*') p) x where a is not null
$$;
-- the part after the last "@" names the place ("SHOE CABINET @ CAR POUCH"); read it first
create function pg_temp.area_of(t text) returns text language sql immutable as $$
  select coalesce(case when upper(t) like '%@%' then pg_temp.area_many(regexp_replace(upper(t), '^.*@', '')) end,
                  pg_temp.area_many(upper(coalesce(t, ''))))
$$;

create temp table imported on commit drop as
  select value as doc_no from scm.app_config where key like 'note:so-notion-import:%';

-- 1. headings --------------------------------------------------------------------------------------------
update scm.reno_doc_sections set heading = 'WALL DESIGN FOR SELECTED AREA -MIX & MATCH WITH WALLPAPER/VASARI PAINT/FLUTED PANEL)'
 where id in ('9da51e3f-d467-4f0d-9194-b9e886741163', '2dfaded3-b336-4b7b-9b18-438551aaf205');

create temp table merge_into (false_id uuid, prev_id uuid) on commit drop;
insert into merge_into values
  ('9d2a258b-b9fd-415a-9847-0314b3677f0e', '8a8990e5-3366-47b7-bc08-9e8141bb5c11'), -- TC-SO-2605-004
  ('3c385809-cbe0-4f08-bc86-759d69b3dc30', '9b6b33c8-679f-4a88-9fee-1bb357d3dd44'),
  ('c7bc4a8f-b7a7-42b2-9b49-bc45fcf2f924', '7f26b405-cc6c-4453-bc2c-b7c4988c8ea1'), -- TC-SO-2605-009
  ('12985603-2da6-4171-a4f8-cd83088fcec8', '4db63b6d-6b9a-44c7-abe5-bc58e8751131'),
  ('383e0d2c-5ccb-4c88-acf4-8e91523666e1', '61e2a676-42cf-4d43-82d3-c921828ebe12'), -- TC-SO-2608-002
  ('31d2fab8-75db-4a74-9a45-c6edc3330d7e', '3d9516e4-39a0-4c44-8579-8c0c5e487dfb'),
  ('fe22e59b-d505-4da9-9d4f-374c94112f33', '872d2229-db03-4af9-a9e0-af703aa1ec43'), -- TC-SO-2610-005 size
  ('42017ef5-2b3d-49ff-8278-89d4306be85c', 'a3c19bbf-a315-4ea6-abc3-1d020f59805d'),
  ('c0dc86bb-0183-458e-a3ba-237e3c01fc01', '876ef67a-23d6-4dea-8fe4-5ce4c05731da'), -- TC-SO-2610-005 note
  ('458a7489-4ec6-4dee-bea7-9441768d757a', 'a83925be-5ce7-4976-925d-a232631a455a');

-- the note onto the last line of the section before (contract line, and its SO line's remark)
create temp table note_to on commit drop as
  select m.false_id, m.prev_id, s.heading as note,
         (select l.id from scm.reno_doc_lines l where l.section_id = m.prev_id order by l.sort_order desc limit 1) as line_id
    from merge_into m join scm.reno_doc_sections s on s.id = m.false_id;
update scm.reno_doc_lines l set description = l.description || ' - ' || n.note, updated_at = now()
  from note_to n where l.id = n.line_id;
update scm.mfg_sales_order_items i set remark = coalesce(i.remark, i.description) || ' - ' || n.note
  from note_to n join scm.reno_doc_lines l on l.id = n.line_id where i.id = l.so_item_id;
update scm.reno_doc_lines l
   set section_id = m.prev_id,
       sort_order = (select coalesce(max(p.sort_order), 0) from scm.reno_doc_lines p where p.section_id = m.prev_id) + 1 + l.sort_order,
       updated_at = now()
  from merge_into m where l.section_id = m.false_id;
delete from scm.reno_doc_sections s using merge_into m where s.id = m.false_id;

-- TC-SO-2609-001: a terms paragraph read as a RM 0 text line under a heading "works."
delete from scm.reno_doc_lines where id in ('34616b61-1965-48ec-b310-33b1dd9cb62a', 'edca7dcb-391c-4931-b898-c252597c4376') and kind = 'TEXT';
delete from scm.reno_doc_sections where id in ('2ac533d3-80a8-4a87-87b5-5357c1753b86', '7dab973d-13ce-45f7-bd10-58dd7d4e7221')
   and not exists (select 1 from scm.reno_doc_lines l where l.section_id = reno_doc_sections.id);

-- 2. areas ------------------------------------------------------------------------------------------------
create temp table line_area on commit drop as
  select i.id, i.doc_no,
         coalesce(pg_temp.area_of(coalesce(i.remark, i.description)),
                  pg_temp.area_of((select s.heading from scm.reno_doc_lines l join scm.reno_doc_sections s on s.id = l.section_id
                                    where l.so_item_id = i.id limit 1)),
                  pg_temp.area_of(i.room),
                  'Common area') as area
    from scm.mfg_sales_order_items i join imported d on d.doc_no = i.doc_no;
-- an unnumbered toilet / bedroom is the second one when the order also has the master one, else the first
update line_area a set area = case a.area
    when 'BATH?' then case when exists (select 1 from line_area b where b.doc_no = a.doc_no and b.area = 'Bathroom 1') then 'Bathroom 2' else 'Bathroom 1' end
    when 'BED?'  then case when exists (select 1 from line_area b where b.doc_no = a.doc_no and b.area = 'Bedroom 1') then 'Bedroom 2' else 'Bedroom 1' end
  end
 where a.area in ('BATH?', 'BED?');

update scm.mfg_sales_order_items i set room = a.area from line_area a where i.id = a.id and i.room is distinct from a.area;
update scm.mfg_sales_orders o set room_sections = r.rooms
  from (select doc_no, jsonb_agg(area order by
               case when area = 'Common area' then 0 when area = 'Living hall' then 1 when area like 'Bedroom %' then 2 else 3 end,
               nullif(regexp_replace(area, '\D', '', 'g'), '')::int nulls first) as rooms
          from (select distinct doc_no, area from line_area) x group by doc_no) r
 where o.doc_no = r.doc_no;

-- checks
select (select count(*) from imported) as sos,
       (select count(*) from line_area) as lines,
       (select sum(total_sen) from scm.mfg_sales_order_items i join imported d using (doc_no)) as total_sen,
       (select count(*) from scm.reno_doc_sections s where s.company_id = 1 and s.vo_id is null
           and (s.heading ~ '^\s*[-*(]' or s.heading ~ '(^|\s)(W|H|D)\s*:' or s.heading = 'works.')) as false_headings_left,
       (select jsonb_object_agg(area, n) from (select area, count(*) n from line_area group by area) z) as by_area;
