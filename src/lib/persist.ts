import { useLayoutEffect } from 'react';
import { useApi } from './useApi';
import { ApiFailure, notifyFailure } from './api';

/**
 * Sends a change made from a list screen, then re-reads the list so the screen shows what the server holds.
 * The success message waits for the server: a refused save shows only the "not saved" notice, and the
 * re-read drops the row the screen drew ahead of time (a rejected duplicate, or a new row still carrying
 * a made-up id that a later edit or delete would send to the server).
 */
export function persist(request: Promise<unknown>, opts: { reload: () => void; ok?: () => void }) {
  request.then(() => opts.ok?.(), failed).finally(opts.reload);
}

/** The form is already closed when a refusal comes back, so the notice names the field rather than "some fields". */
function failed(e: unknown) {
  const field = e instanceof ApiFailure && e.code === 'VALIDATION' && e.fields ? Object.values(e.fields)[0] : undefined;
  notifyFailure(field && e instanceof ApiFailure ? new ApiFailure(e.status, e.code, field, e.fields) : e);
}

/** Drops the rows a screen drew ahead of the server once a fresh copy of the list arrives, before it is painted. */
export function useResetOnReload(data: unknown, reset: () => void) {
  useLayoutEffect(reset, [data]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The full record behind a list row. List endpoints send document headers only, so a drawer that shows or edits
 * lines must fetch the record itself. A row the screen drew ahead of the server (made-up id) has nothing to fetch yet.
 */
export function useRecord<T>(resource: string, id: string | null | undefined) {
  const real = !!id && !id.includes('-new-');
  const q = useApi<{ data: T }>(real ? `/${resource}/${id}` : null);
  return { record: q.data?.data ?? null, loading: real && q.loading && !q.data, error: real ? q.error : null, reload: q.reload };
}
