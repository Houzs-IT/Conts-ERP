-- REVERSAL: DELETE FROM scm.reno_po_line_flags WHERE vo_id IS NULL; then ALTER TABLE scm.reno_po_line_flags ALTER COLUMN vo_id SET NOT NULL;
-- A change of options is not a VO (owner, 4 Nov 2026: only a change of amount or an added line is), so a PO line that
-- must follow one is flagged with no VO behind it.
ALTER TABLE scm.reno_po_line_flags ALTER COLUMN vo_id DROP NOT NULL;
