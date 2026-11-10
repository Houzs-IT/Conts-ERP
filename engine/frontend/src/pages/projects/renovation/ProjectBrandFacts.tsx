/* A renovation project's brand and finance type, each chosen in place (PATCH /api/renovation/:id). Shared by the
   project page and the project workspace's Client & team card (chew, 10 Nov 2026: the brand could only be set on the
   older page). */

import { useState } from "react";
import { useBrands } from "../../../lib/renovation/api";
import { errorText } from "./renovationModel";
import { simpleApi, type FinanceKind } from "./simpleApi";

const FINANCE_KIND_LABEL: Record<string, string> = {
  "": "By quotation brand", RENOVATION: "Renovation (301)", INHOUSE_RENOVATION: "Inhouse renovation (302)",
};

/** Renovation or inhouse renovation, chosen in place (PATCH /api/renovation/:id); blank follows the quotation's brand:
    The Conts → inhouse renovation, Dream Crafter → renovation. */
export function FinanceKindFact({ projectId, value, canWrite, onDone, onError }: {
  projectId: number; value: string | null; canWrite: boolean; onDone: (t: string) => void; onError: (t: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!canWrite) return <span>{FINANCE_KIND_LABEL[value ?? ""] ?? value}</span>;
  return (
    <select className="h-7 rounded border border-border bg-surface px-1.5 text-xs" aria-label="Project type" value={value ?? ""} disabled={busy}
      onChange={async (e) => {
        const next = (e.target.value || null) as FinanceKind | null;
        setBusy(true);
        try {
          await simpleApi.setFinanceKind(projectId, next);
          onDone(`Type set to ${FINANCE_KIND_LABEL[next ?? ""]}.`);
        } catch (err) { onError(errorText(err)); } finally { setBusy(false); }
      }}>
      {Object.entries(FINANCE_KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
    </select>
  );
}

/** The brand, chosen in place (PATCH /api/renovation/:id); the sales order and its letterhead follow (owner, 10 Nov 2026). */
export function BrandFact({ projectId, value, canWrite, onDone, onError }: {
  projectId: number; value: string | null; canWrite: boolean; onDone: (t: string) => void; onError: (t: string) => void;
}) {
  const brands = useBrands();
  const [busy, setBusy] = useState(false);
  const rows = (brands.data?.brands ?? []).filter((b) => b.active);
  const current = rows.find((b) => b.name === value)?.brandId;
  if (!canWrite) return <span>{value ?? "-"}</span>;
  return (
    <select className="h-7 rounded border border-border bg-surface px-1.5 text-xs" aria-label="Brand" value={current ?? ""} disabled={busy || rows.length === 0}
      onChange={async (e) => {
        const next = Number(e.target.value);
        if (!next) return;
        setBusy(true);
        try {
          await simpleApi.setBrand(projectId, next);
          onDone(`Brand set to ${rows.find((b) => b.brandId === next)?.name ?? ""}. Its sales order follows.`);
        } catch (err) { onError(errorText(err)); } finally { setBusy(false); }
      }}>
      {current == null && <option value="">{value ?? "Choose a brand"}</option>}
      {rows.map((b) => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
    </select>
  );
}
