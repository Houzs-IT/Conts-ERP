import type { CSSProperties, ReactElement } from 'react';

interface SummaryLine { rid: string; itemCode: string; materialName: string }

export interface CreditorRematchSummaryProps {
  creditorName: string;
  kept: readonly SummaryLine[];
  removed: readonly SummaryLine[];
}

// The confirm dialog renders its body inside a <p>, so everything here is a block span, never a div or list.
const block: CSSProperties = { display: 'block' };
const heading: CSSProperties = { ...block, fontWeight: 700, marginTop: 'var(--space-3)' };
const scroller: CSSProperties = {
  ...block, maxHeight: '30vh', overflowY: 'auto', marginTop: 'var(--space-1)',
  border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-1) var(--space-2)',
};
const row: CSSProperties = { ...block, padding: 'var(--space-1) 0', overflowWrap: 'anywhere' };
const code: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 700 };
const muted: CSSProperties = { color: 'var(--fg-muted)' };

const LineRows = ({ lines }: { lines: readonly SummaryLine[] }): ReactElement => (
  <span style={scroller}>
    {lines.map((l) => (
      <span key={l.rid} style={row}>
        <span style={code}>{l.itemCode}</span>
        {l.materialName && <span style={muted}> · {l.materialName}</span>}
      </span>
    ))}
  </span>
);

export const CreditorRematchSummary = ({ creditorName, kept, removed }: CreditorRematchSummaryProps): ReactElement => {
  const keptItems = kept.filter((l) => l.itemCode.trim());
  return (
    <>
      <span style={block}>
        {removed.length === 0
          ? `${creditorName} sells every item below. Each line moves over at its supplier SKU and price.`
          : keptItems.length === 0
            ? `${creditorName} sells none of these items, so every line is removed.`
            : `${creditorName} sells ${keptItems.length} of these items. Those lines move over at its supplier SKU and price; the rest are removed.`}
      </span>
      {removed.length > 0 && (
        <>
          <span style={heading}>Removed: not sold by {creditorName} ({removed.length})</span>
          <LineRows lines={removed} />
        </>
      )}
      {keptItems.length > 0 && (
        <>
          <span style={heading}>Kept ({keptItems.length})</span>
          <LineRows lines={keptItems} />
        </>
      )}
    </>
  );
};
