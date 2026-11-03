// Conts only (not part of Houzs's code): a list that failed to load says so the way Property OS does, with a Retry,
// instead of "Failed to load" and no way out (owner, 3 Nov 2026: one "Couldn't load / Retry" pattern across the app).
import { useContext, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";

/** Retry refetches the queries that are on screen. Without a query client (a table fed by hand) it reloads the page. */
export function TableLoadError({ error }: { error: string }) {
  const client = useContext(QueryClientContext);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (!client) { window.location.reload(); return; }
    setBusy(true);
    try { await client.refetchQueries({ type: "active" }); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="font-semibold text-ink">Couldn't load this list.</div>
      {error && error !== "Failed to load" && <div className="text-xs text-ink-muted">{error}</div>}
      <button type="button" onClick={() => void retry()} disabled={busy}
        className="mt-1 h-9 rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60">
        {busy ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
