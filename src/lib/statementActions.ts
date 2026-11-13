/** The toast after Mark final or Send on one statement (the owner's page and the statement page). The server answers 200
 *  with a count and the refusals, so a refused Mark final (a step still open, a draft out of date) must not read as done
 *  (review I5). */
export type StatementActionToast = { tone: 'success' | 'warning'; title: string; body?: string };

export function statementActionToast(kind: 'finalise' | 'send', res: { finalised?: number; sent?: number; failed?: { id?: string; reason: string }[] }): StatementActionToast {
  const done = (kind === 'finalise' ? res.finalised : res.sent) ?? 0;
  if (done > 0) return { tone: 'success', title: kind === 'finalise' ? 'Statement marked final.' : 'Statement sent to the owner.' };
  return { tone: 'warning', title: kind === 'finalise' ? 'Not marked final.' : 'Not sent.', body: res.failed?.[0]?.reason };
}
