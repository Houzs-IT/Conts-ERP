import { useApi } from './useApi';

export type Employment = 'internal' | 'outsourced';

export interface Cleaner {
  id: string;
  name: string;
  employmentType: Employment;
  vendorName: string | null;
  phone: string | null;
  userId: string | null;
  isActive: boolean;
  busy: number;
}

/** Dev sample roster so the assign picker and roster page render before the API is
 *  live. Two internal staff, one outsourced crew — the two employment dimensions. */
export const CLEANER_FALLBACK: { data: Cleaner[] } = {
  data: [
    { id: 'cl-u5', name: 'Nurul Huda', employmentType: 'internal', vendorName: null, phone: '+60 12-345 6705', userId: 'u5', isActive: true, busy: 2 },
    { id: 'cl-u6', name: 'Faridah Ismail', employmentType: 'internal', vendorName: null, phone: '+60 12-345 6706', userId: 'u6', isActive: true, busy: 1 },
    { id: 'cl-out1', name: 'Siti Rahmah', employmentType: 'outsourced', vendorName: 'SparkleClean Services', phone: '+60 19-882 4410', userId: null, isActive: true, busy: 1 },
    { id: 'cl-out2', name: 'BrightNest Crew', employmentType: 'outsourced', vendorName: 'BrightNest Sdn Bhd', phone: '+60 11-2200 7788', userId: null, isActive: false, busy: 0 },
  ],
};

/** The cleaner roster. `activeOnly` (default) is what the assign pickers use; `date` counts each cleaner's open jobs
 *  on that day instead of today. */
export function useCleaners(activeOnly = true, date?: string): { cleaners: Cleaner[]; ready: boolean; loading: boolean; error: string | null; reload: () => void } {
  const q = new URLSearchParams({ ...(activeOnly && { active: '1' }), ...(date && { date }) }).toString();
  const { data, loading, error, reload } = useApi<{ data: Cleaner[] }>(
    `/housekeeping/cleaners${q ? `?${q}` : ''}`,
    activeOnly ? { data: CLEANER_FALLBACK.data.filter(c => c.isActive) } : CLEANER_FALLBACK,
  );
  return { cleaners: data?.data ?? [], ready: data != null, loading, error, reload };
}
