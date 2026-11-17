-- The brand intro sentence on quotations, sales orders and variation orders reads "With reference to our meeting
-- regarding the above matter, we are pleased to submit our quotation as follows:" (16 Nov 2026). Only brand profiles
-- still holding the old seeded sentence change; a brand with its own wording keeps it, and a document's own intro is
-- left alone. The NOTICE prints how many brands changed: 0 means the stored text differs from the seed.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0328, dry run first.
-- REVERSAL:
--   UPDATE scm.reno_brand_profiles SET intro = 'We refer to our meeting with regards the above captioned matter and we are pleased to submit our quotation as follow : -'
--    WHERE intro = 'With reference to our meeting regarding the above matter, we are pleased to submit our quotation as follows:';
do $$
declare
  changed integer;
begin
  update scm.reno_brand_profiles
     set intro = 'With reference to our meeting regarding the above matter, we are pleased to submit our quotation as follows:'
   where intro = 'We refer to our meeting with regards the above captioned matter and we are pleased to submit our quotation as follow : -';
  get diagnostics changed = row_count;
  raise notice '0328 brand profiles changed: %', changed;
end $$;
