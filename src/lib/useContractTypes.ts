import { useMemo } from 'react';
import { useApi, type Query } from './useApi';
import { BUILT_IN_CONTRACT_TYPES, type ContractType } from './revenueModel';

export interface ContractTypesPayload { ready: boolean; mayEdit: boolean; data: ContractType[] }
const FALLBACK: ContractTypesPayload = { ready: false, mayEdit: false, data: [...BUILT_IN_CONTRACT_TYPES] };

/** The contract type list as the server holds it, hidden types too, with what the editing screen needs. */
export const useContractTypesPayload = (on = true): Query<ContractTypesPayload> => useApi<ContractTypesPayload>(on ? '/contract-types' : null, FALLBACK);

/** The contract types for labels and pickers. One read per page; the built-in list shows until it arrives, and when it cannot be read. */
export function useContractTypes(): readonly ContractType[] {
  const { data } = useContractTypesPayload();
  const list = data?.data ?? BUILT_IN_CONTRACT_TYPES;
  // Same list, same array: every fetch returns a new one, and screens reset their drafts when the list changes.
  const key = JSON.stringify(list);
  return useMemo(() => list, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
