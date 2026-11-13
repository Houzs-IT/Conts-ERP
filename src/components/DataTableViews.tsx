import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useToast } from './Toast';

/** Saved views of one table (functions/api/table-layouts). */

export interface TableLayout {
  columns: { key: string; hidden: boolean }[];
  sort: string | null;
  pageSize: number | null;
  /** URL parameters: the table's column filters and the page's own (tab, building, ...). */
  filters: Record<string, string>;
}

export interface SavedView {
  id: string; table: string; name: string; scope: 'mine' | 'company'; isDefault: boolean; layout: TableLayout; mine: boolean; updatedAt: string;
}

/** `columns`: this person's own column order and visibility for the table, kept with their account (null: none yet);
 *  `columnsAt`: when the account kept it (the server's time). */
interface Payload { table: string; canShare: boolean; mine: SavedView[]; company: SavedView[]; columns?: TableLayout['columns'] | null; columnsAt?: string | null }

export function useTableViews(table: string | null) {
  const q = useApi<Payload>(table ? `/table-layouts?table=${encodeURIComponent(table)}` : null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const failed = (title: string, e: unknown) => toast({ tone: 'critical', title, body: errorMessage(e, 'Try again in a moment.') });

  async function create(input: { name: string; scope: 'mine' | 'company'; isDefault: boolean; layout: TableLayout }): Promise<SavedView | null> {
    if (!table) return null;
    setBusy(true);
    try {
      const v = await api.post<SavedView>('/table-layouts', { table, ...input });
      q.reload();
      return v;
    } catch (e) { failed('View not saved.', e); return null; } finally { setBusy(false); }
  }
  async function update(id: string, patch: Partial<{ name: string; isDefault: boolean; layout: TableLayout }>): Promise<boolean> {
    setBusy(true);
    try { await api.patch(`/table-layouts/${encodeURIComponent(id)}`, patch); q.reload(); return true; }
    catch (e) { failed('View not changed.', e); return false; } finally { setBusy(false); }
  }
  async function remove(id: string): Promise<boolean> {
    setBusy(true);
    try { await api.del(`/table-layouts/${encodeURIComponent(id)}`); q.reload(); return true; }
    catch (e) { failed('View not deleted.', e); return false; } finally { setBusy(false); }
  }
  /** Keeps this person's column order and visibility with their account (functions/api/table-layouts/columns.ts), so the
   *  list opens the same way on any computer (chew, 13 Nov 2026). Gives back when the account kept it, or null. A failure
   *  is quiet: the browser keeps it, and the next change sends it again. */
  async function saveColumns(columns: TableLayout['columns']): Promise<string | null> {
    if (!table) return null;
    try { return (await api.put<{ at?: string }>('/table-layouts/columns', { table, columns })).at ?? null; }
    catch { return null; /* kept in this browser meanwhile */ }
  }
  return { data: q.data, loading: q.loading, error: q.error, busy, create, update, remove, saveColumns };
}
