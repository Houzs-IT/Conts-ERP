import sys, json, collections, re
sys.path.insert(0, '.')
import so_rules as m
W = r"C:/Users/User/Desktop/Conts-ERP-worktrees/so-notion-import/docs/catalog-import/batch2/batch2-data.json"
b2 = json.load(open(W, encoding='utf-8'))
LIVE = set(m.cat) | {x['code'] for x in b2['balance']} | {x['code'] for x in b2['so_codes']}
R = json.load(open('so_parsed.json', encoding='utf-8'))
EXTRA = [(t, re.compile(rx)) for t, rx in [
    ('RN-DESIGN', r'DESIGN|MOODBOARD|PROPOSAL'), ('RN-FEATURE_WALL', r'FEATURE'), ('RN-PAINTING', r'SKIM|SEALER|GLOSS'),
    ('RN-AIRCON_INSTALL', r'A/C|AC OPENING'), ('RN-HACKING', r'HOLE OPENING|OPEN HOLE'),
    ('CUR-GEN-DOUBLE', r'^-?\s*(LIVING|MASTER|ROOM|BEDROOM|DRY KITCHEN|DINING).*\d+(\.\d+)?\s*FT'),
    ('RN-ALUMINIUM_GLASS', r'PVC PROFILE|HANDRAIL'),
    ('BED-HKA-1041-(Q)', r'VICTORIA'), ('BED-HKA-1007-(S)', r'SINGLE SIZE BED ?FRAME'), ('BED-HKA-1007-(Q)', r'BED ?FRAME'),
    ('AKEMI OMNIA MATT (K)', r'KING.*MATTRESS|MATTRESS.*KING'), ('AKEMI GALLENT MATT (Q)', r'MATTRESS'),
    ('TV-HIS-43', r'SMART TV|TV(?!.*(CABINET|CONSOLE|RACK))'), ('FRG-GEN-200L', r'FRIDGE(?!.*CABINET)'),
    ('WSH-MID-2IN1', r'WASHING|WASHER|DRYER'), ('FAN-GEN-EXHAUST', r'EXH?U?A?U?ST'), ('FAN-GEN-CEILING', r'^-?\s*FAN$|CEILING FAN'),
    ('TRK-GEN-MAGNETIC', r'DRIVER|JOINER|MAGNE?C?TIC'), ('RN-DELIVERY', r'DELIVERY|LOGISTIC'), ('SOF-GEN-3S', r'SOFA'),
    ('FUR-GEN-DINSET6', r'DINING (TABLE )?SET'), ('RN-COUNTERTOP', r'QUAR?Z?T|TABLE TOP|SIMEN|MARBLE|SINTER'),
    ('RN-PLUMBING', r'MAINHOLE|MANHOLE|WATER INLET|PLUMB|BATHROOM ACCESS|TOILET|SINK|TAP'),
    ('RN-FLOORING', r'SKR?I?TING|VINYL|SPC|FLOOR'), ('RN-PAINTING', r'PA?I?NTING'),
    ('RN-ELECTRICAL', r'LED|LIGHT|LAMP|POINT|SOCKET|SWITCH|WIRING|DB|DOWN ?G?LIGHT|EYE ?BALL|PENDAN'),
    ('RN-KITCHEN_CABINET', r'LARDER|PULL-? ?OUT|COMPARTMENT|DRAWER|VENTILATION COVER|HOLE BOARD|BACKING|CABINET'),
    ('RN-WARDROBE', r'WA?R?DROBE|WRADROBE'), ('RN-SHELVING', r'PANEL|CARCASE|SHELF|CURVE|FRAME|LOCKER|RACK'),
    ('RN-ALUMINIUM_GLASS', r'ALUM|GLASS|MIRROR|WINDOW'), ('RN-AIRCON_INSTALL', r'AC|AIR ?CON'),
]]
SECTION = [(t, re.compile(rx)) for t, rx in [
    ('RN-ELECTRICAL', r'WIRING|ELECTRIC|LIGHT'), ('CUR-GEN-DOUBLE', r'CURTAIN|BLIND'), ('RN-SHELVING', r'CARPENTRY|BUILT|CABINET'),
    ('RN-PLUMBING', r'PLUMB'), ('RN-PLASTER_CEILING', r'CEILING'), ('RN-MASONRY_TILING', r'TILE|MASON|HACK'),
    ('RN-AIRBNB_SETUP', r'AIRBNB|ACCESSOR|DECO|FURNITURE|APPLIANCE'),
]]
def target(desc, sec=None, priced=False):
    t = m.classify(m.norm(desc))
    t = m.REMAP.get(t, t)
    if t == 'REVIEW' or (t == 'SKIP' and priced):
        c = m.norm(desc)
        t = next((x for x, rx in EXTRA if rx.search(c)), None) or next((x for x, rx in SECTION if rx.search(m.norm(sec or ''))), None) or ('RN-PROJECT_MGMT' if priced else 'TEXT')
    return t
cnt = collections.Counter(); rev = collections.Counter(); notlive = collections.Counter(); skip = collections.Counter()
for f, d in R.items():
    for i in d['items']:
        t = target(i['desc'], i.get('sec'), i['amt'] is not None or i['price'] is not None); i['sku'] = t
        if t in ('TEXT',) or (t == 'RN-PROJECT_MGMT' and not re.search('MANAGEMENT|SUPERVIS|PLANNING', m.norm(i['desc']))): rev[m.norm(i['desc'])[:70]] += 1
        elif t == 'SKIP': skip[m.norm(i['desc'])[:70]] += 1
        elif t not in LIVE: notlive[t] += 1
        cnt['fallback-pm' if t == 'RN-PROJECT_MGMT' and not re.search('MANAGEMENT|SUPERVIS|PLANNING', m.norm(i['desc'])) else 'TEXT' if t == 'TEXT' else 'REVIEW' if t == 'REVIEW' else 'SKIP' if t == 'SKIP' else 'ok' if t in LIVE else 'notlive'] += 1
json.dump(R, open('so_parsed.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(cnt, 'distinct review', len(rev))
print('NOTLIVE', notlive.most_common(30))
print('SKIP', skip.most_common(25))
for d, n in rev.most_common(int(sys.argv[1]) if len(sys.argv) > 1 else 60): print(n, d)
