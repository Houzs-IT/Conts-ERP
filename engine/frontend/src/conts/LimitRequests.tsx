// Conts only (not part of Houzs's code): /scm/limit-requests — requests for extra project limit or budget (finance phase
// 1.5; SOP 3.4). Anyone with the Ledger sees them; a holder of the approve key decides, never on their own request.
import { useMemo, useState } from "react";
import { PageHeader } from "../components/Layout";
import { Button } from "../components/Button";
import { DataTable, type Column } from "../components/DataTable";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { useAuth } from "../auth/AuthContext";
import { fmtSenPlain } from "../vendor/shared/format";
import { useDecideLimit, useLimitRequests, type LimitRequest } from "./projectLimitQueries";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";

const asked = (r: LimitRequest): string =>
  r.kind === "pct" ? `Limit to ${((r.pct_bp ?? 0) / 100).toFixed(1)}% of what was paid` : `${r.kind === "budget" ? "Budget" : "Limit"} + RM ${fmtSenPlain(r.amount_sen ?? 0)}`;

export function LimitRequests() {
  const [status, setStatus] = useState("PENDING");
  const q = useLimitRequests(status);
  const decide = useDecideLimit();
  const askConfirm = useConfirm();
  const { can, user } = useAuth();
  const canDecide = can("scm.project_limit.approve");
  const me = String((user as { name?: string } | null)?.name ?? "");
  const myId = (user as { id?: string | number } | null)?.id != null ? String((user as { id: string | number }).id) : null;
  /* Mine by user id where the request has one, else by name (requests made before the id was kept). */
  const mine = (r: LimitRequest) => (r.requested_by_id != null && myId != null ? r.requested_by_id === myId : r.requested_by === me);
  const [note, setNote] = useState<string | null>(null);

  const run = async (r: LimitRequest, decision: "approve" | "reject") => {
    setNote(null);
    if (!(await askConfirm({
      title: `${decision === "approve" ? "Approve" : "Reject"} for ${r.project_name}?`,
      body: `${asked(r)} — asked by ${r.requested_by}: ${r.reason}`,
      confirmLabel: decision === "approve" ? "Approve" : "Reject",
      danger: decision === "reject",
    }))) return;
    try { await decide.mutateAsync({ id: r.id, decision }); } catch (e) { setNote(e instanceof Error ? e.message : "Not saved."); }
  };

  const columns = useMemo<Column<LimitRequest>[]>(() => [
    { key: "created", label: "Asked on", render: (r) => r.created_at.slice(0, 10), getValue: (r) => r.created_at },
    { key: "project", label: "Project", render: (r) => <span style={{ fontWeight: 600 }}>{r.project_name}</span>, getValue: (r) => r.project_name },
    { key: "asked", label: "Asked for", render: asked, getValue: (r) => r.amount_sen ?? r.pct_bp ?? 0 },
    { key: "reason", label: "Why", render: (r) => r.reason, getValue: (r) => r.reason },
    { key: "by", label: "By", render: (r) => r.requested_by, getValue: (r) => r.requested_by },
    {
      key: "status", label: "Status",
      render: (r) => (r.status === "PENDING" ? "Waiting" : `${r.status === "APPROVED" ? "Approved" : "Rejected"} by ${r.decided_by ?? "—"}`),
      getValue: (r) => r.status,
    },
    {
      key: "decide", label: "",
      render: (r) => (canDecide && r.status === "PENDING" ? (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button className="h-8" disabled={decide.isPending || mine(r)} title={mine(r) ? "Someone else must approve your own request." : undefined} onClick={() => void run(r, "approve")}>Approve</Button>
          <Button className="h-8" variant="secondary" disabled={decide.isPending} onClick={() => void run(r, "reject")}>Reject</Button>
        </span>
      ) : null),
      getValue: () => "",
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mine() reads me and myId, both listed
  ], [canDecide, decide.isPending, me, myId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="Finance" title="Limit requests" description="Extra limit or budget asked for on a project. Approving adds it to the whole project." />
      <label className={styles.field} style={{ maxWidth: 200 }}>
        <span className={styles.fieldLabel}>Show</span>
        <select className={styles.fieldInput} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </label>
      {note && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>{note}</div>}
      <DataTable<LimitRequest>
        tableId="conts-limit-requests"
        columns={columns}
        rows={q.data ? q.data.requests : null}
        loading={q.isLoading}
        error={q.isError ? "The requests did not load." : null}
        emptyLabel="No requests."
        getRowKey={(r) => r.id}
      />
    </div>
  );
}
