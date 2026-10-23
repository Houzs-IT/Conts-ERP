-- REVERSAL: delete from scm.state_warehouse_mappings where notes = '0152 default'; delete from scm.warehouses where code = 'CONTS-WH';
-- Conts default warehouse (24 Oct 2026). The engine refuses to confirm a sales order whose delivery State has no
-- warehouse (so-location-gate.ts, kept from Houzs: Conts's company row still carries the code HOUZS). Conts had no
-- warehouse at all, so every sales order could only stay a Draft, and with it no VO, PO, goods receipt or delivery
-- order. One default warehouse, every Malaysian State mapped to it; a State can be moved to another warehouse later
-- in the warehouse settings. Re-runnable: nothing is added twice.
set local search_path = public, extensions;

insert into scm.warehouses (code, name, type, is_active, is_default, company_id, country)
select 'CONTS-WH', 'Conts Warehouse', 'warehouse', true, true, 1, 'Malaysia'
where not exists (select 1 from scm.warehouses where code = 'CONTS-WH' and company_id = 1);

insert into scm.state_warehouse_mappings (state, warehouse_id, notes, company_id)
select s.state, w.id, '0152 default', 1
  from (values ('Johor'), ('Kedah'), ('Kelantan'), ('Kuala Lumpur'), ('Labuan'), ('Melaka'), ('Negeri Sembilan'), ('Pahang'),
               ('Perak'), ('Perlis'), ('Pulau Pinang'), ('Putrajaya'), ('Sabah'), ('Sarawak'), ('Selangor'), ('Terengganu')) as s(state)
  join scm.warehouses w on w.code = 'CONTS-WH' and w.company_id = 1
 where not exists (select 1 from scm.state_warehouse_mappings m where m.state = s.state and m.company_id = 1);
