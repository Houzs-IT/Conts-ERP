import { useApi } from './useApi';

export interface RosterUnit {
  id: string; unitNumber: string; propertyName: string; ownerId?: string; ownerName?: string;
  /** The number the unit was imported with (A1201), kept for files that still name it that way; unitNumber is what is shown (A-12-01). */
  storedNumber?: string;
  /** The unit's code ("C13-13A"), its building's id, and its layout, for the unit picker. */
  unitCode?: string; propertyId?: string; bedrooms?: number; bathrooms?: number; layoutType?: string | null;
  /** 0125: rental, showroom or warehouse. Only rental units take reservations. */
  purpose?: string;
}

/** Every unit, for pickers. The ids are the real ones the API accepts. */
export function useUnitRoster(): RosterUnit[] {
  const { data } = useApi<{ data: RosterUnit[] }>('/units');
  return data?.data ?? [];
}
