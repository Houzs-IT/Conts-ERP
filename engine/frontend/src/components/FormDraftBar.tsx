import { Button } from './Button';
import type { FormDraft } from '../lib/formDraft';

const when = (ts: number) => new Date(ts).toLocaleString('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

/** "Restore unsaved draft from <time>?" for a form that left unsaved fields in this browser (lib/formDraft.ts). */
export function FormDraftBar<T>({ draft, onRestore, staleText = 'This record changed after your draft; restoring will overwrite those changes.' }: {
  draft: FormDraft<T>; onRestore: (value: T) => void;
  /** Said when the record was saved again after the draft (edit forms). */
  staleText?: string;
}) {
  if (!draft.offered) return null;
  return (
    <div role="alert" data-draft-banner className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning-text/30 bg-warning-bg text-warning-text px-3 py-2 text-[13px]">
      <span>
        <strong>Restore unsaved draft from {when(draft.offered.ts)}?</strong>
        {draft.stale && ` ${staleText}`}
      </span>
      <span className="flex gap-2">
        <Button variant="ghost" onClick={draft.discard}>Discard</Button>
        <Button onClick={() => draft.restore(onRestore)}>Restore</Button>
      </span>
    </div>
  );
}
