"""Build the in-house (The Conts) renovation SO data: Skyline Embassy quotations, KL 48 packages, and the projects.

Usage: build_data.py <quotation.xlsx> <owner-data.xlsx> <out.json> <lines-to-check.xlsx> <projects.xlsx>

Embassy: one SO per quotation sheet, with that sheet's own lines and prices. The sheet's printed TOTAL (RM) is the
contract; what its lines add up to above that is the document discount (the Dream Crafter rule).
KL 48: the Type A / Type B package lines from the PDFs, unpriced, plus one package-price line (also the Dream Crafter
rule). Owner Data holds no per-unit selling price, so the PDF package total is a PLACEHOLDER (pricePlaceholder: true):
the importer dry-runs these but refuses to write them.
Projects: one renovation project per Owner Data unit (EMBASSY, KL 48, and the Other tab's units with a real unit no).
Only owner name, layout and email are read from the Owner Data; no other column is copied."""
import sys, json, re
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

QX, OX, OUT, UNM, PRJ = sys.argv[1:6]


def s(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    t = re.sub(r'\s+', ' ', str(v).replace('\xa0', ' ')).strip()
    return t or None


def sen(rm):
    return int(round(float(rm) * 100))


def unit_key(u):
    return re.sub(r'[^A-Z0-9]', '', (u or '').upper())


# ---------- Owner Data ----------
owb = openpyxl.load_workbook(OX, data_only=True)
emb_owner, kl_owner, other_units, other_bad = {}, [], [], []
for r in list(owb['EMBASSY'].iter_rows(values_only=True))[1:]:
    if s(r[0]):
        emb_owner[s(r[0]).upper()] = {'layout': s(r[2]) or '', 'owner': s(r[3]) or '', 'email': ''}  # contact details stay out of the repo
for i, r in enumerate(owb['KL 48'].iter_rows(values_only=True), 1):
    if i > 1 and s(r[0]):
        kl_owner.append({'row': i, 'unit': s(r[0]).upper(), 'layout': s(r[2]) or '', 'owner': s(r[3]) or ''})
for i, r in enumerate(owb['Other'].iter_rows(values_only=True), 1):
    if i == 1 or not any(r):
        continue
    unit = r[1]
    if isinstance(unit, str) and re.match(r'^[A-Z0-9]+(-[A-Z0-9]+){1,2}$', unit.strip().upper()):
        other_units.append({'row': i, 'building': s(r[0]).upper(), 'unit': unit.strip().upper(), 'owner': s(r[2]) or '', 'email': ''})
    else:
        other_bad.append(('Other', s(r[0]), str(unit), s(r[2]), 'unit number is not a unit (Excel turned it into a date?)'))

# ---------- SKU rules (as the Dream Crafter import's rules, docs/so-import/build) ----------
lines_to_check = []


def sku(block, sub, item, desc):
    I = (item or '').upper()
    D = (desc or '').upper()
    if block == 'PAINTING':
        if sub == 'FEATURE WALL':
            if 'DINING' in I and 'LIGHT' in I:
                return 'PND-GEN-DINING', 'rule'
            if 'LIGHT' in I:
                return 'RN-ELECTRICAL', 'rule'
            return 'RN-FEATURE_WALL', 'rule'
        return ('RN-TEXTURED_PAINTING' if ('TEXTURE' in D or 'TEXUTRE' in D) else 'RN-PAINTING'), 'rule'
    if block == 'BUILD IN WARDROBE':
        return ('RN-STUDY_TABLE' if 'STUDY' in I else 'RN-WARDROBE'), 'rule'
    table = [
        (r'BEDFRAME JAGER', 'BED-HKA-1013-(Q)', 'exact'), (r'AKEMI.*MATTRESS', 'AKEMI GALLENT MATT (Q)', 'exact'),
        (r'TV CABINET', 'RN-TV_CABINET', 'rule'), (r'COFFEE TABLE', 'FUR-GEN-COFFEE', 'rule'),
        (r'SOFA 2\.5', 'SOF-GEN-PREMIUM-2.5S', 'rule'), (r'SIDE TABLE', 'FUR-GEN-SIDETABLE', 'rule'), (r'WARDROBE', 'RN-WARDROBE', 'rule'),
        (r'WORKING CHAIR', 'FUR-GEN-POUF' if 'POUF' in D else 'FUR-GEN-WORKCHAIR', 'rule'), (r'DINING CHAIR', 'FUR-GEN-CHAIR', 'rule'),
        (r'BLACKOUT CURTAIN', 'CUR-GEN-DOUBLE', 'rule'), (r'TV BRACKET', 'RN-ELECTRICAL', 'rule'), (r'FAN HOOK', 'RN-ELECTRICAL', 'rule'),
        (r'FAN WITH LIGHT', 'FAN-GEN-CEILING', 'rule'), (r'^SURFACE DOWNLIGHT', 'DLT-GEN-SURF8-CW', 'rule'),
        (r'SURFACE MONTED DOWNLIGHT', 'DLT-GEN-SURF', 'rule'), (r'EYEBALL', 'EYB-GEN-EYEBALL', 'rule'),
        (r'FLOORING PROTECTION', 'RN-PROTECTION', 'rule'), (r'PARTITION', 'RN-PARTITION', 'rule'), (r'DELIVERY', 'RN-DELIVERY', 'rule'),
        (r'POST RENO|DEEP CLEAN', 'RN-CLEANING', 'rule'), (r'PROJECT SUPERVISE', 'RN-PROJECT_MGMT', 'exact'),
        (r'PHOTOSHOOT', 'RN-PHOTOSHOOT', 'rule'), (r'LINENS|AIRBNB ITEM', 'RN-AIRBNB_SETUP', 'rule'),
        (r'DECORATION|STYLING', 'RN-STYLING', 'rule'), (r'TV 50', 'TV-HIS-50', 'rule'),
    ]
    for rx, code, how in table:
        if re.search(rx, I):
            return code, how
    return 'RN-PROJECT_MGMT', 'fallback'


# ---------- Embassy quotation sheets ----------
qwb = openpyxl.load_workbook(QX, data_only=True)
# The two sheets carry swapped unit labels (coordinator, 2 Nov 2026; building stacks: -03 Type C dual key, -08 Type A).
SWAP = {'C-35-03': 'C-39-08', 'C-39-08': 'C-35-03'}
orders, flags = [], []
for ws in qwb.worksheets:
    def g(r, c):
        return s(ws.cell(r, c).value)
    unit = (g(15, 10) or '').upper()
    if unit != ws.title.upper():
        flags.append(('EMBASSY', ws.title, f'sheet name and its Unit cell differ ({g(15, 10)})'))
    starts = [c for c in range(1, ws.max_column + 1) if g(18, c) == 'NO']
    sections, lines_sen, final = [], 0, None
    for b in starts:
        block = (g(19, b + 1) or '').replace('PAINITNG', 'PAINTING')
        sub = None
        for r in range(20, 39):
            item, desc, code, price, total, qty = g(r, b + 1), g(r, b + 3), g(r, b + 4), g(r, b + 6), g(r, b + 7), g(r, b + 9)
            if item is None and price is None and total is None:
                continue
            if price is None and total is None and qty is None:
                sub = item
                continue
            if sub is None:
                heading = block
            elif block == 'BUILD IN WARDROBE':
                heading = f'{block} - {sub.replace("MASTERBEDROOM", "MASTER BEDROOM")}'
            else:
                heading = sub
            c, how = sku(block, sub, item, desc)
            extra = [x for x in [desc, None if code is None else str(code)] if x and not str(x).lower().startswith('http')]
            text = ' - '.join([str(item)] + [str(x) for x in extra])[:300]
            q = qty if isinstance(qty, (int, float)) else 1
            p = price if isinstance(price, (int, float)) else 0
            net = total if isinstance(total, (int, float)) else 0
            line = {'kind': 'ITEM', 'itemCode': c, 'description': text, 'qty': q, 'unitPriceSen': sen(p), 'discountBp': 0, 'netSen': sen(net)}
            if how == 'fallback' or price is None:
                lines_to_check.append(('EMBASSY', unit, heading, text, q, p, net, c,
                                       'no catalog product for this item: the general project-management code is used, as the Dream Crafter import did'
                                       if how == 'fallback' else 'no price on the quotation: the line is kept at RM 0'))
            if sections and sections[-1]['heading'] == heading:
                sections[-1]['lines'].append(line)
            else:
                sections.append({'heading': heading, 'lines': [line]})
            lines_sen += sen(net)
        for c2 in range(b, b + 10):
            if g(39, c2) == 'TOTAL (RM)' and isinstance(g(39, c2 + 1), (int, float)):
                final = g(39, c2 + 1)
    sheet_unit = unit
    swapped = SWAP.get(unit)
    if swapped:
        unit = swapped
        flags.append(('EMBASSY', unit, f'built from the sheet labelled {sheet_unit}: the C-35-03 / C-39-08 sheets carry swapped unit labels '
                                       f'(coordinator, 2 Nov: the building stacks make -03 Type C dual key and -08 Type A, as the Owner Data says)'))
    od = emb_owner.get(unit)
    if not od:
        flags.append(('EMBASSY', unit, 'not on the EMBASSY tab of the Owner Data: not seeded'))
        continue
    qlay, olay = (g(16, 4) or '').upper(), od['layout'].upper()
    if qlay.split()[:2] != olay.split()[:2] and not swapped:
        flags.append(('EMBASSY', unit, f'layout differs: quotation sheet says {g(16, 4)}, Owner Data says {od["layout"]}; the SO follows the sheet'))
    if final is None:
        flags.append(('EMBASSY', unit, 'no TOTAL (RM) on the sheet: not seeded'))
        continue
    orders.append({'group': 'EMBASSY', 'key': f'EMBASSY {unit}', 'unit': unit, 'building': 'SKYLINE EMBASSY', 'owner': od['owner'],
                   'email': od['email'], 'layout': g(16, 4) or '', 'preparedBy': g(13, 10) or '',
                   'source': (f'the sheet labelled {sheet_unit} of FOR IT USE QUOTATIION EMBASSY.xlsx: the C-35-03 and C-39-08 sheet labels are swapped, this order is unit {unit}' if swapped else f'sheet {ws.title} of FOR IT USE QUOTATIION EMBASSY.xlsx'), 'payableSen': sen(final), 'linesSen': lines_sen,
                   'pricePlaceholder': False, 'sections': sections})

# ---------- KL 48 (package lines from the PDFs; no per-unit price in the Owner Data) ----------
def pkg(linens):
    z = {'unitPriceSen': 0, 'discountBp': 0, 'netSen': 0}
    return [
        {'heading': 'UNIT APPLIANCES', 'lines': [{'kind': 'ITEM', 'itemCode': 'CUR-MUJ-SINGLE', 'description': 'CURTAIN SINGLE LAYER MUJI - FULL', 'qty': 1, **z}]},
        {'heading': 'OTHERS APPLIANCES', 'lines': [
            {'kind': 'ITEM', 'itemCode': 'TV-HIS-50', 'description': 'HISENSE TELEVISION 50 INCH', 'qty': 1, **z},
            {'kind': 'ITEM', 'itemCode': 'WSH-MID-2IN1', 'description': 'MIDEA WASHING MACHINE & DRYER 2 IN 1', 'qty': 1, **z}]},
        {'heading': 'AIRBNB', 'lines': [
            {'kind': 'ITEM', 'itemCode': 'RN-AIRBNB_SETUP', 'description': 'AMENITIES', 'qty': 1, **z},
            {'kind': 'ITEM', 'itemCode': 'RN-AIRBNB_SETUP', 'description': 'LINENS SET', 'qty': linens, **z},
            {'kind': 'ITEM', 'itemCode': 'RN-STYLING', 'description': 'STYLING AND DECORATION', 'qty': 1, **z},
            {'kind': 'ITEM', 'itemCode': 'RN-PROJECT_MGMT', 'description': 'SET UP SOP AND PROJECT MANAGEMENT', 'qty': 1, **z},
            {'kind': 'ITEM', 'itemCode': 'RN-AIRBNB_SETUP', 'description': 'LABOUR AND INSTALLATION', 'qty': 1, **z}]},
    ]


PKG = {'A': (sen(13000), 2, 'KL 48 AMENITIES-TYPE A (1).pdf'), 'B': (sen(14200), 3, 'KL 48 AMENITIES-TYPE B.pdf')}
kl_not = []
for o in kl_owner:
    lay = re.sub(r'\s+', ' ', o['layout'].upper().replace('TPYE', 'TYPE')).strip()
    m = re.match(r'^TYPE ([AB])\b(.*)$', lay)
    if not m:
        kl_not.append(('KL48', 'KL 48', o['unit'], o['owner'], f'layout "{o["layout"]}" is not Type A or Type B'))
        continue
    t, extra = m.group(1), m.group(2).strip()
    secs = pkg(PKG[t][1])
    if extra == 'ADD FAN':
        secs[1]['lines'].append({'kind': 'ITEM', 'itemCode': 'FAN-GEN-CEILING', 'description': 'CEILING FAN (ADD FAN, per Owner Data)', 'qty': 1,
                                 'unitPriceSen': 0, 'discountBp': 0, 'netSen': 0})
        flags.append(('KL48', o['unit'], 'TYPE B ADD FAN: Type B lines plus a ceiling-fan line at RM 0; no file prices the fan'))
    elif extra:
        kl_not.append(('KL48', 'KL 48', o['unit'], o['owner'], f'unknown layout extra "{extra}"'))
        continue
    if o['layout'].strip().upper() != lay:
        flags.append(('KL48', o['unit'], f'layout written "{o["layout"].strip()}", read as Type {t}'))
    orders.append({'group': 'KL48', 'key': f'KL48 {o["unit"]}', 'unit': o['unit'], 'building': 'KL 48', 'owner': o['owner'], 'email': '',
                   'layout': f'TYPE {t}', 'type': t, 'preparedBy': '', 'source': PKG[t][2], 'payableSen': PKG[t][0], 'linesSen': 0,
                   'pricePlaceholder': True, 'sections': secs})

# ---------- projects: one per Owner Data unit ----------
projects = []
for o in orders:
    projects.append({'key': o['key'], 'group': o['group'], 'building': o['building'], 'unit': o['unit'], 'owner': o['owner'],
                     'email': o['email'], 'layout': o['layout']})
for o in other_units:
    projects.append({'key': f'OTHER {o["building"]} {o["unit"]}', 'group': 'OTHER', 'building': o['building'], 'unit': o['unit'],
                     'owner': o['owner'], 'email': o['email'], 'layout': ''})

json.dump({'note': 'Built 2 Nov 2026 from FOR IT USE QUOTATIION EMBASSY.xlsx, Copy of Owner Data.xlsx and the KL 48 package PDFs (see README).',
           'orders': orders, 'projects': projects}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# ---------- lists for the team ----------
HF, HB = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1F4E78')


def sheet(wb, title, head, rows, widths):
    ws = wb.create_sheet(title)
    ws.append(head)
    for c in ws[1]:
        c.font, c.fill, c.alignment = HF, HB, Alignment(wrap_text=True, vertical='top')
    for r in rows:
        ws.append(list(r))
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(65 + i)].width = w
    ws.freeze_panes = 'A2'


wb = openpyxl.Workbook()
wb.remove(wb.active)
sheet(wb, 'Lines to check', ['Group', 'Unit', 'Section', 'Line (as quoted)', 'Qty', 'Price RM', 'Amount RM', 'SKU used', 'Why'], lines_to_check,
      [10, 12, 22, 50, 6, 10, 11, 18, 70])
sheet(wb, 'Units not seeded', ['Group', 'Building', 'Unit', 'Owner', 'Why'], kl_not + other_bad, [10, 18, 22, 30, 60])
sheet(wb, 'Flags', ['Group', 'Unit', 'Note'], flags, [10, 12, 100])
wb.save(UNM)
wb = openpyxl.Workbook()
wb.remove(wb.active)
sheet(wb, 'Projects', ['Group', 'Building', 'Unit', 'Owner (Owner Data)', 'Layout', 'Still to fill'],
      [(p['group'], p['building'], p['unit'], p['owner'], p['layout'], 'address, postcode, city, built-up area, phone') for p in projects],
      [10, 18, 12, 36, 18, 50])
wb.save(PRJ)

for o in orders:
    print(o['group'], o['unit'], '|', o['owner'], '| lines', o['linesSen'] / 100, '| payable', o['payableSen'] / 100,
          '| n', sum(len(x['lines']) for x in o['sections']))
print('orders: EMBASSY', sum(o['group'] == 'EMBASSY' for o in orders), 'KL48 A', sum(o.get('type') == 'A' for o in orders),
      'KL48 B', sum(o.get('type') == 'B' for o in orders), '| projects', len(projects), '| lines to check', len(lines_to_check))
print('not seeded', kl_not + other_bad)
print('flags', flags)
