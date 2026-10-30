-- Notion SO re-import (owner, 29-30 Oct 2026): address and property type of the 79 projects, from what the PDFs
-- give (building and unit only) plus the area where the building's area is certain. Fills blank fields only, so
-- nothing typed by staff is replaced. Layout and built-up area are not on the PDFs: staff fill them
-- (docs/so-import/README.md). Applied to production before the import, in one transaction.
with area(building, address2, city, postcode, state) as (values
  ('AVA', 'Kiara Bay, Kepong', 'Kuala Lumpur', null, 'Kuala Lumpur'),
  ('HILLPARK', 'Bangsar Hill Park', 'Kuala Lumpur', null, 'Kuala Lumpur'),
  ('SKYLINE KL', 'Pudu', 'Kuala Lumpur', null, 'Kuala Lumpur'),
  ('ARTE MK', 'Mont Kiara', 'Kuala Lumpur', null, 'Kuala Lumpur'),
  ('CITIZEN', 'Old Klang Road', 'Kuala Lumpur', null, 'Kuala Lumpur'),
  ('LEGACY OUG', 'Taman OUG', 'Kuala Lumpur', null, 'Kuala Lumpur'),
  ('FORESTA', 'Bandar Sri Damansara', 'Kuala Lumpur', null, 'Kuala Lumpur'),
  ('THE HIPSTER', 'Taman Desa', 'Kuala Lumpur', null, 'Kuala Lumpur'),
  ('JERNIH', null, 'Kajang', null, 'Selangor'),
  ('CYBER SERIN', null, 'Cyberjaya', '63000', 'Selangor'),
  ('ICON CITY', null, 'Petaling Jaya', null, 'Selangor'),
  ('CHERAS MAHKOTA', 'Bandar Mahkota Cheras', 'Cheras', null, 'Selangor'),
  ('ALIRA', 'Subang', null, null, 'Selangor'),
  ('NILAI', null, 'Nilai', null, 'Negeri Sembilan'),
  ('CARRES PENANG', null, null, null, 'Pulau Pinang'),
  ('CARRES JB', null, 'Johor Bahru', null, 'Johor')
), target as (
  select p.id, p.building, p.unit_no, a.address2, a.city, a.postcode, a.state,
         case when p.id = 98 then '18, USJ 2/4P'
              when p.unit_no is not null then p.unit_no || ', ' || p.building
              else p.building end as address1,
         case when p.id in (98, 79, 68) then 'Landed'          -- 18 USJ 2/4P, NILAI LANDED NO.425, CANDELA @ CHERAS NO.46
              when p.unit_no ~ '\d+-\d+' or p.unit_no ~ '^[A-Z]+\d' then 'Condo'
              else null end as property_type
    from public.projects p
    left join area a on a.building = p.building
   where p.id in (select project_id from scm.mfg_sales_orders where note like 'Imported from Notion SO PDF%')
)
update public.projects p set
  address1 = coalesce(p.address1, t.address1),
  address2 = coalesce(p.address2, t.address2),
  city = coalesce(p.city, case when p.id = 98 then 'Subang Jaya' else t.city end),
  postcode = coalesce(p.postcode, case when p.id = 98 then '47600' else t.postcode end),
  state = coalesce(p.state, case when p.id = 98 then 'Selangor' else t.state end),
  country = coalesce(p.country, 'Malaysia'),
  property_type = coalesce(p.property_type, t.property_type),
  updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
from target t where p.id = t.id;
