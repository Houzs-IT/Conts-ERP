-- REVERSAL: alter table scm.reno_so_contracts alter column project_id set not null; alter table scm.reno_quotations alter column project_id set not null; (refused while a quotation or contract has no project: link or delete those first)
-- A sales order and a project may come in either order (owner decisions 11 Oct 2026): a quotation and the
-- contract it converts to can exist before their project, and get the project id when someone links them.
-- One live renovation SO per project (uq_mfg_so_reno_project, migration 0069) is unchanged.
set local search_path = scm, public, extensions;

alter table scm.reno_quotations alter column project_id drop not null;
alter table scm.reno_so_contracts alter column project_id drop not null;
