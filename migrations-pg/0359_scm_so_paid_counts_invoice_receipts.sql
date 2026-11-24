-- REVERSAL: re-run this view with the LEFT JOIN p subquery reading scm.mfg_sales_order_payments alone
--   (sum(amount_sen) grouped by so_doc_no), the definition before this file. Writes no row, so reverting
--   changes no stored data. GRANTS: none - CREATE OR REPLACE VIEW keeps the existing grants.
--
-- "Paid on this sales order" = money taken on the order + receipts taken on its live invoices.
--
-- THE BUG (click sweep 21 Nov 2026, F31): RM 100 recorded on TC-SI-2611-008 (instalment 2 of TC-SO-2611-913)
--   showed on the invoice, but the order's Paid and Balance stayed where they were: paid_total_sen summed
--   scm.mfg_sales_order_payments only.
--
-- THE FIX: paid_total_sen (and so balance_sen_live) also adds each live invoice's paid_sen, capped at the
--   invoice total. Cancelled and draft invoices are left out: a cancelled invoice's receipts became customer
--   credit, which counts when it is applied to another invoice (as a payment row there). The cap leaves an
--   overpayment's excess out for the same reason. Not double counted: the ERP never copies an order payment
--   onto an invoice (engine scm/lib/si-order-deposit.ts applies the deposit without a row). Same rule as
--   engine scm/shared/so-outstanding.ts soPaidSen + soInvoiceReceiptsSen; the SO list, its money cards and its
--   paid/unpaid filters read this view, so they agree with the SO page.
--
-- The body is the live definition (pg_get_viewdef, identical on local and production, md5
--   f7bbc5bf4c7a55a708eff87eb60221a9 on 21 Nov 2026) with only the LEFT JOIN p subquery changed. Column
--   names, order and types are unchanged (paid_total is cast back to bigint).

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
    COALESCE(p.paid_total, 0::bigint) AS paid_total_sen,
    so.local_total_sen - COALESCE(p.paid_total, 0::bigint) AS balance_sen_live,
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
          GROUP BY x.so_doc_no) p ON p.so_doc_no = so.doc_no;
