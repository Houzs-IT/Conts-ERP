-- The rest of Houzs's structure, in schema public: 242 tables, 6 views, 26 enums, 5 functions and 8 triggers
-- (accounts, staff, permissions, projects and the other areas its server code reads on every request).
-- Needed because the supply chain runs here as Houzs's own code, unchanged, and that code is not separable
-- from these tables. Structure only, no rows. Generated on 2026-10-07 from the same read-only catalogue
-- exports as 0044; public.companies already exists from 0044.
-- Unlike Houzs, every table has row level security on and nothing is granted to the anon or authenticated
-- roles: this project's data API is reachable with a public key, and only the server may read these.
-- The rental side (schema pos) is untouched.
-- REVERSAL: drop each object created below (tables, views, types, sequences, functions); none existed before.
set local check_function_bodies = off;
set local search_path = public, extensions;

create type public."addon_kind" as enum ('qty', 'floors_items', 'flat');
create type public."comp_group" as enum ('1-seater', '2-seater', 'Corner', 'L-Shape', 'Accessory');
create type public."consignment_do_status" as enum ('LOADED', 'DISPATCHED', 'IN_TRANSIT', 'SIGNED', 'DELIVERED', 'INVOICED', 'CANCELLED');
create type public."consignment_dr_status" as enum ('PENDING', 'RECEIVED', 'INSPECTED', 'REFUNDED', 'CREDIT_NOTED', 'REJECTED', 'CANCELLED');
create type public."consignment_so_status" as enum ('CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'ON_HOLD', 'CANCELLED');
create type public."currency_code" as enum ('MYR', 'RMB', 'USD', 'SGD');
create type public."delivery_return_status" as enum ('PENDING', 'RECEIVED', 'INSPECTED', 'REFUNDED', 'CREDIT_NOTED', 'REJECTED', 'CANCELLED');
create type public."do_status" as enum ('LOADED', 'DISPATCHED', 'IN_TRANSIT', 'SIGNED', 'DELIVERED', 'INVOICED', 'CANCELLED');
create type public."fabric_category" as enum ('B.M-FABR', 'S-FABR', 'S.M-FABR', 'LINING', 'WEBBING');
create type public."fabric_price_tier" as enum ('PRICE_1', 'PRICE_2', 'PRICE_3');
create type public."grn_status" as enum ('POSTED', 'CLOSED', 'CANCELLED');
create type public."inventory_movement_type" as enum ('IN', 'OUT', 'ADJUSTMENT', 'TRANSFER');
create type public."material_kind" as enum ('mfg_product', 'fabric', 'raw');
create type public."mfg_product_category" as enum ('SOFA', 'BEDFRAME', 'ACCESSORY', 'MATTRESS', 'SERVICE', 'DINING', 'BEDLINES', 'DIFFUSER', 'CARPET', 'OTHERS', 'FABRIC_ACCESSORY');
create type public."mfg_product_status" as enum ('ACTIVE', 'INACTIVE');
create type public."mfg_so_status" as enum ('CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'ON_HOLD', 'CANCELLED');
create type public."po_status" as enum ('SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
create type public."pricing_kind" as enum ('size_variants', 'sofa_build', 'bedframe_build', 'flat', 'tbc');
create type public."purchase_consignment_order_status" as enum ('SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
create type public."purchase_consignment_receive_status" as enum ('POSTED', 'CLOSED', 'CANCELLED');
create type public."purchase_consignment_return_status" as enum ('POSTED', 'COMPLETED', 'CANCELLED');
create type public."purchase_invoice_status" as enum ('POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
create type public."purchase_return_status" as enum ('POSTED', 'COMPLETED', 'CANCELLED');
create type public."sales_invoice_status" as enum ('SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');
create type public."slip_state" as enum ('none', 'pending', 'verified', 'flagged');
create type public."supplier_status" as enum ('ACTIVE', 'INACTIVE', 'BLOCKED');

create sequence public."ac_snapshot_runs_id_seq" as bigint start with 1 increment by 1;
create sequence public."announcement_files_id_seq" as bigint start with 1 increment by 1;
create sequence public."assr_product_categories_id_seq" as integer start with 1 increment by 1;
create sequence public."audit_events_id_seq" as integer start with 1 increment by 1;
create sequence public."client_errors_id_seq" as integer start with 1 increment by 1;
create sequence public."phone_normalisation_backup_id_seq" as bigint start with 1 increment by 1;
create sequence public."positions_id_seq" as integer start with 1 increment by 1;
create sequence public."project_checklist_attachment_actions_id_seq" as bigint start with 1 increment by 1;
create sequence public."project_contractors_id_seq" as bigint start with 1 increment by 1;
create sequence public."push_devices_id_seq" as integer start with 1 increment by 1;
create sequence public."table_layouts_id_seq" as bigint start with 1 increment by 1;
create sequence public."tmp_sheet_capture_id_seq" as integer start with 1 increment by 1;

create table public."_migrations" (
  "name" text not null,
  "applied_at" text not null
);
create table public."_pg_migrations" (
  "filename" text not null,
  "applied_at" timestamp with time zone default now() not null,
  "checksum" text
);
create table public."ac_snapshot_purchase_orders" (
  "doc_no" text not null,
  "doc_date" text,
  "ref" text,
  "so_doc_no" text,
  "creditor_code" text,
  "creditor_name" text,
  "purchase_location" text,
  "doc_status" text,
  "cancelled" integer default 0 not null,
  "local_ex_tax" double precision,
  "local_net_total" double precision,
  "final_total" double precision,
  "currency_code" text,
  "last_modified" text,
  "raw" text,
  "snapshot_at" text not null
);
create table public."ac_snapshot_runs" (
  "id" bigint default nextval('ac_snapshot_runs_id_seq'::regclass) not null,
  "kind" text not null,
  "trigger_type" text not null,
  "status" text not null,
  "fetched" integer default 0 not null,
  "stored" integer default 0 not null,
  "failed" integer default 0 not null,
  "message" text,
  "started_at" text not null,
  "finished_at" text
);
create table public."ac_snapshot_sales_orders" (
  "doc_no" text not null,
  "doc_date" text,
  "ref" text,
  "branding" text,
  "debtor_name" text,
  "sales_location" text,
  "sales_agent" text,
  "venue" text,
  "local_total" double precision,
  "balance" double precision,
  "remark2" text,
  "transfer_to" text,
  "po_doc_no" text,
  "last_modified" text,
  "region_route" text,
  "raw" text,
  "snapshot_at" text not null
);
create table public."addons" (
  "id" text not null,
  "label" text not null,
  "description" text,
  "icon" text not null,
  "kind" public."addon_kind" not null,
  "price" integer not null,
  "per_floor_item" integer,
  "unit" text,
  "default_qty" integer default 1 not null,
  "stock" integer,
  "enabled" boolean default true not null,
  "show_at_handover" boolean default false not null,
  "service_sku" text,
  "sort_order" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."agent_controls" (
  "agent" text not null,
  "paused" integer default 0 not null,
  "auto_approve" integer default 0 not null,
  "updated_at" text,
  "stage" integer default 1 not null,
  "max_stage" integer default 2 not null
);
create table public."agent_decision_outcomes" (
  "id" text not null,
  "decision_id" text not null,
  "agent" text not null,
  "kind" text not null,
  "detail" text,
  "recovery_ref" text,
  "observed_at" text not null,
  "observed_by" text
);
create table public."agent_decisions" (
  "id" text not null,
  "agent" text not null,
  "family" text,
  "decision_class" text not null,
  "statement" text not null,
  "reason" text,
  "evidence" jsonb default '[]'::jsonb not null,
  "options" jsonb default '[]'::jsonb not null,
  "impact" text,
  "policy" text,
  "confidence" numeric(4,3),
  "data_quality" text,
  "reversible" integer default 0 not null,
  "rollback" text,
  "verification" text,
  "approver" text,
  "approval_required" integer default 1 not null,
  "outcome" text,
  "created_at" text not null
);
create table public."agent_feedback" (
  "id" text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) not null,
  "agent" text not null,
  "instruction" text not null,
  "created_by" text,
  "status" text default 'ACTIVE'::text not null,
  "retired_at" text
);
create table public."agent_kill_scopes" (
  "id" text not null,
  "scope_type" text not null,
  "scope_value" text not null,
  "paused" integer default 1 not null,
  "reason" text,
  "updated_at" text not null,
  "updated_by" text
);
create table public."agent_runs" (
  "id" text not null,
  "agent" text not null,
  "started_at" text not null,
  "finished_at" text,
  "status" text default 'running'::text not null,
  "summary" text,
  "tokens_in" integer default 0 not null,
  "tokens_out" integer default 0 not null,
  "error" text
);
create table public."announcement_acks" (
  "announcement_id" text not null,
  "user_id" integer not null,
  "acked_at" text default (now())::text not null,
  "company_id" bigint default 1 not null
);
create table public."announcement_files" (
  "id" bigint default nextval('announcement_files_id_seq'::regclass) not null,
  "announcement_id" text not null,
  "r2_key" text not null,
  "name" text,
  "mime" text,
  "size" integer,
  "uploaded_by" integer,
  "uploaded_at" text not null,
  "removed_by" integer,
  "removed_at" text
);
create table public."announcement_reminders" (
  "announcement_id" text not null,
  "user_id" integer not null,
  "reminded_at" text not null,
  "reminded_by" integer
);
create table public."announcements" (
  "id" text not null,
  "title" text not null,
  "body" text default ''::text not null,
  "is_active" integer default 1 not null,
  "expires_at" text,
  "reminded_at" text,
  "created_by" integer,
  "created_at" text default (now())::text not null,
  "updated_at" text,
  "translations" text,
  "attachments" text,
  "target_type" text default 'ALL_USERS'::text not null,
  "target_dept_ids" text,
  "target_position_ids" text,
  "target_user_ids" text,
  "category" text default 'GENERAL'::text not null,
  "source" text,
  "company_id" bigint default 1 not null,
  "target_company_ids" text,
  "media_layout" text,
  "body_html" text,
  "require_ack" integer default 0 not null,
  "scheduled_at" text,
  "target_divisions" text,
  "excluded_user_ids" text,
  "escalated_at" text,
  "approval_status" text default 'APPROVED'::text not null,
  "submitted_by" integer,
  "submitted_at" text,
  "reviewed_by" integer,
  "reviewed_at" text,
  "reject_reason" text,
  "ref_no" text,
  "client_key" text,
  "voided_by" integer,
  "voided_at" text,
  "void_reason" text,
  "doc_type" text default 'ANN'::text not null,
  "number_dept_id" integer
);
create table public."app_settings" (
  "key" text not null,
  "value" text,
  "updated_at" text,
  "updated_by" bigint
);
create table public."assistant_conversations" (
  "id" text not null,
  "user_id" text not null,
  "title" text,
  "message_count" integer default 0 not null,
  "created_at" text not null,
  "updated_at" text not null,
  "deleted_at" text
);
create table public."assistant_messages" (
  "id" text not null,
  "conversation_id" text not null,
  "user_id" text not null,
  "role" text not null,
  "content" text not null,
  "agents" text,
  "degraded" integer default 0 not null,
  "created_at" text not null
);
create table public."assr_activity" (
  "id" bigint generated by default as identity not null,
  "assr_id" bigint not null,
  "action" text not null,
  "from_value" text,
  "to_value" text,
  "note" text,
  "user_id" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "customer_id" bigint,
  "source" text,
  "archived_at" text,
  "archived_by" bigint,
  "category" text,
  "stage_elapsed_days" double precision,
  "stage_target_days" double precision,
  "source_channel" text,
  "references_entry_id" bigint,
  "is_correction" bigint default 0 not null
);
create table public."assr_alert_acks" (
  "id" bigint generated by default as identity not null,
  "assr_id" bigint not null,
  "stage" text not null,
  "event" text not null,
  "user_id" bigint not null,
  "note" text,
  "snoozed_until" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null
);
create table public."assr_attachments" (
  "id" bigint generated by default as identity not null,
  "assr_id" bigint not null,
  "r2_key" text not null,
  "file_name" text,
  "content_type" text,
  "category" text,
  "uploaded_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "customer_id" bigint,
  "source" text,
  "visible_to_customer" bigint,
  "archived_at" text,
  "archived_by" bigint
);
create table public."assr_case_access" (
  "assr_id" bigint not null,
  "user_id" bigint not null,
  "added_by" bigint,
  "created_at" timestamp with time zone default now() not null
);
create table public."assr_case_categories" (
  "case_id" bigint not null,
  "slug" text not null
);
create table public."assr_cases" (
  "id" bigint generated by default as identity not null,
  "assr_no" text not null,
  "status" text,
  "doc_no" text not null,
  "complained_date" text,
  "customer_name" text,
  "phone" text,
  "location" text,
  "sales_agent" text,
  "item_code" text,
  "complaint_issue" text,
  "action_remark" text,
  "service_category" text,
  "completion_date" text,
  "po_no" text,
  "addr1" text,
  "addr2" text,
  "addr3" text,
  "addr4" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "stage" text not null,
  "resolution_method" text,
  "issue_category" text,
  "priority" text,
  "assigned_to" bigint,
  "ref_no" text,
  "delivery_order" text,
  "do_date" text,
  "closed_at" text,
  "created_by" bigint,
  "satisfaction_rating" bigint,
  "satisfaction_notes" text,
  "approved_by" bigint,
  "approved_at" text,
  "quality_review_passed" bigint,
  "ncr_category" text,
  "po_amount" double precision,
  "supplier_invoice_ref" text,
  "cost_notes" text,
  "sla_hours" bigint,
  "deadline_at" text,
  "escalated_at" text,
  "customer_id" bigint,
  "archived_at" text,
  "archived_by" bigint,
  "customer_email" text,
  "creditor_code" text,
  "customer_amount" double precision,
  "supplier_pickup_at" text,
  "items_ready_at" text,
  "stage_changed_at" text,
  "stage_entered_at" text,
  "stage_target_days" double precision,
  "inspection_result" text,
  "email_for_survey" text,
  "lead_time_profile_id" bigint,
  "verification_outcome" text,
  "verified_root_cause" text,
  "verified_by" bigint,
  "verified_at" text,
  "qc_receipt_date" text,
  "goods_returned_note" text,
  "supplier_service_note" text,
  "customer_pickup_at" text,
  "supplier_accepted_at" text,
  "supplier_quote_labour" real,
  "supplier_quote_materials" real,
  "supplier_quote_at" text,
  "inspection_by" text,
  "assigned_to_2" bigint,
  "company_id" bigint default 1 not null,
  "qc_issue_result" text,
  "creditor_source" text,
  "sub_status" text,
  "inspection_visit_at" text,
  "void_reason" text,
  "pickup_by" text,
  "sched_inspection_date" text,
  "sched_pickup_date" text,
  "sched_delivery_date" text,
  "delivery_by" text
);
create table public."assr_issue_categories" (
  "id" bigint generated by default as identity not null,
  "slug" text not null,
  "name" text not null,
  "sort_order" bigint not null,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."assr_items" (
  "id" bigint generated by default as identity not null,
  "assr_id" bigint not null,
  "item_code" text not null,
  "item_description" text,
  "qty" bigint,
  "remark" text,
  "qty_carton" integer default 1,
  "supplier_remark" text
);
create table public."assr_lead_time_activations" (
  "id" bigint generated by default as identity not null,
  "profile_id" bigint not null,
  "source" text not null,
  "scheduled_id" bigint,
  "user_id" bigint,
  "previous_profile_id" bigint,
  "activated_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null
);
create table public."assr_lead_time_amendments" (
  "id" bigint generated by default as identity not null,
  "profile_id" bigint not null,
  "stage" text not null,
  "before_days" double precision,
  "after_days" double precision not null,
  "reason" text not null,
  "user_id" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null
);
create table public."assr_lead_time_profiles" (
  "id" bigint generated by default as identity not null,
  "name" text not null,
  "description" text,
  "is_active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null,
  "updated_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null
);
create table public."assr_lead_time_scheduled_activations" (
  "id" bigint generated by default as identity not null,
  "profile_id" bigint not null,
  "scheduled_for" text not null,
  "scheduled_by" bigint,
  "reason" text,
  "status" text default 'pending'::text not null,
  "fired_at" text,
  "cancelled_at" text,
  "cancelled_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null
);
create table public."assr_logistics" (
  "id" bigint generated by default as identity not null,
  "assr_id" bigint not null,
  "type" text not null,
  "scheduled_date" text,
  "scheduled_time_range" text,
  "assigned_to" bigint,
  "status" text,
  "notes" text,
  "completed_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "archived_at" text,
  "archived_by" bigint
);
create table public."assr_ncr_categories" (
  "id" bigint generated by default as identity not null,
  "slug" text not null,
  "name" text not null,
  "sort_order" bigint not null,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."assr_priorities" (
  "id" bigint generated by default as identity not null,
  "slug" text not null,
  "name" text not null,
  "sort_order" bigint not null,
  "sla_hours" bigint,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."assr_priority_stage_targets" (
  "id" bigint generated by default as identity not null,
  "priority_id" bigint not null,
  "stage" text not null,
  "target_days" double precision not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null,
  "updated_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null
);
create table public."assr_product_categories" (
  "id" integer default nextval('assr_product_categories_id_seq'::regclass) not null,
  "slug" text not null,
  "name" text not null,
  "sort_order" integer default 0 not null,
  "active" integer default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."assr_resolution_methods" (
  "id" bigint generated by default as identity not null,
  "slug" text not null,
  "name" text not null,
  "sort_order" bigint not null,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."assr_stage_history" (
  "id" bigint generated by default as identity not null,
  "assr_id" bigint not null,
  "stage" text not null,
  "entered_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) not null,
  "exited_at" text,
  "target_days" double precision,
  "status" text,
  "skipped" bigint default 0 not null,
  "skip_reason" text,
  "alerts_fired" bigint not null,
  "snoozes_applied" bigint default 0 not null
);
create table public."assr_stage_targets" (
  "id" bigint generated by default as identity not null,
  "profile_id" bigint not null,
  "stage" text not null,
  "target_days" double precision not null
);
create table public."assr_supplier_returns" (
  "id" bigint generated always as identity not null,
  "assr_id" bigint not null,
  "round_no" integer not null,
  "pickup_at" text,
  "returned_at" text,
  "qc_result" text,
  "creditor_code" text,
  "reason" text,
  "note" text,
  "created_by" bigint,
  "created_at" text default to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text) not null,
  "updated_at" text default to_char((now() AT TIME ZONE 'utc'::text), 'YYYY-MM-DD HH24:MI:SS'::text) not null,
  "archived_at" text,
  "ref_no" text
);
create table public."assr_supplier_tokens" (
  "id" bigint generated by default as identity not null,
  "token" text not null,
  "assr_id" bigint not null,
  "creditor_code" text,
  "expires_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null,
  "last_seen_at" text,
  "revoked_at" text
);
create table public."assr_survey_tokens" (
  "token" text not null,
  "assr_id" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "expires_at" text,
  "submitted_at" text
);
create table public."audit_events" (
  "id" integer default nextval('audit_events_id_seq'::regclass) not null,
  "created_at" timestamp with time zone default now() not null,
  "actor_id" integer,
  "actor_email" text,
  "action" text not null,
  "entity_type" text,
  "entity_id" text,
  "summary" text,
  "meta" text,
  "ip" text,
  "request_id" text
);
create table public."autocount_delivery_orders" (
  "doc_no" text not null,
  "doc_date" text,
  "ref" text,
  "debtor_name" text,
  "sales_agent" text,
  "total" double precision,
  "cancelled" integer default 0 not null,
  "so_doc_nos" text,
  "last_modified" text,
  "synced_at" text
);
create table public."bedframe_colours" (
  "id" text not null,
  "label" text not null,
  "swatch_hex" text,
  "surcharge" integer default 0 not null,
  "active" boolean default true not null,
  "sort_order" integer default 0 not null
);
create table public."bedframe_options" (
  "id" text not null,
  "kind" text not null,
  "value" text not null,
  "surcharge" integer default 0 not null,
  "active" boolean default true not null,
  "sort_order" integer default 0 not null
);
create table public."brand_share_tokens" (
  "token" text not null,
  "brand" text not null,
  "revoked_at" text,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."bundle_library" (
  "id" text not null,
  "label" text not null,
  "sub" text not null,
  "signature" text not null,
  "base_width_cm" integer not null,
  "base_depth_cm" integer not null,
  "cushions" integer not null,
  "default_price" integer not null,
  "art_left" text,
  "art_right" text,
  "art_base" text,
  "sort_order" integer default 0 not null
);
create table public."case_track_tokens" (
  "token" text not null,
  "assr_id" bigint not null,
  "source" text not null,
  "verified_phone" text,
  "expires_at" text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "revoked_at" text
);
create table public."categories" (
  "id" text not null,
  "label" text not null,
  "icon" text not null,
  "tbc" boolean default false not null,
  "hero_image_key" text,
  "sort_order" integer default 0 not null
);
create table public."client_errors" (
  "id" integer default nextval('client_errors_id_seq'::regclass) not null,
  "occurred_at" text not null,
  "day" text not null,
  "user_id" integer default 0 not null,
  "company_id" integer,
  "route" text default ''::text not null,
  "message" text not null,
  "stack" text,
  "build_id" text default ''::text not null,
  "user_agent" text,
  "dedup_hash" text not null,
  "count" integer default 1 not null,
  "last_seen_at" text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) not null
);
create table public."collection_agent_briefs" (
  "id" text not null,
  "brief" jsonb not null,
  "ai_focus" text,
  "created_at" text default (now())::text not null
);
create table public."collection_agent_proposals" (
  "id" text not null,
  "kind" text not null,
  "key" text not null,
  "status" text default 'PENDING'::text not null,
  "payload" jsonb,
  "summary" text,
  "created_at" text default (now())::text not null,
  "decided_at" text,
  "decided_by" text
);
create table public."compartment_library" (
  "id" text not null,
  "comp_group" public."comp_group" not null,
  "label" text not null,
  "width_cm" integer not null,
  "depth_cm" integer not null,
  "cushions" integer default 1 not null,
  "default_price" integer not null,
  "art_filename" text,
  "is_accessory" boolean default false not null,
  "sort_order" integer default 0 not null
);
create table public."config_proposals" (
  "id" text not null,
  "generated_at" text not null,
  "param_key" text not null,
  "current_value" text,
  "proposed_value" text not null,
  "reason" text,
  "status" text default 'PENDING'::text not null,
  "decided_at" text,
  "decided_by" text
);
create table public."consignment_delivery_order_items" (
  "id" uuid default gen_random_uuid() not null,
  "consignment_delivery_order_id" uuid not null,
  "consignment_so_item_id" uuid,
  "item_code" text not null,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "qty" integer not null,
  "m3_milli" integer default 0 not null,
  "unit_price_centi" integer default 0 not null,
  "discount_centi" integer default 0 not null,
  "line_total_centi" integer default 0 not null,
  "unit_cost_centi" integer default 0 not null,
  "line_cost_centi" integer default 0 not null,
  "line_margin_centi" integer default 0 not null,
  "variants" jsonb,
  "notes" text,
  "line_delivery_date" date,
  "line_delivery_date_overridden" boolean default false not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."consignment_delivery_order_payments" (
  "id" uuid default gen_random_uuid() not null,
  "consignment_delivery_order_id" uuid not null,
  "paid_at" date default now() not null,
  "method" text not null,
  "merchant_provider" text,
  "installment_months" integer,
  "online_type" text,
  "approval_code" text,
  "amount_centi" integer not null,
  "account_sheet" text,
  "collected_by" integer,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."consignment_delivery_orders" (
  "id" uuid default gen_random_uuid() not null,
  "do_number" text not null,
  "consignment_so_doc_no" text,
  "debtor_code" text,
  "debtor_name" text not null,
  "do_date" date default now() not null,
  "expected_delivery_at" date,
  "customer_delivery_date" date,
  "signed_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "dispatched_at" timestamp with time zone,
  "driver_id" uuid,
  "driver_name" text,
  "vehicle" text,
  "m3_total_milli" integer default 0 not null,
  "address1" text,
  "address2" text,
  "city" text,
  "state" text,
  "postcode" text,
  "phone" text,
  "salesperson_id" integer,
  "agent" text,
  "email" text,
  "customer_type" text,
  "building_type" text,
  "branding" text,
  "venue" text,
  "venue_id" uuid,
  "ref" text,
  "customer_so_no" text,
  "po_doc_no" text,
  "sales_location" text,
  "customer_state" text,
  "customer_country" text,
  "note" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "emergency_contact_relationship" text,
  "mattress_sofa_centi" integer default 0 not null,
  "bedframe_centi" integer default 0 not null,
  "accessories_centi" integer default 0 not null,
  "others_centi" integer default 0 not null,
  "mattress_sofa_cost_centi" integer default 0 not null,
  "bedframe_cost_centi" integer default 0 not null,
  "accessories_cost_centi" integer default 0 not null,
  "others_cost_centi" integer default 0 not null,
  "local_total_centi" integer default 0 not null,
  "total_cost_centi" integer default 0 not null,
  "total_margin_centi" integer default 0 not null,
  "margin_pct_basis" integer default 0 not null,
  "line_count" integer default 0 not null,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "warehouse_id" uuid,
  "pod_r2_key" text,
  "signature_data" text,
  "status" public."consignment_do_status" default 'LOADED'::consignment_do_status not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."consignment_delivery_return_items" (
  "id" uuid default gen_random_uuid() not null,
  "consignment_delivery_return_id" uuid not null,
  "consignment_do_item_id" uuid,
  "item_code" text not null,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "qty_returned" integer not null,
  "condition" text,
  "unit_price_centi" integer default 0 not null,
  "discount_centi" integer default 0 not null,
  "line_total_centi" integer default 0 not null,
  "unit_cost_centi" integer default 0 not null,
  "line_cost_centi" integer default 0 not null,
  "line_margin_centi" integer default 0 not null,
  "refund_centi" integer default 0 not null,
  "variants" jsonb,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."consignment_delivery_returns" (
  "id" uuid default gen_random_uuid() not null,
  "return_number" text not null,
  "do_number" text,
  "consignment_do_id" uuid,
  "debtor_code" text,
  "debtor_name" text not null,
  "return_date" date default now() not null,
  "reason" text,
  "status" public."consignment_dr_status" default 'PENDING'::consignment_dr_status not null,
  "received_at" timestamp with time zone,
  "inspected_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "refund_centi" integer default 0 not null,
  "inspection_notes" text,
  "salesperson_id" integer,
  "agent" text,
  "email" text,
  "customer_type" text,
  "building_type" text,
  "branding" text,
  "venue" text,
  "venue_id" uuid,
  "ref" text,
  "customer_so_no" text,
  "sales_location" text,
  "customer_state" text,
  "customer_country" text,
  "note" text,
  "address1" text,
  "address2" text,
  "city" text,
  "state" text,
  "postcode" text,
  "phone" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "emergency_contact_relationship" text,
  "mattress_sofa_centi" integer default 0 not null,
  "bedframe_centi" integer default 0 not null,
  "accessories_centi" integer default 0 not null,
  "others_centi" integer default 0 not null,
  "mattress_sofa_cost_centi" integer default 0 not null,
  "bedframe_cost_centi" integer default 0 not null,
  "accessories_cost_centi" integer default 0 not null,
  "others_cost_centi" integer default 0 not null,
  "local_total_centi" integer default 0 not null,
  "total_cost_centi" integer default 0 not null,
  "total_margin_centi" integer default 0 not null,
  "margin_pct_basis" integer default 0 not null,
  "line_count" integer default 0 not null,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "warehouse_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."consignment_sales_order_items" (
  "id" uuid default gen_random_uuid() not null,
  "doc_no" text not null,
  "line_date" date default now() not null,
  "debtor_code" text,
  "debtor_name" text,
  "agent" text,
  "item_group" text,
  "item_code" text not null,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "location" text,
  "warehouse_id" uuid,
  "qty" integer default 1 not null,
  "unit_price_centi" integer default 0 not null,
  "discount_centi" integer default 0 not null,
  "total_centi" integer default 0 not null,
  "tax_centi" integer default 0 not null,
  "total_inc_centi" integer default 0 not null,
  "balance_centi" integer default 0 not null,
  "payment_status" text default 'Unchecked'::text not null,
  "venue" text,
  "branding" text,
  "remark" text,
  "cancelled" boolean default false not null,
  "variants" jsonb,
  "unit_cost_centi" integer default 0 not null,
  "line_cost_centi" integer default 0 not null,
  "line_margin_centi" integer default 0 not null,
  "divan_price_sen" integer default 0 not null,
  "leg_price_sen" integer default 0 not null,
  "special_order_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_delivery_date" date,
  "line_delivery_date_overridden" boolean default false not null,
  "photo_urls" text[] default '{}'::text[] not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."consignment_sales_order_payments" (
  "id" uuid default gen_random_uuid() not null,
  "so_doc_no" text not null,
  "paid_at" date default now() not null,
  "method" text not null,
  "merchant_provider" text,
  "installment_months" integer,
  "online_type" text,
  "approval_code" text,
  "amount_centi" integer not null,
  "account_sheet" text,
  "collected_by" integer,
  "note" text,
  "is_deposit" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."consignment_sales_orders" (
  "doc_no" text not null,
  "transfer_to" text,
  "so_date" date default now() not null,
  "branding" text,
  "debtor_code" text,
  "debtor_name" text not null,
  "agent" text,
  "sales_location" text,
  "ref" text,
  "po_doc_no" text,
  "venue" text,
  "venue_id" uuid,
  "address1" text,
  "address2" text,
  "address3" text,
  "address4" text,
  "phone" text,
  "mattress_sofa_centi" integer default 0 not null,
  "bedframe_centi" integer default 0 not null,
  "accessories_centi" integer default 0 not null,
  "others_centi" integer default 0 not null,
  "mattress_sofa_cost_centi" integer default 0 not null,
  "bedframe_cost_centi" integer default 0 not null,
  "accessories_cost_centi" integer default 0 not null,
  "others_cost_centi" integer default 0 not null,
  "local_total_centi" integer default 0 not null,
  "balance_centi" integer default 0 not null,
  "total_cost_centi" integer default 0 not null,
  "total_revenue_centi" integer default 0 not null,
  "total_margin_centi" integer default 0 not null,
  "margin_pct_basis" integer default 0 not null,
  "line_count" integer default 0 not null,
  "subtotal_sen" integer,
  "overdue" text,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "status" public."consignment_so_status" default 'CONFIRMED'::consignment_so_status not null,
  "remark2" text,
  "remark3" text,
  "remark4" text,
  "note" text,
  "processing_date" date,
  "sales_exemption_expiry" date,
  "customer_id" uuid,
  "customer_state" text,
  "customer_country" text,
  "customer_po" text,
  "customer_po_id" text,
  "customer_po_date" date,
  "customer_po_image_b64" text,
  "customer_so_no" text,
  "hub_id" uuid,
  "hub_name" text,
  "customer_delivery_date" date,
  "internal_expected_dd" date,
  "linked_do_doc_no" text,
  "ship_to_address" text,
  "bill_to_address" text,
  "install_to_address" text,
  "email" text,
  "customer_type" text,
  "salesperson_id" integer,
  "city" text,
  "postcode" text,
  "building_type" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "emergency_contact_relationship" text,
  "target_date" date,
  "signature_b64" text,
  "payment_method" text,
  "installment_months" integer,
  "merchant_provider" text,
  "approval_code" text,
  "payment_date" date,
  "deposit_centi" integer default 0 not null,
  "paid_centi" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."consignment_so_audit_log" (
  "id" uuid default gen_random_uuid() not null,
  "so_doc_no" text not null,
  "action" text not null,
  "actor_id" integer,
  "actor_name_snapshot" text,
  "field_changes" jsonb default '[]'::jsonb not null,
  "status_snapshot" text,
  "source" text default 'web'::text,
  "note" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."contractor_share_tokens" (
  "token" text not null,
  "contractor" text not null,
  "revoked_at" text,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."creditors" (
  "creditor_code" text not null,
  "company_name" text,
  "desc2" text,
  "address1" text,
  "address2" text,
  "address3" text,
  "address4" text,
  "post_code" text,
  "deliver_address1" text,
  "deliver_address2" text,
  "deliver_address3" text,
  "deliver_address4" text,
  "deliver_post_code" text,
  "attention" text,
  "phone1" text,
  "phone2" text,
  "mobile" text,
  "fax1" text,
  "fax2" text,
  "email" text,
  "web_url" text,
  "contact_info" text,
  "nature_of_business" text,
  "currency_code" text,
  "display_term" text,
  "rounding_method" text,
  "inclusive_tax" bigint,
  "price_category" text,
  "statement_type" text,
  "aging_on" text,
  "credit_limit" double precision,
  "overdue_limit" double precision,
  "tax_code" text,
  "tax_register_no" text,
  "gst_register_no" text,
  "sst_register_no" text,
  "self_billed_approval_no" text,
  "exempt_no" text,
  "exempt_expiry_date" text,
  "register_no" text,
  "gst_status_verified_date" text,
  "area_code" text,
  "area_description" text,
  "area_desc2" text,
  "type" text,
  "type_description" text,
  "type_desc2" text,
  "purchase_agent" text,
  "purchase_agent_description" text,
  "parent_acc_no" text,
  "note" text,
  "last_modified" text,
  "last_modified_user_id" text,
  "created_timestamp" text,
  "created_user_id" text,
  "is_active" bigint default 1,
  "raw" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "company_id" bigint default 1 not null
);
create table public."cs_agent_briefs" (
  "id" text not null,
  "brief" jsonb not null,
  "ai_focus" text,
  "created_at" text default (now())::text not null
);
create table public."cs_agent_proposals" (
  "id" text not null,
  "kind" text not null,
  "key" text not null,
  "status" text default 'PENDING'::text not null,
  "payload" jsonb,
  "summary" text,
  "created_at" text default (now())::text not null,
  "decided_at" text,
  "decided_by" text
);
create table public."customers" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "phone" text,
  "email" text,
  "customer_code" text,
  "address" text,
  "address_line2" text,
  "postcode" text,
  "city" text,
  "state" text,
  "notes" text,
  "first_seen_at" timestamp with time zone default now() not null,
  "last_seen_at" timestamp with time zone default now() not null
);
create table public."daily_inspections" (
  "id" bigint generated by default as identity not null,
  "lorry_id" bigint not null,
  "driver_user_id" bigint not null,
  "inspection_date" text not null,
  "checklist_json" text not null,
  "passed" bigint not null,
  "notes" text,
  "photo_r2_keys" text,
  "submitted_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."delivery_agent_briefs" (
  "id" text not null,
  "brief" jsonb not null,
  "ai_focus" text,
  "created_at" text default (now())::text not null
);
create table public."delivery_agent_proposals" (
  "id" text not null,
  "kind" text not null,
  "key" text not null,
  "status" text default 'PENDING'::text not null,
  "payload" jsonb,
  "summary" text,
  "created_at" text default (now())::text not null,
  "decided_at" text,
  "decided_by" text
);
create table public."delivery_order_items" (
  "id" uuid default gen_random_uuid() not null,
  "delivery_order_id" uuid not null,
  "so_item_id" uuid,
  "item_code" text not null,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "qty" integer not null,
  "m3_milli" integer default 0 not null,
  "unit_price_centi" integer default 0 not null,
  "discount_centi" integer default 0 not null,
  "line_total_centi" integer default 0 not null,
  "unit_cost_centi" integer default 0 not null,
  "line_cost_centi" integer default 0 not null,
  "line_margin_centi" integer default 0 not null,
  "notes" text,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "variants" jsonb,
  "line_delivery_date" date,
  "line_delivery_date_overridden" boolean default false not null,
  "line_no" integer,
  "created_at" timestamp with time zone default now() not null
);
create table public."delivery_order_payments" (
  "id" uuid default gen_random_uuid() not null,
  "delivery_order_id" uuid not null,
  "paid_at" date default now() not null,
  "method" text not null,
  "merchant_provider" text,
  "installment_months" integer,
  "online_type" text,
  "approval_code" text,
  "amount_centi" integer not null,
  "account_sheet" text,
  "collected_by" integer,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."delivery_orders" (
  "id" uuid default gen_random_uuid() not null,
  "do_number" text not null,
  "so_doc_no" text,
  "debtor_code" text,
  "debtor_name" text not null,
  "do_date" date default now() not null,
  "expected_delivery_at" date,
  "customer_delivery_date" date,
  "signed_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "dispatched_at" timestamp with time zone,
  "driver_id" uuid,
  "driver_name" text,
  "vehicle" text,
  "m3_total_milli" integer default 0 not null,
  "address1" text,
  "address2" text,
  "city" text,
  "state" text,
  "postcode" text,
  "phone" text,
  "salesperson_id" integer,
  "agent" text,
  "email" text,
  "customer_type" text,
  "building_type" text,
  "branding" text,
  "venue" text,
  "venue_id" uuid,
  "ref" text,
  "customer_so_no" text,
  "po_doc_no" text,
  "sales_location" text,
  "customer_state" text,
  "customer_country" text,
  "note" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "emergency_contact_relationship" text,
  "mattress_sofa_centi" integer default 0 not null,
  "bedframe_centi" integer default 0 not null,
  "accessories_centi" integer default 0 not null,
  "others_centi" integer default 0 not null,
  "service_centi" integer default 0 not null,
  "mattress_sofa_cost_centi" integer default 0 not null,
  "bedframe_cost_centi" integer default 0 not null,
  "accessories_cost_centi" integer default 0 not null,
  "others_cost_centi" integer default 0 not null,
  "service_cost_centi" integer default 0 not null,
  "local_total_centi" integer default 0 not null,
  "total_cost_centi" integer default 0 not null,
  "total_margin_centi" integer default 0 not null,
  "margin_pct_basis" integer default 0 not null,
  "line_count" integer default 0 not null,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "warehouse_id" uuid,
  "pod_r2_key" text,
  "signature_data" text,
  "status" public."do_status" default 'LOADED'::do_status not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."delivery_return_items" (
  "id" uuid default gen_random_uuid() not null,
  "delivery_return_id" uuid not null,
  "do_item_id" uuid,
  "item_code" text not null,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "qty_returned" integer not null,
  "condition" text,
  "unit_price_centi" integer default 0 not null,
  "discount_centi" integer default 0 not null,
  "line_total_centi" integer default 0 not null,
  "unit_cost_centi" integer default 0 not null,
  "line_cost_centi" integer default 0 not null,
  "line_margin_centi" integer default 0 not null,
  "refund_centi" integer default 0 not null,
  "variants" jsonb,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."delivery_returns" (
  "id" uuid default gen_random_uuid() not null,
  "return_number" text not null,
  "do_doc_no" text,
  "delivery_order_id" uuid,
  "sales_invoice_id" uuid,
  "debtor_code" text,
  "debtor_name" text not null,
  "return_date" date default now() not null,
  "reason" text,
  "status" public."delivery_return_status" default 'PENDING'::delivery_return_status not null,
  "received_at" timestamp with time zone,
  "inspected_at" timestamp with time zone,
  "refunded_at" timestamp with time zone,
  "refund_centi" integer default 0 not null,
  "inspection_notes" text,
  "salesperson_id" integer,
  "agent" text,
  "email" text,
  "customer_type" text,
  "building_type" text,
  "branding" text,
  "venue" text,
  "venue_id" uuid,
  "ref" text,
  "customer_so_no" text,
  "sales_location" text,
  "customer_state" text,
  "customer_country" text,
  "note" text,
  "address1" text,
  "address2" text,
  "city" text,
  "state" text,
  "postcode" text,
  "phone" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "emergency_contact_relationship" text,
  "mattress_sofa_centi" integer default 0 not null,
  "bedframe_centi" integer default 0 not null,
  "accessories_centi" integer default 0 not null,
  "others_centi" integer default 0 not null,
  "mattress_sofa_cost_centi" integer default 0 not null,
  "bedframe_cost_centi" integer default 0 not null,
  "accessories_cost_centi" integer default 0 not null,
  "others_cost_centi" integer default 0 not null,
  "local_total_centi" integer default 0 not null,
  "total_cost_centi" integer default 0 not null,
  "total_margin_centi" integer default 0 not null,
  "margin_pct_basis" integer default 0 not null,
  "line_count" integer default 0 not null,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "warehouse_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."delivery_status_log" (
  "id" bigint generated by default as identity not null,
  "doc_no" text not null,
  "from_status" text,
  "to_status" text not null,
  "changed_by" bigint,
  "notes" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."delivery_tracking" (
  "doc_no" text not null,
  "region" text not null,
  "status" text not null,
  "do_ready_at" text,
  "shipout_date" text,
  "pickup_confirmed_at" text,
  "est_arrival_date" text,
  "arrived_warehouse_at" text,
  "est_delivery_date" text,
  "out_for_delivery_at" text,
  "delivered_at" text,
  "failed_at" text,
  "failure_reason" text,
  "order_revenue" double precision,
  "budget_pct" double precision,
  "budget_amount" double precision,
  "freight_cost" double precision,
  "last_mile_cost" double precision,
  "total_cost" double precision,
  "customer_transport_fee" double precision,
  "delivery_method" text,
  "trip_id" bigint,
  "vendor_id" bigint,
  "em_warehouse" text,
  "vendor_name" text,
  "notes" text,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "do_email_sent_at" text
);
create table public."departments" (
  "id" bigint generated by default as identity not null,
  "name" text not null,
  "description" text,
  "color" text not null,
  "sort_order" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "lead_user_id" integer,
  "headcount_target" integer,
  "code" text
);
create table public."document_agent_briefs" (
  "id" text not null,
  "generated_at" text not null,
  "brief" jsonb not null,
  "ai_focus" text
);
create table public."document_agent_findings" (
  "id" text not null,
  "kind" text not null,
  "severity" text default 'WARN'::text not null,
  "doc_type" text not null,
  "doc_id" text not null,
  "doc_no" text,
  "summary" text not null,
  "payload" jsonb default '{}'::jsonb not null,
  "status" text default 'OPEN'::text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) not null,
  "last_seen_at" text not null,
  "resolved_at" text
);
create table public."document_refs" (
  "ref_no" text not null,
  "series" text not null,
  "dept_code" text not null,
  "type_code" text not null,
  "yymm" text not null,
  "seq" integer not null,
  "entity_type" text not null,
  "entity_id" text not null,
  "status" text default 'ACTIVE'::text not null,
  "created_by" integer,
  "created_at" text not null,
  "voided_by" integer,
  "voided_at" text,
  "void_reason" text
);
create table public."document_types" (
  "code" text not null,
  "label" text not null,
  "attachment_required" integer default 0 not null,
  "is_active" integer default 1 not null,
  "created_at" text not null,
  "updated_at" text
);
create table public."email_address_access" (
  "id" text not null,
  "address_id" text not null,
  "user_id" integer not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "created_by" integer,
  "company_id" bigint default 1 not null
);
create table public."email_addresses" (
  "id" text not null,
  "address" text not null,
  "label" text,
  "assigned_user_id" integer,
  "assigned_user_name" text,
  "assigned_dept" text,
  "assigned_position" text,
  "active" integer default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "created_by" integer,
  "company_id" bigint default 1 not null
);
create table public."email_attachments" (
  "id" text not null,
  "message_id" text not null,
  "filename" text,
  "content_type" text,
  "size_bytes" integer,
  "storage_path" text,
  "content_id" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."email_labels" (
  "id" text not null,
  "name" text not null,
  "color" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "created_by" integer,
  "company_id" bigint default 1 not null
);
create table public."email_log" (
  "id" bigint generated by default as identity not null,
  "purpose" text not null,
  "ref_type" text,
  "ref_id" bigint,
  "to_addr" text not null,
  "subject" text,
  "status" text not null,
  "provider_id" text,
  "error" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."email_messages" (
  "id" text not null,
  "thread_id" text not null,
  "direction" text not null,
  "message_id" text,
  "in_reply_to" text,
  "reference_ids" text,
  "from_address" text,
  "from_name" text,
  "to_addresses" text,
  "cc_addresses" text,
  "subject" text,
  "text_body" text,
  "html_body" text,
  "sent_at" text,
  "received_at" text,
  "sent_by_user_id" integer,
  "sent_by_name" text,
  "provider_message_id" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null
);
create table public."email_outbox" (
  "id" text not null,
  "to_address" text not null,
  "subject" text not null,
  "body_html" text,
  "body_text" text,
  "purpose" text,
  "ref_type" text,
  "ref_id" integer,
  "reply_to" text,
  "status" text default 'pending'::text not null,
  "attempts" integer default 0 not null,
  "last_error" text,
  "created_at" timestamp with time zone default now() not null,
  "sent_at" text,
  "company_code" text,
  "cc_address" text,
  "bcc_address" text
);
create table public."email_threads" (
  "id" text not null,
  "mailbox_address" text,
  "subject" text,
  "counterparty_email" text,
  "counterparty_name" text,
  "status" text default 'open'::text not null,
  "assigned_to_user_id" integer,
  "assigned_to_name" text,
  "last_message_at" text,
  "last_direction" text,
  "last_snippet" text,
  "message_count" integer default 0 not null,
  "unread" integer default 1 not null,
  "starred" integer default 0 not null,
  "labels" text,
  "trashed_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null
);
create table public."events" (
  "id" bigint generated by default as identity not null,
  "type" text not null,
  "title" text not null,
  "event_date" text not null,
  "address" text,
  "status" text,
  "notes" text,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "company_id" bigint default 1 not null
);
create table public."execution_logs" (
  "id" bigint generated by default as identity not null,
  "request_id" text not null,
  "type" text not null,
  "started_at" text not null,
  "ended_at" text,
  "status" text not null,
  "message" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."fabric_colours" (
  "fabric_id" text not null,
  "colour_id" text not null,
  "label" text not null,
  "swatch_hex" text,
  "swatch_key" text,
  "active" boolean default true not null,
  "sort_order" integer default 0 not null
);
create table public."fabric_library" (
  "id" text not null,
  "label" text not null,
  "tier" text default 'standard'::text not null,
  "default_surcharge" integer default 0 not null,
  "swatch_key" text,
  "active" boolean default true not null,
  "sort_order" integer default 0 not null,
  "sofa_tier" text,
  "bedframe_tier" text,
  "fabric_code" text
);
create table public."fabric_tier_addon_config" (
  "id" integer default 1 not null,
  "sofa_tier2_delta" integer default 0 not null,
  "sofa_tier3_delta" integer default 0 not null,
  "bedframe_tier2_delta" integer default 0 not null,
  "bedframe_tier3_delta" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" integer
);
create table public."fabric_trackings" (
  "id" text not null,
  "fabric_code" text not null,
  "fabric_description" text,
  "fabric_category" public."fabric_category",
  "price_tier" public."fabric_price_tier",
  "sofa_price_tier" public."fabric_price_tier",
  "bedframe_price_tier" public."fabric_price_tier",
  "price_centi" integer default 0 not null,
  "soh_centi" integer default 0 not null,
  "po_outstanding_centi" integer default 0 not null,
  "last_month_usage_centi" integer default 0 not null,
  "one_week_usage_centi" integer default 0 not null,
  "two_weeks_usage_centi" integer default 0 not null,
  "one_month_usage_centi" integer default 0 not null,
  "shortage_centi" integer default 0 not null,
  "reorder_point_centi" integer default 0 not null,
  "supplier" text,
  "supplier_code" text,
  "lead_time_days" integer default 0 not null,
  "series" text,
  "is_active" boolean default true not null
);
create table public."fabrics" (
  "id" text not null,
  "code" text not null,
  "name" text not null,
  "category" text,
  "price_sen" integer default 0 not null,
  "soh_meters_centi" integer default 0 not null,
  "reorder_level_centi" integer default 0 not null
);
create table public."grn_items" (
  "id" uuid default gen_random_uuid() not null,
  "grn_id" uuid not null,
  "purchase_order_item_id" uuid,
  "material_kind" public."material_kind" not null,
  "material_code" text not null,
  "material_name" text not null,
  "qty_received" integer not null,
  "qty_accepted" integer not null,
  "qty_rejected" integer default 0 not null,
  "rejection_reason" text,
  "unit_price_centi" integer not null,
  "notes" text,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "variants" jsonb,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "discount_centi" integer default 0 not null,
  "line_total_centi" integer default 0 not null,
  "delivery_date" date,
  "unit_cost_centi" integer default 0 not null,
  "supplier_sku" text,
  "invoiced_qty" integer default 0 not null,
  "returned_qty" integer default 0 not null,
  "rack_id" uuid,
  "created_at" timestamp with time zone default now() not null
);
create table public."grns" (
  "id" uuid default gen_random_uuid() not null,
  "grn_number" text not null,
  "purchase_order_id" uuid,
  "supplier_id" uuid not null,
  "warehouse_id" uuid,
  "received_at" date default now() not null,
  "delivery_note_ref" text,
  "status" public."grn_status" default 'POSTED'::grn_status not null,
  "notes" text,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "subtotal_centi" integer default 0 not null,
  "tax_centi" integer default 0 not null,
  "total_centi" integer default 0 not null,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."idea_comments" (
  "id" bigint generated by default as identity not null,
  "target_type" text not null,
  "target_id" bigint not null,
  "user_id" bigint not null,
  "body" text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "edited_at" text,
  "archived_at" text
);
create table public."idempotency_keys" (
  "key" text not null,
  "scope" text not null,
  "user_id" integer not null,
  "status_code" integer,
  "response_body" text,
  "created_at" timestamp with time zone default now() not null,
  "tenant_scope" text not null,
  "request_hash" text not null
);
create table public."inventory_lot_consumptions" (
  "id" uuid default gen_random_uuid() not null,
  "lot_id" uuid not null,
  "warehouse_id" uuid not null,
  "product_code" text not null,
  "variant_key" text default ''::text not null,
  "qty_consumed" integer not null,
  "unit_cost_sen" integer not null,
  "total_cost_sen" integer not null,
  "consumed_at" timestamp with time zone default now() not null,
  "source_doc_type" text,
  "source_doc_id" uuid,
  "source_doc_no" text,
  "movement_id" uuid,
  "created_by" integer
);
create table public."inventory_lots" (
  "id" uuid default gen_random_uuid() not null,
  "warehouse_id" uuid not null,
  "product_code" text not null,
  "product_name" text,
  "variant_key" text default ''::text not null,
  "qty_received" integer not null,
  "qty_remaining" integer not null,
  "unit_cost_sen" integer default 0 not null,
  "received_at" timestamp with time zone default now() not null,
  "source_doc_type" text,
  "source_doc_id" uuid,
  "source_doc_no" text,
  "movement_id" uuid,
  "batch_no" text,
  "notes" text,
  "created_by" integer,
  "created_at" timestamp with time zone default now() not null
);
create table public."inventory_movements" (
  "id" uuid default gen_random_uuid() not null,
  "movement_type" public."inventory_movement_type" not null,
  "warehouse_id" uuid not null,
  "product_code" text not null,
  "product_name" text,
  "variant_key" text default ''::text not null,
  "qty" integer not null,
  "unit_cost_sen" integer default 0,
  "total_cost_sen" integer default 0,
  "source_doc_type" text,
  "source_doc_id" uuid,
  "source_doc_no" text,
  "batch_no" text,
  "reason_code" text,
  "notes" text,
  "performed_by" integer,
  "created_at" timestamp with time zone default now() not null
);
create table public."invitations" (
  "id" bigint generated by default as identity not null,
  "email" text not null,
  "role_id" bigint not null,
  "token" text not null,
  "invited_by" bigint not null,
  "expires_at" text not null,
  "accepted_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "position_id" integer,
  "department_id" integer,
  "manager_id" integer
);
create table public."lorry_incidents" (
  "id" bigint generated by default as identity not null,
  "lorry_id" bigint not null,
  "trip_id" bigint,
  "incident_date" text not null,
  "type" text not null,
  "description" text,
  "cost_estimate" double precision,
  "photo_r2_keys" text,
  "insurance_claim_ref" text,
  "claim_status" text,
  "liability" text,
  "resolved_at" text,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "company_id" bigint default 1 not null
);
create table public."mail_user_scope" (
  "user_id" integer not null,
  "level" text default 'personal'::text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."maintenance_config_history" (
  "id" text not null,
  "scope" text not null,
  "config" jsonb not null,
  "effective_from" date not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."master_price_history" (
  "id" uuid default gen_random_uuid() not null,
  "product_code" text not null,
  "field" text not null,
  "old_value_sen" integer,
  "new_value_sen" integer,
  "reason" text,
  "changed_at" timestamp with time zone default now() not null,
  "changed_by" integer
);
create table public."memos" (
  "id" text not null,
  "title" text not null,
  "department_id" integer not null,
  "dept_code" text not null,
  "memo_date" text not null,
  "notes" text,
  "file_key" text,
  "file_name" text,
  "file_mime" text,
  "file_size" integer,
  "ref_no" text,
  "created_by" integer,
  "created_at" text not null,
  "voided_by" integer,
  "voided_at" text,
  "void_reason" text,
  "doc_type" text default 'MEMO'::text not null
);
create table public."mfg_products" (
  "id" text not null,
  "code" text not null,
  "name" text not null,
  "category" public."mfg_product_category" not null,
  "description" text,
  "base_model" text,
  "size_code" text,
  "size_label" text,
  "fabric_usage_centi" integer default 0 not null,
  "unit_m3_milli" integer default 0 not null,
  "status" public."mfg_product_status" default 'ACTIVE'::mfg_product_status not null,
  "cost_price_sen" integer default 0 not null,
  "base_price_sen" integer,
  "price1_sen" integer,
  "sell_price_sen" integer,
  "pwp_price_sen" integer default 0 not null,
  "pos_active" boolean default true not null,
  "included_addons" jsonb default '[]'::jsonb not null,
  "default_free_gifts" jsonb default '[]'::jsonb not null,
  "production_time_minutes" integer default 0 not null,
  "sub_assemblies" jsonb,
  "sku_code" text,
  "fabric_color" text,
  "branding" text,
  "barcode" text,
  "one_shot" boolean default false not null,
  "source_doc_no" text,
  "pieces" jsonb,
  "seat_height_prices" jsonb,
  "default_variants" jsonb,
  "retail_product_id" uuid,
  "model_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."mfg_purchase_order_items" (
  "id" uuid default gen_random_uuid() not null,
  "purchase_order_id" uuid not null,
  "binding_id" uuid,
  "material_kind" public."material_kind" not null,
  "material_code" text not null,
  "material_name" text not null,
  "supplier_sku" text,
  "qty" integer not null,
  "unit_price_centi" integer not null,
  "line_total_centi" integer not null,
  "received_qty" integer default 0 not null,
  "notes" text,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "variants" jsonb,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "discount_centi" integer default 0 not null,
  "unit_cost_centi" integer default 0 not null,
  "delivery_date" date,
  "warehouse_id" uuid,
  "so_item_id" uuid,
  "from_mrp" boolean default false not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."mfg_purchase_order_lines" (
  "id" uuid default gen_random_uuid() not null,
  "purchase_order_id" uuid not null,
  "order_id" text not null,
  "sku" text not null,
  "name" text not null,
  "size" text,
  "colour" text,
  "qty" integer not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."mfg_purchase_orders" (
  "id" uuid default gen_random_uuid() not null,
  "po_number" text not null,
  "supplier_id" uuid not null,
  "status" public."po_status" default 'SUBMITTED'::po_status not null,
  "po_date" date default now() not null,
  "expected_at" date,
  "purchase_location_id" uuid,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "subtotal_centi" integer default 0 not null,
  "tax_centi" integer default 0 not null,
  "total_centi" integer default 0 not null,
  "notes" text,
  "submitted_at" timestamp with time zone,
  "received_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."mfg_sales_order_items" (
  "id" uuid default gen_random_uuid() not null,
  "doc_no" text not null,
  "line_date" date default now() not null,
  "debtor_code" text,
  "debtor_name" text,
  "agent" text,
  "item_group" text not null,
  "item_code" text not null,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "location" text,
  "warehouse_id" uuid,
  "qty" integer default 1 not null,
  "unit_price_centi" integer default 0 not null,
  "discount_centi" integer default 0 not null,
  "total_centi" integer default 0 not null,
  "tax_centi" integer default 0 not null,
  "total_inc_centi" integer default 0 not null,
  "balance_centi" integer default 0 not null,
  "payment_status" text default 'Unchecked'::text not null,
  "venue" text,
  "branding" text,
  "remark" text,
  "cancelled" boolean default false not null,
  "variants" jsonb,
  "unit_cost_centi" integer default 0 not null,
  "line_cost_centi" integer default 0 not null,
  "line_margin_centi" integer default 0 not null,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "po_qty_picked" integer default 0 not null,
  "line_delivery_date" date,
  "line_delivery_date_overridden" boolean default false not null,
  "photo_urls" text[] default '{}'::text[] not null,
  "stock_status" text default 'PENDING'::text not null,
  "stock_qty_ready" integer default 0 not null,
  "allocated_batch_no" text,
  "line_no" integer,
  "created_at" timestamp with time zone default now() not null
);
create table public."mfg_sales_order_payments" (
  "id" uuid default gen_random_uuid() not null,
  "so_doc_no" text not null,
  "paid_at" date default now() not null,
  "method" text not null,
  "merchant_provider" text,
  "installment_months" integer,
  "online_type" text,
  "approval_code" text,
  "amount_centi" integer not null,
  "account_sheet" text,
  "slip_key" text,
  "collected_by" integer,
  "note" text,
  "is_deposit" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."mfg_sales_orders" (
  "doc_no" text not null,
  "transfer_to" text,
  "so_date" date default now() not null,
  "branding" text,
  "debtor_code" text,
  "debtor_name" text not null,
  "agent" text,
  "sales_location" text,
  "ref" text,
  "po_doc_no" text,
  "venue" text,
  "venue_id" uuid,
  "address1" text,
  "address2" text,
  "address3" text,
  "address4" text,
  "phone" text,
  "mattress_sofa_centi" integer default 0 not null,
  "bedframe_centi" integer default 0 not null,
  "accessories_centi" integer default 0 not null,
  "others_centi" integer default 0 not null,
  "mattress_sofa_cost_centi" integer default 0 not null,
  "bedframe_cost_centi" integer default 0 not null,
  "accessories_cost_centi" integer default 0 not null,
  "others_cost_centi" integer default 0 not null,
  "service_centi" integer default 0 not null,
  "service_cost_centi" integer default 0 not null,
  "local_total_centi" integer default 0 not null,
  "balance_centi" integer default 0 not null,
  "total_cost_centi" integer default 0 not null,
  "total_revenue_centi" integer default 0 not null,
  "total_margin_centi" integer default 0 not null,
  "margin_pct_basis" integer default 0 not null,
  "line_count" integer default 0 not null,
  "fabric_tier_addon_centi" integer default 0 not null,
  "delivery_fee_centi" integer default 0 not null,
  "cross_category_source_doc_no" text,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "status" public."mfg_so_status" default 'CONFIRMED'::mfg_so_status not null,
  "remark2" text,
  "remark3" text,
  "remark4" text,
  "note" text,
  "processing_date" date,
  "proceeded_at" timestamp with time zone,
  "sales_exemption_expiry" date,
  "customer_id" uuid,
  "customer_state" text,
  "customer_country" text,
  "customer_po" text,
  "customer_po_id" text,
  "customer_po_date" date,
  "customer_po_image_b64" text,
  "customer_so_no" text,
  "hub_id" uuid,
  "hub_name" text,
  "customer_delivery_date" date,
  "internal_expected_dd" date,
  "linked_do_doc_no" text,
  "ship_to_address" text,
  "bill_to_address" text,
  "install_to_address" text,
  "subtotal_sen" integer,
  "overdue" text,
  "email" text,
  "customer_type" text,
  "salesperson_id" integer,
  "city" text,
  "postcode" text,
  "building_type" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "emergency_contact_relationship" text,
  "target_date" date,
  "signature_b64" text,
  "slip_key" text,
  "slip_state" public."slip_state" default 'none'::slip_state not null,
  "payment_method" text,
  "installment_months" integer,
  "merchant_provider" text,
  "approval_code" text,
  "payment_date" date,
  "deposit_centi" integer default 0 not null,
  "paid_centi" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."mfg_so_audit_log" (
  "id" uuid default gen_random_uuid() not null,
  "so_doc_no" text not null,
  "action" text not null,
  "actor_id" integer,
  "actor_name_snapshot" text,
  "field_changes" jsonb default '[]'::jsonb not null,
  "status_snapshot" text,
  "source" text default 'web'::text,
  "note" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."mfg_so_price_overrides" (
  "id" uuid default gen_random_uuid() not null,
  "doc_no" text not null,
  "item_id" uuid not null,
  "item_code" text not null,
  "original_price_sen" integer not null,
  "override_price_sen" integer not null,
  "reason" text,
  "approved_by" integer,
  "created_at" timestamp with time zone default now() not null
);
create table public."mfg_so_status_changes" (
  "id" uuid default gen_random_uuid() not null,
  "doc_no" text not null,
  "from_status" text,
  "to_status" text not null,
  "changed_by" integer,
  "notes" text,
  "auto_actions" jsonb,
  "created_at" timestamp with time zone default now() not null
);
create table public."mfg_suppliers" (
  "id" uuid default gen_random_uuid() not null,
  "code" text not null,
  "name" text not null,
  "whatsapp_number" text,
  "email" text,
  "contact_person" text,
  "phone" text,
  "address" text,
  "state" text,
  "country" text default 'Malaysia'::text not null,
  "payment_terms" text,
  "status" public."supplier_status" default 'ACTIVE'::supplier_status not null,
  "rating" integer default 0 not null,
  "notes" text,
  "supplier_type" text,
  "category" text,
  "tin_number" text,
  "business_reg_no" text,
  "postcode" text,
  "area" text,
  "mobile" text,
  "fax" text,
  "website" text,
  "attention" text,
  "business_nature" text,
  "currency" text default 'MYR'::text not null,
  "statement_type" text default 'OPEN_ITEM'::text not null,
  "aging_basis" text default 'INVOICE_DATE'::text not null,
  "credit_limit_sen" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."mfg_warehouses" (
  "id" uuid default gen_random_uuid() not null,
  "code" text not null,
  "name" text not null,
  "location" text,
  "is_active" boolean default true not null,
  "is_default" boolean default false not null,
  "is_consignment" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."model_default_free_gifts" (
  "model_id" uuid not null,
  "gifts" jsonb default '[]'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" integer
);
create table public."model_fabric_tier_overrides" (
  "model_id" uuid not null,
  "tier2_delta" integer,
  "tier3_delta" integer,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" integer
);
create table public."model_special_delivery_fees" (
  "model_id" uuid not null,
  "standalone_fee" integer default 0 not null,
  "cross_cat_followup_fee" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" integer
);
create table public."mrp_category_lead_times" (
  "category" text not null,
  "lead_days" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."of_agent_briefs" (
  "id" text not null,
  "generated_at" text not null,
  "brief" jsonb not null,
  "ai_focus" text
);
create table public."of_agent_findings" (
  "id" text not null,
  "kind" text not null,
  "severity" text default 'WARN'::text not null,
  "so_doc_no" text not null,
  "readiness" integer default 0 not null,
  "top_blocker" text,
  "owner" text,
  "summary" text not null,
  "payload" jsonb default '{}'::jsonb not null,
  "status" text default 'OPEN'::text not null,
  "created_at" text not null,
  "last_seen_at" text not null,
  "resolved_at" text
);
create table public."order_details" (
  "doc_no" text not null,
  "delivery_date" text,
  "time_range" text,
  "time_confirmed" text,
  "lorry_plate" text,
  "driver_name" text,
  "driver_contact" text,
  "days_left" text,
  "internal_purchasing" text,
  "property_type" text,
  "new_house_replacement" text,
  "item_details" text,
  "done_delivery" text,
  "consignment_no" text,
  "eta_port" text,
  "estimate_delivery" text,
  "m3" text,
  "vessel_voyage" text,
  "etd_port_klang" text,
  "eta_destination" text,
  "transporter_remarks" text,
  "seafreight" double precision,
  "local_charges" double precision,
  "inland" double precision,
  "agent_fee" double precision,
  "insurance" double precision,
  "total_cost" double precision,
  "shipout_date" text,
  "order_type" text,
  "state" text,
  "warehouse" text,
  "proposed_delivery_date" text,
  "lat" double precision,
  "lng" double precision,
  "geocoded_at" text,
  "updated_at" text,
  "company_id" bigint default 1 not null
);
create table public."password_resets" (
  "id" bigint generated by default as identity not null,
  "user_id" bigint not null,
  "token" text not null,
  "requested_by" bigint,
  "expires_at" text not null,
  "consumed_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."phone_normalisation_backup" (
  "id" bigint default nextval('phone_normalisation_backup_id_seq'::regclass) not null,
  "run_id" text not null,
  "table_name" text not null,
  "column_name" text not null,
  "pk_column" text default 'id'::text not null,
  "row_id" text not null,
  "old_value" text,
  "new_value" text,
  "applied_at" timestamp with time zone default now() not null
);
create table public."pms_agent_briefs" (
  "id" text not null,
  "brief" jsonb not null,
  "ai_focus" text,
  "created_at" text default (now())::text not null
);
create table public."pms_agent_proposals" (
  "id" text not null,
  "kind" text not null,
  "key" text not null,
  "status" text default 'PENDING'::text not null,
  "payload" jsonb,
  "summary" text,
  "created_at" text default (now())::text not null,
  "decided_at" text,
  "decided_by" text
);
create table public."position_capabilities" (
  "position_id" integer not null,
  "capability" text not null,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."position_policy" (
  "position_id" integer not null,
  "cohort" text not null,
  "profile" text,
  "can_move_money" integer default 0 not null,
  "can_write_config" integer default 0 not null,
  "is_fleet" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" integer,
  "duty" text default 'other'::text not null
);
create table public."positions" (
  "id" integer default nextval('positions_id_seq'::regclass) not null,
  "department_id" integer,
  "slug" text not null,
  "name" text not null,
  "level" integer default 100 not null,
  "sort_order" integer default 100 not null,
  "active" integer default 1 not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."procurement_agent_briefs" (
  "id" text not null,
  "brief" jsonb not null,
  "ai_focus" text,
  "created_at" text default (now())::text not null
);
create table public."procurement_agent_proposals" (
  "id" text not null,
  "kind" text not null,
  "key" text not null,
  "status" text default 'PENDING'::text not null,
  "payload" jsonb,
  "summary" text,
  "created_at" text default (now())::text not null,
  "decided_at" text,
  "decided_by" text
);
create table public."product_bedframe_colours" (
  "product_id" uuid not null,
  "colour_id" text not null,
  "active" boolean default true not null
);
create table public."product_bundles" (
  "product_id" uuid not null,
  "bundle_id" text not null,
  "active" boolean default true not null,
  "price" integer not null
);
create table public."product_compartments" (
  "product_id" uuid not null,
  "compartment_id" text not null,
  "active" boolean default true not null,
  "price" integer not null
);
create table public."product_dept_configs" (
  "product_code" text not null,
  "unit_m3_milli" integer default 0 not null,
  "fabric_usage_centi" integer default 0 not null,
  "price2_sen" integer default 0 not null,
  "fab_cut_category" text,
  "fab_cut_minutes" integer,
  "fab_sew_category" text,
  "fab_sew_minutes" integer,
  "wood_cut_category" text,
  "wood_cut_minutes" integer,
  "foam_category" text,
  "foam_minutes" integer,
  "framing_category" text,
  "framing_minutes" integer,
  "upholstery_category" text,
  "upholstery_minutes" integer,
  "packing_category" text,
  "packing_minutes" integer,
  "sub_assemblies" jsonb,
  "heights_sub_assemblies" jsonb
);
create table public."product_fabrics" (
  "product_id" uuid not null,
  "fabric_id" text not null,
  "active" boolean default true not null,
  "surcharge" integer default 0 not null
);
create table public."product_models" (
  "id" uuid default gen_random_uuid() not null,
  "branding" text,
  "model_code" text not null,
  "name" text not null,
  "category" public."mfg_product_category" not null,
  "description" text,
  "photo_url" text,
  "allowed_options" jsonb default '{}'::jsonb not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."product_size_variants" (
  "product_id" uuid not null,
  "size_id" text not null,
  "active" boolean default true not null,
  "price" integer not null
);
create table public."products" (
  "id" uuid default gen_random_uuid() not null,
  "sku" text not null,
  "category_id" text not null,
  "series_id" text,
  "pricing_kind" public."pricing_kind" default 'tbc'::pricing_kind not null,
  "name" text not null,
  "model_code" text,
  "detail" text,
  "size_display" text,
  "img_key" text,
  "thumb_key" text,
  "stock" integer default 0 not null,
  "low_at" integer default 5 not null,
  "visible" boolean default true not null,
  "flat_price" integer,
  "recliner_upgrade_price" integer,
  "seat_upgrade_label" text,
  "seat_upgrade_footrest" boolean default true not null,
  "depth_options" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" integer,
  "supplier_id" uuid
);
create table public."project_activity" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "action" text not null,
  "from_value" text,
  "to_value" text,
  "note" text,
  "user_id" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "archived_at" text,
  "company_id" bigint default 1 not null
);
create table public."project_attachments" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "category" text,
  "r2_key" text not null,
  "file_name" text,
  "mime_type" text,
  "size_bytes" bigint,
  "uploaded_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "archived_at" text,
  "uploaded_by_role" text
);
create table public."project_brands" (
  "id" bigint generated by default as identity not null,
  "name" text not null,
  "color" text not null,
  "sort_order" bigint not null,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "logo_r2_key" text,
  "company_id" bigint default 1 not null
);
create table public."project_checklist" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "seq" bigint not null,
  "title" text not null,
  "description" text,
  "required_perm" text,
  "due_date" text,
  "owner_user_id" bigint,
  "status" text default 'pending'::text not null,
  "evidence_r2_key" text,
  "completed_by" bigint,
  "completed_at" text,
  "notes" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "review_status" text,
  "rejection_reason" text,
  "section_id" bigint,
  "due_offset_days" bigint,
  "role_label" text,
  "crew_visible" bigint default 0 not null,
  "pill_kind" text,
  "pill_value" text,
  "company_id" bigint default 1 not null
);
create table public."project_checklist_attachment_actions" (
  "id" bigint default nextval('project_checklist_attachment_actions_id_seq'::regclass) not null,
  "attachment_id" bigint not null,
  "status" text not null,
  "remark" text,
  "user_id" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."project_checklist_attachments" (
  "id" bigint generated by default as identity not null,
  "item_id" bigint not null,
  "r2_key" text not null,
  "file_name" text not null,
  "content_type" text,
  "size_bytes" bigint,
  "uploaded_by" bigint,
  "uploaded_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "archived_at" text,
  "company_id" bigint default 1 not null,
  "caption" text
);
create table public."project_checklist_comments" (
  "id" bigint generated by default as identity not null,
  "item_id" bigint not null,
  "kind" text not null,
  "body" text,
  "user_id" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null
);
create table public."project_checklist_sections" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "name" text not null,
  "sort_order" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "display_mode" text default 'list'::text not null,
  "company_id" bigint default 1 not null
);
create table public."project_checklist_template_items" (
  "id" bigint generated by default as identity not null,
  "template_id" bigint not null,
  "seq" bigint not null,
  "title" text not null,
  "description" text,
  "required_perm" text,
  "due_offset_days" bigint,
  "section_id" bigint,
  "requires_review" bigint not null,
  "role_label" text,
  "crew_visible" bigint not null,
  "pill_kind" text,
  "pill_value" text,
  "company_id" bigint default 1 not null
);
create table public."project_checklist_template_sections" (
  "id" bigint generated by default as identity not null,
  "template_id" bigint not null,
  "name" text not null,
  "sort_order" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "display_mode" text default 'list'::text not null,
  "company_id" bigint default 1 not null
);
create table public."project_checklist_templates" (
  "id" bigint generated by default as identity not null,
  "name" text not null,
  "description" text,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null
);
create table public."project_contractors" (
  "id" bigint default nextval('project_contractors_id_seq'::regclass) not null,
  "name" text not null,
  "notes" text,
  "active" bigint default 1 not null,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "share_export_scope" text default 'month'::text not null
);
create table public."project_cost_rates" (
  "id" bigint generated by default as identity not null,
  "brand" text not null,
  "transport_pct" double precision not null,
  "merchandise_pct" double precision not null,
  "commission_normal_pct" double precision not null,
  "commission_boost_pct" double precision,
  "boost_min_gp_pct" double precision,
  "boost_min_sales" double precision,
  "updated_at" text,
  "updated_by" bigint
);
create table public."project_defects" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "phase" text not null,
  "reported_by_role" text not null,
  "item_code" text,
  "item_description" text,
  "size" text,
  "quantity" bigint,
  "reason" text,
  "photo_r2_key" text,
  "reported_by" bigint,
  "reported_at" text,
  "resolved" bigint,
  "resolved_notes" text,
  "linked_assr_id" bigint,
  "archived_at" text
);
create table public."project_event_types" (
  "id" bigint generated by default as identity not null,
  "slug" text not null,
  "name" text not null,
  "default_template_id" bigint,
  "sort_order" bigint,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."project_finance" (
  "project_id" bigint generated by default as identity not null,
  "rental" double precision,
  "contractor_cost" double precision,
  "license_fee" double precision,
  "deposit_paid" double precision,
  "deposit_refund" double precision,
  "misc_cost" double precision,
  "total_sales" double precision,
  "notes" text,
  "updated_at" text,
  "updated_by" bigint
);
create table public."project_finance_lines" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "kind" text not null,
  "category" text not null,
  "description" text,
  "amount" double precision not null,
  "occurred_at" text,
  "r2_key" text,
  "file_name" text,
  "mime_type" text,
  "notes" text,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "archived_at" text,
  "auto_source" text,
  "company_id" integer
);
create table public."project_organizers" (
  "id" bigint generated by default as identity not null,
  "name" text not null,
  "notes" text,
  "active" bigint default 1 not null,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."project_phase_photos" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "phase" text not null,
  "r2_key" text not null,
  "content_type" text,
  "caption" text,
  "uploaded_by" bigint,
  "uploaded_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null
);
create table public."project_reads" (
  "user_id" bigint not null,
  "project_id" bigint not null,
  "last_read_at" text
);
create table public."project_sales_attendees" (
  "project_id" bigint not null,
  "sales_rep_id" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD HH24:MI:SS'::text) not null,
  "created_by" bigint
);
create table public."project_sales_reports" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "title" text,
  "sales_amount" double precision,
  "period_start" text,
  "period_end" text,
  "r2_key" text,
  "file_name" text,
  "mime_type" text,
  "uploaded_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "archived_at" text
);
create table public."project_stock_transfers" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "direction" text not null,
  "transferred_at" text,
  "record_r2_key" text,
  "file_name" text,
  "mime_type" text,
  "notes" text,
  "confirmed_at" text,
  "confirmed_by" bigint,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "archived_at" text
);
create table public."project_team" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint not null,
  "user_id" bigint not null,
  "role" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."project_venues" (
  "id" bigint generated by default as identity not null,
  "name" text not null,
  "state" text,
  "notes" text,
  "active" bigint default 1 not null,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null,
  "country" text,
  "postcode" text,
  "city" text,
  "size" text
);
create table public."projects" (
  "id" bigint generated by default as identity not null,
  "code" text,
  "name" text not null,
  "stage" text not null,
  "start_date" text,
  "end_date" text,
  "organizer" text,
  "state" text,
  "venue" text,
  "venue_address" text,
  "brand" text,
  "event_type_id" bigint,
  "booth_no" text,
  "size_sqm" double precision,
  "notion_url" text,
  "notes" text,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "archived_at" text,
  "archived_by" bigint,
  "setup_start_at" text,
  "setup_end_at" text,
  "dismantle_start_at" text,
  "dismantle_end_at" text,
  "setup_driver_user_id" bigint,
  "setup_lorry_id" uuid,
  "dismantle_driver_user_id" bigint,
  "dismantle_lorry_id" uuid,
  "banner_message" text,
  "banner_tone" text,
  "payment_status" text,
  "payment_proof_r2_key" text,
  "payment_proof_file_name" text,
  "payment_notes" text,
  "payment_updated_at" text,
  "payment_updated_by" bigint,
  "pic_id" bigint,
  "setup_helper_1_id" bigint,
  "setup_helper_2_id" bigint,
  "setup_helper_outsourced" bigint default 0 not null,
  "dismantle_helper_1_id" bigint,
  "dismantle_helper_2_id" bigint,
  "dismantle_helper_outsourced" bigint default 0 not null,
  "status" text default 'pending'::text not null,
  "setup_crew" text,
  "dismantle_crew" text,
  "company_id" bigint default 1 not null,
  "service_crew" text,
  "schedule_remark" text,
  "contractor" text
);
create table public."purchase_consignment_receive_items" (
  "id" uuid default gen_random_uuid() not null,
  "pc_receive_id" uuid not null,
  "pc_order_item_id" uuid,
  "material_kind" public."material_kind" not null,
  "material_code" text not null,
  "material_name" text not null,
  "supplier_sku" text,
  "qty_received" integer not null,
  "qty_accepted" integer not null,
  "qty_rejected" integer default 0 not null,
  "rejection_reason" text,
  "unit_price_centi" integer default 0 not null,
  "notes" text,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "discount_centi" integer default 0 not null,
  "variants" jsonb,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "line_total_centi" integer default 0 not null,
  "delivery_date" date,
  "unit_cost_centi" integer default 0 not null,
  "invoiced_qty" integer default 0 not null,
  "returned_qty" integer default 0 not null,
  "rack_id" uuid,
  "created_at" timestamp with time zone default now() not null
);
create table public."purchase_consignment_receives" (
  "id" uuid default gen_random_uuid() not null,
  "receive_number" text not null,
  "purchase_consignment_order_id" uuid,
  "pc_order_no" text,
  "supplier_id" uuid not null,
  "received_at" date default now() not null,
  "delivery_note_ref" text,
  "status" public."purchase_consignment_receive_status" default 'POSTED'::purchase_consignment_receive_status not null,
  "notes" text,
  "warehouse_id" uuid,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "subtotal_centi" integer default 0 not null,
  "tax_centi" integer default 0 not null,
  "total_centi" integer default 0 not null,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."purchase_consignment_return_items" (
  "id" uuid default gen_random_uuid() not null,
  "purchase_consignment_return_id" uuid not null,
  "pc_receive_item_id" uuid,
  "material_kind" public."material_kind" not null,
  "material_code" text not null,
  "material_name" text not null,
  "qty_returned" integer not null,
  "unit_price_centi" integer default 0 not null,
  "line_refund_centi" integer default 0 not null,
  "reason" text,
  "notes" text,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "variants" jsonb,
  "created_at" timestamp with time zone default now() not null
);
create table public."purchase_consignment_returns" (
  "id" uuid default gen_random_uuid() not null,
  "return_number" text not null,
  "pc_order_id" uuid,
  "pc_receive_id" uuid,
  "supplier_id" uuid not null,
  "return_date" date default now() not null,
  "reason" text,
  "status" public."purchase_consignment_return_status" default 'POSTED'::purchase_consignment_return_status not null,
  "posted_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "credit_note_ref" text,
  "refund_centi" integer default 0 not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."purchase_invoice_items" (
  "id" uuid default gen_random_uuid() not null,
  "purchase_invoice_id" uuid not null,
  "grn_item_id" uuid,
  "material_kind" public."material_kind" not null,
  "material_code" text not null,
  "material_name" text not null,
  "qty" integer not null,
  "unit_price_centi" integer not null,
  "line_total_centi" integer not null,
  "notes" text,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "variants" jsonb,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "discount_centi" integer default 0 not null,
  "unit_cost_centi" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."purchase_invoices" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_number" text not null,
  "supplier_invoice_ref" text,
  "supplier_id" uuid not null,
  "purchase_order_id" uuid,
  "grn_id" uuid,
  "invoice_date" date default now() not null,
  "due_date" date,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "subtotal_centi" integer default 0 not null,
  "tax_centi" integer default 0 not null,
  "total_centi" integer default 0 not null,
  "paid_centi" integer default 0 not null,
  "status" public."purchase_invoice_status" default 'POSTED'::purchase_invoice_status not null,
  "notes" text,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."purchase_order_docs" (
  "doc_no" text not null,
  "doc_date" text,
  "ref" text,
  "so_doc_no" text,
  "creditor_code" text,
  "creditor_name" text,
  "purchase_location" text,
  "doc_status" text,
  "cancelled" bigint,
  "local_ex_tax" double precision,
  "local_tax" double precision,
  "local_net_total" double precision,
  "final_total" double precision,
  "currency_code" text,
  "currency_rate" double precision,
  "remark1" text,
  "remark2" text,
  "remark3" text,
  "remark4" text,
  "note" text,
  "last_modified" text,
  "amount_source" text,
  "amount_updated_at" text,
  "amount_updated_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "raw" text,
  "company_id" bigint default 1 not null
);
create table public."purchase_orders" (
  "id" bigint generated by default as identity not null,
  "doc_no" text not null,
  "so_doc_no" text,
  "creditor_code" text,
  "creditor_name" text,
  "item_code" text not null,
  "item_description" text,
  "location" text,
  "doc_date" text,
  "remaining_qty" double precision,
  "delivery_date" text,
  "supplier_date1" text,
  "supplier_date2" text,
  "supplier_date3" text,
  "overdue_days" text,
  "unit_price" double precision,
  "amount" double precision,
  "amount_source" text,
  "amount_updated_at" text,
  "amount_updated_by" bigint,
  "original_qty" double precision,
  "is_outstanding" bigint,
  "doc_status" text,
  "cancelled" bigint,
  "company_id" bigint default 1 not null
);
create table public."purchase_return_items" (
  "id" uuid default gen_random_uuid() not null,
  "purchase_return_id" uuid not null,
  "grn_item_id" uuid,
  "material_kind" public."material_kind" not null,
  "material_code" text not null,
  "material_name" text not null,
  "qty_returned" integer not null,
  "unit_price_centi" integer default 0 not null,
  "line_refund_centi" integer default 0 not null,
  "reason" text,
  "notes" text,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "variants" jsonb,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "created_at" timestamp with time zone default now() not null
);
create table public."purchase_returns" (
  "id" uuid default gen_random_uuid() not null,
  "return_number" text not null,
  "purchase_order_id" uuid,
  "grn_id" uuid,
  "supplier_id" uuid not null,
  "return_date" date default now() not null,
  "reason" text,
  "status" public."purchase_return_status" default 'POSTED'::purchase_return_status not null,
  "posted_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "credit_note_ref" text,
  "refund_centi" integer default 0 not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."push_devices" (
  "id" integer default nextval('push_devices_id_seq'::regclass) not null,
  "user_id" integer not null,
  "platform" text default 'ios'::text not null,
  "token" text not null,
  "created_at" text default to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) not null,
  "last_seen_at" text default to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) not null,
  "disabled_at" text,
  "last_error" text,
  "last_reminder_sent_on" text
);
create table public."pwp_codes" (
  "code" text not null,
  "rule_id" uuid,
  "reward_category" public."mfg_product_category" not null,
  "eligible_reward_model_ids" jsonb default '[]'::jsonb not null,
  "reward_combo_ids" jsonb default '[]'::jsonb not null,
  "type" text default 'pwp'::text not null,
  "status" text default 'RESERVED'::text not null,
  "owner_staff_id" integer,
  "cart_line_key" text,
  "trigger_item_code" text,
  "source_doc_no" text,
  "redeemed_doc_no" text,
  "redeemed_item_code" text,
  "customer_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."pwp_rules" (
  "id" uuid default gen_random_uuid() not null,
  "trigger_category" public."mfg_product_category" not null,
  "trigger_eligible_model_ids" jsonb default '[]'::jsonb not null,
  "reward_category" public."mfg_product_category" not null,
  "eligible_reward_model_ids" jsonb default '[]'::jsonb not null,
  "trigger_combo_ids" jsonb default '[]'::jsonb not null,
  "reward_combo_ids" jsonb default '[]'::jsonb not null,
  "qty_per_trigger" integer default 1 not null,
  "type" text default 'pwp'::text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."roles" (
  "id" bigint generated by default as identity not null,
  "name" text not null,
  "description" text,
  "permissions" text not null,
  "is_system" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "scope_to_pic" bigint not null
);
create table public."salary_records" (
  "id" bigint generated by default as identity not null,
  "user_id" bigint not null,
  "period" text not null,
  "base_pay" double precision,
  "trip_count" bigint,
  "trip_allowance_total" double precision,
  "ot_hours" double precision,
  "ot_amount" double precision,
  "deductions_json" text,
  "deductions_total" double precision,
  "gross" double precision,
  "net" double precision,
  "status" text,
  "confirmed_by" bigint,
  "confirmed_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text
);
create table public."salary_trip_lines" (
  "id" bigint generated by default as identity not null,
  "salary_record_id" bigint,
  "user_id" bigint not null,
  "trip_id" bigint not null,
  "trip_date" text not null,
  "role" text not null,
  "trip_allowance" double precision,
  "ot_hours" double precision,
  "ot_amount" double precision,
  "notes" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null
);
create table public."sales_commission_tiers" (
  "id" bigint generated by default as identity not null,
  "slug" text not null,
  "name" text not null,
  "rate" double precision not null,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."sales_entries" (
  "id" bigint generated by default as identity not null,
  "project_id" bigint,
  "customer_name" text not null,
  "customer_code" text,
  "amount" double precision not null,
  "currency" text not null,
  "occurred_at" text not null,
  "notes" text,
  "status" text default 'draft'::text not null,
  "autocount_doc_no" text,
  "autocount_doc_type" text,
  "pushed_at" text,
  "push_error" text,
  "created_by" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "archived_at" text,
  "ref_no" text,
  "deposit_amount" double precision,
  "deposit_payment_type" text,
  "sales_person_id" bigint,
  "customer_address" text,
  "customer_phone" text,
  "sales_rep_id" bigint,
  "doc_no" text,
  "processing_date" text,
  "delivery_date" text,
  "status_2" text,
  "customer_address_2" text,
  "customer_postcode" text,
  "customer_state" text,
  "customer_phone_2" text,
  "customer_email" text,
  "venue" text,
  "warehouse" text,
  "branding" text,
  "po_doc_no" text,
  "payment_status" text,
  "source" text,
  "remarks" text,
  "company_id" bigint default 1 not null
);
create table public."sales_entry_activity" (
  "id" bigint generated by default as identity not null,
  "entry_id" bigint not null,
  "user_id" bigint,
  "action" text not null,
  "note" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null
);
create table public."sales_entry_change_requests" (
  "id" bigint generated by default as identity not null,
  "entry_id" bigint not null,
  "payload" text not null,
  "summary" text,
  "status" text default 'pending'::text not null,
  "requested_by" bigint,
  "decided_by" bigint,
  "decided_at" text,
  "decide_note" text,
  "created_at" text default (now())::text not null,
  "company_id" bigint default 1 not null
);
create table public."sales_entry_items" (
  "id" bigint generated by default as identity not null,
  "entry_id" bigint not null,
  "line_no" bigint not null,
  "item_code" text,
  "item_description" text,
  "remarks" text,
  "qty" double precision not null,
  "unit_price" double precision not null,
  "amount" double precision not null,
  "group_tag" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null
);
create table public."sales_entry_payments" (
  "id" bigint generated by default as identity not null,
  "entry_id" bigint not null,
  "paid_at" text not null,
  "payment_method" text not null,
  "amount" double precision not null,
  "account_sheet" text,
  "approval_code" text,
  "collected_by" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "company_id" bigint default 1 not null
);
create table public."sales_invoice_items" (
  "id" uuid default gen_random_uuid() not null,
  "sales_invoice_id" uuid not null,
  "so_item_id" uuid,
  "do_item_id" uuid,
  "item_code" text not null,
  "item_group" text,
  "description" text,
  "description2" text,
  "uom" text default 'UNIT'::text not null,
  "qty" integer not null,
  "unit_price_centi" integer default 0 not null,
  "discount_centi" integer default 0 not null,
  "tax_centi" integer default 0 not null,
  "line_total_centi" integer default 0 not null,
  "unit_cost_centi" integer default 0 not null,
  "line_cost_centi" integer default 0 not null,
  "line_margin_centi" integer default 0 not null,
  "notes" text,
  "gap_inches" integer,
  "divan_height_inches" integer,
  "divan_price_sen" integer default 0 not null,
  "leg_height_inches" integer,
  "leg_price_sen" integer default 0 not null,
  "custom_specials" jsonb,
  "line_suffix" text,
  "special_order_price_sen" integer default 0 not null,
  "variants" jsonb,
  "line_no" integer,
  "created_at" timestamp with time zone default now() not null
);
create table public."sales_invoice_payments" (
  "id" uuid default gen_random_uuid() not null,
  "sales_invoice_id" uuid not null,
  "paid_at" date default now() not null,
  "method" text not null,
  "merchant_provider" text,
  "installment_months" integer,
  "online_type" text,
  "approval_code" text,
  "amount_centi" integer not null,
  "account_sheet" text,
  "collected_by" integer,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."sales_invoices" (
  "id" uuid default gen_random_uuid() not null,
  "invoice_number" text not null,
  "so_doc_no" text,
  "delivery_order_id" uuid,
  "debtor_code" text,
  "debtor_name" text not null,
  "invoice_date" date default now() not null,
  "due_date" date,
  "customer_delivery_date" date,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "subtotal_centi" integer default 0 not null,
  "discount_centi" integer default 0 not null,
  "tax_centi" integer default 0 not null,
  "total_centi" integer default 0 not null,
  "paid_centi" integer default 0 not null,
  "salesperson_id" integer,
  "agent" text,
  "email" text,
  "customer_type" text,
  "building_type" text,
  "branding" text,
  "venue" text,
  "venue_id" uuid,
  "ref" text,
  "customer_so_no" text,
  "po_doc_no" text,
  "sales_location" text,
  "customer_state" text,
  "customer_country" text,
  "note" text,
  "address1" text,
  "address2" text,
  "city" text,
  "state" text,
  "postcode" text,
  "phone" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "emergency_contact_relationship" text,
  "mattress_sofa_centi" integer default 0 not null,
  "bedframe_centi" integer default 0 not null,
  "accessories_centi" integer default 0 not null,
  "others_centi" integer default 0 not null,
  "service_centi" integer default 0 not null,
  "mattress_sofa_cost_centi" integer default 0 not null,
  "bedframe_cost_centi" integer default 0 not null,
  "accessories_cost_centi" integer default 0 not null,
  "others_cost_centi" integer default 0 not null,
  "service_cost_centi" integer default 0 not null,
  "local_total_centi" integer default 0 not null,
  "total_cost_centi" integer default 0 not null,
  "total_margin_centi" integer default 0 not null,
  "margin_pct_basis" integer default 0 not null,
  "line_count" integer default 0 not null,
  "status" public."sales_invoice_status" default 'SENT'::sales_invoice_status not null,
  "notes" text,
  "sent_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer,
  "updated_at" timestamp with time zone default now() not null
);
create table public."sales_orders" (
  "id" bigint generated by default as identity not null,
  "doc_no" text not null,
  "region" text not null,
  "transfer_to" text,
  "doc_date" text,
  "ref" text,
  "branding" text,
  "debtor_name" text,
  "phone" text,
  "sales_location" text,
  "sales_agent" text,
  "local_total" double precision,
  "balance" double precision,
  "remark2" text,
  "remark3" text,
  "remark4" text,
  "ac_udf_pdate" text,
  "expiry_date" text,
  "note" text,
  "po_doc_no" text,
  "inv_addr1" text,
  "inv_addr2" text,
  "inv_addr3" text,
  "inv_addr4" text,
  "venue" text,
  "attention" text,
  "sync_status" text,
  "sync_error" text,
  "last_modified" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "customer_email" text,
  "company_id" bigint default 1 not null
);
create table public."sales_positions" (
  "id" bigint generated by default as identity not null,
  "slug" text not null,
  "name" text not null,
  "level" bigint default 20 not null,
  "sort_order" bigint default 0 not null,
  "active" bigint default 1 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."sales_rep_brands" (
  "rep_id" bigint not null,
  "brand" text not null
);
create table public."sales_rep_commission_tiers" (
  "id" bigint generated by default as identity not null,
  "rep_id" bigint not null,
  "threshold" double precision not null,
  "rate" double precision not null,
  "sort_order" bigint not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."sales_reps" (
  "id" bigint generated by default as identity not null,
  "code" text not null,
  "name" text not null,
  "phone" text,
  "email" text,
  "position_id" bigint,
  "upline_id" bigint,
  "user_id" bigint,
  "status" text not null,
  "is_admin" bigint default 0 not null,
  "commission_rate" double precision,
  "commission_tier_id" bigint,
  "joined_on" text,
  "notes" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "archived_at" text,
  "archived_by" bigint,
  "nric" text,
  "upline_secondary_id" bigint,
  "commission_min_rate" double precision default 0 not null
);
create table public."sales_team_activity" (
  "id" bigint generated by default as identity not null,
  "rep_id" bigint not null,
  "action" text not null,
  "from_value" text,
  "to_value" text,
  "note" text,
  "user_id" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."series" (
  "id" text not null,
  "label" text not null,
  "active" boolean default true not null
);
create table public."sessions" (
  "token" text not null,
  "user_id" bigint not null,
  "expires_at" text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "origin" text,
  "renew_seconds" integer
);
create table public."share_export_log" (
  "id" bigint generated by default as identity not null,
  "kind" text not null,
  "subject" text not null,
  "token" text not null,
  "ip" text,
  "row_count" integer default 0 not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."si_agent_briefs" (
  "id" text not null,
  "generated_at" text not null,
  "brief" jsonb not null,
  "ai_focus" text
);
create table public."si_agent_findings" (
  "id" text not null,
  "kind" text not null,
  "severity" text default 'WARN'::text not null,
  "subject" text not null,
  "subject_type" text default 'ORDER'::text not null,
  "metric" text,
  "summary" text not null,
  "payload" jsonb default '{}'::jsonb not null,
  "status" text default 'OPEN'::text not null,
  "created_at" text not null,
  "last_seen_at" text not null,
  "resolved_at" text
);
create table public."size_library" (
  "id" text not null,
  "label" text not null,
  "width_cm" integer not null,
  "length_cm" integer not null,
  "sort_order" integer default 0 not null
);
create table public."sofa_combo_pricing" (
  "id" uuid default gen_random_uuid() not null,
  "base_model" text not null,
  "modules" jsonb default '[]'::jsonb not null,
  "tier" public."fabric_price_tier",
  "customer_id" uuid,
  "supplier_id" uuid,
  "prices_by_height" jsonb default '{}'::jsonb not null,
  "selling_prices_by_height" jsonb default '{}'::jsonb not null,
  "pwp_prices_by_height" jsonb default '{}'::jsonb not null,
  "default_free_gifts" jsonb default '[]'::jsonb not null,
  "label" text,
  "effective_from" date not null,
  "deleted_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."sofa_quick_picks" (
  "id" uuid default gen_random_uuid() not null,
  "base_model" text not null,
  "label" text,
  "modules" jsonb default '[]'::jsonb not null,
  "depth" text not null,
  "sort_order" integer default 0 not null,
  "active" boolean default true not null,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."special_addons" (
  "id" uuid default gen_random_uuid() not null,
  "code" text not null,
  "label" text not null,
  "so_description" text default ''::text not null,
  "categories" text[] default '{}'::text[] not null,
  "selling_price_sen" integer default 0 not null,
  "cost_price_sen" integer default 0 not null,
  "option_groups" jsonb default '[]'::jsonb not null,
  "active" boolean default true not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."state_warehouse_map" (
  "state" text not null,
  "warehouse" text not null
);
create table public."stock_items" (
  "item_code" text not null,
  "auto_key" text,
  "doc_key" text,
  "description" text,
  "desc2" text,
  "item_group" text,
  "item_type" text,
  "item_brand" text,
  "item_class" text,
  "item_category" text,
  "base_uom" text,
  "sales_uom" text,
  "purchase_uom" text,
  "main_supplier" text,
  "is_active" bigint default 1,
  "is_sales_item" bigint,
  "is_purchase_item" bigint,
  "lead_time" bigint,
  "cost" double precision,
  "price" double precision,
  "tax_code" text,
  "purchase_tax_code" text,
  "barcode2" text,
  "cost_code" text,
  "last_modified" text,
  "raw" text,
  "fetched_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text
);
create table public."stock_take_lines" (
  "id" uuid default gen_random_uuid() not null,
  "stock_take_id" uuid not null,
  "product_code" text not null,
  "product_name" text,
  "system_qty" integer default 0 not null,
  "counted_qty" integer,
  "variance" integer generated always as ((COALESCE(counted_qty, 0) - system_qty)) stored,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."stock_takes" (
  "id" uuid default gen_random_uuid() not null,
  "take_no" text not null,
  "status" text default 'OPEN'::text not null,
  "warehouse_id" uuid not null,
  "scope_type" text default 'ALL'::text not null,
  "scope_value" text,
  "take_date" date default now() not null,
  "notes" text,
  "posted_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."stock_transfer_lines" (
  "id" uuid default gen_random_uuid() not null,
  "stock_transfer_id" uuid not null,
  "product_code" text not null,
  "product_name" text,
  "variant_key" text default ''::text not null,
  "qty" integer not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."stock_transfers" (
  "id" uuid default gen_random_uuid() not null,
  "transfer_no" text not null,
  "status" text default 'POSTED'::text not null,
  "from_warehouse_id" uuid not null,
  "to_warehouse_id" uuid not null,
  "transfer_date" date default now() not null,
  "notes" text,
  "posted_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "created_by" integer
);
create table public."supplier_accounts" (
  "id" bigint generated by default as identity not null,
  "supplier_id" bigint not null,
  "email" text not null,
  "name" text,
  "password_hash" text,
  "status" text not null,
  "last_login_at" text,
  "created_by" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text
);
create table public."supplier_communications" (
  "id" bigint generated by default as identity not null,
  "supplier_id" bigint not null,
  "assr_id" bigint,
  "channel" text,
  "direction" text,
  "subject" text,
  "body" text,
  "user_id" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."supplier_invitations" (
  "id" bigint generated by default as identity not null,
  "token" text not null,
  "supplier_account_id" bigint not null,
  "purpose" text not null,
  "created_by" bigint,
  "expires_at" text not null,
  "accepted_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."supplier_material_bindings" (
  "id" uuid default gen_random_uuid() not null,
  "supplier_id" uuid not null,
  "material_kind" public."material_kind" not null,
  "material_code" text not null,
  "material_name" text not null,
  "supplier_sku" text not null,
  "unit_price_centi" integer default 0 not null,
  "currency" public."currency_code" default 'MYR'::currency_code not null,
  "lead_time_days" integer default 0 not null,
  "payment_terms_override" text,
  "moq" integer default 0 not null,
  "price_valid_from" date,
  "price_valid_to" date,
  "is_main_supplier" boolean default false not null,
  "notes" text,
  "price_matrix" jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."supplier_sessions" (
  "token" text not null,
  "supplier_account_id" bigint not null,
  "expires_at" text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."suppliers" (
  "id" bigint generated by default as identity not null,
  "code" text,
  "name" text not null,
  "contact_name" text,
  "phone" text,
  "email" text,
  "address" text,
  "category" text,
  "sla_response_hours" bigint,
  "sla_completion_hours" bigint,
  "active" bigint default 1 not null,
  "notes" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text
);
create table public."system_settings" (
  "key" text not null,
  "value" text
);
create table public."table_layouts" (
  "id" bigint default nextval('table_layouts_id_seq'::regclass) not null,
  "company_id" bigint not null,
  "user_id" bigint,
  "table_key" text not null,
  "layout" text not null,
  "updated_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_by" bigint,
  "name" text,
  "is_shared" integer default 0 not null
);
create table public."tmp_sheet_capture" (
  "id" integer default nextval('tmp_sheet_capture_id_seq'::regclass) not null,
  "name" text,
  "chunk" integer,
  "content" text
);
create table public."trip_proposal_trips" (
  "id" bigint generated by default as identity not null,
  "proposal_id" bigint not null,
  "warehouse" text not null,
  "trip_date" text not null,
  "suggested_lorry_id" bigint,
  "suggested_driver_user_id" bigint,
  "trip_type" text not null,
  "total_revenue" double precision,
  "total_distance_km" double precision,
  "stop_count" bigint,
  "is_outsourced" bigint default 0 not null,
  "payload_json" text not null,
  "company_id" bigint default 1 not null
);
create table public."trip_proposals" (
  "id" bigint generated by default as identity not null,
  "generated_at" text not null,
  "generated_by" bigint,
  "horizon_days" bigint not null,
  "status" text not null,
  "summary_json" text,
  "notes" text,
  "company_id" bigint default 1 not null
);
create table public."trip_stops" (
  "id" bigint generated by default as identity not null,
  "trip_id" bigint not null,
  "doc_no" text not null,
  "sequence" bigint not null,
  "stop_type" text not null,
  "dismantle_session" text,
  "status" text not null,
  "arrived_at" text,
  "completed_at" text,
  "recipient_name" text,
  "signature_r2_key" text,
  "pod_photo_r2_key" text,
  "failure_reason" text,
  "notes" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "updated_at" text,
  "company_id" bigint default 1 not null
);
create table public."udf_fields" (
  "id" bigint generated by default as identity not null,
  "table_name" text not null,
  "field_key" text not null,
  "label" text not null,
  "field_type" text not null,
  "options" text,
  "position" bigint,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."udf_values" (
  "table_name" text not null,
  "row_key" text not null,
  "field_key" text not null,
  "value" text,
  "updated_at" text
);
create table public."user_brands" (
  "user_id" bigint not null,
  "brand" text not null,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text)
);
create table public."user_companies" (
  "user_id" integer not null,
  "company_id" bigint not null
);
create table public."user_departments" (
  "user_id" integer not null,
  "department_id" integer not null,
  "created_at" text default to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);
create table public."users" (
  "id" bigint generated by default as identity not null,
  "email" text not null,
  "name" text,
  "password_hash" text,
  "role_id" bigint not null,
  "status" text not null,
  "invited_by" bigint,
  "invited_at" text,
  "joined_at" text,
  "last_login_at" text,
  "last_seen_at" text,
  "created_at" text default to_char(timezone('UTC'::text, now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text),
  "user_type" text,
  "phone" text,
  "ic_number" text,
  "license_no" text,
  "license_expiry" text,
  "emergency_contact_name" text,
  "emergency_contact_phone" text,
  "base_salary" double precision,
  "trip_allowance_rate" double precision,
  "ot_rate" double precision,
  "max_continuous_hours" double precision,
  "manager_id" bigint,
  "department_id" bigint,
  "points_balance" bigint default 0 not null,
  "gifting_balance" bigint default 0 not null,
  "gifting_reset_at" text,
  "current_streak" bigint default 0 not null,
  "profile_pic_r2_key" text,
  "company_phone" text,
  "position_id" integer,
  "totp_secret" text,
  "totp_enabled" integer default 0 not null,
  "totp_enrolled_at" text,
  "totp_backup_codes" text,
  "status_reason" text,
  "division" text,
  "email_alias" text,
  "assr_email_muted" integer default 0 not null,
  "last_path" text
);
create table public."warehouse_rack_items" (
  "id" uuid default gen_random_uuid() not null,
  "rack_id" uuid not null,
  "product_code" text not null,
  "variant_key" text default ''::text not null,
  "product_name" text,
  "size_label" text,
  "customer_name" text,
  "source_doc_no" text,
  "qty" integer default 1 not null,
  "stocked_in_date" date default now() not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table public."warehouse_rack_movements" (
  "id" uuid default gen_random_uuid() not null,
  "movement_type" text not null,
  "rack_id" uuid,
  "rack_label" text,
  "to_rack_id" uuid,
  "to_rack_label" text,
  "warehouse_id" uuid,
  "product_code" text,
  "variant_key" text default ''::text not null,
  "product_name" text,
  "source_doc_no" text,
  "quantity" integer default 1 not null,
  "reason" text,
  "performed_by" integer,
  "created_at" timestamp with time zone default now() not null
);
create table public."warehouse_racks" (
  "id" uuid default gen_random_uuid() not null,
  "warehouse_id" uuid not null,
  "rack" text not null,
  "position" text,
  "status" text default 'EMPTY'::text not null,
  "reserved" boolean default false not null,
  "notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table public."warehouses" (
  "code" text not null,
  "name" text not null,
  "address" text,
  "lat" double precision,
  "lng" double precision,
  "is_active" bigint default 1 not null
);

alter table public."_migrations" add constraint "_migrations_pkey" PRIMARY KEY (name);
alter table public."_pg_migrations" add constraint "_pg_migrations_pkey" PRIMARY KEY (filename);
alter table public."ac_snapshot_purchase_orders" add constraint "ac_snapshot_purchase_orders_pkey" PRIMARY KEY (doc_no);
alter table public."ac_snapshot_runs" add constraint "ac_snapshot_runs_pkey" PRIMARY KEY (id);
alter table public."ac_snapshot_sales_orders" add constraint "ac_snapshot_sales_orders_pkey" PRIMARY KEY (doc_no);
alter table public."addons" add constraint "addons_pkey" PRIMARY KEY (id);
alter table public."agent_controls" add constraint "agent_controls_pkey" PRIMARY KEY (agent);
alter table public."agent_decision_outcomes" add constraint "agent_decision_outcomes_pkey" PRIMARY KEY (id);
alter table public."agent_decisions" add constraint "agent_decisions_pkey" PRIMARY KEY (id);
alter table public."agent_feedback" add constraint "agent_feedback_pkey" PRIMARY KEY (id);
alter table public."agent_kill_scopes" add constraint "agent_kill_scopes_pkey" PRIMARY KEY (id);
alter table public."agent_runs" add constraint "agent_runs_pkey" PRIMARY KEY (id);
alter table public."announcement_acks" add constraint "announcement_acks_pkey" PRIMARY KEY (announcement_id, user_id);
alter table public."announcement_files" add constraint "announcement_files_announcement_id_r2_key_key" UNIQUE (announcement_id, r2_key);
alter table public."announcement_files" add constraint "announcement_files_pkey" PRIMARY KEY (id);
alter table public."announcement_reminders" add constraint "announcement_reminders_pkey" PRIMARY KEY (announcement_id, user_id);
alter table public."announcements" add constraint "announcements_pkey" PRIMARY KEY (id);
alter table public."app_settings" add constraint "app_settings_pkey" PRIMARY KEY (key);
alter table public."assistant_conversations" add constraint "assistant_conversations_pkey" PRIMARY KEY (id);
alter table public."assistant_messages" add constraint "assistant_messages_pkey" PRIMARY KEY (id);
alter table public."assr_activity" add constraint "assr_activity_pkey" PRIMARY KEY (id);
alter table public."assr_alert_acks" add constraint "assr_alert_acks_pkey" PRIMARY KEY (id);
alter table public."assr_attachments" add constraint "assr_attachments_pkey" PRIMARY KEY (id);
alter table public."assr_case_access" add constraint "assr_case_access_pkey" PRIMARY KEY (assr_id, user_id);
alter table public."assr_case_categories" add constraint "assr_case_categories_pkey" PRIMARY KEY (case_id, slug);
alter table public."assr_cases" add constraint "assr_cases_pkey" PRIMARY KEY (id);
alter table public."assr_issue_categories" add constraint "assr_issue_categories_pkey" PRIMARY KEY (id);
alter table public."assr_items" add constraint "assr_items_pkey" PRIMARY KEY (id);
alter table public."assr_lead_time_activations" add constraint "assr_lead_time_activations_pkey" PRIMARY KEY (id);
alter table public."assr_lead_time_amendments" add constraint "assr_lead_time_amendments_pkey" PRIMARY KEY (id);
alter table public."assr_lead_time_profiles" add constraint "assr_lead_time_profiles_pkey" PRIMARY KEY (id);
alter table public."assr_lead_time_scheduled_activations" add constraint "assr_lead_time_scheduled_activations_pkey" PRIMARY KEY (id);
alter table public."assr_logistics" add constraint "assr_logistics_pkey" PRIMARY KEY (id);
alter table public."assr_ncr_categories" add constraint "assr_ncr_categories_pkey" PRIMARY KEY (id);
alter table public."assr_priorities" add constraint "assr_priorities_pkey" PRIMARY KEY (id);
alter table public."assr_priority_stage_targets" add constraint "assr_priority_stage_targets_pkey" PRIMARY KEY (id);
alter table public."assr_product_categories" add constraint "assr_product_categories_pkey" PRIMARY KEY (id);
alter table public."assr_product_categories" add constraint "assr_product_categories_slug_key" UNIQUE (slug);
alter table public."assr_resolution_methods" add constraint "assr_resolution_methods_pkey" PRIMARY KEY (id);
alter table public."assr_stage_history" add constraint "assr_stage_history_pkey" PRIMARY KEY (id);
alter table public."assr_stage_targets" add constraint "assr_stage_targets_pkey" PRIMARY KEY (id);
alter table public."assr_supplier_returns" add constraint "assr_supplier_returns_pkey" PRIMARY KEY (id);
alter table public."assr_supplier_tokens" add constraint "assr_supplier_tokens_pkey" PRIMARY KEY (id);
alter table public."assr_survey_tokens" add constraint "assr_survey_tokens_pkey" PRIMARY KEY (token);
alter table public."audit_events" add constraint "audit_events_pkey" PRIMARY KEY (id);
alter table public."autocount_delivery_orders" add constraint "autocount_delivery_orders_pkey" PRIMARY KEY (doc_no);
alter table public."bedframe_colours" add constraint "bedframe_colours_pkey" PRIMARY KEY (id);
alter table public."bedframe_options" add constraint "bedframe_options_pkey" PRIMARY KEY (id);
alter table public."brand_share_tokens" add constraint "brand_share_tokens_pkey" PRIMARY KEY (token);
alter table public."bundle_library" add constraint "bundle_library_pkey" PRIMARY KEY (id);
alter table public."case_track_tokens" add constraint "case_track_tokens_pkey" PRIMARY KEY (token);
alter table public."categories" add constraint "categories_pkey" PRIMARY KEY (id);
alter table public."client_errors" add constraint "client_errors_pkey" PRIMARY KEY (id);
alter table public."collection_agent_briefs" add constraint "collection_agent_briefs_pkey" PRIMARY KEY (id);
alter table public."collection_agent_proposals" add constraint "collection_agent_proposals_pkey" PRIMARY KEY (id);
alter table public."compartment_library" add constraint "compartment_library_pkey" PRIMARY KEY (id);
alter table public."config_proposals" add constraint "config_proposals_pkey" PRIMARY KEY (id);
alter table public."consignment_delivery_order_items" add constraint "consignment_delivery_order_items_pkey" PRIMARY KEY (id);
alter table public."consignment_delivery_order_payments" add constraint "consignment_delivery_order_payments_pkey" PRIMARY KEY (id);
alter table public."consignment_delivery_orders" add constraint "consignment_delivery_orders_do_number_key" UNIQUE (do_number);
alter table public."consignment_delivery_orders" add constraint "consignment_delivery_orders_pkey" PRIMARY KEY (id);
alter table public."consignment_delivery_return_items" add constraint "consignment_delivery_return_items_pkey" PRIMARY KEY (id);
alter table public."consignment_delivery_returns" add constraint "consignment_delivery_returns_pkey" PRIMARY KEY (id);
alter table public."consignment_delivery_returns" add constraint "consignment_delivery_returns_return_number_key" UNIQUE (return_number);
alter table public."consignment_sales_order_items" add constraint "consignment_sales_order_items_pkey" PRIMARY KEY (id);
alter table public."consignment_sales_order_payments" add constraint "consignment_sales_order_payments_pkey" PRIMARY KEY (id);
alter table public."consignment_sales_orders" add constraint "consignment_sales_orders_pkey" PRIMARY KEY (doc_no);
alter table public."consignment_so_audit_log" add constraint "consignment_so_audit_log_pkey" PRIMARY KEY (id);
alter table public."contractor_share_tokens" add constraint "contractor_share_tokens_pkey" PRIMARY KEY (token);
alter table public."creditors" add constraint "creditors_pkey" PRIMARY KEY (creditor_code);
alter table public."cs_agent_briefs" add constraint "cs_agent_briefs_pkey" PRIMARY KEY (id);
alter table public."cs_agent_proposals" add constraint "cs_agent_proposals_pkey" PRIMARY KEY (id);
alter table public."customers" add constraint "customers_pkey" PRIMARY KEY (id);
alter table public."daily_inspections" add constraint "daily_inspections_pkey" PRIMARY KEY (id);
alter table public."delivery_agent_briefs" add constraint "delivery_agent_briefs_pkey" PRIMARY KEY (id);
alter table public."delivery_agent_proposals" add constraint "delivery_agent_proposals_pkey" PRIMARY KEY (id);
alter table public."delivery_order_items" add constraint "delivery_order_items_pkey" PRIMARY KEY (id);
alter table public."delivery_order_payments" add constraint "delivery_order_payments_pkey" PRIMARY KEY (id);
alter table public."delivery_orders" add constraint "delivery_orders_do_number_key" UNIQUE (do_number);
alter table public."delivery_orders" add constraint "delivery_orders_pkey" PRIMARY KEY (id);
alter table public."delivery_return_items" add constraint "delivery_return_items_pkey" PRIMARY KEY (id);
alter table public."delivery_returns" add constraint "delivery_returns_pkey" PRIMARY KEY (id);
alter table public."delivery_returns" add constraint "delivery_returns_return_number_key" UNIQUE (return_number);
alter table public."delivery_status_log" add constraint "delivery_status_log_pkey" PRIMARY KEY (id);
alter table public."delivery_tracking" add constraint "delivery_tracking_pkey" PRIMARY KEY (doc_no);
alter table public."departments" add constraint "departments_pkey" PRIMARY KEY (id);
alter table public."document_agent_briefs" add constraint "document_agent_briefs_pkey" PRIMARY KEY (id);
alter table public."document_agent_findings" add constraint "document_agent_findings_pkey" PRIMARY KEY (id);
alter table public."document_refs" add constraint "document_refs_entity_type_entity_id_key" UNIQUE (entity_type, entity_id);
alter table public."document_refs" add constraint "document_refs_pkey" PRIMARY KEY (ref_no);
alter table public."document_types" add constraint "document_types_pkey" PRIMARY KEY (code);
alter table public."email_address_access" add constraint "email_address_access_pkey" PRIMARY KEY (id);
alter table public."email_addresses" add constraint "email_addresses_pkey" PRIMARY KEY (id);
alter table public."email_attachments" add constraint "email_attachments_pkey" PRIMARY KEY (id);
alter table public."email_labels" add constraint "email_labels_pkey" PRIMARY KEY (id);
alter table public."email_log" add constraint "email_log_pkey" PRIMARY KEY (id);
alter table public."email_messages" add constraint "email_messages_pkey" PRIMARY KEY (id);
alter table public."email_outbox" add constraint "email_outbox_pkey" PRIMARY KEY (id);
alter table public."email_threads" add constraint "email_threads_pkey" PRIMARY KEY (id);
alter table public."events" add constraint "events_pkey" PRIMARY KEY (id);
alter table public."execution_logs" add constraint "execution_logs_pkey" PRIMARY KEY (id);
alter table public."fabric_colours" add constraint "fabric_colours_pkey" PRIMARY KEY (fabric_id, colour_id);
alter table public."fabric_library" add constraint "fabric_library_pkey" PRIMARY KEY (id);
alter table public."fabric_tier_addon_config" add constraint "fabric_tier_addon_config_pkey" PRIMARY KEY (id);
alter table public."fabric_trackings" add constraint "fabric_trackings_pkey" PRIMARY KEY (id);
alter table public."fabrics" add constraint "fabrics_code_key" UNIQUE (code);
alter table public."fabrics" add constraint "fabrics_pkey" PRIMARY KEY (id);
alter table public."grn_items" add constraint "grn_items_pkey" PRIMARY KEY (id);
alter table public."grns" add constraint "grns_grn_number_key" UNIQUE (grn_number);
alter table public."grns" add constraint "grns_pkey" PRIMARY KEY (id);
alter table public."idea_comments" add constraint "idea_comments_pkey" PRIMARY KEY (id);
alter table public."idempotency_keys" add constraint "idempotency_keys_pkey" PRIMARY KEY (user_id, tenant_scope, key, scope);
alter table public."inventory_lot_consumptions" add constraint "inventory_lot_consumptions_pkey" PRIMARY KEY (id);
alter table public."inventory_lots" add constraint "inventory_lots_pkey" PRIMARY KEY (id);
alter table public."inventory_movements" add constraint "inventory_movements_pkey" PRIMARY KEY (id);
alter table public."invitations" add constraint "invitations_pkey" PRIMARY KEY (id);
alter table public."lorry_incidents" add constraint "lorry_incidents_pkey" PRIMARY KEY (id);
alter table public."mail_user_scope" add constraint "mail_user_scope_pkey" PRIMARY KEY (user_id);
alter table public."maintenance_config_history" add constraint "maintenance_config_history_pkey" PRIMARY KEY (id);
alter table public."master_price_history" add constraint "master_price_history_pkey" PRIMARY KEY (id);
alter table public."memos" add constraint "memos_pkey" PRIMARY KEY (id);
alter table public."memos" add constraint "memos_ref_no_key" UNIQUE (ref_no);
alter table public."mfg_products" add constraint "mfg_products_pkey" PRIMARY KEY (id);
alter table public."mfg_purchase_order_items" add constraint "mfg_purchase_order_items_pkey" PRIMARY KEY (id);
alter table public."mfg_purchase_order_lines" add constraint "mfg_purchase_order_lines_pkey" PRIMARY KEY (id);
alter table public."mfg_purchase_orders" add constraint "mfg_purchase_orders_pkey" PRIMARY KEY (id);
alter table public."mfg_purchase_orders" add constraint "mfg_purchase_orders_po_number_key" UNIQUE (po_number);
alter table public."mfg_sales_order_items" add constraint "mfg_sales_order_items_pkey" PRIMARY KEY (id);
alter table public."mfg_sales_order_payments" add constraint "mfg_sales_order_payments_pkey" PRIMARY KEY (id);
alter table public."mfg_sales_orders" add constraint "mfg_sales_orders_pkey" PRIMARY KEY (doc_no);
alter table public."mfg_so_audit_log" add constraint "mfg_so_audit_log_pkey" PRIMARY KEY (id);
alter table public."mfg_so_price_overrides" add constraint "mfg_so_price_overrides_pkey" PRIMARY KEY (id);
alter table public."mfg_so_status_changes" add constraint "mfg_so_status_changes_pkey" PRIMARY KEY (id);
alter table public."mfg_suppliers" add constraint "mfg_suppliers_code_key" UNIQUE (code);
alter table public."mfg_suppliers" add constraint "mfg_suppliers_pkey" PRIMARY KEY (id);
alter table public."mfg_warehouses" add constraint "mfg_warehouses_code_key" UNIQUE (code);
alter table public."mfg_warehouses" add constraint "mfg_warehouses_pkey" PRIMARY KEY (id);
alter table public."model_default_free_gifts" add constraint "model_default_free_gifts_pkey" PRIMARY KEY (model_id);
alter table public."model_fabric_tier_overrides" add constraint "model_fabric_tier_overrides_pkey" PRIMARY KEY (model_id);
alter table public."model_special_delivery_fees" add constraint "model_special_delivery_fees_pkey" PRIMARY KEY (model_id);
alter table public."mrp_category_lead_times" add constraint "mrp_category_lead_times_pkey" PRIMARY KEY (category);
alter table public."of_agent_briefs" add constraint "of_agent_briefs_pkey" PRIMARY KEY (id);
alter table public."of_agent_findings" add constraint "of_agent_findings_pkey" PRIMARY KEY (id);
alter table public."order_details" add constraint "order_details_pkey" PRIMARY KEY (doc_no);
alter table public."password_resets" add constraint "password_resets_pkey" PRIMARY KEY (id);
alter table public."phone_normalisation_backup" add constraint "phone_normalisation_backup_pkey" PRIMARY KEY (id);
alter table public."pms_agent_briefs" add constraint "pms_agent_briefs_pkey" PRIMARY KEY (id);
alter table public."pms_agent_proposals" add constraint "pms_agent_proposals_pkey" PRIMARY KEY (id);
alter table public."position_capabilities" add constraint "position_capabilities_pkey" PRIMARY KEY (position_id, capability);
alter table public."position_policy" add constraint "position_policy_pkey" PRIMARY KEY (position_id);
alter table public."positions" add constraint "positions_pkey" PRIMARY KEY (id);
alter table public."positions" add constraint "positions_slug_key" UNIQUE (slug);
alter table public."procurement_agent_briefs" add constraint "procurement_agent_briefs_pkey" PRIMARY KEY (id);
alter table public."procurement_agent_proposals" add constraint "procurement_agent_proposals_pkey" PRIMARY KEY (id);
alter table public."product_bedframe_colours" add constraint "product_bedframe_colours_pkey" PRIMARY KEY (product_id, colour_id);
alter table public."product_bundles" add constraint "product_bundles_pkey" PRIMARY KEY (product_id, bundle_id);
alter table public."product_compartments" add constraint "product_compartments_pkey" PRIMARY KEY (product_id, compartment_id);
alter table public."product_dept_configs" add constraint "product_dept_configs_pkey" PRIMARY KEY (product_code);
alter table public."product_fabrics" add constraint "product_fabrics_pkey" PRIMARY KEY (product_id, fabric_id);
alter table public."product_models" add constraint "product_models_pkey" PRIMARY KEY (id);
alter table public."product_size_variants" add constraint "product_size_variants_pkey" PRIMARY KEY (product_id, size_id);
alter table public."products" add constraint "products_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_sku_key" UNIQUE (sku);
alter table public."project_activity" add constraint "project_activity_pkey" PRIMARY KEY (id);
alter table public."project_attachments" add constraint "project_attachments_pkey" PRIMARY KEY (id);
alter table public."project_brands" add constraint "project_brands_pkey" PRIMARY KEY (id);
alter table public."project_checklist" add constraint "project_checklist_pkey" PRIMARY KEY (id);
alter table public."project_checklist_attachment_actions" add constraint "project_checklist_attachment_actions_pkey" PRIMARY KEY (id);
alter table public."project_checklist_attachments" add constraint "project_checklist_attachments_pkey" PRIMARY KEY (id);
alter table public."project_checklist_comments" add constraint "project_checklist_comments_pkey" PRIMARY KEY (id);
alter table public."project_checklist_sections" add constraint "project_checklist_sections_pkey" PRIMARY KEY (id);
alter table public."project_checklist_template_items" add constraint "project_checklist_template_items_pkey" PRIMARY KEY (id);
alter table public."project_checklist_template_sections" add constraint "project_checklist_template_sections_pkey" PRIMARY KEY (id);
alter table public."project_checklist_templates" add constraint "project_checklist_templates_pkey" PRIMARY KEY (id);
alter table public."project_contractors" add constraint "project_contractors_pkey" PRIMARY KEY (id);
alter table public."project_cost_rates" add constraint "project_cost_rates_pkey" PRIMARY KEY (id);
alter table public."project_defects" add constraint "project_defects_pkey" PRIMARY KEY (id);
alter table public."project_event_types" add constraint "project_event_types_pkey" PRIMARY KEY (id);
alter table public."project_finance" add constraint "project_finance_pkey" PRIMARY KEY (project_id);
alter table public."project_finance_lines" add constraint "project_finance_lines_pkey" PRIMARY KEY (id);
alter table public."project_organizers" add constraint "project_organizers_pkey" PRIMARY KEY (id);
alter table public."project_phase_photos" add constraint "project_phase_photos_pkey" PRIMARY KEY (id);
alter table public."project_reads" add constraint "project_reads_pkey" PRIMARY KEY (user_id, project_id);
alter table public."project_sales_attendees" add constraint "project_sales_attendees_pkey" PRIMARY KEY (project_id, sales_rep_id);
alter table public."project_sales_reports" add constraint "project_sales_reports_pkey" PRIMARY KEY (id);
alter table public."project_stock_transfers" add constraint "project_stock_transfers_pkey" PRIMARY KEY (id);
alter table public."project_team" add constraint "project_team_pkey" PRIMARY KEY (id);
alter table public."project_venues" add constraint "project_venues_pkey" PRIMARY KEY (id);
alter table public."projects" add constraint "projects_pkey" PRIMARY KEY (id);
alter table public."purchase_consignment_receive_items" add constraint "purchase_consignment_receive_items_pkey" PRIMARY KEY (id);
alter table public."purchase_consignment_receives" add constraint "purchase_consignment_receives_pkey" PRIMARY KEY (id);
alter table public."purchase_consignment_receives" add constraint "purchase_consignment_receives_receive_number_key" UNIQUE (receive_number);
alter table public."purchase_consignment_return_items" add constraint "purchase_consignment_return_items_pkey" PRIMARY KEY (id);
alter table public."purchase_consignment_returns" add constraint "purchase_consignment_returns_pkey" PRIMARY KEY (id);
alter table public."purchase_consignment_returns" add constraint "purchase_consignment_returns_return_number_key" UNIQUE (return_number);
alter table public."purchase_invoice_items" add constraint "purchase_invoice_items_pkey" PRIMARY KEY (id);
alter table public."purchase_invoices" add constraint "purchase_invoices_invoice_number_key" UNIQUE (invoice_number);
alter table public."purchase_invoices" add constraint "purchase_invoices_pkey" PRIMARY KEY (id);
alter table public."purchase_order_docs" add constraint "purchase_order_docs_pkey" PRIMARY KEY (doc_no);
alter table public."purchase_orders" add constraint "purchase_orders_pkey" PRIMARY KEY (id);
alter table public."purchase_return_items" add constraint "purchase_return_items_pkey" PRIMARY KEY (id);
alter table public."purchase_returns" add constraint "purchase_returns_pkey" PRIMARY KEY (id);
alter table public."purchase_returns" add constraint "purchase_returns_return_number_key" UNIQUE (return_number);
alter table public."push_devices" add constraint "push_devices_pkey" PRIMARY KEY (id);
alter table public."push_devices" add constraint "push_devices_token_key" UNIQUE (token);
alter table public."pwp_codes" add constraint "pwp_codes_pkey" PRIMARY KEY (code);
alter table public."pwp_rules" add constraint "pwp_rules_pkey" PRIMARY KEY (id);
alter table public."roles" add constraint "roles_pkey" PRIMARY KEY (id);
alter table public."salary_records" add constraint "salary_records_pkey" PRIMARY KEY (id);
alter table public."salary_trip_lines" add constraint "salary_trip_lines_pkey" PRIMARY KEY (id);
alter table public."sales_commission_tiers" add constraint "sales_commission_tiers_pkey" PRIMARY KEY (id);
alter table public."sales_entries" add constraint "sales_entries_pkey" PRIMARY KEY (id);
alter table public."sales_entry_activity" add constraint "sales_entry_activity_pkey" PRIMARY KEY (id);
alter table public."sales_entry_change_requests" add constraint "sales_entry_change_requests_pkey" PRIMARY KEY (id);
alter table public."sales_entry_items" add constraint "sales_entry_items_pkey" PRIMARY KEY (id);
alter table public."sales_entry_payments" add constraint "sales_entry_payments_pkey" PRIMARY KEY (id);
alter table public."sales_invoice_items" add constraint "sales_invoice_items_pkey" PRIMARY KEY (id);
alter table public."sales_invoice_payments" add constraint "sales_invoice_payments_pkey" PRIMARY KEY (id);
alter table public."sales_invoices" add constraint "sales_invoices_invoice_number_key" UNIQUE (invoice_number);
alter table public."sales_invoices" add constraint "sales_invoices_pkey" PRIMARY KEY (id);
alter table public."sales_orders" add constraint "sales_orders_pkey" PRIMARY KEY (id);
alter table public."sales_positions" add constraint "sales_positions_pkey" PRIMARY KEY (id);
alter table public."sales_rep_brands" add constraint "sales_rep_brands_pkey" PRIMARY KEY (rep_id, brand);
alter table public."sales_rep_commission_tiers" add constraint "sales_rep_commission_tiers_pkey" PRIMARY KEY (id);
alter table public."sales_reps" add constraint "sales_reps_pkey" PRIMARY KEY (id);
alter table public."sales_team_activity" add constraint "sales_team_activity_pkey" PRIMARY KEY (id);
alter table public."series" add constraint "series_pkey" PRIMARY KEY (id);
alter table public."sessions" add constraint "sessions_pkey" PRIMARY KEY (token);
alter table public."share_export_log" add constraint "share_export_log_pkey" PRIMARY KEY (id);
alter table public."si_agent_briefs" add constraint "si_agent_briefs_pkey" PRIMARY KEY (id);
alter table public."si_agent_findings" add constraint "si_agent_findings_pkey" PRIMARY KEY (id);
alter table public."size_library" add constraint "size_library_pkey" PRIMARY KEY (id);
alter table public."sofa_combo_pricing" add constraint "sofa_combo_pricing_pkey" PRIMARY KEY (id);
alter table public."sofa_quick_picks" add constraint "sofa_quick_picks_pkey" PRIMARY KEY (id);
alter table public."special_addons" add constraint "special_addons_code_key" UNIQUE (code);
alter table public."special_addons" add constraint "special_addons_pkey" PRIMARY KEY (id);
alter table public."state_warehouse_map" add constraint "state_warehouse_map_pkey" PRIMARY KEY (state);
alter table public."stock_items" add constraint "stock_items_pkey" PRIMARY KEY (item_code);
alter table public."stock_take_lines" add constraint "stock_take_lines_pkey" PRIMARY KEY (id);
alter table public."stock_takes" add constraint "stock_takes_pkey" PRIMARY KEY (id);
alter table public."stock_takes" add constraint "stock_takes_take_no_key" UNIQUE (take_no);
alter table public."stock_transfer_lines" add constraint "stock_transfer_lines_pkey" PRIMARY KEY (id);
alter table public."stock_transfers" add constraint "stock_transfers_pkey" PRIMARY KEY (id);
alter table public."stock_transfers" add constraint "stock_transfers_transfer_no_key" UNIQUE (transfer_no);
alter table public."supplier_accounts" add constraint "supplier_accounts_pkey" PRIMARY KEY (id);
alter table public."supplier_communications" add constraint "supplier_communications_pkey" PRIMARY KEY (id);
alter table public."supplier_invitations" add constraint "supplier_invitations_pkey" PRIMARY KEY (id);
alter table public."supplier_material_bindings" add constraint "supplier_material_bindings_pkey" PRIMARY KEY (id);
alter table public."supplier_sessions" add constraint "supplier_sessions_pkey" PRIMARY KEY (token);
alter table public."suppliers" add constraint "suppliers_pkey" PRIMARY KEY (id);
alter table public."system_settings" add constraint "system_settings_pkey" PRIMARY KEY (key);
alter table public."table_layouts" add constraint "table_layouts_pkey" PRIMARY KEY (id);
alter table public."tmp_sheet_capture" add constraint "tmp_sheet_capture_pkey" PRIMARY KEY (id);
alter table public."trip_proposal_trips" add constraint "trip_proposal_trips_pkey" PRIMARY KEY (id);
alter table public."trip_proposals" add constraint "trip_proposals_pkey" PRIMARY KEY (id);
alter table public."trip_stops" add constraint "trip_stops_pkey" PRIMARY KEY (id);
alter table public."udf_fields" add constraint "udf_fields_pkey" PRIMARY KEY (id);
alter table public."udf_values" add constraint "udf_values_pkey" PRIMARY KEY (table_name, row_key, field_key);
alter table public."user_brands" add constraint "user_brands_pkey" PRIMARY KEY (user_id, brand);
alter table public."user_companies" add constraint "user_companies_pkey" PRIMARY KEY (user_id, company_id);
alter table public."user_departments" add constraint "user_departments_pkey" PRIMARY KEY (user_id, department_id);
alter table public."users" add constraint "users_pkey" PRIMARY KEY (id);
alter table public."warehouse_rack_items" add constraint "warehouse_rack_items_pkey" PRIMARY KEY (id);
alter table public."warehouse_rack_movements" add constraint "warehouse_rack_movements_pkey" PRIMARY KEY (id);
alter table public."warehouse_racks" add constraint "warehouse_racks_pkey" PRIMARY KEY (id);
alter table public."warehouses" add constraint "warehouses_pkey" PRIMARY KEY (code);
alter table public."announcements" add constraint "chk_ann_category" CHECK ((category = ANY (ARRAY['GENERAL'::text, 'WARNING'::text, 'SOP'::text, 'LEARNING'::text])));
alter table public."announcements" add constraint "chk_ann_target_type" CHECK ((target_type = ANY (ARRAY['ALL_USERS'::text, 'DEPARTMENT_IDS'::text, 'POSITION_IDS'::text, 'USER_IDS'::text, 'MIXED'::text])));
alter table public."collection_agent_proposals" add constraint "chk_collection_agent_proposal_status" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text])));
alter table public."cs_agent_proposals" add constraint "chk_cs_agent_proposal_status" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text])));
alter table public."delivery_agent_proposals" add constraint "chk_delivery_agent_proposal_status" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text])));
alter table public."email_outbox" add constraint "email_outbox_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])));
alter table public."inventory_lot_consumptions" add constraint "inventory_lot_consumptions_qty_consumed_check" CHECK ((qty_consumed > 0));
alter table public."inventory_lots" add constraint "inventory_lots_qty_received_check" CHECK ((qty_received > 0));
alter table public."inventory_lots" add constraint "inventory_lots_qty_remaining_check" CHECK ((qty_remaining >= 0));
alter table public."mrp_category_lead_times" add constraint "mrp_category_lead_times_category_check" CHECK ((category = ANY (ARRAY['sofa'::text, 'bedframe'::text, 'mattress'::text, 'accessory'::text, 'service'::text])));
alter table public."mrp_category_lead_times" add constraint "mrp_category_lead_times_lead_days_check" CHECK ((lead_days >= 0));
alter table public."pms_agent_proposals" add constraint "chk_pms_agent_proposal_status" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text])));
alter table public."position_policy" add constraint "position_policy_can_move_money_check" CHECK ((can_move_money = ANY (ARRAY[0, 1])));
alter table public."position_policy" add constraint "position_policy_can_write_config_check" CHECK ((can_write_config = ANY (ARRAY[0, 1])));
alter table public."position_policy" add constraint "position_policy_cohort_check" CHECK ((cohort = ANY (ARRAY['god'::text, 'full'::text, 'restricted'::text, 'sales'::text])));
alter table public."position_policy" add constraint "position_policy_duty_check" CHECK ((duty = ANY (ARRAY['management'::text, 'finance'::text, 'purchasing'::text, 'logistic'::text, 'driver'::text, 'helper'::text, 'warehouse'::text, 'other'::text])));
alter table public."position_policy" add constraint "position_policy_is_fleet_check" CHECK ((is_fleet = ANY (ARRAY[0, 1])));
alter table public."position_policy" add constraint "position_policy_profile_check" CHECK (((profile IS NULL) OR (profile = ANY (ARRAY['driver_helper'::text, 'storekeeper'::text, 'storekeeper_supervisor'::text, 'calendar_viewer'::text, 'director'::text, 'rep'::text]))));
alter table public."procurement_agent_proposals" add constraint "chk_procurement_agent_proposal_status" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text])));
alter table public."project_contractors" add constraint "project_contractors_share_export_scope_check" CHECK ((share_export_scope = ANY (ARRAY['month'::text, 'year'::text])));
alter table public."push_devices" add constraint "push_devices_platform_check" CHECK ((platform = 'ios'::text));
alter table public."sales_entry_change_requests" add constraint "sales_entry_change_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'superseded'::text])));
alter table public."stock_takes" add constraint "stock_takes_scope_type_chk" CHECK ((scope_type = ANY (ARRAY['ALL'::text, 'CATEGORY'::text, 'CODE_PREFIX'::text])));
alter table public."stock_takes" add constraint "stock_takes_status_chk" CHECK ((status = ANY (ARRAY['OPEN'::text, 'POSTED'::text, 'CANCELLED'::text])));
alter table public."stock_transfer_lines" add constraint "stock_transfer_lines_qty_check" CHECK ((qty > 0));
alter table public."stock_transfers" add constraint "stock_transfers_not_same_wh" CHECK ((from_warehouse_id <> to_warehouse_id));
alter table public."stock_transfers" add constraint "stock_transfers_status_chk" CHECK ((status = ANY (ARRAY['POSTED'::text, 'CANCELLED'::text])));
alter table public."warehouse_rack_items" add constraint "warehouse_rack_items_qty_check" CHECK ((qty > 0));
alter table public."warehouse_rack_movements" add constraint "warehouse_rack_movements_type_chk" CHECK ((movement_type = ANY (ARRAY['STOCK_IN'::text, 'STOCK_OUT'::text, 'TRANSFER'::text])));
alter table public."warehouse_racks" add constraint "warehouse_racks_status_chk" CHECK ((status = ANY (ARRAY['OCCUPIED'::text, 'EMPTY'::text, 'RESERVED'::text])));
alter table public."announcement_acks" add constraint "announcement_acks_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."announcements" add constraint "announcements_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."assr_case_access" add constraint "assr_case_access_assr_id_fkey" FOREIGN KEY (assr_id) REFERENCES assr_cases(id) ON DELETE CASCADE;
alter table public."assr_case_categories" add constraint "assr_case_categories_case_id_fkey" FOREIGN KEY (case_id) REFERENCES assr_cases(id) ON DELETE CASCADE;
alter table public."assr_cases" add constraint "assr_cases_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."assr_supplier_returns" add constraint "assr_supplier_returns_assr_id_fkey" FOREIGN KEY (assr_id) REFERENCES assr_cases(id) ON DELETE CASCADE;
alter table public."consignment_delivery_order_items" add constraint "consignment_delivery_order_it_consignment_delivery_order_i_fkey" FOREIGN KEY (consignment_delivery_order_id) REFERENCES consignment_delivery_orders(id) ON DELETE CASCADE;
alter table public."consignment_delivery_order_items" add constraint "consignment_delivery_order_items_consignment_so_item_id_fkey" FOREIGN KEY (consignment_so_item_id) REFERENCES consignment_sales_order_items(id) ON DELETE SET NULL;
alter table public."consignment_delivery_order_payments" add constraint "consignment_delivery_order_pa_consignment_delivery_order_i_fkey" FOREIGN KEY (consignment_delivery_order_id) REFERENCES consignment_delivery_orders(id) ON DELETE CASCADE;
alter table public."consignment_delivery_orders" add constraint "consignment_delivery_orders_consignment_so_doc_no_fkey" FOREIGN KEY (consignment_so_doc_no) REFERENCES consignment_sales_orders(doc_no) ON DELETE SET NULL;
alter table public."consignment_delivery_orders" add constraint "consignment_delivery_orders_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."consignment_delivery_return_items" add constraint "consignment_delivery_return_i_consignment_delivery_return__fkey" FOREIGN KEY (consignment_delivery_return_id) REFERENCES consignment_delivery_returns(id) ON DELETE CASCADE;
alter table public."consignment_delivery_return_items" add constraint "consignment_delivery_return_items_consignment_do_item_id_fkey" FOREIGN KEY (consignment_do_item_id) REFERENCES consignment_delivery_order_items(id) ON DELETE SET NULL;
alter table public."consignment_delivery_returns" add constraint "consignment_delivery_returns_consignment_do_id_fkey" FOREIGN KEY (consignment_do_id) REFERENCES consignment_delivery_orders(id) ON DELETE SET NULL;
alter table public."consignment_delivery_returns" add constraint "consignment_delivery_returns_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."consignment_sales_order_items" add constraint "consignment_sales_order_items_doc_no_fkey" FOREIGN KEY (doc_no) REFERENCES consignment_sales_orders(doc_no) ON DELETE CASCADE;
alter table public."consignment_sales_order_items" add constraint "consignment_sales_order_items_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."consignment_sales_order_payments" add constraint "consignment_sales_order_payments_so_doc_no_fkey" FOREIGN KEY (so_doc_no) REFERENCES consignment_sales_orders(doc_no) ON DELETE CASCADE;
alter table public."consignment_sales_orders" add constraint "consignment_sales_orders_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
alter table public."consignment_so_audit_log" add constraint "consignment_so_audit_log_so_doc_no_fkey" FOREIGN KEY (so_doc_no) REFERENCES consignment_sales_orders(doc_no) ON DELETE CASCADE;
alter table public."creditors" add constraint "creditors_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."delivery_order_items" add constraint "delivery_order_items_delivery_order_id_fkey" FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE;
alter table public."delivery_order_items" add constraint "delivery_order_items_so_item_id_fkey" FOREIGN KEY (so_item_id) REFERENCES mfg_sales_order_items(id) ON DELETE SET NULL;
alter table public."delivery_order_payments" add constraint "delivery_order_payments_delivery_order_id_fkey" FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE;
alter table public."delivery_orders" add constraint "delivery_orders_so_doc_no_fkey" FOREIGN KEY (so_doc_no) REFERENCES mfg_sales_orders(doc_no) ON DELETE SET NULL;
alter table public."delivery_orders" add constraint "delivery_orders_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."delivery_return_items" add constraint "delivery_return_items_delivery_return_id_fkey" FOREIGN KEY (delivery_return_id) REFERENCES delivery_returns(id) ON DELETE CASCADE;
alter table public."delivery_return_items" add constraint "delivery_return_items_do_item_id_fkey" FOREIGN KEY (do_item_id) REFERENCES delivery_order_items(id) ON DELETE SET NULL;
alter table public."delivery_returns" add constraint "delivery_returns_delivery_order_id_fkey" FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE SET NULL;
alter table public."delivery_returns" add constraint "delivery_returns_sales_invoice_id_fkey" FOREIGN KEY (sales_invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL;
alter table public."delivery_returns" add constraint "delivery_returns_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."departments" add constraint "departments_lead_user_id_fkey" FOREIGN KEY (lead_user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public."email_address_access" add constraint "email_address_access_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."email_addresses" add constraint "email_addresses_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."email_labels" add constraint "email_labels_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."email_messages" add constraint "email_messages_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."email_threads" add constraint "email_threads_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."events" add constraint "events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."fabric_colours" add constraint "fabric_colours_fabric_id_fkey" FOREIGN KEY (fabric_id) REFERENCES fabric_library(id) ON DELETE CASCADE;
alter table public."grn_items" add constraint "grn_items_grn_id_fkey" FOREIGN KEY (grn_id) REFERENCES grns(id) ON DELETE CASCADE;
alter table public."grn_items" add constraint "grn_items_purchase_order_item_id_fkey" FOREIGN KEY (purchase_order_item_id) REFERENCES mfg_purchase_order_items(id) ON DELETE SET NULL;
alter table public."grn_items" add constraint "grn_items_rack_id_fkey" FOREIGN KEY (rack_id) REFERENCES warehouse_racks(id) ON DELETE SET NULL;
alter table public."grns" add constraint "grns_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES mfg_purchase_orders(id) ON DELETE SET NULL;
alter table public."grns" add constraint "grns_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE RESTRICT;
alter table public."grns" add constraint "grns_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."inventory_lot_consumptions" add constraint "inventory_lot_consumptions_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES inventory_lots(id) ON DELETE CASCADE;
alter table public."inventory_lot_consumptions" add constraint "inventory_lot_consumptions_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE RESTRICT;
alter table public."inventory_lots" add constraint "inventory_lots_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE RESTRICT;
alter table public."inventory_movements" add constraint "inventory_movements_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE RESTRICT;
alter table public."lorry_incidents" add constraint "lorry_incidents_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."mfg_products" add constraint "mfg_products_model_id_fkey" FOREIGN KEY (model_id) REFERENCES product_models(id) ON DELETE SET NULL;
alter table public."mfg_products" add constraint "mfg_products_retail_product_id_fkey" FOREIGN KEY (retail_product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public."mfg_purchase_order_items" add constraint "mfg_purchase_order_items_binding_id_fkey" FOREIGN KEY (binding_id) REFERENCES supplier_material_bindings(id) ON DELETE SET NULL;
alter table public."mfg_purchase_order_items" add constraint "mfg_purchase_order_items_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES mfg_purchase_orders(id) ON DELETE CASCADE;
alter table public."mfg_purchase_order_lines" add constraint "mfg_purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES mfg_purchase_orders(id) ON DELETE CASCADE;
alter table public."mfg_purchase_orders" add constraint "mfg_purchase_orders_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE RESTRICT;
alter table public."mfg_sales_order_items" add constraint "mfg_sales_order_items_doc_no_fkey" FOREIGN KEY (doc_no) REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE;
alter table public."mfg_sales_order_items" add constraint "mfg_sales_order_items_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."mfg_sales_order_payments" add constraint "mfg_sales_order_payments_so_doc_no_fkey" FOREIGN KEY (so_doc_no) REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE;
alter table public."mfg_sales_orders" add constraint "mfg_sales_orders_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
alter table public."mfg_so_audit_log" add constraint "mfg_so_audit_log_so_doc_no_fkey" FOREIGN KEY (so_doc_no) REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE;
alter table public."mfg_so_price_overrides" add constraint "mfg_so_price_overrides_doc_no_fkey" FOREIGN KEY (doc_no) REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE;
alter table public."mfg_so_price_overrides" add constraint "mfg_so_price_overrides_item_id_fkey" FOREIGN KEY (item_id) REFERENCES mfg_sales_order_items(id) ON DELETE CASCADE;
alter table public."mfg_so_status_changes" add constraint "mfg_so_status_changes_doc_no_fkey" FOREIGN KEY (doc_no) REFERENCES mfg_sales_orders(doc_no) ON DELETE CASCADE;
alter table public."model_default_free_gifts" add constraint "model_default_free_gifts_model_id_fkey" FOREIGN KEY (model_id) REFERENCES product_models(id) ON DELETE CASCADE;
alter table public."model_fabric_tier_overrides" add constraint "model_fabric_tier_overrides_model_id_fkey" FOREIGN KEY (model_id) REFERENCES product_models(id) ON DELETE CASCADE;
alter table public."model_special_delivery_fees" add constraint "model_special_delivery_fees_model_id_fkey" FOREIGN KEY (model_id) REFERENCES product_models(id) ON DELETE CASCADE;
alter table public."order_details" add constraint "order_details_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."position_capabilities" add constraint "position_capabilities_position_id_fkey" FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE;
alter table public."position_policy" add constraint "position_policy_position_id_fkey" FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE;
alter table public."positions" add constraint "positions_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id);
alter table public."product_bedframe_colours" add constraint "product_bedframe_colours_colour_id_fkey" FOREIGN KEY (colour_id) REFERENCES bedframe_colours(id);
alter table public."product_bedframe_colours" add constraint "product_bedframe_colours_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_bundles" add constraint "product_bundles_bundle_id_fkey" FOREIGN KEY (bundle_id) REFERENCES bundle_library(id);
alter table public."product_bundles" add constraint "product_bundles_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_compartments" add constraint "product_compartments_compartment_id_fkey" FOREIGN KEY (compartment_id) REFERENCES compartment_library(id);
alter table public."product_compartments" add constraint "product_compartments_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_fabrics" add constraint "product_fabrics_fabric_id_fkey" FOREIGN KEY (fabric_id) REFERENCES fabric_library(id);
alter table public."product_fabrics" add constraint "product_fabrics_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_size_variants" add constraint "product_size_variants_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_size_variants" add constraint "product_size_variants_size_id_fkey" FOREIGN KEY (size_id) REFERENCES size_library(id);
alter table public."products" add constraint "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id);
alter table public."products" add constraint "products_series_id_fkey" FOREIGN KEY (series_id) REFERENCES series(id);
alter table public."products" add constraint "products_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE RESTRICT;
alter table public."project_activity" add constraint "project_activity_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_brands" add constraint "project_brands_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_checklist" add constraint "project_checklist_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_checklist_attachments" add constraint "project_checklist_attachments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_checklist_comments" add constraint "project_checklist_comments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_checklist_sections" add constraint "project_checklist_sections_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_checklist_template_items" add constraint "project_checklist_template_items_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_checklist_template_sections" add constraint "project_checklist_template_sections_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_checklist_templates" add constraint "project_checklist_templates_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."project_venues" add constraint "project_venues_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."projects" add constraint "projects_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."purchase_consignment_receive_items" add constraint "purchase_consignment_receive_items_pc_receive_id_fkey" FOREIGN KEY (pc_receive_id) REFERENCES purchase_consignment_receives(id) ON DELETE CASCADE;
alter table public."purchase_consignment_receive_items" add constraint "purchase_consignment_receive_items_rack_id_fkey" FOREIGN KEY (rack_id) REFERENCES warehouse_racks(id) ON DELETE SET NULL;
alter table public."purchase_consignment_receives" add constraint "purchase_consignment_receives_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE RESTRICT;
alter table public."purchase_consignment_receives" add constraint "purchase_consignment_receives_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."purchase_consignment_return_items" add constraint "purchase_consignment_return_i_purchase_consignment_return__fkey" FOREIGN KEY (purchase_consignment_return_id) REFERENCES purchase_consignment_returns(id) ON DELETE CASCADE;
alter table public."purchase_consignment_return_items" add constraint "purchase_consignment_return_items_pc_receive_item_id_fkey" FOREIGN KEY (pc_receive_item_id) REFERENCES purchase_consignment_receive_items(id) ON DELETE SET NULL;
alter table public."purchase_consignment_returns" add constraint "purchase_consignment_returns_pc_receive_id_fkey" FOREIGN KEY (pc_receive_id) REFERENCES purchase_consignment_receives(id) ON DELETE SET NULL;
alter table public."purchase_consignment_returns" add constraint "purchase_consignment_returns_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE RESTRICT;
alter table public."purchase_invoice_items" add constraint "purchase_invoice_items_grn_item_id_fkey" FOREIGN KEY (grn_item_id) REFERENCES grn_items(id) ON DELETE SET NULL;
alter table public."purchase_invoice_items" add constraint "purchase_invoice_items_purchase_invoice_id_fkey" FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE;
alter table public."purchase_invoices" add constraint "purchase_invoices_grn_id_fkey" FOREIGN KEY (grn_id) REFERENCES grns(id) ON DELETE SET NULL;
alter table public."purchase_invoices" add constraint "purchase_invoices_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES mfg_purchase_orders(id) ON DELETE SET NULL;
alter table public."purchase_invoices" add constraint "purchase_invoices_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE RESTRICT;
alter table public."purchase_order_docs" add constraint "purchase_order_docs_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."purchase_orders" add constraint "purchase_orders_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."purchase_return_items" add constraint "purchase_return_items_grn_item_id_fkey" FOREIGN KEY (grn_item_id) REFERENCES grn_items(id) ON DELETE SET NULL;
alter table public."purchase_return_items" add constraint "purchase_return_items_purchase_return_id_fkey" FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE;
alter table public."purchase_returns" add constraint "purchase_returns_grn_id_fkey" FOREIGN KEY (grn_id) REFERENCES grns(id) ON DELETE SET NULL;
alter table public."purchase_returns" add constraint "purchase_returns_purchase_order_id_fkey" FOREIGN KEY (purchase_order_id) REFERENCES mfg_purchase_orders(id) ON DELETE SET NULL;
alter table public."purchase_returns" add constraint "purchase_returns_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE RESTRICT;
alter table public."push_devices" add constraint "push_devices_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."pwp_codes" add constraint "pwp_codes_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
alter table public."pwp_codes" add constraint "pwp_codes_rule_id_fkey" FOREIGN KEY (rule_id) REFERENCES pwp_rules(id) ON DELETE SET NULL;
alter table public."salary_trip_lines" add constraint "salary_trip_lines_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."sales_entries" add constraint "sales_entries_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."sales_entry_activity" add constraint "sales_entry_activity_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."sales_entry_change_requests" add constraint "sales_entry_change_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."sales_entry_change_requests" add constraint "sales_entry_change_requests_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES sales_entries(id) ON DELETE CASCADE;
alter table public."sales_entry_items" add constraint "sales_entry_items_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."sales_entry_payments" add constraint "sales_entry_payments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."sales_invoice_items" add constraint "sales_invoice_items_do_item_id_fkey" FOREIGN KEY (do_item_id) REFERENCES delivery_order_items(id) ON DELETE SET NULL;
alter table public."sales_invoice_items" add constraint "sales_invoice_items_sales_invoice_id_fkey" FOREIGN KEY (sales_invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
alter table public."sales_invoice_items" add constraint "sales_invoice_items_so_item_id_fkey" FOREIGN KEY (so_item_id) REFERENCES mfg_sales_order_items(id) ON DELETE SET NULL;
alter table public."sales_invoice_payments" add constraint "sales_invoice_payments_sales_invoice_id_fkey" FOREIGN KEY (sales_invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
alter table public."sales_invoices" add constraint "sales_invoices_delivery_order_id_fkey" FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE SET NULL;
alter table public."sales_invoices" add constraint "sales_invoices_so_doc_no_fkey" FOREIGN KEY (so_doc_no) REFERENCES mfg_sales_orders(doc_no) ON DELETE SET NULL;
alter table public."sales_orders" add constraint "sales_orders_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."sofa_combo_pricing" add constraint "sofa_combo_pricing_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
alter table public."sofa_combo_pricing" add constraint "sofa_combo_pricing_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE CASCADE;
alter table public."stock_take_lines" add constraint "stock_take_lines_stock_take_id_fkey" FOREIGN KEY (stock_take_id) REFERENCES stock_takes(id) ON DELETE CASCADE;
alter table public."stock_takes" add constraint "stock_takes_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE RESTRICT;
alter table public."stock_transfer_lines" add constraint "stock_transfer_lines_stock_transfer_id_fkey" FOREIGN KEY (stock_transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE;
alter table public."stock_transfers" add constraint "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY (from_warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE RESTRICT;
alter table public."stock_transfers" add constraint "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY (to_warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE RESTRICT;
alter table public."supplier_material_bindings" add constraint "supplier_material_bindings_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES mfg_suppliers(id) ON DELETE CASCADE;
alter table public."trip_proposal_trips" add constraint "trip_proposal_trips_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."trip_proposals" add constraint "trip_proposals_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."trip_stops" add constraint "trip_stops_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public."user_companies" add constraint "user_companies_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public."user_companies" add constraint "user_companies_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public."users" add constraint "users_position_id_fkey" FOREIGN KEY (position_id) REFERENCES positions(id);
alter table public."warehouse_rack_items" add constraint "warehouse_rack_items_rack_id_fkey" FOREIGN KEY (rack_id) REFERENCES warehouse_racks(id) ON DELETE CASCADE;
alter table public."warehouse_rack_movements" add constraint "warehouse_rack_movements_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE SET NULL;
alter table public."warehouse_racks" add constraint "warehouse_racks_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES mfg_warehouses(id) ON DELETE CASCADE;

CREATE INDEX ac_snapshot_po_cancelled_idx ON public.ac_snapshot_purchase_orders USING btree (cancelled);
CREATE INDEX ac_snapshot_po_doc_date_idx ON public.ac_snapshot_purchase_orders USING btree (doc_date);
CREATE INDEX ac_snapshot_runs_kind_started_idx ON public.ac_snapshot_runs USING btree (kind, started_at DESC);
CREATE INDEX ac_snapshot_so_doc_date_idx ON public.ac_snapshot_sales_orders USING btree (doc_date);
CREATE INDEX ac_snapshot_so_region_idx ON public.ac_snapshot_sales_orders USING btree (region_route);
CREATE INDEX idx_agent_decision_outcomes_agent ON public.agent_decision_outcomes USING btree (agent, observed_at DESC);
CREATE INDEX idx_agent_decision_outcomes_decision ON public.agent_decision_outcomes USING btree (decision_id, observed_at DESC);
CREATE INDEX idx_agent_decisions_agent ON public.agent_decisions USING btree (agent, created_at DESC);
CREATE INDEX idx_agent_decisions_class ON public.agent_decisions USING btree (decision_class, created_at DESC);
CREATE INDEX idx_agent_feedback_agent ON public.agent_feedback USING btree (agent, status);
CREATE UNIQUE INDEX uq_agent_kill_scopes ON public.agent_kill_scopes USING btree (scope_type, scope_value);
CREATE INDEX idx_agent_runs_agent ON public.agent_runs USING btree (agent, started_at DESC);
CREATE INDEX idx_announcement_acks_company_id ON public.announcement_acks USING btree (company_id);
CREATE INDEX idx_announcement_acks_user ON public.announcement_acks USING btree (user_id);
CREATE INDEX idx_announcement_files_ann ON public.announcement_files USING btree (announcement_id);
CREATE INDEX idx_announcement_reminders_user ON public.announcement_reminders USING btree (user_id);
CREATE UNIQUE INDEX announcements_client_key_uq ON public.announcements USING btree (created_by, client_key) WHERE (client_key IS NOT NULL);
CREATE INDEX idx_announcements_active_created ON public.announcements USING btree (is_active, created_at DESC);
CREATE INDEX idx_announcements_approval_open ON public.announcements USING btree (approval_status) WHERE (approval_status <> 'APPROVED'::text);
CREATE INDEX idx_announcements_company_id ON public.announcements USING btree (company_id);
CREATE UNIQUE INDEX idx_announcements_ref_no ON public.announcements USING btree (ref_no) WHERE (ref_no IS NOT NULL);
CREATE INDEX idx_assistant_conv_user ON public.assistant_conversations USING btree (user_id, updated_at DESC);
CREATE INDEX idx_assistant_msg_conv ON public.assistant_messages USING btree (conversation_id, created_at);
CREATE INDEX idx_assistant_msg_user ON public.assistant_messages USING btree (user_id, created_at);
CREATE INDEX idx_assr_activity_archived ON public.assr_activity USING btree (archived_at);
CREATE INDEX idx_assr_activity_case ON public.assr_activity USING btree (assr_id);
CREATE INDEX idx_assr_activity_category ON public.assr_activity USING btree (assr_id, category);
CREATE INDEX idx_assr_activity_refs ON public.assr_activity USING btree (references_entry_id);
CREATE INDEX idx_assr_activity_source ON public.assr_activity USING btree (source_channel);
CREATE INDEX idx_assr_activity_stage_since ON public.assr_activity USING btree (assr_id, action, to_value, created_at);
CREATE INDEX idx_assr_alert_acks_active ON public.assr_alert_acks USING btree (assr_id, stage, event, snoozed_until);
CREATE INDEX idx_assr_alert_acks_case ON public.assr_alert_acks USING btree (assr_id);
CREATE INDEX idx_assr_attachments_archived ON public.assr_attachments USING btree (archived_at);
CREATE INDEX idx_assr_attachments_case ON public.assr_attachments USING btree (assr_id);
CREATE INDEX idx_assr_case_access_user ON public.assr_case_access USING btree (user_id);
CREATE INDEX idx_assr_case_categories_slug ON public.assr_case_categories USING btree (slug);
CREATE INDEX idx_assr_approved_by ON public.assr_cases USING btree (approved_by);
CREATE INDEX idx_assr_assigned ON public.assr_cases USING btree (assigned_to);
CREATE INDEX idx_assr_cases_archived ON public.assr_cases USING btree (archived_at);
CREATE INDEX idx_assr_cases_company_id ON public.assr_cases USING btree (company_id);
CREATE INDEX idx_assr_cases_customer ON public.assr_cases USING btree (customer_id);
CREATE INDEX idx_assr_cases_verification_outcome ON public.assr_cases USING btree (verification_outcome) WHERE (verification_outcome IS NOT NULL);
CREATE INDEX idx_assr_creditor_code ON public.assr_cases USING btree (creditor_code);
CREATE INDEX idx_assr_customer_email ON public.assr_cases USING btree (customer_email);
CREATE INDEX idx_assr_deadline ON public.assr_cases USING btree (deadline_at);
CREATE INDEX idx_assr_items_ready ON public.assr_cases USING btree (items_ready_at);
CREATE INDEX idx_assr_lead_time_prof ON public.assr_cases USING btree (lead_time_profile_id);
CREATE INDEX idx_assr_ncr ON public.assr_cases USING btree (ncr_category);
CREATE INDEX idx_assr_stage ON public.assr_cases USING btree (stage);
CREATE INDEX idx_assr_stage_changed ON public.assr_cases USING btree (stage_changed_at);
CREATE INDEX idx_assr_stage_entered ON public.assr_cases USING btree (stage_entered_at);
CREATE INDEX idx_assr_status ON public.assr_cases USING btree (status);
CREATE INDEX idx_assr_supplier_pickup ON public.assr_cases USING btree (supplier_pickup_at);
CREATE INDEX trgm_assr_customer ON public.assr_cases USING gin (customer_name gin_trgm_ops);
CREATE INDEX trgm_assr_doc_no ON public.assr_cases USING gin (doc_no gin_trgm_ops);
CREATE INDEX trgm_assr_issue ON public.assr_cases USING gin (complaint_issue gin_trgm_ops);
CREATE INDEX trgm_assr_no ON public.assr_cases USING gin (assr_no gin_trgm_ops);
CREATE INDEX trgm_assr_phone ON public.assr_cases USING gin (phone gin_trgm_ops);
CREATE INDEX trgm_assr_po_no ON public.assr_cases USING gin (po_no gin_trgm_ops);
CREATE UNIQUE INDEX uq_assr_cases_assr_no ON public.assr_cases USING btree (assr_no) WHERE (id <> ALL (ARRAY[(1200)::bigint, (1201)::bigint, (1223)::bigint, (1224)::bigint, (1225)::bigint, (1226)::bigint, (1227)::bigint, (1228)::bigint]));
CREATE INDEX idx_assr_issue_cat_active ON public.assr_issue_categories USING btree (active);
CREATE INDEX idx_assr_items_case ON public.assr_items USING btree (assr_id);
CREATE INDEX idx_assr_lt_acts_at ON public.assr_lead_time_activations USING btree (activated_at);
CREATE INDEX idx_assr_lt_acts_profile ON public.assr_lead_time_activations USING btree (profile_id, activated_at);
CREATE INDEX idx_assr_lt_amend_profile ON public.assr_lead_time_amendments USING btree (profile_id, created_at);
CREATE INDEX idx_assr_lt_sched_pending ON public.assr_lead_time_scheduled_activations USING btree (status, scheduled_for);
CREATE INDEX idx_assr_logistics_archived ON public.assr_logistics USING btree (archived_at);
CREATE INDEX idx_assr_logistics_case ON public.assr_logistics USING btree (assr_id);
CREATE INDEX idx_assr_ncr_active ON public.assr_ncr_categories USING btree (active);
CREATE INDEX idx_assr_priorities_active ON public.assr_priorities USING btree (active);
CREATE INDEX idx_assr_priority_stage_targets_lookup ON public.assr_priority_stage_targets USING btree (priority_id, stage);
CREATE INDEX idx_assr_product_cat_active ON public.assr_product_categories USING btree (active);
CREATE INDEX idx_assr_resolution_active ON public.assr_resolution_methods USING btree (active);
CREATE INDEX idx_assr_stage_history_case ON public.assr_stage_history USING btree (assr_id);
CREATE INDEX idx_assr_stage_history_open ON public.assr_stage_history USING btree (assr_id, exited_at);
CREATE INDEX idx_assr_stage_targets_profile ON public.assr_stage_targets USING btree (profile_id);
CREATE INDEX idx_assr_supplier_returns_case ON public.assr_supplier_returns USING btree (assr_id, round_no);
CREATE UNIQUE INDEX uq_assr_supplier_returns_ref_no ON public.assr_supplier_returns USING btree (ref_no) WHERE (ref_no IS NOT NULL);
CREATE INDEX idx_assr_supplier_tokens_case ON public.assr_supplier_tokens USING btree (assr_id);
CREATE INDEX idx_assr_supplier_tokens_token ON public.assr_supplier_tokens USING btree (token);
CREATE INDEX idx_survey_assr ON public.assr_survey_tokens USING btree (assr_id);
CREATE INDEX idx_audit_events_actor ON public.audit_events USING btree (actor_id);
CREATE INDEX idx_audit_events_created ON public.audit_events USING btree (created_at);
CREATE INDEX idx_audit_events_entity ON public.audit_events USING btree (entity_type, entity_id);
CREATE INDEX idx_ac_do_ref ON public.autocount_delivery_orders USING btree (lower(ref));
CREATE INDEX idx_bedframe_options_kind ON public.bedframe_options USING btree (kind);
CREATE INDEX idx_brand_share_tokens_brand ON public.brand_share_tokens USING btree (brand);
CREATE INDEX idx_case_track_assr ON public.case_track_tokens USING btree (assr_id);
CREATE INDEX idx_case_track_exp ON public.case_track_tokens USING btree (expires_at);
CREATE UNIQUE INDEX idx_client_errors_dedup ON public.client_errors USING btree (dedup_hash, day, user_id);
CREATE INDEX idx_client_errors_last_seen ON public.client_errors USING btree (last_seen_at);
CREATE INDEX idx_collection_agent_briefs_created ON public.collection_agent_briefs USING btree (created_at DESC);
CREATE INDEX idx_collection_agent_proposals_key ON public.collection_agent_proposals USING btree (kind, key, status);
CREATE INDEX idx_collection_agent_proposals_status ON public.collection_agent_proposals USING btree (status, created_at DESC);
CREATE INDEX idx_config_proposals_status ON public.config_proposals USING btree (status, generated_at DESC);
CREATE INDEX idx_cdo_items_do ON public.consignment_delivery_order_items USING btree (consignment_delivery_order_id);
CREATE INDEX idx_cdo_items_so_item ON public.consignment_delivery_order_items USING btree (consignment_so_item_id);
CREATE INDEX idx_cdop_do ON public.consignment_delivery_order_payments USING btree (consignment_delivery_order_id);
CREATE INDEX idx_cdo_date ON public.consignment_delivery_orders USING btree (do_date);
CREATE INDEX idx_cdo_so ON public.consignment_delivery_orders USING btree (consignment_so_doc_no);
CREATE INDEX idx_cdo_status ON public.consignment_delivery_orders USING btree (status);
CREATE INDEX idx_cdr_items_do_item ON public.consignment_delivery_return_items USING btree (consignment_do_item_id);
CREATE INDEX idx_cdr_items_dr ON public.consignment_delivery_return_items USING btree (consignment_delivery_return_id);
CREATE INDEX idx_cdr_debtor ON public.consignment_delivery_returns USING btree (debtor_code);
CREATE INDEX idx_cdr_do ON public.consignment_delivery_returns USING btree (consignment_do_id);
CREATE INDEX idx_cdr_status ON public.consignment_delivery_returns USING btree (status);
CREATE INDEX idx_cso_items_doc ON public.consignment_sales_order_items USING btree (doc_no);
CREATE INDEX idx_cso_items_item ON public.consignment_sales_order_items USING btree (item_code);
CREATE INDEX idx_csop_doc ON public.consignment_sales_order_payments USING btree (so_doc_no);
CREATE INDEX idx_cso_customer ON public.consignment_sales_orders USING btree (customer_id);
CREATE INDEX idx_cso_date ON public.consignment_sales_orders USING btree (so_date);
CREATE INDEX idx_cso_status ON public.consignment_sales_orders USING btree (status);
CREATE INDEX idx_csoaudit_doc ON public.consignment_so_audit_log USING btree (so_doc_no);
CREATE INDEX idx_csoaudit_doc_at ON public.consignment_so_audit_log USING btree (so_doc_no, created_at);
CREATE INDEX idx_contractor_share_tokens_contractor ON public.contractor_share_tokens USING btree (contractor);
CREATE INDEX idx_creditors_company_id ON public.creditors USING btree (company_id);
CREATE INDEX idx_creditors_company_name ON public.creditors USING btree (company_name);
CREATE INDEX idx_creditors_currency ON public.creditors USING btree (currency_code);
CREATE INDEX idx_creditors_type ON public.creditors USING btree (type);
CREATE INDEX trgm_cred_code ON public.creditors USING gin (creditor_code gin_trgm_ops);
CREATE INDEX trgm_cred_company ON public.creditors USING gin (company_name gin_trgm_ops);
CREATE INDEX trgm_cred_desc2 ON public.creditors USING gin (desc2 gin_trgm_ops);
CREATE INDEX trgm_cred_email ON public.creditors USING gin (email gin_trgm_ops);
CREATE INDEX trgm_cred_mobile ON public.creditors USING gin (mobile gin_trgm_ops);
CREATE INDEX trgm_cred_phone1 ON public.creditors USING gin (phone1 gin_trgm_ops);
CREATE INDEX idx_cs_agent_briefs_created ON public.cs_agent_briefs USING btree (created_at DESC);
CREATE INDEX idx_cs_agent_proposals_key ON public.cs_agent_proposals USING btree (kind, key, status);
CREATE INDEX idx_cs_agent_proposals_status ON public.cs_agent_proposals USING btree (status, created_at DESC);
CREATE UNIQUE INDEX customers_customer_code_unique ON public.customers USING btree (customer_code) WHERE (customer_code IS NOT NULL);
CREATE UNIQUE INDEX customers_name_phone_unique ON public.customers USING btree (lower(TRIM(BOTH FROM name)), phone) WHERE (phone IS NOT NULL);
CREATE INDEX idx_customers_phone ON public.customers USING btree (phone);
CREATE INDEX idx_inspection_date ON public.daily_inspections USING btree (inspection_date);
CREATE INDEX idx_inspection_lorry ON public.daily_inspections USING btree (lorry_id);
CREATE INDEX idx_delivery_agent_briefs_created ON public.delivery_agent_briefs USING btree (created_at DESC);
CREATE INDEX idx_delivery_agent_proposals_key ON public.delivery_agent_proposals USING btree (kind, key, status);
CREATE INDEX idx_delivery_agent_proposals_kind ON public.delivery_agent_proposals USING btree (kind, status);
CREATE INDEX idx_delivery_agent_proposals_status ON public.delivery_agent_proposals USING btree (status, created_at DESC);
CREATE INDEX idx_do_items_do ON public.delivery_order_items USING btree (delivery_order_id);
CREATE INDEX idx_do_items_so_item ON public.delivery_order_items USING btree (so_item_id);
CREATE INDEX idx_dop_do ON public.delivery_order_payments USING btree (delivery_order_id);
CREATE INDEX idx_do_date ON public.delivery_orders USING btree (do_date);
CREATE INDEX idx_do_so ON public.delivery_orders USING btree (so_doc_no);
CREATE INDEX idx_do_status ON public.delivery_orders USING btree (status);
CREATE INDEX idx_dr_items_do_item ON public.delivery_return_items USING btree (do_item_id);
CREATE INDEX idx_dr_items_dr ON public.delivery_return_items USING btree (delivery_return_id);
CREATE INDEX idx_dr_debtor ON public.delivery_returns USING btree (debtor_code);
CREATE INDEX idx_dr_do ON public.delivery_returns USING btree (delivery_order_id);
CREATE INDEX idx_dr_status ON public.delivery_returns USING btree (status);
CREATE INDEX idx_dsl_doc ON public.delivery_status_log USING btree (doc_no);
CREATE INDEX idx_dt_est_delivery ON public.delivery_tracking USING btree (est_delivery_date);
CREATE INDEX idx_dt_region ON public.delivery_tracking USING btree (region);
CREATE INDEX idx_dt_shipout ON public.delivery_tracking USING btree (shipout_date);
CREATE INDEX idx_dt_status ON public.delivery_tracking USING btree (status);
CREATE INDEX idx_dt_trip ON public.delivery_tracking USING btree (trip_id);
CREATE UNIQUE INDEX idx_departments_code_upper ON public.departments USING btree (upper(code)) WHERE (code IS NOT NULL);
CREATE INDEX idx_doc_agent_briefs_generated ON public.document_agent_briefs USING btree (generated_at DESC);
CREATE INDEX idx_doc_agent_findings_created ON public.document_agent_findings USING btree (created_at DESC);
CREATE UNIQUE INDEX idx_doc_agent_findings_open_dedupe ON public.document_agent_findings USING btree (kind, doc_type, doc_id) WHERE (status = 'OPEN'::text);
CREATE INDEX idx_doc_agent_findings_status_kind ON public.document_agent_findings USING btree (status, kind, severity);
CREATE INDEX idx_document_refs_series ON public.document_refs USING btree (series, seq);
CREATE INDEX idx_email_address_access_company_id ON public.email_address_access USING btree (company_id);
CREATE INDEX ix_email_access_user ON public.email_address_access USING btree (user_id);
CREATE UNIQUE INDEX ux_email_access_addr_user ON public.email_address_access USING btree (address_id, user_id);
CREATE INDEX idx_email_addresses_company_id ON public.email_addresses USING btree (company_id);
CREATE UNIQUE INDEX ux_email_addresses_addr ON public.email_addresses USING btree (lower(address));
CREATE INDEX ix_email_attachments_msg ON public.email_attachments USING btree (message_id);
CREATE INDEX idx_email_labels_company_id ON public.email_labels USING btree (company_id);
CREATE UNIQUE INDEX ux_email_labels_company_name ON public.email_labels USING btree (company_id, lower(name));
CREATE INDEX idx_email_log_purpose ON public.email_log USING btree (purpose, created_at);
CREATE INDEX idx_email_log_ref ON public.email_log USING btree (ref_type, ref_id);
CREATE INDEX idx_email_messages_company_id ON public.email_messages USING btree (company_id);
CREATE INDEX ix_email_messages_msgid ON public.email_messages USING btree (message_id);
CREATE INDEX ix_email_messages_thread ON public.email_messages USING btree (thread_id, created_at);
CREATE INDEX idx_email_outbox_pending ON public.email_outbox USING btree (created_at) WHERE (status = 'pending'::text);
CREATE INDEX idx_email_threads_company_id ON public.email_threads USING btree (company_id);
CREATE INDEX ix_email_threads_box ON public.email_threads USING btree (mailbox_address, last_message_at);
CREATE INDEX idx_events_company_id ON public.events USING btree (company_id);
CREATE INDEX idx_events_date ON public.events USING btree (event_date);
CREATE INDEX idx_events_type ON public.events USING btree (type);
CREATE INDEX idx_fabric_trackings_code ON public.fabric_trackings USING btree (fabric_code);
CREATE INDEX idx_fabric_trackings_series ON public.fabric_trackings USING btree (series) WHERE (series IS NOT NULL);
CREATE INDEX idx_fabric_trackings_tier ON public.fabric_trackings USING btree (price_tier);
CREATE INDEX idx_grn_items_grn ON public.grn_items USING btree (grn_id);
CREATE INDEX idx_grn_po ON public.grns USING btree (purchase_order_id);
CREATE INDEX idx_grn_status ON public.grns USING btree (status);
CREATE INDEX idx_grn_supplier ON public.grns USING btree (supplier_id);
CREATE INDEX idx_idea_comments_target ON public.idea_comments USING btree (target_type, target_id, archived_at);
CREATE INDEX idx_idea_comments_user ON public.idea_comments USING btree (user_id);
CREATE INDEX idx_idempotency_keys_created_at ON public.idempotency_keys USING btree (created_at);
CREATE INDEX idx_inv_cons_consumed ON public.inventory_lot_consumptions USING btree (consumed_at);
CREATE INDEX idx_inv_cons_doc ON public.inventory_lot_consumptions USING btree (source_doc_type, source_doc_id);
CREATE INDEX idx_inv_cons_lot ON public.inventory_lot_consumptions USING btree (lot_id);
CREATE INDEX idx_inv_lots_batch ON public.inventory_lots USING btree (warehouse_id, batch_no, product_code, variant_key) WHERE ((qty_remaining > 0) AND (batch_no IS NOT NULL));
CREATE INDEX idx_inv_lots_wh_product ON public.inventory_lots USING btree (warehouse_id, product_code, variant_key, received_at);
CREATE INDEX idx_inv_mov_created ON public.inventory_movements USING btree (created_at);
CREATE INDEX idx_inv_mov_doc ON public.inventory_movements USING btree (source_doc_type, source_doc_id);
CREATE INDEX idx_inv_mov_warehouse_product ON public.inventory_movements USING btree (warehouse_id, product_code, variant_key);
CREATE INDEX idx_invitations_email ON public.invitations USING btree (email);
CREATE INDEX idx_invitations_token ON public.invitations USING btree (token);
CREATE INDEX idx_incident_date ON public.lorry_incidents USING btree (incident_date);
CREATE INDEX idx_incident_lorry ON public.lorry_incidents USING btree (lorry_id);
CREATE INDEX idx_lorry_incidents_company_id ON public.lorry_incidents USING btree (company_id);
CREATE INDEX idx_mch_scope_eff ON public.maintenance_config_history USING btree (scope, effective_from);
CREATE INDEX idx_master_price_history_code ON public.master_price_history USING btree (product_code);
CREATE INDEX idx_memos_department_created ON public.memos USING btree (department_id, created_at DESC);
CREATE INDEX idx_mfg_products_base_model ON public.mfg_products USING btree (base_model);
CREATE INDEX idx_mfg_products_category ON public.mfg_products USING btree (category);
CREATE INDEX idx_mfg_products_code ON public.mfg_products USING btree (code);
CREATE INDEX idx_mfg_products_model_id ON public.mfg_products USING btree (model_id);
CREATE INDEX idx_po_items_po ON public.mfg_purchase_order_items USING btree (purchase_order_id);
CREATE INDEX idx_po_items_so_item ON public.mfg_purchase_order_items USING btree (so_item_id);
CREATE INDEX idx_po_items_warehouse ON public.mfg_purchase_order_items USING btree (warehouse_id);
CREATE INDEX idx_po_status ON public.mfg_purchase_orders USING btree (status);
CREATE INDEX idx_po_supplier ON public.mfg_purchase_orders USING btree (supplier_id);
CREATE INDEX idx_mso_items_doc ON public.mfg_sales_order_items USING btree (doc_no);
CREATE INDEX idx_mso_items_group ON public.mfg_sales_order_items USING btree (item_group);
CREATE INDEX idx_mso_items_item ON public.mfg_sales_order_items USING btree (item_code);
CREATE INDEX idx_msop_doc ON public.mfg_sales_order_payments USING btree (so_doc_no);
CREATE INDEX idx_msop_paid_at ON public.mfg_sales_order_payments USING btree (paid_at);
CREATE INDEX idx_mso_branding ON public.mfg_sales_orders USING btree (branding);
CREATE INDEX idx_mso_customer ON public.mfg_sales_orders USING btree (customer_id);
CREATE INDEX idx_mso_date ON public.mfg_sales_orders USING btree (so_date);
CREATE INDEX idx_mso_debtor ON public.mfg_sales_orders USING btree (debtor_code);
CREATE INDEX idx_mso_status ON public.mfg_sales_orders USING btree (status);
CREATE INDEX idx_msoaudit_actor ON public.mfg_so_audit_log USING btree (actor_id);
CREATE INDEX idx_msoaudit_doc ON public.mfg_so_audit_log USING btree (so_doc_no);
CREATE INDEX idx_msoaudit_doc_at ON public.mfg_so_audit_log USING btree (so_doc_no, created_at);
CREATE INDEX idx_so_overrides_doc ON public.mfg_so_price_overrides USING btree (doc_no);
CREATE INDEX idx_so_overrides_item ON public.mfg_so_price_overrides USING btree (item_id);
CREATE INDEX idx_so_status_changes_at ON public.mfg_so_status_changes USING btree (created_at);
CREATE INDEX idx_so_status_changes_doc ON public.mfg_so_status_changes USING btree (doc_no);
CREATE INDEX idx_warehouses_active ON public.mfg_warehouses USING btree (is_active);
CREATE INDEX idx_of_agent_briefs_generated ON public.of_agent_briefs USING btree (generated_at DESC);
CREATE INDEX idx_of_agent_findings_status ON public.of_agent_findings USING btree (status, severity, last_seen_at DESC);
CREATE UNIQUE INDEX uq_of_agent_findings_open ON public.of_agent_findings USING btree (so_doc_no) WHERE (status = 'OPEN'::text);
CREATE INDEX idx_od_proposed_date ON public.order_details USING btree (proposed_delivery_date);
CREATE INDEX idx_od_state ON public.order_details USING btree (state);
CREATE INDEX idx_od_warehouse ON public.order_details USING btree (warehouse);
CREATE INDEX idx_order_details_company_id ON public.order_details USING btree (company_id);
CREATE INDEX idx_pr_token ON public.password_resets USING btree (token);
CREATE INDEX idx_pr_user ON public.password_resets USING btree (user_id, consumed_at);
CREATE INDEX idx_phone_backup_run ON public.phone_normalisation_backup USING btree (run_id);
CREATE INDEX idx_pms_agent_briefs_created ON public.pms_agent_briefs USING btree (created_at DESC);
CREATE INDEX idx_pms_agent_proposals_key ON public.pms_agent_proposals USING btree (kind, key, status);
CREATE INDEX idx_pms_agent_proposals_status ON public.pms_agent_proposals USING btree (status, created_at DESC);
CREATE INDEX idx_procurement_agent_briefs_created ON public.procurement_agent_briefs USING btree (created_at DESC);
CREATE INDEX idx_procurement_agent_proposals_key ON public.procurement_agent_proposals USING btree (kind, key, status);
CREATE INDEX idx_procurement_agent_proposals_status ON public.procurement_agent_proposals USING btree (status, created_at DESC);
CREATE INDEX idx_product_models_category ON public.product_models USING btree (category);
CREATE UNIQUE INDEX product_models_code_category_unique ON public.product_models USING btree (model_code, category);
CREATE INDEX idx_products_category ON public.products USING btree (category_id);
CREATE INDEX idx_products_visible ON public.products USING btree (visible) WHERE (visible = true);
CREATE INDEX idx_pact_project ON public.project_activity USING btree (project_id, created_at);
CREATE INDEX idx_project_activity_company_id ON public.project_activity USING btree (company_id);
CREATE INDEX idx_project_activity_project_created ON public.project_activity USING btree (project_id, created_at);
CREATE INDEX idx_pa_project ON public.project_attachments USING btree (project_id, category);
CREATE INDEX idx_pa_role ON public.project_attachments USING btree (project_id, uploaded_by_role);
CREATE INDEX idx_project_brands_company_id ON public.project_brands USING btree (company_id);
CREATE INDEX idx_pc_due ON public.project_checklist USING btree (due_date);
CREATE INDEX idx_pc_owner ON public.project_checklist USING btree (owner_user_id, status);
CREATE INDEX idx_pc_project ON public.project_checklist USING btree (project_id, seq);
CREATE INDEX idx_project_checklist_company_id ON public.project_checklist USING btree (company_id);
CREATE INDEX idx_project_checklist_project_due ON public.project_checklist USING btree (project_id, due_date);
CREATE INDEX idx_pcaa_attachment ON public.project_checklist_attachment_actions USING btree (attachment_id);
CREATE INDEX idx_pcatt_item ON public.project_checklist_attachments USING btree (item_id, archived_at);
CREATE INDEX idx_project_checklist_attachments_company_id ON public.project_checklist_attachments USING btree (company_id);
CREATE INDEX idx_pcc_item ON public.project_checklist_comments USING btree (item_id, created_at);
CREATE INDEX idx_project_checklist_comments_company_id ON public.project_checklist_comments USING btree (company_id);
CREATE INDEX idx_pcs_project ON public.project_checklist_sections USING btree (project_id, sort_order);
CREATE INDEX idx_project_checklist_sections_company_id ON public.project_checklist_sections USING btree (company_id);
CREATE INDEX idx_pcti_template ON public.project_checklist_template_items USING btree (template_id, seq);
CREATE INDEX idx_project_checklist_template_items_company_id ON public.project_checklist_template_items USING btree (company_id);
CREATE INDEX idx_pcts_template ON public.project_checklist_template_sections USING btree (template_id, sort_order);
CREATE INDEX idx_project_checklist_template_sections_company_id ON public.project_checklist_template_sections USING btree (company_id);
CREATE INDEX idx_project_checklist_templates_company_id ON public.project_checklist_templates USING btree (company_id);
CREATE INDEX idx_contractors_active ON public.project_contractors USING btree (active);
CREATE INDEX idx_pd_project ON public.project_defects USING btree (project_id, phase);
CREATE INDEX idx_pfl_auto_source ON public.project_finance_lines USING btree (project_id, auto_source);
CREATE INDEX idx_pfl_category ON public.project_finance_lines USING btree (category);
CREATE INDEX idx_pfl_company_kind ON public.project_finance_lines USING btree (company_id, kind);
CREATE INDEX idx_pfl_occurred ON public.project_finance_lines USING btree (COALESCE(occurred_at, created_at));
CREATE INDEX idx_pfl_project ON public.project_finance_lines USING btree (project_id, kind, category);
CREATE INDEX idx_organizers_active ON public.project_organizers USING btree (active);
CREATE INDEX idx_project_phase_photos_proj_phase ON public.project_phase_photos USING btree (project_id, phase, uploaded_at DESC);
CREATE INDEX idx_project_reads_user ON public.project_reads USING btree (user_id, last_read_at DESC);
CREATE INDEX idx_project_sales_attendees_rep ON public.project_sales_attendees USING btree (sales_rep_id);
CREATE INDEX idx_psr_project ON public.project_sales_reports USING btree (project_id);
CREATE INDEX idx_pst_project ON public.project_stock_transfers USING btree (project_id, direction);
CREATE INDEX idx_ptm_project ON public.project_team USING btree (project_id);
CREATE INDEX idx_ptm_user ON public.project_team USING btree (user_id);
CREATE INDEX idx_project_venues_city ON public.project_venues USING btree (city);
CREATE INDEX idx_project_venues_company_id ON public.project_venues USING btree (company_id);
CREATE INDEX idx_project_venues_country ON public.project_venues USING btree (country);
CREATE INDEX idx_venues_active ON public.project_venues USING btree (active);
CREATE INDEX idx_projects_archived ON public.projects USING btree (archived_at);
CREATE INDEX idx_projects_brand ON public.projects USING btree (brand);
CREATE INDEX idx_projects_company_id ON public.projects USING btree (company_id);
CREATE INDEX idx_projects_payment ON public.projects USING btree (payment_status);
CREATE INDEX idx_projects_pic ON public.projects USING btree (pic_id);
CREATE INDEX idx_projects_stage ON public.projects USING btree (stage);
CREATE INDEX idx_projects_start ON public.projects USING btree (start_date);
CREATE INDEX idx_projects_status ON public.projects USING btree (status);
CREATE INDEX trgm_proj_brand ON public.projects USING gin (brand gin_trgm_ops);
CREATE INDEX trgm_proj_code ON public.projects USING gin (code gin_trgm_ops);
CREATE INDEX trgm_proj_name ON public.projects USING gin (name gin_trgm_ops);
CREATE INDEX trgm_proj_organizer ON public.projects USING gin (organizer gin_trgm_ops);
CREATE INDEX trgm_proj_venue ON public.projects USING gin (venue gin_trgm_ops);
CREATE INDEX idx_pcr_items_receive ON public.purchase_consignment_receive_items USING btree (pc_receive_id);
CREATE INDEX idx_pcri_receive ON public.purchase_consignment_receive_items USING btree (pc_receive_id);
CREATE INDEX idx_pcr_pco ON public.purchase_consignment_receives USING btree (purchase_consignment_order_id);
CREATE INDEX idx_pcr_po ON public.purchase_consignment_receives USING btree (purchase_consignment_order_id);
CREATE INDEX idx_pcr_status ON public.purchase_consignment_receives USING btree (status);
CREATE INDEX idx_pcr_supplier ON public.purchase_consignment_receives USING btree (supplier_id);
CREATE INDEX idx_pcreti_return ON public.purchase_consignment_return_items USING btree (purchase_consignment_return_id);
CREATE INDEX idx_pct_items_return ON public.purchase_consignment_return_items USING btree (purchase_consignment_return_id);
CREATE INDEX idx_pcret_po ON public.purchase_consignment_returns USING btree (pc_order_id);
CREATE INDEX idx_pcret_receive ON public.purchase_consignment_returns USING btree (pc_receive_id);
CREATE INDEX idx_pcret_status ON public.purchase_consignment_returns USING btree (status);
CREATE INDEX idx_pcret_supplier ON public.purchase_consignment_returns USING btree (supplier_id);
CREATE INDEX idx_pct_pco ON public.purchase_consignment_returns USING btree (pc_order_id);
CREATE INDEX idx_pct_receive ON public.purchase_consignment_returns USING btree (pc_receive_id);
CREATE INDEX idx_pct_status ON public.purchase_consignment_returns USING btree (status);
CREATE INDEX idx_pct_supplier ON public.purchase_consignment_returns USING btree (supplier_id);
CREATE INDEX idx_pi_items_pi ON public.purchase_invoice_items USING btree (purchase_invoice_id);
CREATE INDEX idx_pi_po ON public.purchase_invoices USING btree (purchase_order_id);
CREATE INDEX idx_pi_status ON public.purchase_invoices USING btree (status);
CREATE INDEX idx_pi_supplier ON public.purchase_invoices USING btree (supplier_id);
CREATE INDEX idx_po_docs_creditor ON public.purchase_order_docs USING btree (creditor_code);
CREATE INDEX idx_po_docs_date ON public.purchase_order_docs USING btree (doc_date);
CREATE INDEX idx_po_docs_status ON public.purchase_order_docs USING btree (cancelled, doc_status);
CREATE INDEX idx_purchase_order_docs_company_id ON public.purchase_order_docs USING btree (company_id);
CREATE INDEX trgm_pod_creditor ON public.purchase_order_docs USING gin (creditor_name gin_trgm_ops);
CREATE INDEX trgm_pod_doc_no ON public.purchase_order_docs USING gin (doc_no gin_trgm_ops);
CREATE INDEX trgm_pod_ref ON public.purchase_order_docs USING gin (ref gin_trgm_ops);
CREATE INDEX idx_po_amount ON public.purchase_orders USING btree (doc_date, amount);
CREATE INDEX idx_po_doc ON public.purchase_orders USING btree (doc_no);
CREATE INDEX idx_purchase_orders_company_id ON public.purchase_orders USING btree (company_id);
CREATE INDEX trgm_po_creditor ON public.purchase_orders USING gin (creditor_name gin_trgm_ops);
CREATE INDEX trgm_po_doc_no ON public.purchase_orders USING gin (doc_no gin_trgm_ops);
CREATE INDEX trgm_po_item_code ON public.purchase_orders USING gin (item_code gin_trgm_ops);
CREATE INDEX trgm_po_item_desc ON public.purchase_orders USING gin (item_description gin_trgm_ops);
CREATE INDEX idx_pr_items_pr ON public.purchase_return_items USING btree (purchase_return_id);
CREATE INDEX idx_pr_po ON public.purchase_returns USING btree (purchase_order_id);
CREATE INDEX idx_pr_status ON public.purchase_returns USING btree (status);
CREATE INDEX idx_pr_supplier ON public.purchase_returns USING btree (supplier_id);
CREATE INDEX idx_push_devices_user ON public.push_devices USING btree (user_id);
CREATE INDEX idx_pwp_codes_cart_line ON public.pwp_codes USING btree (cart_line_key);
CREATE INDEX idx_pwp_codes_owner_status ON public.pwp_codes USING btree (owner_staff_id, status);
CREATE INDEX idx_pwp_codes_source_doc ON public.pwp_codes USING btree (source_doc_no);
CREATE INDEX idx_salary_period ON public.salary_records USING btree (period);
CREATE INDEX idx_salary_user ON public.salary_records USING btree (user_id);
CREATE INDEX idx_salary_line_trip ON public.salary_trip_lines USING btree (trip_id);
CREATE INDEX idx_salary_line_user ON public.salary_trip_lines USING btree (user_id);
CREATE INDEX idx_salary_trip_lines_company_id ON public.salary_trip_lines USING btree (company_id);
CREATE INDEX idx_sales_tiers_active ON public.sales_commission_tiers USING btree (active);
CREATE INDEX idx_sales_entries_by_project ON public.sales_entries USING btree (project_id, occurred_at DESC);
CREATE INDEX idx_sales_entries_by_user ON public.sales_entries USING btree (created_by, occurred_at DESC);
CREATE INDEX idx_sales_entries_company_id ON public.sales_entries USING btree (company_id);
CREATE INDEX idx_sales_entries_customer_phone ON public.sales_entries USING btree (customer_phone);
CREATE UNIQUE INDEX idx_sales_entries_doc_no ON public.sales_entries USING btree (doc_no) WHERE (doc_no IS NOT NULL);
CREATE INDEX idx_sales_entries_occurred ON public.sales_entries USING btree (occurred_at DESC);
CREATE INDEX idx_sales_entries_ref_no ON public.sales_entries USING btree (ref_no);
CREATE INDEX idx_sales_entries_rep ON public.sales_entries USING btree (sales_rep_id);
CREATE INDEX idx_sales_entries_sales_person ON public.sales_entries USING btree (sales_person_id, occurred_at DESC);
CREATE INDEX idx_sales_entries_status ON public.sales_entries USING btree (status);
CREATE INDEX idx_sales_entry_activity_company_id ON public.sales_entry_activity USING btree (company_id);
CREATE INDEX idx_sales_entry_activity_entry ON public.sales_entry_activity USING btree (entry_id, created_at);
CREATE INDEX idx_sales_entry_change_requests_company_id ON public.sales_entry_change_requests USING btree (company_id);
CREATE INDEX idx_secr_entry_status ON public.sales_entry_change_requests USING btree (entry_id, status);
CREATE INDEX idx_secr_status ON public.sales_entry_change_requests USING btree (status);
CREATE INDEX idx_sales_entry_items_company_id ON public.sales_entry_items USING btree (company_id);
CREATE INDEX idx_sales_entry_items_entry ON public.sales_entry_items USING btree (entry_id);
CREATE INDEX idx_sales_entry_payments_company_id ON public.sales_entry_payments USING btree (company_id);
CREATE INDEX idx_sales_entry_payments_entry ON public.sales_entry_payments USING btree (entry_id);
CREATE INDEX idx_si_items_do_item ON public.sales_invoice_items USING btree (do_item_id);
CREATE INDEX idx_si_items_si ON public.sales_invoice_items USING btree (sales_invoice_id);
CREATE INDEX idx_sip_si ON public.sales_invoice_payments USING btree (sales_invoice_id);
CREATE INDEX idx_si_debtor ON public.sales_invoices USING btree (debtor_code);
CREATE INDEX idx_si_do ON public.sales_invoices USING btree (delivery_order_id);
CREATE INDEX idx_si_due_date ON public.sales_invoices USING btree (due_date);
CREATE INDEX idx_si_so ON public.sales_invoices USING btree (so_doc_no);
CREATE INDEX idx_si_status ON public.sales_invoices USING btree (status);
CREATE INDEX idx_sales_orders_company_id ON public.sales_orders USING btree (company_id);
CREATE INDEX idx_sales_orders_customer_email ON public.sales_orders USING btree (customer_email);
CREATE INDEX idx_so_balance ON public.sales_orders USING btree (balance);
CREATE INDEX idx_so_region ON public.sales_orders USING btree (region);
CREATE INDEX idx_so_sync ON public.sales_orders USING btree (sync_status);
CREATE UNIQUE INDEX sales_orders_doc_no_key ON public.sales_orders USING btree (doc_no);
CREATE INDEX trgm_so_debtor_name ON public.sales_orders USING gin (debtor_name gin_trgm_ops);
CREATE INDEX trgm_so_doc_no ON public.sales_orders USING gin (doc_no gin_trgm_ops);
CREATE INDEX trgm_so_ref ON public.sales_orders USING gin (ref gin_trgm_ops);
CREATE INDEX idx_sales_positions_active ON public.sales_positions USING btree (active);
CREATE INDEX idx_sales_rep_brands_brand ON public.sales_rep_brands USING btree (brand);
CREATE INDEX idx_rep_tiers_rep ON public.sales_rep_commission_tiers USING btree (rep_id, sort_order);
CREATE INDEX idx_sales_reps_archived ON public.sales_reps USING btree (archived_at);
CREATE INDEX idx_sales_reps_position ON public.sales_reps USING btree (position_id);
CREATE INDEX idx_sales_reps_status ON public.sales_reps USING btree (status);
CREATE INDEX idx_sales_reps_upline ON public.sales_reps USING btree (upline_id);
CREATE INDEX idx_sales_reps_user ON public.sales_reps USING btree (user_id);
CREATE INDEX idx_sales_team_activity_rep ON public.sales_team_activity USING btree (rep_id, created_at);
CREATE INDEX idx_sessions_expires ON public.sessions USING btree (expires_at);
CREATE INDEX idx_sessions_user ON public.sessions USING btree (user_id);
CREATE INDEX idx_share_export_log_subject ON public.share_export_log USING btree (kind, subject, created_at);
CREATE INDEX idx_si_agent_briefs_generated ON public.si_agent_briefs USING btree (generated_at DESC);
CREATE INDEX idx_si_agent_findings_status ON public.si_agent_findings USING btree (status, severity, last_seen_at DESC);
CREATE UNIQUE INDEX uq_si_agent_findings_open ON public.si_agent_findings USING btree (kind, subject) WHERE (status = 'OPEN'::text);
CREATE INDEX idx_sofa_combo_pricing_history ON public.sofa_combo_pricing USING btree (base_model, tier, customer_id, supplier_id, effective_from, created_at);
CREATE INDEX idx_sofa_combo_pricing_lookup ON public.sofa_combo_pricing USING btree (base_model, tier, customer_id, supplier_id, effective_from);
CREATE INDEX idx_sofa_combo_pricing_supplier ON public.sofa_combo_pricing USING btree (supplier_id);
CREATE INDEX idx_sofa_quick_picks_lookup ON public.sofa_quick_picks USING btree (base_model, sort_order) WHERE (deleted_at IS NULL);
CREATE INDEX idx_stock_items_item_group ON public.stock_items USING btree (item_group);
CREATE INDEX idx_stock_items_main_supplier ON public.stock_items USING btree (main_supplier);
CREATE INDEX idx_stock_take_lines_take ON public.stock_take_lines USING btree (stock_take_id);
CREATE UNIQUE INDEX stock_take_lines_take_product_unique ON public.stock_take_lines USING btree (stock_take_id, product_code);
CREATE INDEX idx_stock_takes_status ON public.stock_takes USING btree (status, take_date);
CREATE INDEX idx_stock_takes_warehouse ON public.stock_takes USING btree (warehouse_id);
CREATE INDEX idx_stock_transfer_lines_xfer ON public.stock_transfer_lines USING btree (stock_transfer_id);
CREATE INDEX idx_stock_transfers_from_wh ON public.stock_transfers USING btree (from_warehouse_id);
CREATE INDEX idx_stock_transfers_status ON public.stock_transfers USING btree (status, transfer_date);
CREATE INDEX idx_stock_transfers_to_wh ON public.stock_transfers USING btree (to_warehouse_id);
CREATE INDEX idx_supplier_accounts_status ON public.supplier_accounts USING btree (status);
CREATE INDEX idx_supplier_accounts_supplier ON public.supplier_accounts USING btree (supplier_id);
CREATE INDEX idx_sc_assr ON public.supplier_communications USING btree (assr_id);
CREATE INDEX idx_sc_supplier ON public.supplier_communications USING btree (supplier_id);
CREATE INDEX idx_supplier_invitations_account ON public.supplier_invitations USING btree (supplier_account_id);
CREATE INDEX idx_smb_main_per_material ON public.supplier_material_bindings USING btree (material_kind, material_code) WHERE (is_main_supplier = true);
CREATE INDEX idx_smb_material ON public.supplier_material_bindings USING btree (material_kind, material_code);
CREATE INDEX idx_smb_supplier ON public.supplier_material_bindings USING btree (supplier_id);
CREATE INDEX idx_supplier_sessions_exp ON public.supplier_sessions USING btree (expires_at);
CREATE INDEX idx_suppliers_active ON public.suppliers USING btree (active);
CREATE INDEX idx_suppliers_name ON public.suppliers USING btree (name);
CREATE INDEX idx_table_layouts_company_user ON public.table_layouts USING btree (company_id, user_id);
CREATE UNIQUE INDEX uq_table_layouts_company_default ON public.table_layouts USING btree (company_id, table_key) WHERE ((user_id IS NULL) AND (is_shared = 0));
CREATE UNIQUE INDEX uq_table_layouts_company_shared ON public.table_layouts USING btree (company_id, table_key, lower(name)) WHERE ((user_id IS NULL) AND (is_shared = 1));
CREATE UNIQUE INDEX uq_table_layouts_user_current ON public.table_layouts USING btree (company_id, table_key, user_id) WHERE ((user_id IS NOT NULL) AND (name IS NULL));
CREATE UNIQUE INDEX uq_table_layouts_user_named ON public.table_layouts USING btree (company_id, table_key, user_id, lower(name)) WHERE ((user_id IS NOT NULL) AND (name IS NOT NULL));
CREATE INDEX idx_proposal_trips_proposal ON public.trip_proposal_trips USING btree (proposal_id);
CREATE INDEX idx_trip_proposal_trips_company_id ON public.trip_proposal_trips USING btree (company_id);
CREATE INDEX idx_trip_proposals_company_id ON public.trip_proposals USING btree (company_id);
CREATE INDEX idx_trip_stops_company_id ON public.trip_stops USING btree (company_id);
CREATE INDEX idx_trip_stops_doc ON public.trip_stops USING btree (doc_no);
CREATE INDEX idx_trip_stops_trip ON public.trip_stops USING btree (trip_id);
CREATE INDEX idx_udf_fields_table ON public.udf_fields USING btree (table_name);
CREATE INDEX idx_udf_values_table ON public.udf_values USING btree (table_name);
CREATE INDEX idx_user_brands_brand ON public.user_brands USING btree (brand);
CREATE INDEX idx_user_companies_user ON public.user_companies USING btree (user_id);
CREATE INDEX idx_user_departments_dept ON public.user_departments USING btree (department_id);
CREATE INDEX idx_users_department ON public.users USING btree (department_id);
CREATE INDEX idx_users_last_seen ON public.users USING btree (last_seen_at);
CREATE INDEX idx_users_manager ON public.users USING btree (manager_id);
CREATE INDEX idx_users_position ON public.users USING btree (position_id);
CREATE INDEX idx_users_role ON public.users USING btree (role_id);
CREATE INDEX idx_users_status ON public.users USING btree (status);
CREATE INDEX idx_users_type ON public.users USING btree (user_type);
CREATE INDEX trgm_users_email ON public.users USING gin (email gin_trgm_ops);
CREATE INDEX trgm_users_name ON public.users USING gin (name gin_trgm_ops);
CREATE INDEX idx_warehouse_rack_items_product ON public.warehouse_rack_items USING btree (product_code);
CREATE INDEX idx_warehouse_rack_items_rack ON public.warehouse_rack_items USING btree (rack_id);
CREATE INDEX idx_warehouse_rack_movements_created ON public.warehouse_rack_movements USING btree (created_at);
CREATE INDEX idx_warehouse_rack_movements_rack ON public.warehouse_rack_movements USING btree (rack_id);
CREATE INDEX idx_warehouse_rack_movements_type ON public.warehouse_rack_movements USING btree (movement_type);
CREATE INDEX idx_warehouse_racks_status ON public.warehouse_racks USING btree (status);
CREATE INDEX idx_warehouse_racks_warehouse ON public.warehouse_racks USING btree (warehouse_id, rack);
CREATE UNIQUE INDEX warehouse_racks_warehouse_rack_key ON public.warehouse_racks USING btree (warehouse_id, rack);

CREATE OR REPLACE FUNCTION public.announcements_no_hard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.approval_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'announcements: % is not a draft — a submitted announcement must be voided, not deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_consume_fifo(p_warehouse_id uuid, p_product_code text, p_variant_key text, p_qty_needed integer, p_source_doc_type text, p_source_doc_id uuid, p_source_doc_no text, p_movement_id uuid, p_created_by integer)
 RETURNS TABLE(total_cost_sen integer, qty_short integer)
 LANGUAGE plpgsql
AS $function$ DECLARE v_lot RECORD; v_take INTEGER; v_remaining INTEGER := p_qty_needed; v_total_cost INTEGER := 0; BEGIN FOR v_lot IN SELECT id, qty_remaining, unit_cost_sen FROM inventory_lots WHERE warehouse_id = p_warehouse_id AND product_code = p_product_code AND variant_key = p_variant_key AND qty_remaining > 0 ORDER BY received_at ASC, id ASC FOR UPDATE LOOP EXIT WHEN v_remaining <= 0; v_take := LEAST(v_lot.qty_remaining, v_remaining); v_total_cost := v_total_cost + (v_take * v_lot.unit_cost_sen); v_remaining := v_remaining - v_take; UPDATE inventory_lots SET qty_remaining = qty_remaining - v_take WHERE id = v_lot.id; INSERT INTO inventory_lot_consumptions ( lot_id, warehouse_id, product_code, variant_key, qty_consumed, unit_cost_sen, total_cost_sen, source_doc_type, source_doc_id, source_doc_no, movement_id, created_by ) VALUES ( v_lot.id, p_warehouse_id, p_product_code, p_variant_key, v_take, v_lot.unit_cost_sen, v_take * v_lot.unit_cost_sen, p_source_doc_type, p_source_doc_id, p_source_doc_no, p_movement_id, p_created_by ); END LOOP; RETURN QUERY SELECT v_total_cost, GREATEST(v_remaining, 0); END; $function$;

CREATE OR REPLACE FUNCTION public.fn_consume_fifo_batch(p_warehouse_id uuid, p_product_code text, p_variant_key text, p_qty_needed integer, p_batch_no text, p_source_doc_type text, p_source_doc_id uuid, p_source_doc_no text, p_movement_id uuid, p_created_by integer)
 RETURNS TABLE(total_cost_sen integer, qty_short integer)
 LANGUAGE plpgsql
AS $function$ DECLARE v_lot RECORD; v_take INTEGER; v_remaining INTEGER := p_qty_needed; v_total_cost INTEGER := 0; BEGIN FOR v_lot IN SELECT id, qty_remaining, unit_cost_sen FROM inventory_lots WHERE warehouse_id = p_warehouse_id AND product_code = p_product_code AND variant_key = p_variant_key AND batch_no = p_batch_no AND qty_remaining > 0 ORDER BY received_at ASC, id ASC FOR UPDATE LOOP EXIT WHEN v_remaining <= 0; v_take := LEAST(v_lot.qty_remaining, v_remaining); v_total_cost := v_total_cost + (v_take * v_lot.unit_cost_sen); v_remaining := v_remaining - v_take; UPDATE inventory_lots SET qty_remaining = qty_remaining - v_take WHERE id = v_lot.id; INSERT INTO inventory_lot_consumptions ( lot_id, warehouse_id, product_code, variant_key, qty_consumed, unit_cost_sen, total_cost_sen, source_doc_type, source_doc_id, source_doc_no, movement_id, created_by ) VALUES ( v_lot.id, p_warehouse_id, p_product_code, p_variant_key, v_take, v_lot.unit_cost_sen, v_take * v_lot.unit_cost_sen, p_source_doc_type, p_source_doc_id, p_source_doc_no, p_movement_id, p_created_by ); END LOOP; RETURN QUERY SELECT v_total_cost, GREATEST(v_remaining, 0); END; $function$;

CREATE OR REPLACE FUNCTION public.fn_inventory_movement_fifo()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ DECLARE v_result RECORD; v_abs_qty INTEGER; v_avg_cost INTEGER; v_unit_cost INTEGER; BEGIN IF NEW.movement_type = 'IN' THEN INSERT INTO inventory_lots ( warehouse_id, product_code, variant_key, product_name, qty_received, qty_remaining, unit_cost_sen, received_at, source_doc_type, source_doc_id, source_doc_no, movement_id, created_by, batch_no ) VALUES ( NEW.warehouse_id, NEW.product_code, NEW.variant_key, NEW.product_name, NEW.qty, NEW.qty, COALESCE(NEW.unit_cost_sen, 0), NEW.created_at, NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no, NEW.id, NEW.performed_by, NEW.batch_no ); UPDATE inventory_movements SET total_cost_sen = NEW.qty * COALESCE(NEW.unit_cost_sen, 0) WHERE id = NEW.id; ELSIF NEW.movement_type = 'OUT' THEN v_abs_qty := ABS(NEW.qty); IF NEW.batch_no IS NOT NULL THEN SELECT * INTO v_result FROM fn_consume_fifo_batch( NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty, NEW.batch_no, NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no, NEW.id, NEW.performed_by ); ELSE SELECT * INTO v_result FROM fn_consume_fifo( NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty, NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no, NEW.id, NEW.performed_by ); END IF; UPDATE inventory_movements SET total_cost_sen = v_result.total_cost_sen, unit_cost_sen = CASE WHEN v_abs_qty > 0 THEN v_result.total_cost_sen / v_abs_qty ELSE 0 END WHERE id = NEW.id; ELSIF NEW.movement_type = 'ADJUSTMENT' THEN IF NEW.qty > 0 THEN SELECT CASE WHEN SUM(qty_remaining) > 0 THEN SUM(qty_remaining * unit_cost_sen) / SUM(qty_remaining) ELSE 0 END INTO v_avg_cost FROM inventory_lots WHERE warehouse_id = NEW.warehouse_id AND product_code = NEW.product_code AND variant_key = NEW.variant_key AND qty_remaining > 0; v_unit_cost := COALESCE(NULLIF(NEW.unit_cost_sen, 0), v_avg_cost, 0); INSERT INTO inventory_lots ( warehouse_id, product_code, variant_key, product_name, qty_received, qty_remaining, unit_cost_sen, received_at, source_doc_type, source_doc_id, source_doc_no, movement_id, created_by, batch_no ) VALUES ( NEW.warehouse_id, NEW.product_code, NEW.variant_key, NEW.product_name, NEW.qty, NEW.qty, v_unit_cost, NEW.created_at, NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no, NEW.id, NEW.performed_by, NEW.batch_no ); UPDATE inventory_movements SET total_cost_sen = NEW.qty * v_unit_cost, unit_cost_sen = v_unit_cost WHERE id = NEW.id; ELSIF NEW.qty < 0 THEN v_abs_qty := ABS(NEW.qty); IF NEW.batch_no IS NOT NULL THEN SELECT * INTO v_result FROM fn_consume_fifo_batch( NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty, NEW.batch_no, NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no, NEW.id, NEW.performed_by ); ELSE SELECT * INTO v_result FROM fn_consume_fifo( NEW.warehouse_id, NEW.product_code, NEW.variant_key, v_abs_qty, NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no, NEW.id, NEW.performed_by ); END IF; UPDATE inventory_movements SET total_cost_sen = v_result.total_cost_sen, unit_cost_sen = CASE WHEN v_abs_qty > 0 THEN v_result.total_cost_sen / v_abs_qty ELSE 0 END WHERE id = NEW.id; END IF; END IF; RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.memos_no_hard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'memos: % is a numbered document — void it with a reason, never delete it', OLD.ref_no
    USING ERRCODE = 'restrict_violation';
END;
$function$;

create view public."inventory_balances" as
 SELECT warehouse_id,
    product_code,
    variant_key,
    max(product_name) AS product_name,
    sum(
        CASE
            WHEN (movement_type = 'IN'::inventory_movement_type) THEN qty
            WHEN (movement_type = 'OUT'::inventory_movement_type) THEN (- qty)
            WHEN (movement_type = 'ADJUSTMENT'::inventory_movement_type) THEN qty
            WHEN (movement_type = 'TRANSFER'::inventory_movement_type) THEN qty
            ELSE 0
        END) AS qty,
    max(created_at) AS last_movement_at
   FROM inventory_movements
  GROUP BY warehouse_id, product_code, variant_key;

create view public."lorries" as
 SELECT l.id,
    l.plate,
    l.type,
    l.is_internal,
    l.warehouse_id,
    l.capacity_m3,
    l.capacity_kg,
    l.active,
    l.notes,
    l.created_at,
    l.updated_at,
    w.code AS warehouse
   FROM (scm.lorries l
     LEFT JOIN scm.warehouses w ON ((w.id = l.warehouse_id)));

create view public."trips" as
 SELECT t.id,
    t.trip_no,
    t.trip_date,
    t.lorry_id,
    t.driver_id,
    t.helper_1_id,
    t.helper_2_id,
    t.warehouse_id,
    t.trip_type,
    t.status,
    t.is_outsourced,
    t.clock_in_at,
    t.clock_out_at,
    t.total_distance_km,
    t.notes,
    t.created_at,
    t.created_by,
    t.updated_at,
    NULL::integer AS project_id,
    t.driver_id AS driver_user_id,
    w.code AS warehouse
   FROM (scm.trips t
     LEFT JOIN scm.warehouses w ON ((w.id = t.warehouse_id)));

create view public."v_cogs_entries" as
 SELECT c.id,
    c.consumed_at,
    c.warehouse_id,
    w.code AS warehouse_code,
    c.product_code,
    c.variant_key,
    c.qty_consumed,
    c.unit_cost_sen,
    c.total_cost_sen,
    c.source_doc_type,
    c.source_doc_no,
    l.received_at AS lot_received_at,
    l.source_doc_no AS lot_source_doc_no
   FROM ((inventory_lot_consumptions c
     JOIN inventory_lots l ON ((l.id = c.lot_id)))
     LEFT JOIN mfg_warehouses w ON ((w.id = c.warehouse_id)))
  ORDER BY c.consumed_at DESC;

create view public."v_inventory_lots_open" as
 SELECT l.id,
    l.warehouse_id,
    w.code AS warehouse_code,
    l.product_code,
    l.variant_key,
    l.product_name,
    l.qty_received,
    l.qty_remaining,
    l.unit_cost_sen,
    (l.qty_remaining * l.unit_cost_sen) AS remaining_value_sen,
    l.received_at,
    l.source_doc_type,
    l.source_doc_no,
    l.batch_no
   FROM (inventory_lots l
     LEFT JOIN mfg_warehouses w ON ((w.id = l.warehouse_id)))
  WHERE (l.qty_remaining > 0)
  ORDER BY l.received_at;

create view public."v_inventory_value" as
 SELECT l.warehouse_id,
    w.code AS warehouse_code,
    l.product_code,
    l.variant_key,
    l.product_name,
    sum(l.qty_remaining) AS qty_on_hand,
    sum((l.qty_remaining * l.unit_cost_sen)) AS value_sen,
        CASE
            WHEN (sum(l.qty_remaining) > 0) THEN (sum((l.qty_remaining * l.unit_cost_sen)) / sum(l.qty_remaining))
            ELSE (0)::bigint
        END AS avg_unit_cost_sen
   FROM (inventory_lots l
     LEFT JOIN mfg_warehouses w ON ((w.id = l.warehouse_id)))
  WHERE (l.qty_remaining > 0)
  GROUP BY l.warehouse_id, w.code, l.product_code, l.variant_key, l.product_name;


CREATE TRIGGER trg_announcements_no_hard_delete BEFORE DELETE ON public.announcements FOR EACH ROW EXECUTE FUNCTION announcements_no_hard_delete();
CREATE TRIGGER trg_inventory_movement_fifo AFTER INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION fn_inventory_movement_fifo();
CREATE TRIGGER trg_memos_no_hard_delete BEFORE DELETE ON public.memos FOR EACH ROW EXECUTE FUNCTION memos_no_hard_delete();
CREATE TRIGGER trg_project_venues_canonicalize_name BEFORE INSERT OR UPDATE OF name ON public.project_venues FOR EACH ROW EXECUTE FUNCTION scm.project_venues_canonicalize_name();
CREATE TRIGGER trg_projects_canonicalize_venue BEFORE INSERT OR UPDATE OF venue ON public.projects FOR EACH ROW EXECUTE FUNCTION scm.projects_canonicalize_venue();
CREATE TRIGGER trg_vp_outbox_project AFTER UPDATE OF venue, organizer, start_date, end_date, status ON public.projects FOR EACH ROW WHEN (((old.venue IS DISTINCT FROM new.venue) OR (old.organizer IS DISTINCT FROM new.organizer) OR (old.start_date IS DISTINCT FROM new.start_date) OR (old.end_date IS DISTINCT FROM new.end_date) OR (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION scm.enqueue_vp_outbox_project();
CREATE TRIGGER trg_sync_user_to_staff AFTER INSERT OR UPDATE OF name, status ON public.users FOR EACH ROW EXECUTE FUNCTION scm.sync_user_to_staff();
CREATE TRIGGER trg_sync_user_to_tms AFTER INSERT OR UPDATE OF position_id, status, name, phone, ic_number ON public.users FOR EACH ROW EXECUTE FUNCTION scm.sync_user_to_tms();

alter table public."_migrations" enable row level security;
alter table public."_pg_migrations" enable row level security;
alter table public."ac_snapshot_purchase_orders" enable row level security;
alter table public."ac_snapshot_runs" enable row level security;
alter table public."ac_snapshot_sales_orders" enable row level security;
alter table public."addons" enable row level security;
alter table public."agent_controls" enable row level security;
alter table public."agent_decision_outcomes" enable row level security;
alter table public."agent_decisions" enable row level security;
alter table public."agent_feedback" enable row level security;
alter table public."agent_kill_scopes" enable row level security;
alter table public."agent_runs" enable row level security;
alter table public."announcement_acks" enable row level security;
alter table public."announcement_files" enable row level security;
alter table public."announcement_reminders" enable row level security;
alter table public."announcements" enable row level security;
alter table public."app_settings" enable row level security;
alter table public."assistant_conversations" enable row level security;
alter table public."assistant_messages" enable row level security;
alter table public."assr_activity" enable row level security;
alter table public."assr_alert_acks" enable row level security;
alter table public."assr_attachments" enable row level security;
alter table public."assr_case_access" enable row level security;
alter table public."assr_case_categories" enable row level security;
alter table public."assr_cases" enable row level security;
alter table public."assr_issue_categories" enable row level security;
alter table public."assr_items" enable row level security;
alter table public."assr_lead_time_activations" enable row level security;
alter table public."assr_lead_time_amendments" enable row level security;
alter table public."assr_lead_time_profiles" enable row level security;
alter table public."assr_lead_time_scheduled_activations" enable row level security;
alter table public."assr_logistics" enable row level security;
alter table public."assr_ncr_categories" enable row level security;
alter table public."assr_priorities" enable row level security;
alter table public."assr_priority_stage_targets" enable row level security;
alter table public."assr_product_categories" enable row level security;
alter table public."assr_resolution_methods" enable row level security;
alter table public."assr_stage_history" enable row level security;
alter table public."assr_stage_targets" enable row level security;
alter table public."assr_supplier_returns" enable row level security;
alter table public."assr_supplier_tokens" enable row level security;
alter table public."assr_survey_tokens" enable row level security;
alter table public."audit_events" enable row level security;
alter table public."autocount_delivery_orders" enable row level security;
alter table public."bedframe_colours" enable row level security;
alter table public."bedframe_options" enable row level security;
alter table public."brand_share_tokens" enable row level security;
alter table public."bundle_library" enable row level security;
alter table public."case_track_tokens" enable row level security;
alter table public."categories" enable row level security;
alter table public."client_errors" enable row level security;
alter table public."collection_agent_briefs" enable row level security;
alter table public."collection_agent_proposals" enable row level security;
alter table public."compartment_library" enable row level security;
alter table public."config_proposals" enable row level security;
alter table public."consignment_delivery_order_items" enable row level security;
alter table public."consignment_delivery_order_payments" enable row level security;
alter table public."consignment_delivery_orders" enable row level security;
alter table public."consignment_delivery_return_items" enable row level security;
alter table public."consignment_delivery_returns" enable row level security;
alter table public."consignment_sales_order_items" enable row level security;
alter table public."consignment_sales_order_payments" enable row level security;
alter table public."consignment_sales_orders" enable row level security;
alter table public."consignment_so_audit_log" enable row level security;
alter table public."contractor_share_tokens" enable row level security;
alter table public."creditors" enable row level security;
alter table public."cs_agent_briefs" enable row level security;
alter table public."cs_agent_proposals" enable row level security;
alter table public."customers" enable row level security;
alter table public."daily_inspections" enable row level security;
alter table public."delivery_agent_briefs" enable row level security;
alter table public."delivery_agent_proposals" enable row level security;
alter table public."delivery_order_items" enable row level security;
alter table public."delivery_order_payments" enable row level security;
alter table public."delivery_orders" enable row level security;
alter table public."delivery_return_items" enable row level security;
alter table public."delivery_returns" enable row level security;
alter table public."delivery_status_log" enable row level security;
alter table public."delivery_tracking" enable row level security;
alter table public."departments" enable row level security;
alter table public."document_agent_briefs" enable row level security;
alter table public."document_agent_findings" enable row level security;
alter table public."document_refs" enable row level security;
alter table public."document_types" enable row level security;
alter table public."email_address_access" enable row level security;
alter table public."email_addresses" enable row level security;
alter table public."email_attachments" enable row level security;
alter table public."email_labels" enable row level security;
alter table public."email_log" enable row level security;
alter table public."email_messages" enable row level security;
alter table public."email_outbox" enable row level security;
alter table public."email_threads" enable row level security;
alter table public."events" enable row level security;
alter table public."execution_logs" enable row level security;
alter table public."fabric_colours" enable row level security;
alter table public."fabric_library" enable row level security;
alter table public."fabric_tier_addon_config" enable row level security;
alter table public."fabric_trackings" enable row level security;
alter table public."fabrics" enable row level security;
alter table public."grn_items" enable row level security;
alter table public."grns" enable row level security;
alter table public."idea_comments" enable row level security;
alter table public."idempotency_keys" enable row level security;
alter table public."inventory_lot_consumptions" enable row level security;
alter table public."inventory_lots" enable row level security;
alter table public."inventory_movements" enable row level security;
alter table public."invitations" enable row level security;
alter table public."lorry_incidents" enable row level security;
alter table public."mail_user_scope" enable row level security;
alter table public."maintenance_config_history" enable row level security;
alter table public."master_price_history" enable row level security;
alter table public."memos" enable row level security;
alter table public."mfg_products" enable row level security;
alter table public."mfg_purchase_order_items" enable row level security;
alter table public."mfg_purchase_order_lines" enable row level security;
alter table public."mfg_purchase_orders" enable row level security;
alter table public."mfg_sales_order_items" enable row level security;
alter table public."mfg_sales_order_payments" enable row level security;
alter table public."mfg_sales_orders" enable row level security;
alter table public."mfg_so_audit_log" enable row level security;
alter table public."mfg_so_price_overrides" enable row level security;
alter table public."mfg_so_status_changes" enable row level security;
alter table public."mfg_suppliers" enable row level security;
alter table public."mfg_warehouses" enable row level security;
alter table public."model_default_free_gifts" enable row level security;
alter table public."model_fabric_tier_overrides" enable row level security;
alter table public."model_special_delivery_fees" enable row level security;
alter table public."mrp_category_lead_times" enable row level security;
alter table public."of_agent_briefs" enable row level security;
alter table public."of_agent_findings" enable row level security;
alter table public."order_details" enable row level security;
alter table public."password_resets" enable row level security;
alter table public."phone_normalisation_backup" enable row level security;
alter table public."pms_agent_briefs" enable row level security;
alter table public."pms_agent_proposals" enable row level security;
alter table public."position_capabilities" enable row level security;
alter table public."position_policy" enable row level security;
alter table public."positions" enable row level security;
alter table public."procurement_agent_briefs" enable row level security;
alter table public."procurement_agent_proposals" enable row level security;
alter table public."product_bedframe_colours" enable row level security;
alter table public."product_bundles" enable row level security;
alter table public."product_compartments" enable row level security;
alter table public."product_dept_configs" enable row level security;
alter table public."product_fabrics" enable row level security;
alter table public."product_models" enable row level security;
alter table public."product_size_variants" enable row level security;
alter table public."products" enable row level security;
alter table public."project_activity" enable row level security;
alter table public."project_attachments" enable row level security;
alter table public."project_brands" enable row level security;
alter table public."project_checklist" enable row level security;
alter table public."project_checklist_attachment_actions" enable row level security;
alter table public."project_checklist_attachments" enable row level security;
alter table public."project_checklist_comments" enable row level security;
alter table public."project_checklist_sections" enable row level security;
alter table public."project_checklist_template_items" enable row level security;
alter table public."project_checklist_template_sections" enable row level security;
alter table public."project_checklist_templates" enable row level security;
alter table public."project_contractors" enable row level security;
alter table public."project_cost_rates" enable row level security;
alter table public."project_defects" enable row level security;
alter table public."project_event_types" enable row level security;
alter table public."project_finance" enable row level security;
alter table public."project_finance_lines" enable row level security;
alter table public."project_organizers" enable row level security;
alter table public."project_phase_photos" enable row level security;
alter table public."project_reads" enable row level security;
alter table public."project_sales_attendees" enable row level security;
alter table public."project_sales_reports" enable row level security;
alter table public."project_stock_transfers" enable row level security;
alter table public."project_team" enable row level security;
alter table public."project_venues" enable row level security;
alter table public."projects" enable row level security;
alter table public."purchase_consignment_receive_items" enable row level security;
alter table public."purchase_consignment_receives" enable row level security;
alter table public."purchase_consignment_return_items" enable row level security;
alter table public."purchase_consignment_returns" enable row level security;
alter table public."purchase_invoice_items" enable row level security;
alter table public."purchase_invoices" enable row level security;
alter table public."purchase_order_docs" enable row level security;
alter table public."purchase_orders" enable row level security;
alter table public."purchase_return_items" enable row level security;
alter table public."purchase_returns" enable row level security;
alter table public."push_devices" enable row level security;
alter table public."pwp_codes" enable row level security;
alter table public."pwp_rules" enable row level security;
alter table public."roles" enable row level security;
alter table public."salary_records" enable row level security;
alter table public."salary_trip_lines" enable row level security;
alter table public."sales_commission_tiers" enable row level security;
alter table public."sales_entries" enable row level security;
alter table public."sales_entry_activity" enable row level security;
alter table public."sales_entry_change_requests" enable row level security;
alter table public."sales_entry_items" enable row level security;
alter table public."sales_entry_payments" enable row level security;
alter table public."sales_invoice_items" enable row level security;
alter table public."sales_invoice_payments" enable row level security;
alter table public."sales_invoices" enable row level security;
alter table public."sales_orders" enable row level security;
alter table public."sales_positions" enable row level security;
alter table public."sales_rep_brands" enable row level security;
alter table public."sales_rep_commission_tiers" enable row level security;
alter table public."sales_reps" enable row level security;
alter table public."sales_team_activity" enable row level security;
alter table public."series" enable row level security;
alter table public."sessions" enable row level security;
alter table public."share_export_log" enable row level security;
alter table public."si_agent_briefs" enable row level security;
alter table public."si_agent_findings" enable row level security;
alter table public."size_library" enable row level security;
alter table public."sofa_combo_pricing" enable row level security;
alter table public."sofa_quick_picks" enable row level security;
alter table public."special_addons" enable row level security;
alter table public."state_warehouse_map" enable row level security;
alter table public."stock_items" enable row level security;
alter table public."stock_take_lines" enable row level security;
alter table public."stock_takes" enable row level security;
alter table public."stock_transfer_lines" enable row level security;
alter table public."stock_transfers" enable row level security;
alter table public."supplier_accounts" enable row level security;
alter table public."supplier_communications" enable row level security;
alter table public."supplier_invitations" enable row level security;
alter table public."supplier_material_bindings" enable row level security;
alter table public."supplier_sessions" enable row level security;
alter table public."suppliers" enable row level security;
alter table public."system_settings" enable row level security;
alter table public."table_layouts" enable row level security;
alter table public."tmp_sheet_capture" enable row level security;
alter table public."trip_proposal_trips" enable row level security;
alter table public."trip_proposals" enable row level security;
alter table public."trip_stops" enable row level security;
alter table public."udf_fields" enable row level security;
alter table public."udf_values" enable row level security;
alter table public."user_brands" enable row level security;
alter table public."user_companies" enable row level security;
alter table public."user_departments" enable row level security;
alter table public."users" enable row level security;
alter table public."warehouse_rack_items" enable row level security;
alter table public."warehouse_rack_movements" enable row level security;
alter table public."warehouse_racks" enable row level security;
alter table public."warehouses" enable row level security;
revoke all on public."_migrations" from anon, authenticated;
revoke all on public."_pg_migrations" from anon, authenticated;
revoke all on public."ac_snapshot_purchase_orders" from anon, authenticated;
revoke all on public."ac_snapshot_runs" from anon, authenticated;
revoke all on public."ac_snapshot_sales_orders" from anon, authenticated;
revoke all on public."addons" from anon, authenticated;
revoke all on public."agent_controls" from anon, authenticated;
revoke all on public."agent_decision_outcomes" from anon, authenticated;
revoke all on public."agent_decisions" from anon, authenticated;
revoke all on public."agent_feedback" from anon, authenticated;
revoke all on public."agent_kill_scopes" from anon, authenticated;
revoke all on public."agent_runs" from anon, authenticated;
revoke all on public."announcement_acks" from anon, authenticated;
revoke all on public."announcement_files" from anon, authenticated;
revoke all on public."announcement_reminders" from anon, authenticated;
revoke all on public."announcements" from anon, authenticated;
revoke all on public."app_settings" from anon, authenticated;
revoke all on public."assistant_conversations" from anon, authenticated;
revoke all on public."assistant_messages" from anon, authenticated;
revoke all on public."assr_activity" from anon, authenticated;
revoke all on public."assr_alert_acks" from anon, authenticated;
revoke all on public."assr_attachments" from anon, authenticated;
revoke all on public."assr_case_access" from anon, authenticated;
revoke all on public."assr_case_categories" from anon, authenticated;
revoke all on public."assr_cases" from anon, authenticated;
revoke all on public."assr_issue_categories" from anon, authenticated;
revoke all on public."assr_items" from anon, authenticated;
revoke all on public."assr_lead_time_activations" from anon, authenticated;
revoke all on public."assr_lead_time_amendments" from anon, authenticated;
revoke all on public."assr_lead_time_profiles" from anon, authenticated;
revoke all on public."assr_lead_time_scheduled_activations" from anon, authenticated;
revoke all on public."assr_logistics" from anon, authenticated;
revoke all on public."assr_ncr_categories" from anon, authenticated;
revoke all on public."assr_priorities" from anon, authenticated;
revoke all on public."assr_priority_stage_targets" from anon, authenticated;
revoke all on public."assr_product_categories" from anon, authenticated;
revoke all on public."assr_resolution_methods" from anon, authenticated;
revoke all on public."assr_stage_history" from anon, authenticated;
revoke all on public."assr_stage_targets" from anon, authenticated;
revoke all on public."assr_supplier_returns" from anon, authenticated;
revoke all on public."assr_supplier_tokens" from anon, authenticated;
revoke all on public."assr_survey_tokens" from anon, authenticated;
revoke all on public."audit_events" from anon, authenticated;
revoke all on public."autocount_delivery_orders" from anon, authenticated;
revoke all on public."bedframe_colours" from anon, authenticated;
revoke all on public."bedframe_options" from anon, authenticated;
revoke all on public."brand_share_tokens" from anon, authenticated;
revoke all on public."bundle_library" from anon, authenticated;
revoke all on public."case_track_tokens" from anon, authenticated;
revoke all on public."categories" from anon, authenticated;
revoke all on public."client_errors" from anon, authenticated;
revoke all on public."collection_agent_briefs" from anon, authenticated;
revoke all on public."collection_agent_proposals" from anon, authenticated;
revoke all on public."compartment_library" from anon, authenticated;
revoke all on public."config_proposals" from anon, authenticated;
revoke all on public."consignment_delivery_order_items" from anon, authenticated;
revoke all on public."consignment_delivery_order_payments" from anon, authenticated;
revoke all on public."consignment_delivery_orders" from anon, authenticated;
revoke all on public."consignment_delivery_return_items" from anon, authenticated;
revoke all on public."consignment_delivery_returns" from anon, authenticated;
revoke all on public."consignment_sales_order_items" from anon, authenticated;
revoke all on public."consignment_sales_order_payments" from anon, authenticated;
revoke all on public."consignment_sales_orders" from anon, authenticated;
revoke all on public."consignment_so_audit_log" from anon, authenticated;
revoke all on public."contractor_share_tokens" from anon, authenticated;
revoke all on public."creditors" from anon, authenticated;
revoke all on public."cs_agent_briefs" from anon, authenticated;
revoke all on public."cs_agent_proposals" from anon, authenticated;
revoke all on public."customers" from anon, authenticated;
revoke all on public."daily_inspections" from anon, authenticated;
revoke all on public."delivery_agent_briefs" from anon, authenticated;
revoke all on public."delivery_agent_proposals" from anon, authenticated;
revoke all on public."delivery_order_items" from anon, authenticated;
revoke all on public."delivery_order_payments" from anon, authenticated;
revoke all on public."delivery_orders" from anon, authenticated;
revoke all on public."delivery_return_items" from anon, authenticated;
revoke all on public."delivery_returns" from anon, authenticated;
revoke all on public."delivery_status_log" from anon, authenticated;
revoke all on public."delivery_tracking" from anon, authenticated;
revoke all on public."departments" from anon, authenticated;
revoke all on public."document_agent_briefs" from anon, authenticated;
revoke all on public."document_agent_findings" from anon, authenticated;
revoke all on public."document_refs" from anon, authenticated;
revoke all on public."document_types" from anon, authenticated;
revoke all on public."email_address_access" from anon, authenticated;
revoke all on public."email_addresses" from anon, authenticated;
revoke all on public."email_attachments" from anon, authenticated;
revoke all on public."email_labels" from anon, authenticated;
revoke all on public."email_log" from anon, authenticated;
revoke all on public."email_messages" from anon, authenticated;
revoke all on public."email_outbox" from anon, authenticated;
revoke all on public."email_threads" from anon, authenticated;
revoke all on public."events" from anon, authenticated;
revoke all on public."execution_logs" from anon, authenticated;
revoke all on public."fabric_colours" from anon, authenticated;
revoke all on public."fabric_library" from anon, authenticated;
revoke all on public."fabric_tier_addon_config" from anon, authenticated;
revoke all on public."fabric_trackings" from anon, authenticated;
revoke all on public."fabrics" from anon, authenticated;
revoke all on public."grn_items" from anon, authenticated;
revoke all on public."grns" from anon, authenticated;
revoke all on public."idea_comments" from anon, authenticated;
revoke all on public."idempotency_keys" from anon, authenticated;
revoke all on public."inventory_lot_consumptions" from anon, authenticated;
revoke all on public."inventory_lots" from anon, authenticated;
revoke all on public."inventory_movements" from anon, authenticated;
revoke all on public."invitations" from anon, authenticated;
revoke all on public."lorry_incidents" from anon, authenticated;
revoke all on public."mail_user_scope" from anon, authenticated;
revoke all on public."maintenance_config_history" from anon, authenticated;
revoke all on public."master_price_history" from anon, authenticated;
revoke all on public."memos" from anon, authenticated;
revoke all on public."mfg_products" from anon, authenticated;
revoke all on public."mfg_purchase_order_items" from anon, authenticated;
revoke all on public."mfg_purchase_order_lines" from anon, authenticated;
revoke all on public."mfg_purchase_orders" from anon, authenticated;
revoke all on public."mfg_sales_order_items" from anon, authenticated;
revoke all on public."mfg_sales_order_payments" from anon, authenticated;
revoke all on public."mfg_sales_orders" from anon, authenticated;
revoke all on public."mfg_so_audit_log" from anon, authenticated;
revoke all on public."mfg_so_price_overrides" from anon, authenticated;
revoke all on public."mfg_so_status_changes" from anon, authenticated;
revoke all on public."mfg_suppliers" from anon, authenticated;
revoke all on public."mfg_warehouses" from anon, authenticated;
revoke all on public."model_default_free_gifts" from anon, authenticated;
revoke all on public."model_fabric_tier_overrides" from anon, authenticated;
revoke all on public."model_special_delivery_fees" from anon, authenticated;
revoke all on public."mrp_category_lead_times" from anon, authenticated;
revoke all on public."of_agent_briefs" from anon, authenticated;
revoke all on public."of_agent_findings" from anon, authenticated;
revoke all on public."order_details" from anon, authenticated;
revoke all on public."password_resets" from anon, authenticated;
revoke all on public."phone_normalisation_backup" from anon, authenticated;
revoke all on public."pms_agent_briefs" from anon, authenticated;
revoke all on public."pms_agent_proposals" from anon, authenticated;
revoke all on public."position_capabilities" from anon, authenticated;
revoke all on public."position_policy" from anon, authenticated;
revoke all on public."positions" from anon, authenticated;
revoke all on public."procurement_agent_briefs" from anon, authenticated;
revoke all on public."procurement_agent_proposals" from anon, authenticated;
revoke all on public."product_bedframe_colours" from anon, authenticated;
revoke all on public."product_bundles" from anon, authenticated;
revoke all on public."product_compartments" from anon, authenticated;
revoke all on public."product_dept_configs" from anon, authenticated;
revoke all on public."product_fabrics" from anon, authenticated;
revoke all on public."product_models" from anon, authenticated;
revoke all on public."product_size_variants" from anon, authenticated;
revoke all on public."products" from anon, authenticated;
revoke all on public."project_activity" from anon, authenticated;
revoke all on public."project_attachments" from anon, authenticated;
revoke all on public."project_brands" from anon, authenticated;
revoke all on public."project_checklist" from anon, authenticated;
revoke all on public."project_checklist_attachment_actions" from anon, authenticated;
revoke all on public."project_checklist_attachments" from anon, authenticated;
revoke all on public."project_checklist_comments" from anon, authenticated;
revoke all on public."project_checklist_sections" from anon, authenticated;
revoke all on public."project_checklist_template_items" from anon, authenticated;
revoke all on public."project_checklist_template_sections" from anon, authenticated;
revoke all on public."project_checklist_templates" from anon, authenticated;
revoke all on public."project_contractors" from anon, authenticated;
revoke all on public."project_cost_rates" from anon, authenticated;
revoke all on public."project_defects" from anon, authenticated;
revoke all on public."project_event_types" from anon, authenticated;
revoke all on public."project_finance" from anon, authenticated;
revoke all on public."project_finance_lines" from anon, authenticated;
revoke all on public."project_organizers" from anon, authenticated;
revoke all on public."project_phase_photos" from anon, authenticated;
revoke all on public."project_reads" from anon, authenticated;
revoke all on public."project_sales_attendees" from anon, authenticated;
revoke all on public."project_sales_reports" from anon, authenticated;
revoke all on public."project_stock_transfers" from anon, authenticated;
revoke all on public."project_team" from anon, authenticated;
revoke all on public."project_venues" from anon, authenticated;
revoke all on public."projects" from anon, authenticated;
revoke all on public."purchase_consignment_receive_items" from anon, authenticated;
revoke all on public."purchase_consignment_receives" from anon, authenticated;
revoke all on public."purchase_consignment_return_items" from anon, authenticated;
revoke all on public."purchase_consignment_returns" from anon, authenticated;
revoke all on public."purchase_invoice_items" from anon, authenticated;
revoke all on public."purchase_invoices" from anon, authenticated;
revoke all on public."purchase_order_docs" from anon, authenticated;
revoke all on public."purchase_orders" from anon, authenticated;
revoke all on public."purchase_return_items" from anon, authenticated;
revoke all on public."purchase_returns" from anon, authenticated;
revoke all on public."push_devices" from anon, authenticated;
revoke all on public."pwp_codes" from anon, authenticated;
revoke all on public."pwp_rules" from anon, authenticated;
revoke all on public."roles" from anon, authenticated;
revoke all on public."salary_records" from anon, authenticated;
revoke all on public."salary_trip_lines" from anon, authenticated;
revoke all on public."sales_commission_tiers" from anon, authenticated;
revoke all on public."sales_entries" from anon, authenticated;
revoke all on public."sales_entry_activity" from anon, authenticated;
revoke all on public."sales_entry_change_requests" from anon, authenticated;
revoke all on public."sales_entry_items" from anon, authenticated;
revoke all on public."sales_entry_payments" from anon, authenticated;
revoke all on public."sales_invoice_items" from anon, authenticated;
revoke all on public."sales_invoice_payments" from anon, authenticated;
revoke all on public."sales_invoices" from anon, authenticated;
revoke all on public."sales_orders" from anon, authenticated;
revoke all on public."sales_positions" from anon, authenticated;
revoke all on public."sales_rep_brands" from anon, authenticated;
revoke all on public."sales_rep_commission_tiers" from anon, authenticated;
revoke all on public."sales_reps" from anon, authenticated;
revoke all on public."sales_team_activity" from anon, authenticated;
revoke all on public."series" from anon, authenticated;
revoke all on public."sessions" from anon, authenticated;
revoke all on public."share_export_log" from anon, authenticated;
revoke all on public."si_agent_briefs" from anon, authenticated;
revoke all on public."si_agent_findings" from anon, authenticated;
revoke all on public."size_library" from anon, authenticated;
revoke all on public."sofa_combo_pricing" from anon, authenticated;
revoke all on public."sofa_quick_picks" from anon, authenticated;
revoke all on public."special_addons" from anon, authenticated;
revoke all on public."state_warehouse_map" from anon, authenticated;
revoke all on public."stock_items" from anon, authenticated;
revoke all on public."stock_take_lines" from anon, authenticated;
revoke all on public."stock_takes" from anon, authenticated;
revoke all on public."stock_transfer_lines" from anon, authenticated;
revoke all on public."stock_transfers" from anon, authenticated;
revoke all on public."supplier_accounts" from anon, authenticated;
revoke all on public."supplier_communications" from anon, authenticated;
revoke all on public."supplier_invitations" from anon, authenticated;
revoke all on public."supplier_material_bindings" from anon, authenticated;
revoke all on public."supplier_sessions" from anon, authenticated;
revoke all on public."suppliers" from anon, authenticated;
revoke all on public."system_settings" from anon, authenticated;
revoke all on public."table_layouts" from anon, authenticated;
revoke all on public."tmp_sheet_capture" from anon, authenticated;
revoke all on public."trip_proposal_trips" from anon, authenticated;
revoke all on public."trip_proposals" from anon, authenticated;
revoke all on public."trip_stops" from anon, authenticated;
revoke all on public."udf_fields" from anon, authenticated;
revoke all on public."udf_values" from anon, authenticated;
revoke all on public."user_brands" from anon, authenticated;
revoke all on public."user_companies" from anon, authenticated;
revoke all on public."user_departments" from anon, authenticated;
revoke all on public."users" from anon, authenticated;
revoke all on public."warehouse_rack_items" from anon, authenticated;
revoke all on public."warehouse_rack_movements" from anon, authenticated;
revoke all on public."warehouse_racks" from anon, authenticated;
revoke all on public."warehouses" from anon, authenticated;
revoke all on public."inventory_balances" from anon, authenticated;
revoke all on public."lorries" from anon, authenticated;
revoke all on public."trips" from anon, authenticated;
revoke all on public."v_cogs_entries" from anon, authenticated;
revoke all on public."v_inventory_lots_open" from anon, authenticated;
revoke all on public."v_inventory_value" from anon, authenticated;
revoke all on sequence public."ac_snapshot_runs_id_seq" from anon, authenticated;
revoke all on sequence public."announcement_files_id_seq" from anon, authenticated;
revoke all on sequence public."assr_activity_id_seq" from anon, authenticated;
revoke all on sequence public."assr_alert_acks_id_seq" from anon, authenticated;
revoke all on sequence public."assr_attachments_id_seq" from anon, authenticated;
revoke all on sequence public."assr_cases_id_seq" from anon, authenticated;
revoke all on sequence public."assr_issue_categories_id_seq" from anon, authenticated;
revoke all on sequence public."assr_items_id_seq" from anon, authenticated;
revoke all on sequence public."assr_lead_time_activations_id_seq" from anon, authenticated;
revoke all on sequence public."assr_lead_time_amendments_id_seq" from anon, authenticated;
revoke all on sequence public."assr_lead_time_profiles_id_seq" from anon, authenticated;
revoke all on sequence public."assr_lead_time_scheduled_activations_id_seq" from anon, authenticated;
revoke all on sequence public."assr_logistics_id_seq" from anon, authenticated;
revoke all on sequence public."assr_ncr_categories_id_seq" from anon, authenticated;
revoke all on sequence public."assr_priorities_id_seq" from anon, authenticated;
revoke all on sequence public."assr_priority_stage_targets_id_seq" from anon, authenticated;
revoke all on sequence public."assr_product_categories_id_seq" from anon, authenticated;
revoke all on sequence public."assr_resolution_methods_id_seq" from anon, authenticated;
revoke all on sequence public."assr_stage_history_id_seq" from anon, authenticated;
revoke all on sequence public."assr_stage_targets_id_seq" from anon, authenticated;
revoke all on sequence public."assr_supplier_returns_id_seq" from anon, authenticated;
revoke all on sequence public."assr_supplier_tokens_id_seq" from anon, authenticated;
revoke all on sequence public."audit_events_id_seq" from anon, authenticated;
revoke all on sequence public."client_errors_id_seq" from anon, authenticated;
revoke all on sequence public."companies_id_seq" from anon, authenticated;
revoke all on sequence public."daily_inspections_id_seq" from anon, authenticated;
revoke all on sequence public."delivery_status_log_id_seq" from anon, authenticated;
revoke all on sequence public."departments_id_seq" from anon, authenticated;
revoke all on sequence public."email_log_id_seq" from anon, authenticated;
revoke all on sequence public."events_id_seq" from anon, authenticated;
revoke all on sequence public."execution_logs_id_seq" from anon, authenticated;
revoke all on sequence public."idea_comments_id_seq" from anon, authenticated;
revoke all on sequence public."invitations_id_seq" from anon, authenticated;
revoke all on sequence public."lorry_incidents_id_seq" from anon, authenticated;
revoke all on sequence public."password_resets_id_seq" from anon, authenticated;
revoke all on sequence public."phone_normalisation_backup_id_seq" from anon, authenticated;
revoke all on sequence public."positions_id_seq" from anon, authenticated;
revoke all on sequence public."project_activity_id_seq" from anon, authenticated;
revoke all on sequence public."project_attachments_id_seq" from anon, authenticated;
revoke all on sequence public."project_brands_id_seq" from anon, authenticated;
revoke all on sequence public."project_checklist_attachment_actions_id_seq" from anon, authenticated;
revoke all on sequence public."project_checklist_attachments_id_seq" from anon, authenticated;
revoke all on sequence public."project_checklist_comments_id_seq" from anon, authenticated;
revoke all on sequence public."project_checklist_id_seq" from anon, authenticated;
revoke all on sequence public."project_checklist_sections_id_seq" from anon, authenticated;
revoke all on sequence public."project_checklist_template_items_id_seq" from anon, authenticated;
revoke all on sequence public."project_checklist_template_sections_id_seq" from anon, authenticated;
revoke all on sequence public."project_checklist_templates_id_seq" from anon, authenticated;
revoke all on sequence public."project_contractors_id_seq" from anon, authenticated;
revoke all on sequence public."project_cost_rates_id_seq" from anon, authenticated;
revoke all on sequence public."project_defects_id_seq" from anon, authenticated;
revoke all on sequence public."project_event_types_id_seq" from anon, authenticated;
revoke all on sequence public."project_finance_lines_id_seq" from anon, authenticated;
revoke all on sequence public."project_finance_project_id_seq" from anon, authenticated;
revoke all on sequence public."project_organizers_id_seq" from anon, authenticated;
revoke all on sequence public."project_phase_photos_id_seq" from anon, authenticated;
revoke all on sequence public."project_sales_reports_id_seq" from anon, authenticated;
revoke all on sequence public."project_stock_transfers_id_seq" from anon, authenticated;
revoke all on sequence public."project_team_id_seq" from anon, authenticated;
revoke all on sequence public."project_venues_id_seq" from anon, authenticated;
revoke all on sequence public."projects_id_seq" from anon, authenticated;
revoke all on sequence public."purchase_orders_id_seq" from anon, authenticated;
revoke all on sequence public."push_devices_id_seq" from anon, authenticated;
revoke all on sequence public."roles_id_seq" from anon, authenticated;
revoke all on sequence public."salary_records_id_seq" from anon, authenticated;
revoke all on sequence public."salary_trip_lines_id_seq" from anon, authenticated;
revoke all on sequence public."sales_commission_tiers_id_seq" from anon, authenticated;
revoke all on sequence public."sales_entries_id_seq" from anon, authenticated;
revoke all on sequence public."sales_entry_activity_id_seq" from anon, authenticated;
revoke all on sequence public."sales_entry_change_requests_id_seq" from anon, authenticated;
revoke all on sequence public."sales_entry_items_id_seq" from anon, authenticated;
revoke all on sequence public."sales_entry_payments_id_seq" from anon, authenticated;
revoke all on sequence public."sales_orders_id_seq" from anon, authenticated;
revoke all on sequence public."sales_positions_id_seq" from anon, authenticated;
revoke all on sequence public."sales_rep_commission_tiers_id_seq" from anon, authenticated;
revoke all on sequence public."sales_reps_id_seq" from anon, authenticated;
revoke all on sequence public."sales_team_activity_id_seq" from anon, authenticated;
revoke all on sequence public."share_export_log_id_seq" from anon, authenticated;
revoke all on sequence public."supplier_accounts_id_seq" from anon, authenticated;
revoke all on sequence public."supplier_communications_id_seq" from anon, authenticated;
revoke all on sequence public."supplier_invitations_id_seq" from anon, authenticated;
revoke all on sequence public."suppliers_id_seq" from anon, authenticated;
revoke all on sequence public."table_layouts_id_seq" from anon, authenticated;
revoke all on sequence public."tmp_sheet_capture_id_seq" from anon, authenticated;
revoke all on sequence public."trip_proposal_trips_id_seq" from anon, authenticated;
revoke all on sequence public."trip_proposals_id_seq" from anon, authenticated;
revoke all on sequence public."trip_stops_id_seq" from anon, authenticated;
revoke all on sequence public."udf_fields_id_seq" from anon, authenticated;
revoke all on sequence public."users_id_seq" from anon, authenticated;
grant all on public."_migrations" to service_role;
grant all on public."_pg_migrations" to service_role;
grant all on public."ac_snapshot_purchase_orders" to service_role;
grant all on public."ac_snapshot_runs" to service_role;
grant all on public."ac_snapshot_sales_orders" to service_role;
grant all on public."addons" to service_role;
grant all on public."agent_controls" to service_role;
grant all on public."agent_decision_outcomes" to service_role;
grant all on public."agent_decisions" to service_role;
grant all on public."agent_feedback" to service_role;
grant all on public."agent_kill_scopes" to service_role;
grant all on public."agent_runs" to service_role;
grant all on public."announcement_acks" to service_role;
grant all on public."announcement_files" to service_role;
grant all on public."announcement_reminders" to service_role;
grant all on public."announcements" to service_role;
grant all on public."app_settings" to service_role;
grant all on public."assistant_conversations" to service_role;
grant all on public."assistant_messages" to service_role;
grant all on public."assr_activity" to service_role;
grant all on public."assr_alert_acks" to service_role;
grant all on public."assr_attachments" to service_role;
grant all on public."assr_case_access" to service_role;
grant all on public."assr_case_categories" to service_role;
grant all on public."assr_cases" to service_role;
grant all on public."assr_issue_categories" to service_role;
grant all on public."assr_items" to service_role;
grant all on public."assr_lead_time_activations" to service_role;
grant all on public."assr_lead_time_amendments" to service_role;
grant all on public."assr_lead_time_profiles" to service_role;
grant all on public."assr_lead_time_scheduled_activations" to service_role;
grant all on public."assr_logistics" to service_role;
grant all on public."assr_ncr_categories" to service_role;
grant all on public."assr_priorities" to service_role;
grant all on public."assr_priority_stage_targets" to service_role;
grant all on public."assr_product_categories" to service_role;
grant all on public."assr_resolution_methods" to service_role;
grant all on public."assr_stage_history" to service_role;
grant all on public."assr_stage_targets" to service_role;
grant all on public."assr_supplier_returns" to service_role;
grant all on public."assr_supplier_tokens" to service_role;
grant all on public."assr_survey_tokens" to service_role;
grant all on public."audit_events" to service_role;
grant all on public."autocount_delivery_orders" to service_role;
grant all on public."bedframe_colours" to service_role;
grant all on public."bedframe_options" to service_role;
grant all on public."brand_share_tokens" to service_role;
grant all on public."bundle_library" to service_role;
grant all on public."case_track_tokens" to service_role;
grant all on public."categories" to service_role;
grant all on public."client_errors" to service_role;
grant all on public."collection_agent_briefs" to service_role;
grant all on public."collection_agent_proposals" to service_role;
grant all on public."compartment_library" to service_role;
grant all on public."config_proposals" to service_role;
grant all on public."consignment_delivery_order_items" to service_role;
grant all on public."consignment_delivery_order_payments" to service_role;
grant all on public."consignment_delivery_orders" to service_role;
grant all on public."consignment_delivery_return_items" to service_role;
grant all on public."consignment_delivery_returns" to service_role;
grant all on public."consignment_sales_order_items" to service_role;
grant all on public."consignment_sales_order_payments" to service_role;
grant all on public."consignment_sales_orders" to service_role;
grant all on public."consignment_so_audit_log" to service_role;
grant all on public."contractor_share_tokens" to service_role;
grant all on public."creditors" to service_role;
grant all on public."cs_agent_briefs" to service_role;
grant all on public."cs_agent_proposals" to service_role;
grant all on public."customers" to service_role;
grant all on public."daily_inspections" to service_role;
grant all on public."delivery_agent_briefs" to service_role;
grant all on public."delivery_agent_proposals" to service_role;
grant all on public."delivery_order_items" to service_role;
grant all on public."delivery_order_payments" to service_role;
grant all on public."delivery_orders" to service_role;
grant all on public."delivery_return_items" to service_role;
grant all on public."delivery_returns" to service_role;
grant all on public."delivery_status_log" to service_role;
grant all on public."delivery_tracking" to service_role;
grant all on public."departments" to service_role;
grant all on public."document_agent_briefs" to service_role;
grant all on public."document_agent_findings" to service_role;
grant all on public."document_refs" to service_role;
grant all on public."document_types" to service_role;
grant all on public."email_address_access" to service_role;
grant all on public."email_addresses" to service_role;
grant all on public."email_attachments" to service_role;
grant all on public."email_labels" to service_role;
grant all on public."email_log" to service_role;
grant all on public."email_messages" to service_role;
grant all on public."email_outbox" to service_role;
grant all on public."email_threads" to service_role;
grant all on public."events" to service_role;
grant all on public."execution_logs" to service_role;
grant all on public."fabric_colours" to service_role;
grant all on public."fabric_library" to service_role;
grant all on public."fabric_tier_addon_config" to service_role;
grant all on public."fabric_trackings" to service_role;
grant all on public."fabrics" to service_role;
grant all on public."grn_items" to service_role;
grant all on public."grns" to service_role;
grant all on public."idea_comments" to service_role;
grant all on public."idempotency_keys" to service_role;
grant all on public."inventory_lot_consumptions" to service_role;
grant all on public."inventory_lots" to service_role;
grant all on public."inventory_movements" to service_role;
grant all on public."invitations" to service_role;
grant all on public."lorry_incidents" to service_role;
grant all on public."mail_user_scope" to service_role;
grant all on public."maintenance_config_history" to service_role;
grant all on public."master_price_history" to service_role;
grant all on public."memos" to service_role;
grant all on public."mfg_products" to service_role;
grant all on public."mfg_purchase_order_items" to service_role;
grant all on public."mfg_purchase_order_lines" to service_role;
grant all on public."mfg_purchase_orders" to service_role;
grant all on public."mfg_sales_order_items" to service_role;
grant all on public."mfg_sales_order_payments" to service_role;
grant all on public."mfg_sales_orders" to service_role;
grant all on public."mfg_so_audit_log" to service_role;
grant all on public."mfg_so_price_overrides" to service_role;
grant all on public."mfg_so_status_changes" to service_role;
grant all on public."mfg_suppliers" to service_role;
grant all on public."mfg_warehouses" to service_role;
grant all on public."model_default_free_gifts" to service_role;
grant all on public."model_fabric_tier_overrides" to service_role;
grant all on public."model_special_delivery_fees" to service_role;
grant all on public."mrp_category_lead_times" to service_role;
grant all on public."of_agent_briefs" to service_role;
grant all on public."of_agent_findings" to service_role;
grant all on public."order_details" to service_role;
grant all on public."password_resets" to service_role;
grant all on public."phone_normalisation_backup" to service_role;
grant all on public."pms_agent_briefs" to service_role;
grant all on public."pms_agent_proposals" to service_role;
grant all on public."position_capabilities" to service_role;
grant all on public."position_policy" to service_role;
grant all on public."positions" to service_role;
grant all on public."procurement_agent_briefs" to service_role;
grant all on public."procurement_agent_proposals" to service_role;
grant all on public."product_bedframe_colours" to service_role;
grant all on public."product_bundles" to service_role;
grant all on public."product_compartments" to service_role;
grant all on public."product_dept_configs" to service_role;
grant all on public."product_fabrics" to service_role;
grant all on public."product_models" to service_role;
grant all on public."product_size_variants" to service_role;
grant all on public."products" to service_role;
grant all on public."project_activity" to service_role;
grant all on public."project_attachments" to service_role;
grant all on public."project_brands" to service_role;
grant all on public."project_checklist" to service_role;
grant all on public."project_checklist_attachment_actions" to service_role;
grant all on public."project_checklist_attachments" to service_role;
grant all on public."project_checklist_comments" to service_role;
grant all on public."project_checklist_sections" to service_role;
grant all on public."project_checklist_template_items" to service_role;
grant all on public."project_checklist_template_sections" to service_role;
grant all on public."project_checklist_templates" to service_role;
grant all on public."project_contractors" to service_role;
grant all on public."project_cost_rates" to service_role;
grant all on public."project_defects" to service_role;
grant all on public."project_event_types" to service_role;
grant all on public."project_finance" to service_role;
grant all on public."project_finance_lines" to service_role;
grant all on public."project_organizers" to service_role;
grant all on public."project_phase_photos" to service_role;
grant all on public."project_reads" to service_role;
grant all on public."project_sales_attendees" to service_role;
grant all on public."project_sales_reports" to service_role;
grant all on public."project_stock_transfers" to service_role;
grant all on public."project_team" to service_role;
grant all on public."project_venues" to service_role;
grant all on public."projects" to service_role;
grant all on public."purchase_consignment_receive_items" to service_role;
grant all on public."purchase_consignment_receives" to service_role;
grant all on public."purchase_consignment_return_items" to service_role;
grant all on public."purchase_consignment_returns" to service_role;
grant all on public."purchase_invoice_items" to service_role;
grant all on public."purchase_invoices" to service_role;
grant all on public."purchase_order_docs" to service_role;
grant all on public."purchase_orders" to service_role;
grant all on public."purchase_return_items" to service_role;
grant all on public."purchase_returns" to service_role;
grant all on public."push_devices" to service_role;
grant all on public."pwp_codes" to service_role;
grant all on public."pwp_rules" to service_role;
grant all on public."roles" to service_role;
grant all on public."salary_records" to service_role;
grant all on public."salary_trip_lines" to service_role;
grant all on public."sales_commission_tiers" to service_role;
grant all on public."sales_entries" to service_role;
grant all on public."sales_entry_activity" to service_role;
grant all on public."sales_entry_change_requests" to service_role;
grant all on public."sales_entry_items" to service_role;
grant all on public."sales_entry_payments" to service_role;
grant all on public."sales_invoice_items" to service_role;
grant all on public."sales_invoice_payments" to service_role;
grant all on public."sales_invoices" to service_role;
grant all on public."sales_orders" to service_role;
grant all on public."sales_positions" to service_role;
grant all on public."sales_rep_brands" to service_role;
grant all on public."sales_rep_commission_tiers" to service_role;
grant all on public."sales_reps" to service_role;
grant all on public."sales_team_activity" to service_role;
grant all on public."series" to service_role;
grant all on public."sessions" to service_role;
grant all on public."share_export_log" to service_role;
grant all on public."si_agent_briefs" to service_role;
grant all on public."si_agent_findings" to service_role;
grant all on public."size_library" to service_role;
grant all on public."sofa_combo_pricing" to service_role;
grant all on public."sofa_quick_picks" to service_role;
grant all on public."special_addons" to service_role;
grant all on public."state_warehouse_map" to service_role;
grant all on public."stock_items" to service_role;
grant all on public."stock_take_lines" to service_role;
grant all on public."stock_takes" to service_role;
grant all on public."stock_transfer_lines" to service_role;
grant all on public."stock_transfers" to service_role;
grant all on public."supplier_accounts" to service_role;
grant all on public."supplier_communications" to service_role;
grant all on public."supplier_invitations" to service_role;
grant all on public."supplier_material_bindings" to service_role;
grant all on public."supplier_sessions" to service_role;
grant all on public."suppliers" to service_role;
grant all on public."system_settings" to service_role;
grant all on public."table_layouts" to service_role;
grant all on public."tmp_sheet_capture" to service_role;
grant all on public."trip_proposal_trips" to service_role;
grant all on public."trip_proposals" to service_role;
grant all on public."trip_stops" to service_role;
grant all on public."udf_fields" to service_role;
grant all on public."udf_values" to service_role;
grant all on public."user_brands" to service_role;
grant all on public."user_companies" to service_role;
grant all on public."user_departments" to service_role;
grant all on public."users" to service_role;
grant all on public."warehouse_rack_items" to service_role;
grant all on public."warehouse_rack_movements" to service_role;
grant all on public."warehouse_racks" to service_role;
grant all on public."warehouses" to service_role;
grant all on public."inventory_balances" to service_role;
grant all on public."lorries" to service_role;
grant all on public."trips" to service_role;
grant all on public."v_cogs_entries" to service_role;
grant all on public."v_inventory_lots_open" to service_role;
grant all on public."v_inventory_value" to service_role;
revoke all on public.companies from anon, authenticated;
