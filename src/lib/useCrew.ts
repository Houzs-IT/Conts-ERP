import { useApi } from './useApi';

export interface CrewMember { id: string; name: string; busy: number }

/** The people work can be assigned to, with how many open jobs each holds today. */
export function useCrew(scope: 'housekeeping' | 'all' = 'housekeeping'): CrewMember[] {
  const { data } = useApi<{ data: CrewMember[] }>(`/housekeeping/crew?scope=${scope}`);
  return data?.data ?? [];
}
