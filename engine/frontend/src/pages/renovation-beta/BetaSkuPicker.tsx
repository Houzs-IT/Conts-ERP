/* Swap SKU on the PO tab (owner, 24 Oct 2026: "like the sales order's item picker"). The same catalog list and the
   same match rule as the sales order's SKU picker (SoLineCard: loaded once, filtered locally by code, name,
   description or barcode), shown as a browsable list: photo, code, name, group, price. It opens on the line's own
   group so there is something to pick before typing; arrow keys move, Enter picks, Escape closes. */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { ImageOff, Search } from "lucide-react";
import { resolveApiAssetUrl } from "../../components/scm-v2/PhotoGallery";
import { useRenovationSkus } from "../../vendor/scm/lib/mfg-products-queries";
import { RENOVATION_GROUPS, type CatalogGroup } from "../../vendor/shared/renovation-catalog";
import { useRenovationCatalog } from "../../vendor/scm/lib/renovation-catalog-queries";
import { money } from "../projects/renovation/renovationModel";
import { WS, WsDialog, WsFilterPill, inputStyle } from "./BetaWsUi";
import { metaStyle } from "./BetaVoPoUi";
import { BETA } from "./renovationBetaTheme";
import { groupOfRow, pickGroups, pickRows, type PickRow } from "./renovationBetaSkuPick";

const SHOWN = 80;

function Thumb({ row }: { row: PickRow }): ReactElement {
  const src = row.primaryThumbUrl ?? row.primaryPhotoUrl;
  const box = { width: 44, height: 44, flexShrink: 0, borderRadius: 6, border: `1px solid ${BETA.line}` } as const;
  if (!src) return <span title="No photo" style={{ ...box, display: "inline-flex", alignItems: "center", justifyContent: "center", background: WS.chip, color: BETA.muted }}><ImageOff size={14} aria-hidden="true" /></span>;
  return <img src={resolveApiAssetUrl(src)} alt="" loading="lazy" style={{ ...box, objectFit: "cover" }} />;
}

export function BetaSkuPicker({ current, onPick, onClose }: { current: string; onPick: (code: string, name: string, priceSen: number) => void; onClose: () => void }): ReactElement {
  const q = useRenovationSkus({});
  const catalog = useRenovationCatalog();
  const all = useMemo(() => (q.data ?? []) as PickRow[], [q.data]);
  const groups = useMemo(() => pickGroups(all, current), [all, current]);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<CatalogGroup | null | undefined>(undefined);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Open on the line's own group once the catalog arrives (undefined = not chosen yet).
  const own = useMemo(() => { const r = all.find((x) => x.code === current); return r ? groupOfRow(r) : null; }, [all, current]);
  const chosen: CatalogGroup | null = group === undefined ? (own && groups.some((g) => g.code === own) ? own : null) : group;
  const rows = useMemo(() => pickRows(all, { current, group: chosen, query: search }), [all, current, chosen, search]);
  const shown = rows.slice(0, SHOWN);

  useEffect(() => { setActive(0); }, [search, chosen]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (r: PickRow | undefined): void => { if (r) onPick(r.code, r.name, r.sell_price_sen ?? 0); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(shown[active]); }
  };
  const groupLabel = (r: PickRow): string => {
    const g = groupOfRow(r);
    return [g ? RENOVATION_GROUPS.find((d) => d.code === g)?.label : null, catalog.label(r.sub_category ?? null) || null].filter(Boolean).join(" · ");
  };

  return (
    <WsDialog title="Swap SKU" sub={`Replaces ${current} on this line. The amount uses the new SKU's price.`} onClose={onClose} wide>
      <div style={{ position: "relative" }}>
        <Search size={15} aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: BETA.muted }} />
        <input autoFocus role="combobox" aria-expanded="true" aria-controls="beta-sku-list" aria-activedescendant={shown[active] ? `beta-sku-${shown[active].id}` : undefined}
          aria-label="Search the catalog" placeholder="Search by SKU, name or barcode" style={{ ...inputStyle, paddingLeft: 32 }}
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onKey} />
      </div>
      {groups.length > 0 && (
        <div role="group" aria-label="Catalog group" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <WsFilterPill on={chosen === null} onClick={() => setGroup(null)}>All</WsFilterPill>
          {groups.map((g) => <WsFilterPill key={g.code} on={chosen === g.code} onClick={() => setGroup(g.code)}>{g.label} ({g.count})</WsFilterPill>)}
        </div>
      )}
      <div ref={listRef} id="beta-sku-list" role="listbox" aria-label="Catalog SKUs" style={{ maxHeight: 420, overflowY: "auto", border: `1px solid ${BETA.line}`, borderRadius: 8 }}>
        {q.isLoading && all.length === 0 ? <p style={{ margin: 0, padding: 12, ...metaStyle }}>Loading the catalog...</p>
          : shown.length === 0 ? <p style={{ margin: 0, padding: 12, ...metaStyle }}>{search.trim() ? `No active SKU matches "${search.trim()}".` : "No active SKU in this group."}</p>
          : shown.map((r, i) => (
            <div key={r.id} id={`beta-sku-${r.id}`} data-i={i} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${WS.rowLine}`, background: i === active ? WS.tealSoft : BETA.surface, cursor: "pointer" }}>
              <Thumb row={r} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, fontWeight: 600 }}>{r.code}</span>
                <span style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                {groupLabel(r) && <span style={metaStyle}>{groupLabel(r)}</span>}
              </span>
              <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 13.5 }}>{money(r.sell_price_sen ?? 0)}</span>
            </div>
          ))}
      </div>
      <div style={{ ...metaStyle, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>{rows.length > SHOWN ? `Showing ${SHOWN} of ${rows.length}; type to narrow.` : `${rows.length} SKU${rows.length === 1 ? "" : "s"}`}</span>
        <span>Up / Down to move, Enter to pick, Esc to close</span>
      </div>
      {q.error && <p role="alert" style={{ margin: 0, color: WS.red, fontSize: 13 }}>The catalog could not be loaded.</p>}
    </WsDialog>
  );
}
