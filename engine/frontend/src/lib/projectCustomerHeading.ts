/** One heading per project on the order pickers and lists (owner, 24 Nov 2026). Without a project, lines group per
    customer, so lines of different customers never share a heading. */
export function projectCustomerHeading(project: string | null | undefined, customer: string | null | undefined): string {
  const p = project?.trim();
  const c = customer?.trim();
  if (p) return c ? `${p} - ${c}` : p;
  return c ? `No project - ${c}` : 'No project, no customer';
}

/** The hidden column a grid groups on, and the grouping that points at it. */
export const PROJECT_GROUP_KEY = 'projectGroup';
export const PROJECT_GROUP = { key: PROJECT_GROUP_KEY } as const;
