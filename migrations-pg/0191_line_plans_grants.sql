-- REVERSAL: revoke all on scm.reno_beta_line_plans from service_role, pos_app;
-- scm.reno_beta_line_plans (0155) was granted to scm_engine only, unlike its sibling tables. MRP reads it through the
-- service_role client since the project line release of 1 Nov 2026 and failed with "permission denied"; the same
-- grants as scm.reno_doc_lines.
grant select, insert, update, delete, references, trigger, truncate on scm.reno_beta_line_plans to service_role, pos_app;
