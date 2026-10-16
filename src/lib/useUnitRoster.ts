import { useApi } from './useApi';

export interface RosterUnit {
  id: string; unitNumber: string; propertyName: string; ownerId?: string; ownerName?: string;
  /** The unit's code ("C13-13A"), its building's id, and its layout, for the unit picker. */
  unitCode?: string; propertyId?: string; bedrooms?: number; bathrooms?: number; layoutType?: string | null;
}

/** Every unit, for pickers. The ids are the real ones the API accepts. */
export function useUnitRoster(): RosterUnit[] {
  const { data } = useApi<{ data: RosterUnit[] }>('/units');
  return data?.data ?? [];
}
