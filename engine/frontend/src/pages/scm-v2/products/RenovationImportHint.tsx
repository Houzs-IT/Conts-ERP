/* What the Import SKUs window reads on the renovation SKU Master. The page's own
   Export writes exactly these headings (renovationSkuColumns exportLabel). */
export function RenovationImportHint() {
  return (
    <div className="space-y-2 text-[13px] text-ink-secondary">
      <p>
        Easiest way: press <strong>Export</strong> on this page, edit that file in Excel, save it and pick it here.
        CSV and Excel (.xlsx) both work, up to 500 SKUs per file.
      </p>
      <p>The first row must hold these headings:</p>
      <ul className="list-disc space-y-0.5 pl-5">
        <li><code>code</code>: the product code. A code already in the system is updated; a new code creates a SKU.</li>
        <li><code>name</code>: the description shown on quotes.</li>
        <li><code>category</code>: the group, e.g. Works, Built-in, Furniture, Lighting, Appliances, Soft furnishing, Service.</li>
        <li><code>sub_category</code>: the trade or sub-category, by its name or code.</li>
        <li><code>uom</code>: the unit, e.g. UNIT, SQFT, LOT.</li>
        <li><code>status</code>: Active or Inactive.</li>
      </ul>
      <p>
        A blank cell leaves that field as it is. A new SKU needs at least code, name and category.
        Other columns (main supplier, cost) are ignored. Nothing is saved until you confirm.
      </p>
    </div>
  );
}
