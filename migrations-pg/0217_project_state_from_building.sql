-- REVERSAL: none needed by rows: these projects and orders had no state before this file. To undo, clear state on the
-- projects with these buildings and customer_state on their orders.
-- Projects imported with a building but no state take it from Unit settings' building list, by exact name, and their sales
-- orders follow. Only blanks are filled. Buildings not on that list stay blank until the owner gives their state.
UPDATE public.projects p
   SET state = b.state
  FROM pos.properties b
 WHERE upper(trim(b.name)) = upper(trim(p.building))
   AND coalesce(p.state, '') = '' AND coalesce(b.state, '') <> '';

UPDATE scm.mfg_sales_orders o
   SET customer_state = p.state
  FROM public.projects p
 WHERE p.id = o.project_id
   AND coalesce(o.customer_state::text, '') = '' AND coalesce(p.state, '') <> '';
