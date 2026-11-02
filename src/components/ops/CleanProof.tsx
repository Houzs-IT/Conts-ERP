import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AttachmentLabel, MediaGallery, type MediaItem } from '../Attachments';
import { Segmented, uploadTo } from './OpsUi';

export type CleanStage = 'before' | 'after';
/** A clean's photo: its stage comes from the server (functions/_lib/media.ts cleanStage); none means After (proof). */
export const stageOf = (m: MediaItem): CleanStage => (m.stage === 'before' ? 'before' : 'after');
export const stageCounts = (media: MediaItem[]) => ({ before: media.filter(m => stageOf(m) === 'before').length, after: media.filter(m => stageOf(m) === 'after').length });

export interface CleanProofWords {
  title: string; beforeOrAfter: string; before: string; after: string;
  addBefore: string; addAfter: string; noBefore: string; noAfter: string;
}

/**
 * A clean's photos and videos in two stages, as maintenance has: Before (how the unit was found, never required) and
 * After (proof of work, at least one needed to complete). Several files picked at once go up one request each, with
 * progress and the names of any that failed (MediaGallery). Uploading never completes the job (owner, 2 Nov 2026).
 */
export function CleanProof({ taskId, unitLabel, media, done, words, hint, onUploaded, onRemove, openAddRef }: {
  taskId: string; unitLabel: string; media: MediaItem[]; done: boolean; words: CleanProofWords; hint?: ReactNode;
  onUploaded: () => void; onRemove?: (m: MediaItem) => void; openAddRef?: { current: (() => void) | null };
}) {
  const [stage, setStage] = useState<CleanStage>('after');
  const counts = stageCounts(media);
  const shown = media.filter(m => stageOf(m) === stage);
  // A button elsewhere (the action bar's "Add photos") always adds After proof: switch to After first, then open.
  const inner = useRef<(() => void) | null>(null);
  const openAfter = useRef(false);
  useEffect(() => { if (openAfter.current && stage === 'after') { openAfter.current = false; inner.current?.(); } }, [stage]);
  if (openAddRef) openAddRef.current = done ? null : () => { if (stage === 'after') inner.current?.(); else { openAfter.current = true; setStage('after'); } };
  return (
    <section className="flex flex-col gap-2">
      <AttachmentLabel title={words.title} count={counts.after} hint={hint} />
      <Segmented label={words.beforeOrAfter} className="self-start [&>button]:h-11 md:[&>button]:h-9" value={stage} onChange={setStage} options={[
        { value: 'before', label: <>{words.before} <span className="text-muted-ink tabular-nums">{counts.before}</span></> },
        { value: 'after', label: <>{words.after} <span className="text-muted-ink tabular-nums">{counts.after}</span></> },
      ]} />
      {/* Keyed by stage so a batch still uploading is not shown under the other stage. */}
      <MediaGallery key={stage} items={shown} upload={done ? undefined : uploadTo(`/tasks/${taskId}/photos`, { stage }, unitLabel)} onDone={() => onUploaded()}
        onRemove={done ? undefined : onRemove} addLabel={stage === 'before' ? words.addBefore : words.addAfter}
        emptyText={stage === 'before' ? words.noBefore : words.noAfter} openAddRef={inner} />
    </section>
  );
}
