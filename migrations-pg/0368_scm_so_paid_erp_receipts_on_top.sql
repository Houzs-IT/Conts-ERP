-- REVERSAL: re-run migrations-pg/0365_scm_so_paid_counts_paid_before_golive.sql. Writes no row. GRANTS: none -
--   CREATE OR REPLACE VIEW keeps the existing grants.
--
-- The SO list's Paid and Balance: money recorded on the order in the ERP counts on top of what AutoCount was paid
-- before go-live, whatever its date (chew, 23 Nov 2026: "我保留mk这笔然后当做autocount没有这笔"). 0365 took the
-- order payments dated before go-live out of AutoCount's figure, as AutoCount's own money; the ERP's books start on
-- the ledger start, and a payment AutoCount also recorded now has AutoCount's copy taken back
-- (acc/autocount-journals reverseAutocountJournals) and its opening documents raised by it. Same rule as the engine's
-- billing view (scm/lib/renovation-billing) and the Renovation projects page (acc/reno-projects). Only extra_sen
-- changes; columns, order and types unchanged.

CREATE OR REPLACE VIEW scm.mfg_sales_orders_with_payment_totals AS
 SELECT so.doc_no,
    so.transfer_to,
    so.so_date,
    so.branding,
    so.debtor_code,
    so.debtor_name,
    so.agent,
    so.sales_location,
    so.ref,
    so.venue,
    so.venue_id,
    so.address1,
    so.address2,
    so.address3,
    so.address4,
    so.phone,
    so.mattress_sofa_sen,
    so.bedframe_sen,
    so.accessories_sen,
    so.others_sen,
    so.mattress_sofa_cost_sen,
    so.bedframe_cost_sen,
    so.accessories_cost_sen,
    so.others_cost_sen,
    so.service_sen,
    so.service_cost_sen,
    so.local_total_sen,
    so.balance_sen,
    so.total_cost_sen,
    so.total_revenue_sen,
    so.total_margin_sen,
    so.margin_pct_basis,
    so.line_count,
    so.fabric_tier_addon_sen,
    so.delivery_fee_sen,
    so.cross_category_source_doc_no,
    so.currency,
    so.status,
    so.remark2,
    so.remark3,
    so.remark4,
    so.note,
    so.proceeded_at,
    so.sales_exemption_expiry,
    so.customer_id,
    so.customer_state,
    so.customer_country,
    so.customer_po_image_b64,
    so.customer_so_no,
    so.hub_id,
    so.hub_name,
    so.customer_delivery_date,
    so.processing_date,
    so.linked_do_doc_no,
    so.ship_to_address,
    so.bill_to_address,
    so.install_to_address,
    so.subtotal_sen,
    so.overdue,
    so.email,
    so.customer_type,
    so.salesperson_id,
    so.city,
    so.postcode,
    so.building_type,
    so.emergency_contact_name,
    so.emergency_contact_phone,
    so.emergency_contact_relationship,
    so.target_date,
    so.signature_b64,
    so.slip_key,
    so.slip_state,
    so.payment_method,
    so.installment_months,
    so.merchant_provider,
    so.approval_code,
    so.payment_date,
    so.deposit_sen,
    so.paid_sen,
    so.created_at,
    so.created_by,
    so.updated_at,
    so.priority_rank,
    so.priority_set_at,
    so.priority_set_by,
    so.priority_reason,
    so.allocation_warehouse_id,
    so.slip_image_key,
    so.receipt_image_key,
    so.delivery_state,
    so.possession_date,
    so.house_type,
    so.replacement_disposal,
    so.referral,
    so.amend_date_from_customer,
    so.amended_delivery_date,
    so.amend_reason,
    so.revision,
    so.company_id,
    (COALESCE(p.paid_total, 0::bigint) + COALESCE(g.extra_sen, 0::bigint))::bigint AS paid_total_sen,
    (so.local_total_sen - COALESCE(p.paid_total, 0::bigint) - COALESCE(g.extra_sen, 0::bigint))::bigint AS balance_sen_live,
    so.on_hold,
    so.hold_reason,
    so.held_at,
    so.held_by,
    so.collaborator_staff_ids,
    so.access_staff_ids,
    so.open_to_all
   FROM scm.mfg_sales_orders so
     LEFT JOIN ( SELECT x.so_doc_no,
            sum(x.amount_sen)::bigint AS paid_total
           FROM ( SELECT mfg_sales_order_payments.so_doc_no, mfg_sales_order_payments.amount_sen::bigint AS amount_sen
                   FROM scm.mfg_sales_order_payments
                UNION ALL
                 SELECT si.so_doc_no, LEAST(si.paid_sen, GREATEST(si.total_sen, 0))::bigint AS amount_sen
                   FROM scm.sales_invoices si
                  WHERE si.so_doc_no IS NOT NULL AND si.paid_sen > 0
                    AND si.status::text <> ALL (ARRAY['CANCELLED'::text, 'DRAFT'::text])) x
          GROUP BY x.so_doc_no) p ON p.so_doc_no = so.doc_no
     LEFT JOIN ( WITH k AS (
                 SELECT o.doc_no, o.company_id, trim(o.debtor_code) AS debtor,
                        COALESCE(o.so_date, '9999-12-31'::date) AS sort_date,
                        GREATEST(COALESCE(c.billed_before_golive_sen, 0::bigint), COALESCE(c.golive_contract_sen, 0::bigint))::bigint AS billed
                   FROM scm.mfg_sales_orders o
                     JOIN scm.reno_so_contracts c ON c.so_doc_no = o.doc_no
                  WHERE o.status::text <> 'CANCELLED'::text AND NULLIF(trim(o.debtor_code), ''::text) IS NOT NULL
                    AND GREATEST(COALESCE(c.billed_before_golive_sen, 0::bigint), COALESCE(c.golive_contract_sen, 0::bigint)) > 0
               ), owed AS (
                 SELECT d.company_id, d.debtor,
                        GREATEST(0::bigint,
                          COALESCE((SELECT sum(si.total_sen) FROM scm.sales_invoices si
                                     WHERE si.company_id = d.company_id AND trim(si.debtor_code) = d.debtor AND si.opening_balance
                                       AND upper(COALESCE(si.status::text, ''::text)) <> ALL (ARRAY['DRAFT'::text, 'CANCELLED'::text, 'VOID'::text])), 0::bigint)
                        - COALESCE((SELECT sum(cc.amount_sen) FROM scm.customer_credits cc
                                     WHERE cc.company_id = d.company_id AND trim(cc.debtor_code) = d.debtor AND cc.source_type = 'OPENING'::text), 0::bigint))::bigint AS owed_sen
                   FROM (SELECT DISTINCT k.company_id, k.debtor FROM k) d
               ), alloc AS (
                 SELECT k.doc_no, k.company_id, k.billed,
                        COALESCE(sum(k.billed) OVER (PARTITION BY k.company_id, k.debtor ORDER BY k.sort_date, k.doc_no
                                                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric)::bigint AS billed_before_this,
                        w.owed_sen
                   FROM k JOIN owed w ON w.company_id = k.company_id AND w.debtor = k.debtor
               )
               SELECT a.doc_no,
                      GREATEST(0::bigint, a.billed - LEAST(a.billed, GREATEST(0::bigint, a.owed_sen - a.billed_before_this)))::bigint AS extra_sen
                 FROM alloc a) g ON g.doc_no = so.doc_no;
