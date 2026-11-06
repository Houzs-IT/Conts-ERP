/* A sales line with a remark is customized (owner, 5 Nov 2026): the goods are not interchangeable with the same SKU
   without that remark, or with another remark, so it never shares stock or another line's PO. Spaces and capitals
   are not a different product. */
export function customizedKey(remark: string | null | undefined): string {
  return (remark ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isCustomizedLine(remark: string | null | undefined): boolean {
  return customizedKey(remark) !== '';
}
