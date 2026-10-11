import { useApi } from './useApi';

export interface RosterUnit {
  id: string; unitNumber: string; propertyName: string; propertyId?: string; ownerId?: string; ownerName?: string;
  bedrooms?: number | null; bathrooms?: number | null; readiness?: string;
}

/** Every unit, for pickers. The ids are the real ones the API accepts. */
export function useUnitRoster(): RosterUnit[] {
  const { data } = useApi<{ data: RosterUnit[] }>('/units');
  return data?.data ?? [];
}
