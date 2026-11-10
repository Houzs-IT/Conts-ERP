import { Button } from '../../components/Button';

const when = (ts: number) => new Date(ts).toLocaleString('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

/** "Restore your draft?" for a form that left unsaved changes in this browser. */
export function RenovationDraftBanner({ savedAt, stale, onRestore, onDiscard }: {
  savedAt: number; stale: boolean; onRestore: () => void; onDiscard: () => void;
}) {
  return (
    <div role="alert" data-draft-banner className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-text/30 bg-warning-bg text-warning-text px-3 py-2 text-[13px]">
      <span>
        <strong>Unsaved changes from {when(savedAt)}.</strong> Restore your draft?
        {stale && ' This record was saved again since then; restoring replaces that version when you save.'}
      </span>
      <span className="flex gap-2">
        <Button variant="ghost" onClick={onDiscard}>Discard</Button>
        <Button onClick={onRestore}>Restore</Button>
      </span>
    </div>
  );
}
