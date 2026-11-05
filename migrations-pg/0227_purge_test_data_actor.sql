-- REVERSAL: nothing to undo; the function is dropped with the clear tool once used.
-- pos.audit_log.actor_id points at the Property OS users, and the engine's staff ids are not there, so the clear failed
-- on its audit row and rolled back whole. The engine id goes in the label instead.
set local search_path = scm, public, extensions;

do $do$
begin
  execute replace(
    pg_get_functiondef('scm.purge_test_data(boolean, text)'::regprocedure),
    $a$values (p_actor, coalesce(p_actor, 'owner'),$a$,
    $b$values (null, coalesce(p_actor, 'owner'),$b$
  );
end
$do$;
