-- REVERSAL: recreate scm.suppliers_with_derived_category without its last column (drop view, create it as below minus control_account, grant all to scm_engine, pos_app, service_role).
-- The supplier list carries each supplier's own payables control (finance phase 1.5, 24 Oct 2026; 0156 added
-- scm.suppliers.control_account): the payment voucher page picks the control a supplier payment debits from it,
-- and the server refuses any other. The list reads this view, so the column is appended to it (create or replace
-- keeps the view's grants; the column goes last, as a replace requires).
-- APPLY: by hand, to production before the code merges (no staging: finance, 21 Oct 2026); one transaction with its
--   public.pos_migrations row, as scripts/migrate-pg.mjs writes it.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create or replace view scm.suppliers_with_derived_category as
 SELECT id,
    code,
    name,
    whatsapp_number,
    email,
    contact_person,
    phone,
    address,
    state,
    country,
    payment_terms,
    status,
    rating,
    notes,
    supplier_type,
    category,
    tin_number,
    business_reg_no,
    postcode,
    area,
    mobile,
    fax,
    website,
    attention,
    business_nature,
    currency,
    statement_type,
    aging_basis,
    credit_limit_sen,
    created_at,
    updated_at,
    registration_no,
    nature_of_business,
    exemption_no,
    phone2,
    company_id,
    ( SELECT
                CASE
                    WHEN (count(DISTINCT mp.category) = 0) THEN NULL::text
                    WHEN (count(DISTINCT mp.category) = 1) THEN max((mp.category)::text)
                    ELSE 'MIXED'::text
                END AS "case"
           FROM (scm.supplier_material_bindings smb
             LEFT JOIN scm.mfg_products mp ON (((mp.code = smb.item_code) AND (smb.material_kind = 'mfg_product'::scm.material_kind))))
          WHERE (smb.supplier_id = s.id)) AS derived_category,
    control_account
   FROM scm.suppliers s;

notify pgrst, 'reload schema';
