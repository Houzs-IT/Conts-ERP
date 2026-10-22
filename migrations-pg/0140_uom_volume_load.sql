-- REVERSAL: delete from scm.product_uoms where code in ('CUM','CUFT','LOAD','ROOM') and no SKU or document line uses them.
-- Renovation units still missing after the full list (owner, 22 Oct 2026): cubic volume (concrete, screed, sand,
-- debris) and a lorry load (debris / rubbish disposal, sand delivery), plus per room for room-based packages.
set local search_path = scm, public, extensions;

insert into scm.product_uoms (code, label, print_label, measure, builtin, sort_order) values
  ('CUM',  'Cubic metre',            'M3',    false, false, 93),
  ('CUFT', 'Cubic foot',             'CU FT', false, false, 94),
  ('LOAD', 'Lorry load',             'LOAD',  false, false, 143),
  ('ROOM', 'Room',                   'ROOM',  false, false, 132)
on conflict (code) do nothing;
