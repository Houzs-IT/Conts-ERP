/* The Sales Order list's "Cancel requested" marker — on the row and in the
   quick-view drawer header. Before, an open cancellation request showed only on
   the full detail page (CancelRequestPanel).

   ONE query for the whole list: the existing inbox (GET /cancel-requests?scope=open,
   at most 500 rows, coarse scm.access), keyed by doc_key, which is the SO's doc_no.
   A caller the inbox refuses simply sees no marker. */
import { useMemo } from "react";
import { cancelRequestLine, useCancelRequests, type CancelRequestRow } from "../../vendor/scm/lib/document-cancel-queries";
import { STATUS_TONES } from "../../vendor/scm/lib/status-pill";
import styles from "../../vendor/scm/components/StatusPill.module.css";

/** doc_no → that Sales Order's open cancellation request. */
export function useOpenSoCancelRequests(): Map<string, CancelRequestRow> {
  const q = useCancelRequests("open");
  return useMemo(
    () => new Map((q.data?.requests ?? []).filter((r) => r.doc_type === "SO").map((r) => [r.doc_key, r])),
    [q.data],
  );
}

/** Renders nothing without a request. Solid (the pending tone's ink as the fill,
 *  white text) so it reads on a light row and on the drawer's dark header alike. */
export function CancelRequestedChip({ request }: { request: CancelRequestRow | undefined }) {
  if (!request) return null;
  return (
    <span className={styles.pill} style={{ background: STATUS_TONES.pending.fg, color: "#fff" }} title={cancelRequestLine(request)}>
      Cancel requested
    </span>
  );
}
