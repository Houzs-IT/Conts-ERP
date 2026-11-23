/* A project picker that searches the server (audit 20 Nov 2026).
 *
 * The Sales entry and New Delivery Job pickers read `/api/projects?per_page=200` once and filtered that in the
 * browser, so a project older than the newest 200 could not be picked at all. They now send what is typed as
 * `search` (the list's own search: name, code, venue, organizer, brand, PIC) and show the matching page. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export const PROJECT_SEARCH_PAGE = 30;

export function projectSearchUrl(term: string): string {
  const t = term.trim();
  return `/api/projects?per_page=${PROJECT_SEARCH_PAGE}${t ? `&search=${encodeURIComponent(t)}` : ""}`;
}

/** The projects matching `term` (the newest when blank), plus every project seen so far by id, so the chosen one keeps
 *  its label after the search moves away from it. */
export function useProjectSearch<T extends { id: number }>(term: string, enabled = true) {
  const [debounced, setDebounced] = useState(term.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const q = useQuery({
    queryKey: ["project-search", debounced],
    queryFn: ({ signal }) => api.get<{ data: T[] }>(projectSearchUrl(debounced), { signal }),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const seen = useRef(new Map<number, T>());
  for (const p of q.data?.data ?? []) seen.current.set(p.id, p);
  return {
    rows: q.data?.data ?? [],
    byId: (id: number | string | null | undefined): T | undefined => (id == null || id === "" ? undefined : seen.current.get(Number(id))),
    isLoading: q.isLoading,
    isError: q.isError,
    searching: term.trim() !== debounced || q.isFetching,
  };
}
