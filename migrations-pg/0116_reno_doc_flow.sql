-- REVERSAL: drop trigger trg_reno_flow_delivery_order on scm.delivery_orders; drop trigger trg_reno_flow_delivery_order_item on scm.delivery_order_items; drop trigger trg_reno_flow_sales_invoice on scm.sales_invoices; drop trigger trg_reno_flow_sales_invoice_item on scm.sales_invoice_items; drop trigger trg_reno_flow_po_item on scm.purchase_order_items; drop trigger trg_reno_flow_po_item_project on scm.purchase_order_items; drop trigger trg_reno_flow_grn on scm.grns; drop trigger trg_reno_flow_grn_item on scm.grn_items; drop trigger trg_reno_flow_grn_item_project on scm.grn_items; drop function scm.reno_flow_delivery_order(), scm.reno_flow_delivery_order_item(), scm.reno_flow_sales_invoice(), scm.reno_flow_sales_invoice_item(), scm.reno_flow_po_item(), scm.reno_flow_po_item_project(), scm.reno_flow_grn(), scm.reno_flow_grn_item(), scm.reno_flow_grn_item_project(), scm.reno_flow_on(), scm.reno_so_item_room(uuid), scm.reno_so_project(text); alter table scm.grn_items drop column room, drop column category_group, drop column sub_category; alter table scm.purchase_order_items drop column room, drop column category_group, drop column sub_category; alter table scm.purchase_orders drop column project_id, drop column category_group, drop column sub_category; alter table scm.sales_invoice_items drop column room; alter table scm.sales_invoices drop column project_id, drop column building, drop column unit_no; alter table scm.delivery_order_items drop column room; alter table scm.delivery_orders drop column project_id, drop column building, drop column unit_no; alter table scm.reno_quotation_revisions drop column site_address, drop column property_type, drop column layout_label, drop column bedrooms, drop column bathrooms, drop column built_up_sqft;
-- Renovation document flow (owner, 14 Oct 2026, "batch 4"): Quotation -> SO -> DO -> PO -> GR -> SI all carry the
-- customer, property and room information the SO holds since migration 0112. Field-by-field list:
-- docs/superpowers/plans/2026-10-14-reno-doc-flow-fields.md.
--
-- * The quotation revision gets the rest of the shared block: site address, property type, layout (label, bedrooms,
--   bathrooms) and built-up sq ft. The engine reads and writes them (scm/lib/renovation-doc-flow.ts) and copies them
--   onto the sales order when the quotation is converted.
-- * Delivery orders and sales invoices keep their own copy of the project, building and unit; their lines keep the
--   room. Purchase orders keep the project; their lines keep the room and the product's category / sub-category.
--   A goods receipt takes the PO's project (scm.grns.project_id, which site receipts already use) and each line takes
--   its PO line's room and category.
-- * The copying is done here, by BEFORE / AFTER INSERT triggers, so every create path gets it the same (Houzs's
--   "from SO" screens, a hand-made DO naming its SO, the renovation PO split, progress billing, a GR from a PO).
--   The customer's phone, email and delivery address (lines, city, postcode, state, country) are filled from the SO as
--   the SO holds them, where the insert left them blank. A trigger only fills what the insert left blank, and only when the install runs renovation projects
--   (public.app_settings projects_mode = 'renovation'). A Houzs SO's project_id can name an exhibition: only a
--   renovation project is copied.
-- * A renovation PO (one with a project) holds one category: purchase_orders.category_group, and sub_category while
--   every line shares one. A line of another category is refused (owner, 14 Oct 2026: POs are split by category, so one
--   SO maps to many POs). Houzs furniture POs have no project and are never checked.
-- * Existing renovation-mode documents are filled once at the end.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- Until it is applied the engine keeps working: every read of these columns checks they exist first.
set local search_path = scm, public, extensions;

alter table scm.reno_quotation_revisions
  add column site_address text not null default '',
  add column property_type text not null default '',
  add column layout_label text not null default '',
  add column bedrooms integer check (bedrooms is null or bedrooms between 0 and 20),
  add column bathrooms integer check (bathrooms is null or bathrooms between 0 and 20),
  add column built_up_sqft numeric(10, 2) check (built_up_sqft is null or built_up_sqft > 0);

alter table scm.delivery_orders
  add column project_id bigint references public.projects(id) on delete set null,
  add column building text,
  add column unit_no text;
alter table scm.delivery_order_items add column room text;

alter table scm.sales_invoices
  add column project_id bigint references public.projects(id) on delete set null,
  add column building text,
  add column unit_no text;
alter table scm.sales_invoice_items add column room text;

-- A renovation PO holds ONE category (owner, 14 Oct 2026): category_group always, sub_category when every line shares one.
alter table scm.purchase_orders
  add column project_id bigint references public.projects(id) on delete set null,
  add column category_group text,
  add column sub_category text;
alter table scm.purchase_order_items
  add column room text,
  add column category_group text,
  add column sub_category text;

alter table scm.grn_items
  add column room text,
  add column category_group text,
  add column sub_category text;

create index delivery_orders_project_idx on scm.delivery_orders (project_id) where project_id is not null;
create index sales_invoices_project_idx on scm.sales_invoices (project_id) where project_id is not null;
create index purchase_orders_project_idx on scm.purchase_orders (project_id) where project_id is not null;

-- True when this install runs renovation projects.
create or replace function scm.reno_flow_on() returns boolean
language sql stable as $$
  select exists (select 1 from public.app_settings where key = 'projects_mode' and value = 'renovation')
$$;

-- An SO line's room: the line's own (0112), else, on a contract converted from a quotation, its contract line's
-- room or that line's section heading (migration 0068).
create or replace function scm.reno_so_item_room(p_item uuid) returns text
language sql stable as $$
  select coalesce(
    (select nullif(trim(i.room), '') from scm.mfg_sales_order_items i where i.id = p_item),
    (select coalesce(nullif(trim(l.room), ''), nullif(trim(s.heading), ''))
       from scm.reno_doc_lines l join scm.reno_doc_sections s on s.id = l.section_id
      where l.so_item_id = p_item and s.so_doc_no is not null
      order by l.created_at limit 1))
$$;

-- An SO's renovation project (an exhibition linked to a Houzs order is not one).
create or replace function scm.reno_so_project(p_doc text) returns bigint
language sql stable as $$
  select o.project_id from scm.mfg_sales_orders o join public.projects p on p.id = o.project_id and p.project_kind = 'renovation'
   where o.doc_no = p_doc
$$;

create or replace function scm.reno_flow_delivery_order() returns trigger
language plpgsql as $$
declare so record;
begin
  if new.so_doc_no is null or not scm.reno_flow_on() then return new; end if;
  select o.building, o.unit_no, o.phone, o.email, o.address1, o.address2, o.city, o.postcode, o.customer_state, o.customer_country
    into so from scm.mfg_sales_orders o where o.doc_no = new.so_doc_no;
  if not found then return new; end if;
  new.project_id := coalesce(new.project_id, scm.reno_so_project(new.so_doc_no));
  new.building := coalesce(nullif(new.building, ''), so.building);
  new.unit_no := coalesce(nullif(new.unit_no, ''), so.unit_no);
  new.phone := coalesce(nullif(new.phone, ''), so.phone);
  new.email := coalesce(nullif(new.email, ''), so.email);
  new.address1 := coalesce(nullif(new.address1, ''), so.address1);
  new.address2 := coalesce(nullif(new.address2, ''), so.address2);
  new.city := coalesce(nullif(new.city, ''), so.city);
  new.postcode := coalesce(nullif(new.postcode, ''), so.postcode);
  new.state := coalesce(nullif(new.state, ''), so.customer_state);
  new.customer_state := coalesce(nullif(new.customer_state, ''), so.customer_state);
  new.customer_country := coalesce(nullif(new.customer_country, ''), so.customer_country);
  return new;
end $$;

create or replace function scm.reno_flow_delivery_order_item() returns trigger
language plpgsql as $$
begin
  if nullif(new.room, '') is not null or new.so_item_id is null or not scm.reno_flow_on() then return new; end if;
  new.room := scm.reno_so_item_room(new.so_item_id);
  return new;
end $$;

create or replace function scm.reno_flow_sales_invoice() returns trigger
language plpgsql as $$
declare src text; so record; d_so text; d_project bigint; d_building text; d_unit text;
begin
  if not scm.reno_flow_on() then return new; end if;
  if new.delivery_order_id is not null then
    select x.so_doc_no, x.project_id, x.building, x.unit_no into d_so, d_project, d_building, d_unit
      from scm.delivery_orders x where x.id = new.delivery_order_id;
  end if;
  src := coalesce(new.so_doc_no, d_so);
  if src is not null then
    select o.building, o.unit_no, o.phone, o.email, o.address1, o.address2, o.city, o.postcode, o.customer_state, o.customer_country
      into so from scm.mfg_sales_orders o where o.doc_no = src;
    if found then
      new.project_id := coalesce(new.project_id, scm.reno_so_project(src));
      new.building := coalesce(nullif(new.building, ''), so.building);
      new.unit_no := coalesce(nullif(new.unit_no, ''), so.unit_no);
      new.phone := coalesce(nullif(new.phone, ''), so.phone);
      new.email := coalesce(nullif(new.email, ''), so.email);
      new.address1 := coalesce(nullif(new.address1, ''), so.address1);
      new.address2 := coalesce(nullif(new.address2, ''), so.address2);
      new.city := coalesce(nullif(new.city, ''), so.city);
      new.postcode := coalesce(nullif(new.postcode, ''), so.postcode);
      new.state := coalesce(nullif(new.state, ''), so.customer_state);
      new.customer_state := coalesce(nullif(new.customer_state, ''), so.customer_state);
      new.customer_country := coalesce(nullif(new.customer_country, ''), so.customer_country);
    end if;
  end if;
  new.project_id := coalesce(new.project_id, d_project);
  new.building := coalesce(nullif(new.building, ''), d_building);
  new.unit_no := coalesce(nullif(new.unit_no, ''), d_unit);
  return new;
end $$;

create or replace function scm.reno_flow_sales_invoice_item() returns trigger
language plpgsql as $$
begin
  if nullif(new.room, '') is not null or not scm.reno_flow_on() then return new; end if;
  if new.so_item_id is not null then new.room := scm.reno_so_item_room(new.so_item_id); end if;
  if nullif(new.room, '') is null and new.do_item_id is not null then
    select nullif(x.room, '') into new.room from scm.delivery_order_items x where x.id = new.do_item_id;
  end if;
  return new;
end $$;

create or replace function scm.reno_flow_po_item() returns trigger
language plpgsql as $$
declare p record; other text;
begin
  if not scm.reno_flow_on() then return new; end if;
  if nullif(new.room, '') is null and new.so_item_id is not null then new.room := scm.reno_so_item_room(new.so_item_id); end if;
  if new.category_group is null and new.item_code is not null then
    select m.category_group, m.sub_category into p from scm.mfg_products m
     where m.code = new.item_code and m.company_id = new.company_id order by (m.status::text = 'ACTIVE') desc limit 1;
    if found then
      new.category_group := p.category_group;
      new.sub_category := coalesce(new.sub_category, p.sub_category);
    end if;
  end if;
  /* One category per renovation PO (owner, 14 Oct 2026). A PO is a renovation one when it already has a project or
     this line comes from a renovation project's SO; a Houzs furniture PO is never checked. Earlier lines of the same
     insert are visible here, so a multi-line insert that mixes is refused too. */
  if new.category_group is not null
     and (exists (select 1 from scm.purchase_orders po where po.id = new.purchase_order_id and po.project_id is not null)
          or (new.so_item_id is not null
              and scm.reno_so_project((select i.doc_no from scm.mfg_sales_order_items i where i.id = new.so_item_id)) is not null)) then
    select coalesce(po.category_group, (select x.category_group from scm.purchase_order_items x
                                         where x.purchase_order_id = new.purchase_order_id and x.category_group is not null
                                           and x.category_group <> new.category_group limit 1))
      into other from scm.purchase_orders po where po.id = new.purchase_order_id;
    if other is not null and other <> new.category_group then
      raise exception 'A renovation purchase order holds one category: this PO is %, the line % is %. Raise a separate PO for %.',
        other, coalesce(new.item_code, ''), new.category_group, new.category_group
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- After a PO line lands: a PO with no project takes the project of the SO this line came from, and a project's PO
-- takes its category (and the sub-category while every line shares one).
create or replace function scm.reno_flow_po_item_project() returns trigger
language plpgsql as $$
declare pid bigint;
begin
  if not scm.reno_flow_on() then return null; end if;
  if new.so_item_id is not null then
    select scm.reno_so_project(i.doc_no) into pid from scm.mfg_sales_order_items i where i.id = new.so_item_id;
    if pid is not null then
      update scm.purchase_orders set project_id = pid where id = new.purchase_order_id and project_id is null;
    end if;
  end if;
  update scm.purchase_orders po set
         category_group = coalesce(po.category_group, new.category_group),
         sub_category = (select case when count(*) = count(x.sub_category) and count(distinct x.sub_category) = 1 then min(x.sub_category) end
                           from scm.purchase_order_items x where x.purchase_order_id = po.id)
   where po.id = new.purchase_order_id and po.project_id is not null;
  return null;
end $$;

create or replace function scm.reno_flow_grn() returns trigger
language plpgsql as $$
begin
  if new.project_id is not null or new.purchase_order_id is null or not scm.reno_flow_on() then return new; end if;
  select po.project_id into new.project_id from scm.purchase_orders po where po.id = new.purchase_order_id;
  return new;
end $$;

create or replace function scm.reno_flow_grn_item() returns trigger
language plpgsql as $$
declare pi record;
begin
  if new.purchase_order_item_id is null or not scm.reno_flow_on() then return new; end if;
  select x.room, x.category_group, x.sub_category into pi from scm.purchase_order_items x where x.id = new.purchase_order_item_id;
  if found then
    new.room := coalesce(nullif(new.room, ''), pi.room);
    new.category_group := coalesce(new.category_group, pi.category_group);
    new.sub_category := coalesce(new.sub_category, pi.sub_category);
  end if;
  return new;
end $$;

-- After a GR line lands: a GR with no project takes the project of the PO this line came from.
create or replace function scm.reno_flow_grn_item_project() returns trigger
language plpgsql as $$
declare pid bigint;
begin
  if new.purchase_order_item_id is null or not scm.reno_flow_on() then return null; end if;
  select po.project_id into pid from scm.purchase_order_items x join scm.purchase_orders po on po.id = x.purchase_order_id
   where x.id = new.purchase_order_item_id;
  if pid is not null then
    update scm.grns set project_id = pid where id = new.grn_id and project_id is null;
  end if;
  return null;
end $$;

create trigger trg_reno_flow_delivery_order before insert on scm.delivery_orders
  for each row execute function scm.reno_flow_delivery_order();
create trigger trg_reno_flow_delivery_order_item before insert on scm.delivery_order_items
  for each row execute function scm.reno_flow_delivery_order_item();
create trigger trg_reno_flow_sales_invoice before insert on scm.sales_invoices
  for each row execute function scm.reno_flow_sales_invoice();
create trigger trg_reno_flow_sales_invoice_item before insert on scm.sales_invoice_items
  for each row execute function scm.reno_flow_sales_invoice_item();
create trigger trg_reno_flow_po_item before insert on scm.purchase_order_items
  for each row execute function scm.reno_flow_po_item();
create trigger trg_reno_flow_po_item_project after insert on scm.purchase_order_items
  for each row execute function scm.reno_flow_po_item_project();
create trigger trg_reno_flow_grn before insert on scm.grns
  for each row execute function scm.reno_flow_grn();
create trigger trg_reno_flow_grn_item before insert on scm.grn_items
  for each row execute function scm.reno_flow_grn_item();
create trigger trg_reno_flow_grn_item_project after insert on scm.grn_items
  for each row execute function scm.reno_flow_grn_item_project();

alter function scm.reno_flow_on() owner to scm_engine;
alter function scm.reno_so_item_room(uuid) owner to scm_engine;
alter function scm.reno_so_project(text) owner to scm_engine;
alter function scm.reno_flow_delivery_order() owner to scm_engine;
alter function scm.reno_flow_delivery_order_item() owner to scm_engine;
alter function scm.reno_flow_sales_invoice() owner to scm_engine;
alter function scm.reno_flow_sales_invoice_item() owner to scm_engine;
alter function scm.reno_flow_po_item() owner to scm_engine;
alter function scm.reno_flow_po_item_project() owner to scm_engine;
alter function scm.reno_flow_grn() owner to scm_engine;
alter function scm.reno_flow_grn_item() owner to scm_engine;
alter function scm.reno_flow_grn_item_project() owner to scm_engine;
revoke all on function scm.reno_flow_on(), scm.reno_so_item_room(uuid), scm.reno_so_project(text) from anon, authenticated;
grant execute on function scm.reno_flow_on(), scm.reno_so_item_room(uuid), scm.reno_so_project(text) to pos_app, service_role;

-- Existing renovation-mode documents, filled once (only blanks).
do $$ begin
  if not scm.reno_flow_on() then return; end if;
  update scm.delivery_orders d set project_id = coalesce(d.project_id, scm.reno_so_project(d.so_doc_no)),
         building = coalesce(nullif(d.building, ''), o.building), unit_no = coalesce(nullif(d.unit_no, ''), o.unit_no)
    from scm.mfg_sales_orders o where o.doc_no = d.so_doc_no;
  update scm.delivery_order_items x set room = scm.reno_so_item_room(x.so_item_id) where x.so_item_id is not null and nullif(x.room, '') is null;
  update scm.sales_invoices s set project_id = coalesce(s.project_id, scm.reno_so_project(s.so_doc_no)),
         building = coalesce(nullif(s.building, ''), o.building), unit_no = coalesce(nullif(s.unit_no, ''), o.unit_no)
    from scm.mfg_sales_orders o where o.doc_no = s.so_doc_no;
  update scm.sales_invoice_items x set room = scm.reno_so_item_room(x.so_item_id) where x.so_item_id is not null and nullif(x.room, '') is null;
  update scm.purchase_order_items x set room = scm.reno_so_item_room(x.so_item_id) where x.so_item_id is not null and nullif(x.room, '') is null;
  update scm.purchase_order_items x set category_group = m.category_group, sub_category = m.sub_category
    from scm.mfg_products m where m.code = x.item_code and m.company_id = x.company_id and x.category_group is null;
  update scm.purchase_orders po set project_id = q.pid
    from (select x.purchase_order_id, min(scm.reno_so_project(i.doc_no)) as pid
            from scm.purchase_order_items x join scm.mfg_sales_order_items i on i.id = x.so_item_id group by x.purchase_order_id) q
   where q.purchase_order_id = po.id and po.project_id is null and q.pid is not null;
  update scm.purchase_orders po set category_group = q.cg, sub_category = q.sc
    from (select x.purchase_order_id, min(x.category_group) as cg,
                 case when count(*) = count(x.sub_category) and count(distinct x.sub_category) = 1 then min(x.sub_category) end as sc
            from scm.purchase_order_items x group by x.purchase_order_id having count(distinct x.category_group) = 1) q
   where q.purchase_order_id = po.id and po.project_id is not null and po.category_group is null;
  update scm.grn_items g set room = coalesce(nullif(g.room, ''), x.room), category_group = coalesce(g.category_group, x.category_group),
         sub_category = coalesce(g.sub_category, x.sub_category)
    from scm.purchase_order_items x where x.id = g.purchase_order_item_id;
  update scm.grns g set project_id = po.project_id from scm.purchase_orders po
   where po.id = g.purchase_order_id and g.project_id is null and po.project_id is not null;
end $$;
