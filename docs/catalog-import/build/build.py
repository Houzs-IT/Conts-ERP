"""Builds catalog rows from the parsed supplier documents -> rows.json (+ suppliers, subcats, uoms)."""
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')
HERE = sys.argv[1]
OUT = sys.argv[2]

F = {
 'UNI_PL': 'WORK/FLOORING/UNILOC/0022_UNILOC Price List_161026_Dealer.pdf',
 'UNI_4': 'WORK/FLOORING/UNILOC/UNILOC SPC 4MM PDF.pdf',
 'UNI_5': 'WORK/FLOORING/UNILOC/UNILOC SPC 5MM PDF.pdf',
 'UNI_6': 'WORK/FLOORING/UNILOC/UNILOC SPC 6MM PDF-compressed.pdf',
 'UNI_HB': 'WORK/FLOORING/UNILOC/UNILOC SPC HERRINGBONE PDF.pdf',
 'UNI_FW': 'WORK/FEATURE WALL/UNILOC FLUTED WALL PANEL PDF.pdf',
 'DHI_C': 'WORK/FLOORING/DHI/DHI_Catalogue V3.pdf',
 'DHI_A': 'WORK/FLOORING/DHI/DHI_SPC Floorboard Accessories Product Showcase.pdf',
 'LB_Q': 'BUILT IN/STONE/LB QUARTZ STONE & ARTIFICIAL CATALOG · SEP 2026.pdf',
 'LB_S': 'BUILT IN/STONE/LB SINTERED STONE CATALOG · SEP 2026.pdf',
 'HKA_C': "FURNITURE/HOOKA '/HOOKA.pdf",
 'HKA_2990': "FURNITURE/HOOKA '/2990_sofa list.pdf",
 'LTW_1': 'LIGHTING/LOT WIN/CamScanner 02-10-2026 10.21.pdf',
 'LTW_2': 'LIGHTING/LOT WIN/CamScanner 02-10-2026 10.22.pdf',
 'W1_120': 'LIGHTING/WORLD ONE/SO_W037120.pdf',
 'W1_186': 'LIGHTING/WORLD ONE/SO_W037186.pdf',
 'KK_PL': 'WORK/PLASTER CEILING/K & K PRICE LIST.pdf',
 'KK_QT': 'WORK/QT26-13940 THE CONTS R2.pdf',
}

SUPPLIERS = {
 'UNILOC': dict(code='UNILOC', name='CRAFTED FLOORS SDN BHD', note='Brand UNILOC (SPC flooring, fluted wall panel). Reg 1544933-T.',
                registration_no='1544933-T', address1='Lot 1817 & 1818 Unit H, Jalan KPB 1, Off Jalan Balakong',
                address2='Bukit Belimbing, 43000 Seri Kembangan, Selangor', phone='+6011 5550 9968',
                email='craftedfloors9968@gmail.com', src=F['UNI_PL']),
 'DHI': dict(code='DHI', name='DHI FLOOR', note='Brand DHI FLOOR (SPC flooring + accessories). Catalogue gives no company details or prices.', src=F['DHI_C']),
 'LB': dict(code='LITTLEBUILDER', name='LITTLE BUILDER CONSTRUCTION SUPPLIES (M) SDN BHD', note='Brand LB. Quartz, sintered, artificial stone slabs. Semenyih, Selangor.', src=F['LB_Q']),
 'HOOKKA': dict(code='HOOKKA', name='HOOKKA INDUSTRIES SDN BHD', note='Sofa, bedframe, accessory. Reg 202501060540 (1661946-X).',
                registration_no='202501060540 (1661946-X)', tin_number='C60515534080',
                address1='2775F, Jalan Industri 12, Kampung Baru Sungai Buloh', address2='47000 Sungai Buloh, Selangor',
                phone='+6011-6133 3173', email='hookka.industries@gmail.com', src=F['HKA_C']),
 'LOTWIN': dict(code='LOTWIN', name='LOT WIN LED LIGHTINGS (PUCHONG) SDN BHD', note='LED lighting. From two scanned invoices.',
                address1='No. 15G, Jalan Bandar 3, Pusat Bandar Puchong', address2='47100 Puchong, Selangor', phone='03-5885 4939',
                email='lotwinledlightingspuchong@gmail.com', src=F['LTW_1']),
 'WORLDONE': dict(code='WORLDONE', name='WORLD ONE LIGHTING SDN BHD', note='Ceiling fans. Reg 1320015-W.', registration_no='1320015-W',
                address1='No.58 & 60 & 62 & 62A, Jalan Jalil 1, The Earth Bukit Jalil', address2='Lebuhraya Puchong-Sungai Besi, 57000 Kuala Lumpur',
                phone='+6016-267 8025', email='worldonelighting@gmail.com', src=F['W1_120']),
 'KK': dict(code='KKGYPSUM', name='K & K GYPSUM MARKETING SDN BHD', note='Plaster ceiling / partition / door / glass / masonry materials. Also the supplier of quotation QT26-13940.',
                registration_no='201501009762 (1135097-P)', tin_number='C23880678020', address1='21-1, Jalan PJS 3/34, Taman Sri Manja',
                address2='46000 Petaling Jaya, Selangor', phone='018-220 0687', email='kkgypsum@gmail.com', src=F['KK_PL']),
}

# sub-categories the import needs that the engine does not seed (group, code, label)
NEW_SUBS = [('LIGHTING', 'TRACK_LIGHT', 'Track light')]
# units the engine does not seed (code, label, print_label, measure)
NEW_UOMS = [('BOX', 'Box / carton', 'BOX', False), ('BAG', 'Bag', 'BAG', False), ('ROLL', 'Roll', 'ROLL', False)]
EXISTING_UOMS = {'PCS', 'UNIT', 'SET', 'LOT', 'FT', 'SQFT', 'POINT', 'FULL'}

rows = []
def add(**k):
    base = dict(category='', sub_category='', supplier='', supplier_item_code='', sku='', name='', spec='', uom='',
                doc_unit='', cost=None, sell=None, price_src='', price_type='', price_date='', item_src='',
                confidence='high', notes='', importable=True, exclude_reason='')
    base.update(k)
    rows.append(base)

def src(key, page):
    return f"{F[key]} p{page}"

# ---------------------------------------------------------------- UNILOC price list (Crafted Floors, 15 Oct 2026)
PL = 'UNI_PL'; PLD = '2026-10-15'
spc_price = {  # catalog family -> (price per sqft, ctn price, PL row, PL size, PL pack)
 '4': (2.80, 81.20, 'SPC 4.0mm', '4mm x 182mm x 1220mm', '12pcs or 29sf'),
 '5': (3.00, 72.00, 'SPC 5.0mm', '5mm x 182mm x 1220mm', '10pcs or 24sf'),
 '6': (3.70, 71.04, 'SPC 6.0mm', '6mm x 182mm x 1220mm', '8pcs or 19.2sf'),
 'HB': (3.70, 52.17, '5mm SPC Herringbone (Mizor Series)', '5mm x 128mm x 640mm', '16pcs or 14.1sf'),
}
def uni_family(key, fam, codes, spec, pack):
    p = spc_price[fam]
    for code, page in codes:
        c = code.replace(' ', '')
        tag = {'4': 'SPC4', '5': 'SPC5', '6': 'SPC6', 'HB': 'HB'}[fam]
        conf, note = 'high', f"Cost = price-list line '{p[2]}' RM{p[0]:.2f}/sqft (RM{p[1]:.2f}/carton of {p[4]}); same price for every colour."
        if fam == 'HB':
            conf = 'medium'
            note += ' Catalogue says 610x125x4.5mm, 16pcs/13.2sqft; price list says 5mm x 128 x 640mm, 16pcs/14.1sqft - confirm it is the same product.'
        add(category='WORKS', sub_category='FLOORING', supplier='UNILOC', supplier_item_code=code,
            sku=f"FLR-UNI-{tag}-{c}", name=f"UNILOC SPC flooring {('herringbone' if fam=='HB' else fam+'mm')} {code}",
            spec=f"{spec}; {pack}", uom='SQFT', doc_unit='RM/sqft (carton sold)', cost=p[0],
            price_src=src(PL, 1), price_type='dealer price list', price_date=PLD, item_src=src(key, page),
            confidence=conf, notes=note)

uni_family('UNI_4', '4', [('SD 40119', 3), ('SD 40218', 4), ('SD 40331', 5), ('SD 40433', 6), ('SD 40522', 7), ('SD 40649', 8), ('SD 40712', 9), ('SD 40817', 10)],
           '4mm, wear layer 0.3mm, 1220 x 182mm', '12pcs or 29sqft/box')
uni_family('UNI_5', '5', [('SE 50168', 3), ('SE 50241', 4), ('SE 50316', 5), ('SE 50449', 6), ('SE 50526', 7), ('SE 50637', 8), ('SE 50716', 9), ('SE 50824', 10)],
           '5mm, wear layer 0.3mm, 1220 x 182mm', '10pcs or 24sqft/box')
uni_family('UNI_6', '6', [('SF-60156', 4), ('SF-60388', 5), ('SF-60227', 6), ('SF-60425', 7), ('SF-60510', 8), ('SF-60686', 9), ('SF-60789', 10), ('SF-60885', 11)],
           '6mm, wear layer 0.3mm, 1220 x 182mm, double UV coating', '8pcs or 19.2sqft/box')
uni_family('UNI_HB', 'HB', [('HB 45191', 3), ('HB 45222', 4), ('HB 45361', 5), ('HB 45437', 6)],
           '4.5mm, wear layer 0.3mm, 610 x 125mm herringbone', '16pcs or 13.2sqft/box')

# price-list-only flooring lines (no colour codes given)
for sku, name, spec, uom, cost, note in [
 ('FLR-UNI-KV3-PLANK', 'Korea 3mm vinyl - plank', '3mm x 228.6mm x 1219.2mm; 13pcs or 39sf/box; RM97.50/carton', 'SQFT', 2.50, ''),
 ('FLR-UNI-KV3-MAXISQ', 'Korea 3mm vinyl - Maxi Square series', '3mm x 470mm x 470mm; 15pcs or 35.7sf/box; RM89.25/carton', 'SQFT', 2.50, ''),
 ('FLR-UNI-LVT5-WOOD', '5mm luxury vinyl click - Renzor series (fiberglass) wood grain', '5mm x 182mm x 1220mm; 10pcs or 24sf/box; RM91.20/carton', 'SQFT', 3.80, ''),
 ('FLR-UNI-LVT5-MICRO', '5mm luxury vinyl click - Renzor series (fiberglass) microcement', '5mm x 450mm x 914mm; 6pcs or 26.6sf/box; RM111.72/carton', 'SQFT', 4.20, ''),
 ('FLR-UNI-NOSING5', 'ORI SPC stair nosing 5mm', '25mm x 115mm x 1504mm; 4pcs/box', 'PCS', 39.00, 'Price column is RM/FT2 on the list but the item is a nosing with no carton price - assumed RM39.00 per piece; confirm.'),
 ('FLR-UNI-NOSING6', 'ORI SPC stair nosing 6mm', '25mm x 115mm x 1504mm; 4pcs/box', 'PCS', 42.00, 'Price column is RM/FT2 on the list but the item is a nosing with no carton price - assumed RM42.00 per piece; confirm.'),
 ('FLR-UNI-SFW8', 'SFW 8mm plank (mineral fiber)', '8mm x 194mm x 1208mm; 8pcs or 20.2sf/box; RM157.56/carton', 'SQFT', 7.80, ''),
]:
    add(category='WORKS', sub_category='FLOORING', supplier='UNILOC', sku=sku, name='UNILOC ' + name, spec=spec, uom=uom,
        doc_unit='RM/FT2' if uom == 'SQFT' else 'RM/FT2 column (per piece?)', cost=cost, price_src=src(PL, 1), price_type='dealer price list',
        price_date=PLD, item_src=src(PL, 1), confidence='medium' if 'NOSING' in sku else 'high', notes=note or 'No colour codes on the price list; colour chosen when ordering.')

PVC_COLOURS = 'DARK WALNUT, PEARL, BEIGE, LATTE, MAPLE, GREY, TEAK, PURE WHITE, PURE BLACK'
for sku, name, size, pack, cost in [
 ('FLR-UNI-SKT70', 'PVC skirting 70mm', '2.4m / 8ft', '30pcs/box', 8.00),
 ('FLR-UNI-SKT100', 'PVC skirting 100mm', '2.4m / 8ft', '20pcs/box', 10.00),
 ('FLR-UNI-SMALL-L', 'PVC Small L profile', '2.7m / 9ft', '150pcs/box', 6.50),
 ('FLR-UNI-T-PROF', 'PVC T profile', '2.7m / 9ft', '80pcs/box', 6.50),
 ('FLR-UNI-REDUCER-A', 'PVC Reducer A', '2.7m / 9ft', '50pcs/box', 7.50),
 ('FLR-UNI-MEDIUM-L', 'PVC Medium L profile', '2.7m / 9ft', '50pcs/box', 7.50),
 ('FLR-UNI-8MM-A', 'PVC 8mm-A (with base)', '2.7m / 9ft', '30pcs/box', 15.00),
 ('FLR-UNI-8MM-T', 'PVC 8mm-T (with base)', '2.7m / 9ft', '30pcs/box', 14.00),
 ('FLR-UNI-8MM-END', 'PVC 8mm-End (with base)', '2.7m / 9ft', '30pcs/box', 14.00),
 ('FLR-UNI-12MM-A', 'PVC 12mm-A (with base)', '2.7m / 9ft', '30pcs/box', 17.00),
 ('FLR-UNI-12MM-T', 'PVC 12mm-T (with base)', '2.7m / 9ft', '30pcs/box', 16.00),
 ('FLR-UNI-12MM-END', 'PVC 12mm-End (with base)', '2.7m / 9ft', '30pcs/box', 16.00),
 ('FLR-UNI-BEADING', 'PVC beading', '2.7m / 9ft', '100pcs/box', 7.50),
 ('FLR-UNI-FLUSH-END', 'PVC SPC flush ending', '2.7m / 9ft', '100pcs/box', 7.50),
]:
    col = 'colours follow SPC 5mm & 6mm colour codes' if 'FLUSH' in sku else f'colours: {PVC_COLOURS}'
    add(category='WORKS', sub_category='FLOORING', supplier='UNILOC', sku=sku, name='UNILOC ' + name,
        spec=f"PVC 100% virgin; {size}; {pack}; {col}", uom='PCS', doc_unit='RM/Unit', cost=cost, price_src=src(PL, 1),
        price_type='dealer price list', price_date=PLD, item_src=src(PL, 1),
        notes='One SKU for all colours (same price); colour noted on the order. The colour list is printed once beside the skirting rows - which profiles it covers is assumed.' if 'FLUSH' not in sku else 'One SKU for all colours (same price).')

for base, name, pack, silver, other, other_lbl in [
 ('DOORBAR3', '3.0mm door bar (J)', '100pcs/box', 14.50, 15.50, 'CHAMPAGNE / LIGHT GOLD / BLACK'),
 ('ENDTRIM3', '3.0mm end trim (C)', '100pcs/box', 13.50, 14.50, 'CHAMPAGNE / LIGHT GOLD / BLACK'),
 ('DOORBAR5', '5.0mm door bar (J)', '100pcs/box', 15.00, 16.00, 'CHAMPAGNE / LIGHT GOLD / BLACK'),
 ('ENDTRIM5', '5.0mm end trim (C)', '100pcs/box', 14.00, 15.00, 'CHAMPAGNE / LIGHT GOLD / BLACK'),
 ('DOORBAR6', '6.0mm door bar (J)', '100pcs/box', 15.50, 16.50, 'CHAMPAGNE / LIGHT GOLD / BLACK'),
 ('ENDTRIM6', '6.0mm end trim (C)', '100pcs/box', 14.50, 15.50, 'CHAMPAGNE / LIGHT GOLD / BLACK'),
 ('ALU-L', 'aluminium L profile', '50pcs/box', 14.50, 15.50, 'CHAMPAGNE / LIGHT GOLD / BLACK'),
 ('ALU-T', 'aluminium T profile', '50pcs/box', 14.00, 15.00, 'CHAMPAGNE / LIGHT GOLD / BLACK'),
 ('STAIRNOSE', 'aluminium stair nosing (with rubber)', '50pcs/box', 29.50, 31.50, 'BLACK'),
]:
    for suf, lbl, cost in [('SV', 'SILVER', silver), ('CLB' if other_lbl != 'BLACK' else 'BK', other_lbl, other)]:
        add(category='WORKS', sub_category='FLOORING', supplier='UNILOC', sku=f"FLR-UNI-{base}-{suf}", name=f"UNILOC {name} - {lbl.lower()}",
            spec=f"Aluminium; 2.7m / 9ft; {pack}; colour {lbl}", uom='PCS', doc_unit='RM/Unit', cost=cost, price_src=src(PL, 1),
            price_type='dealer price list', price_date=PLD, item_src=src(PL, 1),
            notes='Champagne, light gold and black share one price, so they share one SKU; colour noted on the order.' if suf == 'CLB' else '')

for i, (nm, cons, yarn, size, oz, cost) in enumerate([
 ('Venus SQ', 'Level Loop', '100% PP / PE-Bac', '50cm x 50cm', 20, 1.70), ('Earth SQ', 'Graphic Level Loop', '100% PP / PE-Bac', '50cm x 50cm', 20, 2.10),
 ('Mars SQ', 'Multi-level Textured Loop', '100% PP / PE-Bac', '50cm x 50cm', 24, 2.60), ('Jupiter Plank', 'Multi-level Textured Loop', '100% PP / PVC-Bac', '25cm x 100cm', 25, 3.60),
 ('Uranus SQ', 'Multi-level Textured Loop', '100% PP / PVC Bac', '50cm x 50cm', 26, 3.90), ('Saturn SQ', 'Multi-level Textured Loop', '100% PP / PVC Bac', '50cm x 50cm', 26, 4.00),
 ('Neptune Plank', 'Multi-level Textured Loop', '100% PP / PVC Bac', '25cm x 100cm', 26, 4.20), ('Pluto SQ', 'Multi-level Textured Loop', '100% Nylon / PVC Bac', '50cm x 50cm', 26, 5.20)]):
    add(category='SOFT', sub_category='CARPET', supplier='UNILOC', sku='CPT-UNI-' + nm.upper().replace(' ', '-'), name=f"UNILOC carpet tile {nm}",
        spec=f"{cons}; {yarn}; {size}; {oz} oz/yd2; 20pcs or 54sf/box; RM{cost*54:.2f}/carton", uom='SQFT', doc_unit='RM/FT2',
        cost=cost, price_src=src(PL, 2), price_type='dealer price list', price_date=PLD, item_src=src(PL, 2),
        notes='Filed under Soft furnishing > Carpet (existing sub-category); could be Works > Flooring instead - owner to choose.')
for mm, cons, yarn, roll, cut in [('12', 'PP+SBR Latex', 'Fibril PP', 1.80, 2.00), ('25', 'PP+Net+SBR Latex', 'C-Shape Monofil PE+Curled PP', 2.80, 3.00), ('35', 'PP+Net+SBR Latex', 'Spine-Shape Monofil PE+Curled PP', 3.50, 3.70)]:
    add(category='SOFT', sub_category='CARPET', supplier='UNILOC', sku=f"CPT-UNI-GRASS{mm}", name=f"UNILOC grass carpet {mm}mm",
        spec=f"{cons}; {yarn}; roll 2m x 25m; cut price RM{cut:.2f}/sqft", uom='SQFT', doc_unit='RM/FT2 (roll / cut)', cost=roll,
        price_src=src(PL, 2), price_type='dealer price list', price_date=PLD, item_src=src(PL, 2),
        notes=f'Cost is the full-roll price; cut length costs RM{cut:.2f}/sqft.')

# fluted wall panels: catalogue colour codes x price-list series price
fw = [('HSW', range(1, 9), 'High Square', 'Wood', '23.5mm x 168mm x 2900mm', 18.90, 189.00, 2),
      ('LSS', range(20, 23), 'Low Square', 'Wood & Marble', '12mm x 197.4mm x 2900mm', 22.00, 220.00, 3),
      ('LSW', range(23, 26), 'Low Square', 'Wood & Marble', '12mm x 197.4mm x 2900mm', 22.00, 220.00, 3),
      ('BWM', range(9, 12), 'Big Wave', 'Metal & Fabric', '14mm x 202.5mm x 2900mm', 28.00, 280.00, 4),
      ('BWF', range(12, 14), 'Big Wave', 'Metal & Fabric', '14mm x 202.5mm x 2900mm', 28.00, 280.00, 4),
      ('SWL', range(14, 17), 'Small Wave', 'Leather & Star', '12mm x 197.4mm x 2900mm', 28.00, 280.00, 5),
      ('SWS', range(17, 20), 'Small Wave', 'Leather & Star', '12mm x 197.4mm x 2900mm', 28.00, 280.00, 5)]
for pre, rng, series, pattern, size, cost, ctn, page in fw:
    for n in rng:
        code = f"{pre}-{n:02d}"
        note = f"Cost = price-list '{series}' RM{cost:.2f}/piece (RM{ctn:.2f}/carton of 10)."
        conf = 'high'
        if series == 'Low Square':
            note += ' Price list says 11.5mm thick, catalogue 12mm.'
        if series == 'Small Wave':
            note += ' Price list says 12 x 204mm, catalogue 12 x 197.4mm - confirm.'; conf = 'medium'
        add(category='WORKS', sub_category='FEATURE_WALL', supplier='UNILOC', supplier_item_code=code, sku=f"FWL-UNI-{pre}{n:02d}",
            name=f"UNILOC fluted wall panel {series} {code}", spec=f"PVC; {size}; {pattern} pattern; 10pcs/box", uom='PCS', doc_unit='RM/UNIT',
            cost=cost, price_src=src(PL, 2), price_type='dealer price list', price_date=PLD, item_src=src('UNI_FW', page), confidence=conf, notes=note)
add(category='WORKS', sub_category='FEATURE_WALL', supplier='UNILOC', sku='FWL-UNI-PROFILE-L', name='UNILOC fluted wall panel "L" ending profile',
    spec='30mm x 30mm x 2900mm; matches panel colours; 50pcs/box', uom='PCS', doc_unit='RM/UNIT', cost=8.50, price_src=src(PL, 2), price_type='dealer price list',
    price_date=PLD, item_src=src('UNI_FW', 6), notes='All colours one SKU; colour noted on the order. RM425.00/carton.')
add(category='WORKS', sub_category='FEATURE_WALL', supplier='UNILOC', sku='FWL-UNI-JOINT-SS', name='UNILOC fluted wall panel joint (stainless steel)',
    spec='100pcs/box', uom='PCS', doc_unit='RM/UNIT', cost=40.00, price_src=src(PL, 2), price_type='dealer price list', price_date=PLD, item_src=src(PL, 2),
    confidence='medium', notes='RM40.00 for a joint looks high per piece - may be per box of 100; confirm with Crafted Floors.')

for sku, name, spec, uom, cost, extra in [
 ('FLR-UNI-GLUE-W250-5', 'Korea vinyl glue W-250G 5kg', 'Acrylic water-base adhesive; covers 250sf', 'UNIT', 60.00, ''),
 ('FLR-UNI-GLUE-W250-10', 'Korea vinyl glue W-250G 10kg', 'Acrylic water-base adhesive; covers 550sf', 'UNIT', 110.00, ''),
 ('FLR-UNI-GLUE-W250-20', 'Korea vinyl glue W-250G 20kg', 'Acrylic water-base adhesive; covers 1200sf', 'UNIT', 210.00, ''),
 ('FLR-UNI-MAPEI-PLANIPREP', 'MAPEI Planiprep SC 4.5kg', 'Cement skimcoating compound', 'UNIT', 75.00, ''),
 ('FLR-UNI-MAPEI-NOVOPLAN21', 'MAPEI Novoplan 21 25kg', 'Self-levelling compound; 50sf', 'BAG', 46.00, ''),
 ('FLR-UNI-MAPEI-PRIMERG-5', 'MAPEI Primer G 5kg', 'Self-levelling floor bonding; 300sf', 'UNIT', 70.00, ''),
 ('FLR-UNI-MAPEI-PRIMERG-25', 'MAPEI Primer G 25kg', 'Self-levelling floor bonding; 1500sf', 'UNIT', 270.00, ''),
 ('FLR-UNI-MAPEI-MRB100', 'MAPEI Planiseal MRB 100 20kg', 'Moisture barrier; 540sf', 'UNIT', 700.00, ''),
 ('FLR-UNI-MAPEI-ECOPRIM', 'MAPEI Eco Prim T Plus AP 20kg', 'Universal acrylic primer; 1080sf', 'UNIT', 900.00, ''),
 ('FLR-UNI-VT222', 'V-Tech VT-222 acrylic gap sealant 450g', 'All purpose gap sealant; 24pcs/carton; RM4.50 each by carton', 'PCS', 5.00, 'Loose price; carton price RM4.50/pc.'),
 ('FLR-UNI-VT224', 'V-Tech VT-224 Rainbow Seal colour sealant 450g', 'Colour acrylic sealant; 24pcs/carton; RM7.00 each by carton', 'PCS', 7.50, 'Loose price; carton price RM7.00/pc.'),
 ('FLR-UNI-VT230', 'V-Tech VT-230 Maxbond construction adhesive 350g', 'Vital Nails Bond; 24pcs/carton; RM7.00 each by carton', 'PCS', 7.50, 'Loose price; carton price RM7.00/pc.'),
 ('FLR-UNI-NAPLOCK', 'Naplock bar aluminium (silver)', '3.66m / 12ft', 'PCS', 16.50, ''),
 ('FLR-UNI-DONSON200', 'Donson 200 carpet glue 3kg', 'Covers 400sf', 'UNIT', 38.00, ''),
 ('FLR-UNI-DONSON2000', 'Donson 2000 carpet glue 3kg', 'Covers 400sf', 'UNIT', 40.00, ''),
 ('FLR-UNI-DONSON-CA', 'Donson CA glue (carpet) 3kg', '', 'UNIT', 50.00, ''),
 ('FLR-UNI-DONSON1898-4', 'Donson 1898 white glue 4kg', 'Covers 300sf', 'UNIT', 65.00, ''),
 ('FLR-UNI-DONSON1898-20', 'Donson 1898 white glue 20kg', 'Covers 1500sf', 'UNIT', 270.00, ''),
]:
    add(category='WORKS', sub_category='FLOORING', supplier='UNILOC', sku=sku, name=name, spec=spec, uom=uom, doc_unit='RM/Unit (loose)', cost=cost,
        price_src=src(PL, 2), price_type='dealer price list', price_date=PLD, item_src=src(PL, 2), confidence='medium',
        notes=('Installation material, not a finished item - owner to confirm it belongs in the catalog. ' + extra).strip())

for sku, name, size, sf, cost in [
 ('FLR-UNI-PE1-50', 'PE foam underlay 1.0mm', '1m x 50m', '538.2sf', 33.00), ('FLR-UNI-PE1-100', 'PE foam underlay 1.0mm', '1m x 100m', '1076.4sf', 45.00),
 ('FLR-UNI-PE1-300', 'PE foam underlay 1.0mm', '1m x 300m', '3229.2sf', 125.00), ('FLR-UNI-PE2-50', 'PE foam underlay 2.0mm', '1m x 50m', '538.2sf', 45.00),
 ('FLR-UNI-PE2-150', 'PE foam underlay 2.0mm', '1m x 150m', '1614.6sf', 125.00), ('FLR-UNI-LAMIPE1-100', 'LAMI PE foam underlay 1.0mm', '1m x 100m', '1076.4sf', 95.00),
 ('FLR-UNI-LAMIPE1-300', 'LAMI PE foam underlay 1.0mm', '1m x 300m', '3229.2sf', 220.00), ('FLR-UNI-EVA1', 'EVA foam rubber underlay 1.0mm', '1.2m x 46.45m', '600sf', 69.00),
 ('FLR-UNI-EVA2', 'EVA foam rubber underlay 2.0mm', '1.2m x 15.5m', '200.2sf', 36.00), ('FLR-UNI-PROTECT1', 'UNILOC OPP floor protection mat 1mm', '1.2m x 12m', '150sf', 28.00),
 ('FLR-UNI-PROTECT2', 'UNILOC OPP floor protection mat 2mm', '1.2m x 12m', '150sf', 39.00), ('FLR-UNI-PROTECT3', 'UNILOC OPP floor protection mat 3mm', '1.2m x 12m', '150sf', 52.00),
 ('FLR-UNI-PLASTIC012', 'Plastic sheet underlay 0.12mm (double layer)', '1m x 91m', '1959sf', 138.00)]:
    sub = 'PROTECTION' if 'PROTECT' in sku else 'FLOORING'
    add(category='WORKS', sub_category=sub, supplier='UNILOC', sku=sku, name=name, spec=f"Roll {size} ({sf}/roll)", uom='ROLL', doc_unit='RM/Unit per roll (loose)',
        cost=cost, price_src=src(PL, 3), price_type='dealer price list', price_date=PLD, item_src=src(PL, 3), confidence='medium',
        notes='Installation / protection material - owner to confirm it belongs in the catalog. Needs new unit ROLL.')
for code, size, pack, cost in [('CR2010', '20mm x 10mm x 2420mm', '176 pcs', 8.00), ('CR3015', '30mm x 15mm x 2420mm', '84 pcs', 9.50), ('CR4020', '40mm x 20mm x 2420mm', '50 pcs', 14.00),
                               ('CR6023', '60mm x 23mm x 2420mm', '30 pcs', 23.50), ('CR8025', '80mm x 25mm x 2420mm', '20 pcs', 33.00), ('CO2515', '25mm x 15mm x 2420mm', '102 pcs', 9.00),
                               ('CO3015', '30mm x 15mm x 2420mm', '84 pcs', 9.50), ('CO4020', '40mm x 20mm x 2420mm', '48 pcs', 14.00), ('PLAIN 3012', '30mm x 12mm x 2420mm', '74 pcs', 9.50),
                               ('PLAIN 4012', '40mm x 12mm x 2420mm', '56 pcs', 13.50)]:
    add(category='WORKS', sub_category='FEATURE_WALL', supplier='UNILOC', supplier_item_code=code, sku='FWL-UNI-WAIN-' + code.replace(' ', ''),
        name=f"Wainscoting PS moulding {code}", spec=f"{size}; {pack}/box", uom='PCS', doc_unit='RM/Unit', cost=cost, price_src=src(PL, 3),
        price_type='dealer price list', price_date=PLD, item_src=src(PL, 3), notes='Wainscoting filed under Works > Feature wall.')

# ---------------------------------------------------------------- DHI (catalogue only, no prices)
dhi_specs = {
 'PREMIUM': ('Premium series 6mm', '6mm, wear layer 0.5mm, 184 x 1220mm, 1.0mm IXPE pad; 24.2sqft (10pcs)/ctn'),
 'ROYAL': ('Royal series 8.5mm', '8.5mm, wear layer 0.5mm, 184 x 1220mm, 1.5mm IXPE pad; 17sqft (7pcs)/ctn'),
 'TERRAZZO': ('Terrazzo series 8.5mm', '8.5mm, wear layer 0.5mm, 184 x 1220mm, 1.5mm IXPE pad; 17sqft (7pcs)/ctn'),
 'SANDSTONE': ('Sandstone series 8.5mm', '8.5mm, wear layer 0.5mm, 184 x 1220mm, 1.5mm IXPE pad, double UV; 17sqft (7pcs)/ctn'),
 'STONE6': ('Stone series 6mm', '6mm, wear layer 0.5mm, 184 x 1220mm, 1.0mm IXPE pad; 24.2sqft (10pcs)/ctn'),
 'STONE5': ('Stone series 5mm', '5mm, wear layer 0.3mm, 610 x 305mm; 20sqft (10pcs)/ctn'),
}
dhi = [('PREMIUM', 5, '0191', 'LIGHT WALNUT'), ('PREMIUM', 5, '2217', 'IVORY MAPLE'), ('PREMIUM', 5, '0335', 'CHESNUT OAK'), ('PREMIUM', 5, '2885', 'FRENCH OAK'),
       ('PREMIUM', 5, '2882', 'BELDIUM OAK'), ('PREMIUM', 5, '2213', 'PEARL OAK'), ('PREMIUM', 6, '3185', 'EXPRESSO BROWN'), ('PREMIUM', 6, '4106', 'ITALIAN CARAMEL'),
       ('PREMIUM', 6, '2232', 'ENGLISH MOONLIGHT'), ('PREMIUM', 6, '2883', 'ALPHINE OAK'), ('PREMIUM', 6, '0333', 'ROYAL MERBAU'),
       ('ROYAL', 8, '8501', 'ROYAL TEAK'), ('ROYAL', 8, '8502', 'IVORY TEAK'), ('ROYAL', 8, '8503', 'NORDIC BROWN'), ('ROYAL', 8, '8504', 'SILVER GREY'),
       ('TERRAZZO', 10, '8506T', 'CANDY STONE'), ('TERRAZZO', 10, '8507T', 'SANDY BEACH'), ('TERRAZZO', 10, '8508T', 'WHITE ORNAMENT'), ('TERRAZZO', 10, '8509T', 'ARTISTIC CANYON'),
       ('TERRAZZO', 10, '8510T', 'GOLDEN SUNSET'), ('SANDSTONE', 12, '8563', ''), ('SANDSTONE', 12, '8564', ''), ('SANDSTONE', 12, '8565', ''), ('SANDSTONE', 12, '8567', ''),
       ('STONE6', 14, '6002', 'RUSTIC GREY'), ('STONE6', 14, '6003', 'IVORY TRAVERTINE'), ('STONE5', 14, '511', 'LIME STONE'), ('STONE5', 14, '512', 'SLATE'),
       ('STONE5', 14, '513', 'CHROMITE'), ('STONE5', 14, '514', 'CONCRETE')]
for ser, page, code, colour in dhi:
    label, spec = dhi_specs[ser]
    add(category='WORKS', sub_category='FLOORING', supplier='DHI', supplier_item_code=f"DHI {code}", sku=f"FLR-DHI-{code}",
        name=f"DHI SPC flooring {label} DHI {code}" + (f" {colour.title()}" if colour else ''), spec=spec, uom='SQFT', item_src=src('DHI_C', page),
        notes='Price needed (catalogue has no prices).' + (' Catalogue prints no colour name for this code.' if not colour else ''))
for i, colour in enumerate(['PureWhite', 'AshWhite', 'Grey', 'Almond', 'Wood', 'Teak', 'Oak', 'Acacia', 'Walnut', 'DarkWalnut', 'MattBlack', 'DarkGrey', 'Beige', 'SiamTeak', 'TerraCotta']):
    for mm, pre, base_page, spec in [(70, 'S77', 2, '2200 x 15 x 70mm; 36pcs/box (24kg)'), (100, 'S10', 18, '2200 x 12 x 100mm; 20pcs/box (19kg)')]:
        code = f"{pre}{10+i}"
        add(category='WORKS', sub_category='FLOORING', supplier='DHI', supplier_item_code=code, sku=f"FLR-DHI-SKT{mm}-{code}",
            name=f"DHI skirting {mm}mm {code} {colour}", spec=spec, uom='PCS', item_src=src('DHI_A', base_page + i), notes='Price needed.')
for i, colour in enumerate(['AshWhite', 'Grey', 'Almond', 'Wood', 'Teak', 'Oak', 'Acacia', 'Walnut', 'DarkWalnut', 'MattBlack', 'DarkGrey', 'Beige', 'SiamTeak', 'TerraCotta']):
    for pre, start, lbl, spec in [('LLP', 3020, 'L large profile', '2700 x 30 x 20mm; 100pcs/box'), ('RP', 280, 'reducer', '2700 x 28 x 8mm; 70/100pcs/box'),
                                  ('TP', 250, 'transition', '2700 x 25 x 5.7mm; 100pcs/box'), ('MP', 200, 'L mini profile', '2700 x 23 x 3mm; 100pcs/box')]:
        code = f"{pre}{start+i}"
        add(category='WORKS', sub_category='FLOORING', supplier='DHI', supplier_item_code=code, sku=f"FLR-DHI-{code}",
            name=f"DHI SPC moulding {lbl} {code} {colour}", spec=spec, uom='PCS', item_src=src('DHI_A', 34 + i), notes='Price needed.')

# ---------------------------------------------------------------- LB stone (catalogue only)
lb = json.load(open(f"{HERE}/lb.json", encoding='utf-8'))
# quartz p9 carries a hidden text layer (KPQ007-012 at 3200x1600) under the visible KPQ019-024 cards - not shown on the page, so not used
lb = [o for o in lb if not (o['file'] == 'QUARTZ' and o['page'] == 9 and o['code'] in ('KPQ007', 'KPQ008', 'KPQ009', 'KPQ010', 'KPQ011', 'KPQ012'))]
for o in lb:
    if o['finish'].startswith('QUARTZ STON'): o['finish'] = 'QUARTZ STONE'
seen = {}
def lbkey(o):
    return (o['code'], o['size'], o['thk'], o['finish'], o['series'] == 'BOOKMATCH SERIES')
uniq = []
for o in lb:
    k = lbkey(o)
    if k in seen: continue
    seen[k] = o; uniq.append(o)
from collections import defaultdict
by = defaultdict(list)
for o in uniq:
    by[(o['code'], o['series'] == 'BOOKMATCH SERIES')].append(o)
for (code, bm), group in by.items():
    for o in group:
        size = o['size'].replace('MM (L) * ', 'x').replace('MM (H)', '').replace(' ', '')
        sku = f"CTP-LB-{code}" + ('-BM' if bm else '')
        if len(group) > 1:
            sku += '-' + size.replace('x', 'X')[:9]
        kind = 'sintered stone' if o['file'] == 'SINTERED' else (o['finish'].lower() if o['finish'] else 'stone')
        fin = o['finish'] if o['file'] == 'SINTERED' else ''
        nm = re.sub(r'[　-鿿＀-￯]+.*$', '', o['name']).strip()
        cn = ''.join(re.findall(r'[　-鿿]+', o['name']))
        notes = 'Price needed (catalogue has no prices).'
        if not nm: notes += ' Catalogue prints no colour name.'
        if bm: notes += ' Bookmatch version of the same colour code.'
        if code in ('KS021', 'KS023'): notes += ' KS021 and KS023 are both named "3D CARARA".'
        add(category='BUILTIN', sub_category='COUNTERTOP', supplier='LB', supplier_item_code=code, sku=sku,
            name=f"LB {kind} {code}" + (f" {nm.title()}" if nm else '') + (' (bookmatch)' if bm else ''),
            spec=f"Slab {size}mm; {o['thk']}" + (f"; {fin.lower()}" if fin else '') + (f"; {cn}" if cn else ''), uom='PCS',
            doc_unit='slab (no unit printed)', item_src=src('LB_S' if o['file'] == 'SINTERED' else 'LB_Q', o['page']), notes=notes)

# ---------------------------------------------------------------- HOOKKA catalogue + 2990 list
hk = [(1, '1003', 'BEDFRAME', '14 SKUs: 200CMX200CM, 220CMX220CM, 3.5FT, 3FT, 5FT... (list cut off)', False),
 (1, '1005', 'BEDFRAME', '5 SKUs: 200CMX200CM, 3.5FT, 3FT, 5FT, 6FT', False), (1, '1007', 'BEDFRAME', '12 SKUs: 152CMX200CM, 153CMX200CM, 183CMX200CM... (list cut off)', False),
 (1, '1008', 'BEDFRAME', '4 SKUs: 3.5FT, 3FT, 5FT, 6FT', False), (1, '1009', 'BEDFRAME', '4 SKUs: 3.5FT, 3FT, 5FT, 6FT', False),
 (1, '1013', 'BEDFRAME', '5 SKUs: 200CMX200CM, 3.5FT, 3FT, 5FT, 6FT', False), (1, '1019', 'BEDFRAME', '8 SKUs: 3.5FT, 3FT, 5FT, 6FT', False),
 (1, '1023', 'BEDFRAME', '8 SKUs: 3.5FT, 3FT, 5FT, 6FT', False), (1, '1030', 'BEDFRAME', '8 SKUs: 153x200cm, 3.5FT, 3FT, 5FT, 6FT', False),
 (2, '1041', 'BEDFRAME', '5 SKUs: 107CMX200CM, 3.5FT, 3FT, 5FT, 6FT', False), (2, '1051', 'BEDFRAME', '1 SKU: 6FT', False),
 (2, '1052', 'BEDFRAME', '3 SKUs: 3.5FT, 5FT, 6FT', False), (2, '2003', 'BEDFRAME', '5 SKUs: 183CMX200CM, 3.5FT, 3FT, 5FT, 6FT', False),
 (2, '2006', 'BEDFRAME', '10 SKUs: 190CMX200CM, 200CMX200CM, 3.5FT, 3FT, 5FT... (list cut off)', False),
 (2, '2008', 'BEDFRAME', '12 SKUs: 152CMX200CM, 183CMX200CM, 200CMX200CM... (list cut off)', True),
 (2, '2009', 'BEDFRAME', '11 SKUs: 152CMX200CM, 200CMX200CM, 210CMX210CM... (list cut off)', False), (2, '2010', 'BEDFRAME', '4 SKUs: 3.5FT, 3FT, 5FT, 6FT', False),
 (2, '2011', 'BEDFRAME', '5 SKUs: 200CMX200CM, 3.5FT, 3FT, 5FT, 6FT', True), (3, '2023', 'BEDFRAME', '4 SKUs: 3FT, 6FT', False),
 (3, '2027', 'BEDFRAME', '4 SKUs: 3.5FT, 3FT, 5FT, 6FT', False), (3, '2033', 'BEDFRAME', '8 SKUs: 3.5FT, 3FT, 5FT, 6FT', False),
 (3, '2038', 'BEDFRAME', '7 SKUs: 3.5FT, 3FT, 5FT, 6FT', False), (3, '2041', 'BEDFRAME', '4 SKUs: 3.5FT, 3FT, 5FT, 6FT', False),
 (3, '2049', 'BEDFRAME', '1 SKU: 6FT', True), (3, 'DIVAN', 'BEDFRAME', '9 SKUs: 153CMX210CM, 170CMX200CM, 200CMX200CM... (list cut off)', True),
 (4, '5530', 'SOFA', '13 SKUs: 1A(LHF), 1A(RHF), 1NA, 1S, 2A(LHF)... (list cut off)', False),
 (4, '5531', 'SOFA', '13 SKUs: 1A(LHF), 1A(RHF), 1NA, 1S, 2A(LHF)... (list cut off)', False),
 (4, '5535', 'SOFA', '13 SKUs: 1A(LHF), 1A(RHF), 1NA, 1S, 2A(LHF)... (list cut off)', False),
 (4, '5536', 'SOFA', '14 SKUs: 1A(LHF), 1A(RHF), 1NA, 1S, 2A(LHF)... (list cut off)', False),
 (4, '5537', 'SOFA', '13 SKUs: 1A(LHF), 1A(RHF), 1NA, 1S, 2A(LHF)... (list cut off)', False),
 (4, '5539', 'SOFA', '17 SKUs: 1A(LHF), 1A(RHF), 1B(LHF), 1B(RHF), 1NA... (list cut off)', False),
 (4, '5540', 'SOFA', '14 SKUs: 1A(LHF), 1A(RHF), 1NA, 1S, 2A(LHF)... (list cut off)', False),
 (4, '5543', 'SOFA', '13 SKUs: 12" X 28", 1B(LHF), 1B(RHF), 1NA, 1S... (list cut off)', False),
 (4, '5545', 'SOFA', '17 SKUs: 1A(LHF), 1A(RHF), 1B(LHF), 1B(RHF), 1NA... (list cut off)', False),
 (5, '5546', 'SOFA', '17 SKUs: 1A(LHF), 1A(RHF), 1B(LHF), 1B(RHF), 1NA... (list cut off)', False),
 (5, '5547', 'SOFA', '17 SKUs: 1A(LHF), 1A(RHF), 1B(LHF), 1B(RHF), 1NA... (list cut off)', False),
 (5, '5548', 'SOFA', '17 SKUs: 1A(LHF), 1A(RHF), 1B(LHF), 1B(RHF), 1NA... (list cut off)', False),
 (5, '5549', 'SOFA', '17 SKUs: 1A(LHF), 1A(RHF), 1B(LHF), 1B(RHF), 1NA... (list cut off)', False),
 (5, '6112', 'SOFA', '1 SKU: 2S', False),
 (6, 'LONG PILLOW', 'ACCESSORY', '1 SKU: 12" X 28"', True), (6, 'SQUARE PILLOW', 'ACCESSORY', '1 SKU: 16" X 16"', True), (6, 'SQUARE PILLOW SP', 'ACCESSORY', '1 SKU: 16" X 16"', True)]
names2990 = {'9036': ('Ommbuc', 1), '9053': ('Siyyp', 1), '9070': ('Annsa', 1), '9071': ('Krron', 1), '8020': ('Telluc', 1), '5119': ('Lyyar', 1),
             '8019': ('Qubbu', 2), '5080': ('Blatt', 2), '8027': ('Boaat', 2), '9050': ('Pantti', 2), '9038': ('Lotti', 2), '5095': ('Pllao', 2),
             '5539': ('Booqit', 2), '5531': ('Xammar', 2), '5535': ('Trrbu', 2)}
notes2990 = {'9053': 'Recliner is an add-on; if used for ads it must be mentioned.', '8027': 'Recliner is an add-on; if used for ads it must be mentioned.',
             '5119': 'No phone charger; recliner is an add-on.'}
for page, code, sub, variants, nophoto in hk:
    nm2990 = names2990.get(code)
    pre = {'BEDFRAME': 'BED', 'SOFA': 'SOF', 'ACCESSORY': 'ACC'}[sub]
    kind = {'BEDFRAME': 'Bedframe', 'SOFA': 'Sofa', 'ACCESSORY': ''}[sub]
    nm = (f"HOOKKA {kind} {code}" if kind else f"HOOKKA {code.title()}") + (f" {nm2990[0]}" if nm2990 else '')
    notes = f"Price needed. Catalogue lists {variants.split(':')[0]} for this model; the size/seat list is cut off in the PDF, so one SKU per model is created and sizes are chosen on the order."
    if nophoto: notes += ' Catalogue has NO PHOTO for this model.'
    if nm2990: notes += f" Also on the 2990 sofa list as '{nm2990[0]}' (p{nm2990[1]})."
    add(category='FURNITURE', sub_category=sub, supplier='HOOKKA', supplier_item_code=code, sku=f"{pre}-HKA-{code.replace(' ', '')}",
        name=nm, spec=variants, uom='UNIT' if sub != 'ACCESSORY' else 'PCS', item_src=src('HKA_C', page), confidence='medium', notes=notes)
for code, (nm, page) in names2990.items():
    if code in ('5539', '5531', '5535'): continue
    add(category='FURNITURE', sub_category='SOFA', supplier='HOOKKA', supplier_item_code=code, sku=f"SOF-HKA-{code}", name=f"Sofa {code} {nm} (2990 list)",
        spec='Model only; seats/sizes not given', uom='UNIT', item_src=src('HKA_2990', page), confidence='low',
        notes='Price needed. From the "2990 ALL SOFA" sheet in the HOOKA folder; not in the HOOKKA catalogue - confirm the supplier and whether 2990 is the selling price (RM2,990). ' + notes2990.get(code, ''))
add(category='FURNITURE', sub_category='SOFA', supplier='HOOKKA', supplier_item_code='Akemi Uborr', sku='SOF-HKA-AKEMI-UBORR', name='Sofa Akemi Uborr (2990 list)',
    spec='Model only; no code given', uom='UNIT', item_src=src('HKA_2990', 3), confidence='low',
    notes='Price needed. Page 3 of the 2990 sheet shows "Akemi" (a brand?) and "Uborr" with no model code - confirm what it is and who supplies it.')

# ---------------------------------------------------------------- Lighting: Lot Win invoices, World One sales orders
for key, inv, date, items in [
 ('LTW_1', 'INV 0191026', '2026-10-01', [('LY 12V COB 5M LED STRIP 3K', 'LED strip', 'LED_STRIP', 'LED', 25.00, 'PCS', '12V COB, 5m, 3000K'),
                                        ('CTS 12V 100W DRIVER', 'LED driver', 'LED_STRIP', 'LED', 40.00, 'PCS', '12V 100W'),
                                        ('MS ALUM 288/3M SV', 'LED aluminium profile', 'LED_STRIP', 'LED', 30.00, 'PCS', '3m, silver')]),
 ('LTW_2', 'INV 0231026', '2026-10-01', [('FLC RRD 18W WH 4K', 'Surface downlight', 'DOWNLIGHT', 'DLT', 10.00, 'PCS', '18W, white, 4000K'),
                                        ('IMIDL RS433/20W LED 4K', 'Downlight', 'DOWNLIGHT', 'DLT', 10.00, 'PCS', '20W LED, 4000K'),
                                        ('LP 1M TRACK WH', 'Track', 'TRACK_LIGHT', 'TRK', 15.00, 'PCS', '1m, white'),
                                        ('IMI TR16/12W WH 4K', 'Track light', 'TRACK_LIGHT', 'TRK', 15.00, 'PCS', '12W, white, 4000K'),
                                        ('ZS QL POWER TRACK 1000MM WH', 'Power track', 'TRACK_LIGHT', 'TRK', 192.10, 'PCS', '1000mm, white'),
                                        ('ZS QL POWER PLUG 13AMP WH', 'Power track plug', 'TRACK_LIGHT', 'TRK', 28.00, 'PCS', '13A, white')])]:
    for code, desc, sub, pre, cost, uom, spec in items:
        slug = re.sub(r'[^A-Z0-9]+', '-', code).strip('-')
        add(category='LIGHTING', sub_category=sub, supplier='LOTWIN', supplier_item_code=code, sku=f"{pre}-LTW-{slug}"[:40], name=f"{desc} {code}",
            spec=spec, uom=uom, doc_unit='Price/Unit', cost=cost, price_src=src(key, 1), price_type=f'supplier invoice {inv}', price_date=date,
            item_src=src(key, 1), confidence='medium' if code.startswith(('IMI', 'IMIDL')) else 'high',
            notes=('Read from a phone scan; code letters read by eye. ' if code.startswith(('IMI', 'IMIDL')) else 'Read from a phone scan. ') + 'Invoice is labelled with a site (' + ('SITE-E18-01' if key == 'LTW_1' else 'SITE-08-08') + ').'
                  + (' New sub-category Lighting > Track light.' if sub == 'TRACK_LIGHT' else ''))
for key, so, date, code, size, colour in [('W1_120', 'SO/W037120', '2026-10-07', 'CF/F5DC/56/PRO/MB', '56"', 'matt black'),
                                          ('W1_120', 'SO/W037120', '2026-10-07', 'CF/F5DC/46/PRO/MB', '46"', 'matt black'),
                                          ('W1_186', 'SO/W037186', '2026-10-12', 'CF/F5DC/56/PRO/MTW', '56"', 'metallic white'),
                                          ('W1_186', 'SO/W037186', '2026-10-12', 'CF/F5DC/46/PRO/MTW', '46"', 'metallic white')]:
    add(category='LIGHTING', sub_category='CEILING_FAN', supplier='WORLDONE', supplier_item_code=code,
        sku='FAN-W1L-' + code.replace('CF/', '').replace('/PRO', '').replace('/', '-'), name=f"DEKA F5DC {size} PRO DC ceiling fan 5 blades - {colour}",
        spec=f"{size} DC motor, 5 blades, with remote, {colour}", uom='UNIT', doc_unit='U/Price', cost=130.00, price_src=src(key, 1),
        price_type=f'supplier sales order {so}', price_date=date, item_src=src(key, 1),
        notes='56" and 46" are both RM130.00 on the sales order - confirm this is the normal price.' + (' The 46" line carries a note ***R0908***.' if code == 'CF/F5DC/46/PRO/MB' else '') + (' The 46" line carries a note ***A0811***.' if code == 'CF/F5DC/46/PRO/MTW' else ''))

# ---------------------------------------------------------------- K & K price list (+ quotation QT26-13940)
kk = json.load(open(f"{HERE}/kk_auto.json", encoding='utf-8'))
fix_by_line = {  # line -> replacement (name, unit) or None to drop
 7: ('Indogyps Gypsum Board 4x6 9mm', 'pcs'), 149: ('Cool "N" Comfort RL920 (40kg/m3) 1200mm X 5000mm X 50mm', 'roll'),
 192: ('Beading BL10 Small', 'pcs'), 219: ('KK002 Round edge curve board 70MM X 40MM X 7FT (R35)', 'pcs'),
 237: ('S Mould 400mm x 200mm x R100 x R100 x 2150mm Long', 'pcs'), 285: ('Scalffolding board (lend deposit)', 'pcs'),
 287: ('Timber 2" x 4" (lend deposit)', 'pcs'), 292: ('BPG floor spring 20nm with patch fitting & lock FOC 2FT H handle', 'set'),
 295: ('BPG floor spring 20nm with patch fitting & lock FOC 1FT C handle', 'set'), 298: ('BPG floor spring 25nm with patch fitting & lock', 'set'),
 301: ('BPG floor spring 20nm with patch fitting & lock', 'set'),
}
for it in kk:
    if it['line'] in fix_by_line:
        it['name'], it['unit'] = fix_by_line[it['line']]
    if it['name'].startswith('Hardware Unload'):
        it['name'] = 'Hardware unload material service - upstair'
    if it['name'] == 'Kalsi Superflex 603mm X 1213mm X' or it['name'].startswith('3.2mm (Painted White)'):
        it['name'] = 'Kalsi Superflex 603mm X 1213mm X 3.2mm (Painted White)'
# the LT 4X6 line: price printed on its own line (line 228 '19.00', line 229 'LT 4X6 pcs')
kk.append(dict(page=2, section='light Throughs / L Box', name='LT 4X6', unit='pcs', price=19.00, line=229))
# 5mm clear glass (standard size) has no price on the list
kk.append(dict(page=2, section='Tempered Glass', name='5mm clear glass (standard size)', unit='sq ft', price=None, line=258))
kk.append(dict(page=2, section='Tempered Glass', name='Clear mirror bevel 2/8", 1/2", 6/8", 1"', unit='ft', price=None, line=251))
kk.sort(key=lambda x: (x['page'], x['line']))
KK_DATES = {1: '2026-09-11', 2: '2026-06-15', 3: '2026-05-01', 4: '2026-10-13'}
SECTION_MAP = {  # section -> (category, sub, importable, sku prefix, reason-if-not)
 'Partition': ('WORKS', 'PARTITION', True, 'PTN'), 'Ceiling': ('WORKS', 'PLASTER_CEILING', True, 'PLC'), 'Doors': ('WORKS', 'DOOR', True, 'DOR'),
 'Others': ('WORKS', 'PLASTER_CEILING', True, 'PLC'), 'Glass Window': ('WORKS', 'ALUMINIUM_GLASS', True, 'GLS'),
 'Stopping / Fiber / Casting': ('WORKS', 'PLASTER_CEILING', True, 'PLC'), 'Cornices': ('WORKS', 'PLASTER_CEILING', True, 'PLC'),
 'Center Roses': ('WORKS', 'PLASTER_CEILING', True, 'PLC'), 'light Throughs / L Box': ('WORKS', 'PLASTER_CEILING', True, 'PLC'),
 'Round L Box': ('WORKS', 'PLASTER_CEILING', True, 'PLC'), 'Tempered Glass 玻璃': ('WORKS', 'ALUMINIUM_GLASS', True, 'GLS'),
 'Tempered Glass': ('WORKS', 'ALUMINIUM_GLASS', True, 'GLS'),
 'TeImtepmered Glass HandUlneit RM': ('WORKS', 'ALUMINIUM_GLASS', True, 'GLS'), 'FloorI tSepmring & Patch FittinUgnit RM': ('WORKS', 'ALUMINIUM_GLASS', True, 'GLS'),
 'Silicon': ('WORKS', 'ALUMINIUM_GLASS', True, 'GLS'), 'ItemServices Unit RM': ('SERVICE', 'DELIVERY', False, 'SVC'),
 '油漆': ('WORKS', 'PAINTING', True, 'PNT'), 'Aluminium Profile & LED Light': ('LIGHTING', 'LED_STRIP', True, 'LED'),
 '迷你小五金': ('WORKS', 'PLASTER_CEILING', False, 'TLS'), 'Machine & Laser': ('WORKS', 'PLASTER_CEILING', False, 'TLS'),
 'Item Unit RM': ('WORKS', 'PLASTER_CEILING', False, 'TLS'), 'Wall Plug & Screw': ('WORKS', 'PLASTER_CEILING', False, 'TLS'),
 'Pasir & Batu 沙石': ('WORKS', 'MASONRY_TILING', True, 'MSN'), 'Bricks 砖': ('WORKS', 'MASONRY_TILING', True, 'MSN'),
 'Cement & Susu灰&牛奶水': ('WORKS', 'MASONRY_TILING', True, 'MSN'), 'Plywood三夹板': ('WORKS', 'PARTITION', False, 'PLY'),
 'Besi 铁支&花铁': ('WORKS', 'MASONRY_TILING', True, 'MSN'),
}
SECTION_LABEL = {'TeImtepmered Glass HandUlneit RM': 'Tempered glass handle', 'FloorI tSepmring & Patch FittinUgnit RM': 'Floor spring & patch fitting',
                 'ItemServices Unit RM': 'Services', 'Item Unit RM': 'Screw / nail', '迷你小五金': 'Mini hardware', '油漆': 'Painting',
                 'Tempered Glass 玻璃': 'Tempered glass'}
UNIT_MAP = {'pcs': 'PCS', 'PCS': 'PCS', 'set': 'SET', 'no': 'PCS', 'nos': 'PCS', 'bag': 'BAG', 'roll': 'ROLL', 'ft': 'FT', 'sq ft': 'SQFT', 'trip': 'LOT'}
quote = {  # price-list name -> (K&K item code, quoted price, quote description)
 'Indogyps Gypsum Board 4x6 9mm': ('TCK215', 13.20, 'INDOGYPS GYPSUM BOARD 4X6X9MM'),
 'Plaster Ceiling Tee 8ft (white)': ('TCK014', 1.40, 'PLASTER CEILING TEE 8ft 30MM (KC)'),
 'L Box Partition 4" x 12"': ('TCK062', 12.80, 'L - BOX 4" X 12" X 8\' X 9MM (PARTITION)'),
 'Manhole 12" x 12"': ('SUNC10', 12.50, 'MANHOLE 12" X 12" (PLASTER)'),
 'Unload Material Service - upstair': ('S20019', 60.00, 'LABOUR SERVICE TO UNLOAD/UPLOAD MATERIAL (UPSTAIR)'),
 'Maxilite 18L (White)': ('O10060', 94.00, 'G- MAXILITE (WHITE 15245) 18 LITER'),
 'S11 Bonding Cornice Adhesive 2in1': ('TCK050', 21.00, 'S11 BONDING CORNICE ADHESIVE 2IN1'),
 'Screw (box)': ('TCK105', 10.50, 'K- SCREW BRAND ZOMIN King Kong (1KG) GOLD COLOR (1 CTN X 20BOX)'),
 'Fiber Tape 1.5\'\'': ('TCK127', 4.50, 'K- FIBER TAPE 40MMX50M (1.5") (1 BOX X 63 PCS)'),
 'Transport Charge': ('S20021', 60.00, 'TRANSPORT CHARGE-SEND BY K&K LORRY 10KM RM61, K&K PRICE AFTER DISCOUNT = RM60'),
}
HEADERS = {'Indogyps Gypsum Board', 'AGP Gypsum Board', 'Gyproc Gypsum Board', 'Knauf Gypsum Board', 'Stud / Ceiling Tee', 'Cement Board', 'Aluminium', 'Rockwool',
           'Clear Mirror Without Polish', 'Clear Glass (cut size)', 'Clear Glass (standard size)'}
kl = open(f"{HERE}/kk_lines.txt", encoding='utf-8').read().splitlines()
def group_of(line):
    for j in range(line - 1, 0, -1):
        t = kl[j - 1].strip()
        if t.startswith('--- p'): return ''
        if t in HEADERS: return t
    return ''
TOOLS = re.compile(r'Caulking Gun|GLASS CUTTER|HAND GLOVE|Paint Brush|Extension Hole')
ON_QUOTE_MATERIAL = {"Fiber Tape 1.5''", 'Screw (box)'}
seq = {}
for it in kk:
    sec = it['section']
    cat, sub, imp, pre = SECTION_MAP[sec]
    name = re.sub(r'\s+', ' ', it['name']).strip()
    if name in ('Painting', 'All Nippon Paint brand'): continue
    # p3/p4 lines carry a Chinese description in the "unit" column - keep it as spec, not a unit
    cn = ''.join(re.findall(r'[　-鿿（）（）]+[^A-Za-z]*', name)) if it['page'] >= 3 else ''
    eng = name
    if it['page'] >= 3:
        m = re.match(r'^(.*?)\s+([　-鿿].*|Partition .*|2x4 .*|Wall Plug .*|W/Plug .*|wall plug.*|1001 / 145.*)$', name)
        if m: eng, cn = m.group(1).strip(), m.group(2).strip()
    if any(name.startswith(x) for x in ON_QUOTE_MATERIAL): pre = 'PLC'
    seq[pre] = seq.get(pre, 0) + 1
    doc_unit = it['unit'] or ''
    if doc_unit:
        uom = UNIT_MAP[doc_unit]; uconf = 'high'
    else:
        uom = 'BAG' if re.search(r'\(BAG\)|PORTLAND', eng) else ('LOT' if 'SCOPE' in eng else ('UNIT' if re.search(r'18L|5L|20L|\(20KG\)|Machine|Drill|Laser|Artifact', eng) else 'PCS'))
        uconf = 'low'
    eng = re.sub(r'\s*\(?\d*[　-鿿].*$', '', eng).strip()
    if eng.startswith('W/Plug Screw 10mm'): eng = 'W/Plug Screw 10mm 1 2/8" (box)'
    if 'Rubber Gasket' in eng: eng += ' (per roll)' if doc_unit == 'roll' else (' (per ft)' if doc_unit == 'ft' else '')
    grp = group_of(it['line'])
    if eng == 'Screw (box)': uom, uconf, doc_unit = 'BOX', 'high', 'BOX (from quotation QT26-13940)'
    q = quote.get(re.sub(r' \(per (roll|ft)\)$', '', eng))
    sub_eff = sub
    if 'SIKA TOP SEAL' in eng: sub_eff = 'WATERPROOFING'
    if 'Transport' in eng or 'Unload' in eng or 'Clear Material' in eng or 'Night/Weekend' in eng: sub_eff = 'DELIVERY'
    reason = ''
    if eng in ON_QUOTE_MATERIAL:
        imp = True; cat, sub_eff = 'WORKS', 'PLASTER_CEILING'
    if TOOLS.search(eng):
        imp = False; reason = 'Contractor tool, not a product'
    if not imp and not reason:
        reason = {'SVC': 'Service / deposit charge, not a product', 'TLS': 'Contractor tool or fixing consumable', 'PLY': 'Raw carpentry board - no matching sub-category'}[pre]
    notes = []
    if q:
        notes.append(f"Also on K&K quotation QT26-13940 (12 Aug 2026) as code {q[0]} '{q[2]}' at RM{q[1]:.2f}" + ('' if abs(q[1] - (it['price'] or 0)) < 0.005 else ' (DIFFERENT from list price)') + '.')
    if uconf == 'low': notes.append('Unit not printed on the list; guessed.')
    if it['price'] is None: notes.append('Price needed (listed without a price).')
    if '(lend deposit)' in eng: notes.append('Refundable deposit for borrowed equipment.')
    if sec.startswith('Tempered Glass') and 'tempered' in eng.lower(): notes.append('List note: door & 1 slant add RM2.00 per sqft.')
    if pre == 'PLC' and sec == 'Others': notes.append(f"From the 'Others' block ({'cement board / aluminium / rockwool'}); filed under Plaster ceiling.")
    if pre == 'PTN' and re.search(r'Ceiling|Tee', eng): notes.append("Listed in K&K's Partition block although it is a ceiling item.")
    sku = f"{pre}-KNK-{seq[pre]:03d}"
    label = SECTION_LABEL.get(sec, re.sub(r'[　-鿿&]+', '', sec).strip())
    add(category=cat, sub_category=sub_eff, supplier='KK', supplier_item_code=q[0] if q else '', sku=sku, name=f"{eng}",
        spec=(f"K&K section: {label}" + (f" / {grp}" if grp else '') + (f"; {cn}" if cn else '')), uom=uom, doc_unit=doc_unit or '(none printed)', cost=it['price'],
        price_src=src('KK_PL', it['page']) if it['price'] is not None else '', price_type='supplier price list' if it['price'] is not None else '',
        price_date=KK_DATES[it['page']] if it['price'] is not None else '', item_src=src('KK_PL', it['page']),
        confidence='high' if uconf == 'high' else 'medium', notes=' '.join(notes), importable=imp, exclude_reason=reason)
# quotation-only line (no price-list match): none - every quote line matched a list line (checked below)
matched = {r['supplier_item_code'] for r in rows if r['supplier'] == 'KK' and r['supplier_item_code']}
missing = [v[0] for v in quote.values() if v[0] not in matched]
if missing: raise SystemExit(f"quote lines not matched: {missing}")

# ---------------------------------------------------------------- finishing: unit checks and import flags
for r in rows:
    if r['uom'] not in EXISTING_UOMS and r['uom'] not in {u[0] for u in NEW_UOMS}:
        raise SystemExit(f"bad uom {r}")
    if r['cost'] is None and not r['notes'].startswith('Price needed') and 'Price needed' not in r['notes']:
        r['notes'] = ('Price needed. ' + r['notes']).strip()
skus = [r['sku'] for r in rows]
dups = {s for s in skus if skus.count(s) > 1}
if dups: raise SystemExit(f"duplicate sku codes: {sorted(dups)[:20]}")
for r in rows:
    if len(r['sku']) > 40: raise SystemExit(f"sku too long {r['sku']}")
json.dump(dict(rows=rows, suppliers=SUPPLIERS, new_subs=NEW_SUBS, new_uoms=NEW_UOMS, files=F), open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
from collections import Counter
print(len(rows), Counter(r['supplier'] for r in rows))
print('priced', sum(r['cost'] is not None for r in rows), 'importable', sum(r['importable'] for r in rows))
