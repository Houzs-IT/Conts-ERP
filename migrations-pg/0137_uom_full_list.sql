-- REVERSAL: delete from scm.product_uoms where builtin = false and code in (<codes below>) and no SKU or document line uses them.
-- Full unit-of-measure list (owner, 22 Oct 2026: "these are all needed", plus liquids and every other common unit).
-- "measure" = a quotation line asks for a length or an area (same meaning as FT / SQFT); only length and area units
-- are measured. Volume, weight, packaging and time units are counted. Codes follow scm.product_uoms_code_check
-- (capital letter + up to 7 letters/digits). Existing units are left as they are.
set local search_path = scm, public, extensions;

insert into scm.product_uoms (code, label, print_label, measure, builtin, sort_order) values
  -- length
  ('MM',    'Millimetre',              'MM',     true,  false, 51),
  ('CM',    'Centimetre',              'CM',     true,  false, 52),
  ('M',     'Metre (linear)',          'M',      true,  false, 53),
  ('INCH',  'Inch',                    'INCH',   true,  false, 54),
  -- area
  ('SQIN',  'Square inch',             'SQ IN',  true,  false, 61),
  ('SQM',   'Square metre',            'SQ M',   true,  false, 62),
  -- volume (liquids)
  ('ML',    'Millilitre',              'ML',     false, false, 90),
  ('L',     'Litre',                   'L',      false, false, 91),
  ('GAL',   'Gallon',                  'GAL',    false, false, 92),
  -- weight
  ('G',     'Gram',                    'G',      false, false, 100),
  ('KG',    'Kilogram',                'KG',     false, false, 101),
  ('TON',   'Tonne',                   'TON',    false, false, 102),
  -- containers and packs
  ('BTL',   'Bottle',                  'BTL',    false, false, 110),
  ('CAN',   'Can / tin',               'CAN',    false, false, 111),
  ('PAIL',  'Pail',                    'PAIL',   false, false, 112),
  ('DRUM',  'Drum',                    'DRUM',   false, false, 113),
  ('TUBE',  'Tube',                    'TUBE',   false, false, 114),
  ('PKT',   'Packet',                  'PKT',    false, false, 115),
  ('CTN',   'Carton',                  'CTN',    false, false, 116),
  ('BDL',   'Bundle',                  'BDL',    false, false, 117),
  -- boards and stock lengths
  ('SHEET', 'Sheet',                   'SHEET',  false, false, 120),
  ('BOARD', 'Board',                   'BOARD',  false, false, 121),
  ('PANEL', 'Panel',                   'PANEL',  false, false, 122),
  ('SLAB',  'Slab',                    'SLAB',   false, false, 123),
  ('LEN',   'Length (batang)',         'LENGTH', false, false, 124),
  -- counts
  ('PAIR',  'Pair',                    'PAIR',   false, false, 130),
  ('DOZ',   'Dozen',                   'DOZ',    false, false, 131),
  -- labour and service
  ('HOUR',  'Hour',                    'HOUR',   false, false, 140),
  ('DAY',   'Day',                     'DAY',    false, false, 141),
  ('TRIP',  'Trip',                    'TRIP',   false, false, 142)
on conflict (code) do nothing;
