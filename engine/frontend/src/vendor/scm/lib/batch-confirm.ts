// ----------------------------------------------------------------------------
// Confirm the ticked drafts of a list in one press (Houzs 5191c5f7c + d1a3794d4,
// TODO port item 15). Each goes through the same `/:id/post` the row's own
// Confirm uses, one after another, and one refusal does not stop the rest: the
// summary names what stayed a draft, and what was confirmed with a problem.
// ----------------------------------------------------------------------------
import { useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';
import { writeFailed } from './mutation-error';
import { useConfirm } from '../components/ConfirmDialog';
import { useNotify } from '../components/NotifyDialog';

export type ConfirmOutcome = {
  done: string[];
  /* Confirmed, but the post answered with a part that failed (e.g. stock not received). */
  warned: Array<{ doc: string; reason: string }>;
  /* Refused: still a draft. */
  failed: Array<{ doc: string; reason: string }>;
};

/** In turn, not at once: a post moves stock and payables, and drafts in a list
 *  often bill the same receipt line, so the second must see the first's result.
 *  `post` resolves to a problem text when the document was confirmed but part of
 *  it failed, and throws when the document was not confirmed. */
export async function confirmInTurn<R>(
  rows: readonly R[],
  docOf: (r: R) => string,
  post: (r: R) => Promise<string | null>,
  onStart: (n: number) => void = () => {},
): Promise<ConfirmOutcome> {
  const out: ConfirmOutcome = { done: [], warned: [], failed: [] };
  for (const [i, r] of rows.entries()) {
    onStart(i + 1);
    try {
      const problem = await post(r);
      out.done.push(docOf(r));
      if (problem) out.warned.push({ doc: docOf(r), reason: problem });
    } catch (e) {
      out.failed.push({ doc: docOf(r), reason: e instanceof Error ? e.message : 'Something went wrong.' });
    }
  }
  return out;
}

export function confirmSummary(noun: string, o: ConfirmOutcome): { title: string; body: string; tone: 'info' | 'error' } {
  const title = `${o.done.length} of ${o.done.length + o.failed.length} confirmed`;
  if (o.failed.length === 0 && o.warned.length === 0) return { title, body: `Every ticked ${noun} is confirmed.`, tone: 'info' };
  const parts: string[] = [];
  if (o.failed.length > 0) parts.push(`Not confirmed (still a draft):\n${o.failed.map((f) => `${f.doc}: ${f.reason}`).join('\n')}`);
  if (o.warned.length > 0) parts.push(`Confirmed, but check:\n${o.warned.map((f) => `${f.doc}: ${f.reason}`).join('\n')}`);
  return { title, body: parts.join('\n\n'), tone: 'error' };
}

type Spec<R> = {
  noun: string;
  body: string;
  pathOf: (r: R) => string;
  docOf: (r: R) => string;
  /** A post can answer 200 and still report a part that failed. */
  problemOf: (res: unknown) => string | null;
  /** The row's own Confirm's follow-up step, run after each confirmed row
   *  (Conts: an on-site goods receipt raises its delivery order). */
  afterEach?: (r: R) => void;
  refresh: QueryKey[];
  onDone: () => void;
};

export function useBatchConfirm<R>(spec: Spec<R>) {
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const notify = useNotify();
  const [progress, setProgress] = useState({ at: 0, of: 0 });
  const run = useMutation({
    mutationFn: (rows: R[]) => confirmInTurn(
      rows,
      spec.docOf,
      async (r) => {
        const problem = spec.problemOf(await authedFetch<unknown>(spec.pathOf(r), { method: 'PATCH' }));
        spec.afterEach?.(r);
        return problem;
      },
      (at) => setProgress({ at, of: rows.length }),
    ),
    onSuccess: async (o) => {
      for (const queryKey of spec.refresh) void qc.invalidateQueries({ queryKey });
      spec.onDone();
      await notify(confirmSummary(spec.noun, o));
    },
    onError: writeFailed,
  });
  const confirm = async (rows: R[]) => {
    if (rows.length === 0) return;
    const many = rows.length === 1 ? spec.noun : `${spec.noun}s`;
    if (await askConfirm({ title: `Confirm ${rows.length} ${many}?`, body: spec.body, confirmLabel: `Confirm ${rows.length}` })) run.mutate(rows);
  };
  /* Twelve GRNs take about a minute in turn: say how far it has got. */
  return { confirm, confirming: run.isPending, progressLabel: `Confirming ${progress.at} of ${progress.of}…` };
}
