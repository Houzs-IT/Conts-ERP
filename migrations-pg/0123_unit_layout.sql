-- REVERSAL: alter table pos.units drop constraint units_layout_type_check, drop constraint units_bathrooms_range, drop constraint units_size_sqft_range, drop column layout_type;
-- Unit layout (owner, 11 Oct 2026, request U1): the Units form gets a Layout section with the layout type, bedrooms,
-- bathrooms and size. bedrooms, bathrooms and size_sqft are on units since 0001; only the layout type is new. Null
-- means not set yet: the form proposes one from the bedrooms. Cleaning and the unit picker read "2 bed · 2 bath".
alter table units add column layout_type text;
alter table units add constraint units_layout_type_check check (layout_type is null or layout_type in
  ('studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_plus_bedroom', 'duplex', 'dual_key', 'penthouse', 'other'));
alter table units add constraint units_bathrooms_range check (bathrooms between 0 and 20) not valid;
alter table units add constraint units_size_sqft_range check (size_sqft is null or size_sqft between 1 and 100000) not valid;
