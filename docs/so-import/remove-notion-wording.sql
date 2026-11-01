-- One-off, applied to production 1 Nov 2026 in one transaction (owner: the word "Notion" must not appear).
-- Visible text only; internal codes stay (project_activity.action 'notion_import', from_value 'notion', source_ref,
-- notion_url, app_config keys). The 79 imported SOs' note "Imported from Notion SO PDF <file>" printed on the
-- customer's PDF, so it is cleared rather than reworded. Read back after commit: 0 visible rows left, 79 notes cleared.
create function pg_temp.dn(t text) returns text language sql immutable as $$
select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
 'Imported from Notion SO PDF ', 'Imported from SO PDF ', 'g'),
 'Imported from Notion \(export ', 'Imported (export ', 'g'),
 'SO number \(Notion title\)', 'SO number (original title)', 'g'),
 'Added by hand from Notion on', 'Added by hand on', 'g'),
 'after the Notion export', 'after the export', 'g'),
 ' \(in Notion\)', '', 'g'),
 'Notion SO import', 'SO import', 'g'),
 'Notion import', 'Data import', 'g'),
 'from Notion', 'from the old system', 'gi'),
 '(the )?\mNotion\M', 'the old system', 'gi') $$;
update scm.mfg_sales_orders set note = null where note ~ '^Imported from Notion SO PDF [^\n]*$';
-- then pg_temp.dn() on: scm.mfg_sales_orders.note, reno_quotations / reno_quotation_revisions / reno_so_contracts .created_by,
-- reno_variation_orders .created_by / .approved_by, entity_audit_log / mfg_so_audit_log .actor_name_snapshot,
-- so_revisions.snapshot (as text), app_config.description, public.projects .flow_manual_reason / .hold_note,
-- project_trade_tasks.notes, project_people.notes, project_flow_log.reason, project_key_moves.note,
-- project_design_records.note, project_design_files.note, project_activity.note (each "where <col> ilike '%notion%'").
