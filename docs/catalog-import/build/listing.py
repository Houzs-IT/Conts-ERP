"""SKU listing for the owner from build/listing.mjs output.   python -I listing.py <in.json> <out.xlsx> <source label>"""
import sys, json, openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
rows = json.load(open(sys.argv[1], encoding='utf-8'))
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'SKUs'
head = ['SKU code', 'Name', 'Category', 'Sub-category', 'Unit', 'Unit (meaning)', 'Model', 'Size', 'Status', 'Main supplier',
        'Supplier item code', 'Cost (RM)', 'Price status']
ws.append(head)
for c in ws[1]: c.font = Font(bold=True); c.fill = PatternFill('solid', fgColor='DDE6F0')
for r in rows:
    cost = (r['unit_price_sen'] if r['unit_price_sen'] is not None else r['cost_price_sen']) or 0
    status = 'cost from supplier document' if cost > 0 else ('PRICE NEEDED' if r['supplier'] else 'no supplier (generic SKU)')
    ws.append([r['code'], r['name'], r['category'], r['sub_category'], r['uom'], r['unit'], r['base_model'], r['size_label'],
               r['status'].title(), r['supplier'], r['supplier_sku'], round(cost / 100, 2) if cost else None, status])
for col, w in zip('ABCDEFGHIJKLM', [30, 52, 14, 22, 7, 22, 16, 12, 9, 32, 22, 10, 26]): ws.column_dimensions[col].width = w
for row in ws.iter_rows(min_row=2, min_col=12, max_col=12):
    for c in row: c.number_format = '#,##0.00'
ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions
rm = wb.create_sheet('Read me', 0)
for line in [f'Every SKU in the engine catalog after migration 0132 (catalog fix of 21 Oct 2026): {len(rows)} SKUs.',
             f'Source: {sys.argv[3]}.',
             'Main supplier and Cost come from the SKU\'s main supplier link (Products > SKU Master shows the same).',
             'PRICE NEEDED: the supplier document has no price (DHI, LB, HOOKKA catalogues).']:
    rm.append([line])
rm.column_dimensions['A'].width = 120
wb.save(sys.argv[2]); print(len(rows), 'rows')
