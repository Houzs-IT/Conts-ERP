export const DEFAULT_PER_PAGE = 50;
export const MAX_PER_PAGE = 200;

export function parsePageNumber(raw: string | undefined): number {
  const parsedPage = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
}

export function parsePerPage(
  raw: string | undefined,
  fallback: number = DEFAULT_PER_PAGE,
  max: number = MAX_PER_PAGE,
): number {
  const parsedPerPage = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsedPerPage) || parsedPerPage < 1) return fallback;
  return Math.min(parsedPerPage, max);
}
