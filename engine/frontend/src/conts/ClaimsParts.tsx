// Conts only (not part of Houzs's code): small pieces the petty cash and payment request screens share.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { fmtSenPlain } from "../vendor/shared/format";
import { useChoice } from "../vendor/scm/components/ChoiceDialog";

export type PettyOptions = {
  departments: { id: string; name: string; kind: string; side: string }[];
  staff: { id: string; name: string; departmentId: string | null }[];
  banks: { code: string; name: string }[];
  expenseAccounts: { code: string; name: string }[];
  writeOffAccounts: { code: string; name: string }[];
  pettyCashAccountSet: boolean;
};
export const usePettyOptions = () => useQuery({
  queryKey: ["petty-options"], queryFn: () => authedFetch<PettyOptions>("/accounting/petty-cash/options"), staleTime: 120_000,
});

/** RM with two decimals, right-aligned; below zero in the danger colour. */
export function Money({ sen, strong }: { sen: number; strong?: boolean }) {
  return (
    <span className={sen < 0 ? "text-err" : undefined} style={{ fontVariantNumeric: "tabular-nums", fontWeight: strong ? 600 : undefined, whiteSpace: "nowrap" }}>
      {sen < 0 ? "−" : ""}RM {fmtSenPlain(Math.abs(sen))}
    </span>
  );
}

/** The receipt's photos and PDFs as small buttons; a click opens the file in a new tab. */
export function FileButtons({ files, open }: { files: { id: string; fileName: string; mime: string }[]; open: (fileId: string, mime: string) => Promise<string> }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (files.length === 0) return <span className="text-ink-muted">—</span>;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {files.map((f, i) => (
        <button key={f.id} type="button" title={f.fileName} disabled={busy === f.id}
          className="rounded border border-border bg-surface px-2 py-0.5 text-xs hover:border-primary"
          onClick={async () => {
            setBusy(f.id);
            try { window.open(await open(f.id, f.mime), "_blank", "noopener"); } finally { setBusy(null); }
          }}>
          {f.mime === "application/pdf" ? "PDF" : "Photo"} {files.length > 1 ? i + 1 : ""}
        </button>
      ))}
    </span>
  );
}

/** Asks which bank a payment comes from; null when cancelled. */
export function useChooseBank() {
  const choose = useChoice();
  return async (banks: { code: string; name: string }[], title: string) => {
    if (banks.length === 0) return null;
    return choose({ title, options: banks.map((b) => ({ value: b.code, label: `${b.code} ${b.name}` })) });
  };
}

/** This month as YYYY-MM, Malaysia time. */
export const thisMonth = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);
