"""HOOKKA quotation 300-T (22 Oct 2026) -> hookka_300t.json.

    python -I docs/catalog-import/build/hookka_parse.py <q.pdf> docs/catalog-import/build/hookka_300t.json

Reads the PDF's text layer (pypdf, layout mode). Every price is kept in sen; "—" is null (no price for that tier/size).
"""
import sys, re, json
from pypdf import PdfReader

pdf, out = sys.argv[1], sys.argv[2]
pages = [p.extract_text(extraction_mode='layout') for p in PdfReader(pdf).pages]

def sen(tok):
    tok = tok.strip()
    if tok in ('—', '-', ''):
        return None
    m = re.fullmatch(r'RM\s*([\d,]+\.\d\d)', tok)
    assert m, tok
    return int(round(float(m.group(1).replace(',', '')) * 100))

PRICE = r'(RM\s*[\d,]+\.\d\d|—)'
bed, sofa, acc, combos = [], [], [], []
surch = {}
section = None
model = None
sizes = None
lines = []
for pi, txt in enumerate(pages, 1):
    for ln in txt.splitlines():
        lines.append((pi, ln))

i = 0
pending_bed = None
cur_surch = None
cur_group = None
while i < len(lines):
    pi, ln = lines[i]
    s = ln.strip()
    i += 1
    if not s:
        continue
    if re.match(r'^BEDFRAME\s+\(\d+\)', s): section = 'BED'; continue
    if re.match(r'^SOFA\s+\(\d+\)', s): section = 'SOFA'; continue
    if re.match(r'^ACCESSORY\s+\(\d+\)', s): section = 'ACC'; continue
    if s.startswith('Sofa Combos'): section = 'COMBO'; continue
    if s.startswith('Customer Maintenance Config'): section = 'MAINT'; continue
    if s.startswith('Prices effective on') or s.startswith('Code ') or 'HOOKKA INDUSTRIES' in s or s.startswith('Reg.') \
       or s.startswith('2775F') or s.startswith('Tel +'):
        continue
    if section == 'BED':
        m = re.match(r'^(\S+)\s{2,}(.+?)\s{2,}(\S+)\s{2,}' + PRICE + r'\s+' + PRICE + r'$', s)
        if m:
            code, desc, size, p2, p1 = m.groups()
            pending_bed = {'code': code, 'description': desc.strip(), 'size': size, 'price2_sen': sen(p2), 'price1_sen': sen(p1), 'page': pi}
            bed.append(pending_bed)
            continue
        if pending_bed and re.fullmatch(r'[A-Z0-9()X]{1,14}', s):  # wrapped tail of a long code: "S)", "(210X240CM)"
            pending_bed['code'] += (' ' if s.startswith('(') and not pending_bed['code'].endswith('(') else '') + s
            continue
        raise SystemExit(f'unparsed bedframe line p{pi}: {s!r}')
    if section == 'SOFA':
        m = re.match(r'^(\d{4})\s+\((\d+)\)$', s)
        if m:
            model = {'model': m.group(1), 'count': int(m.group(2)), 'page': pi}; continue
        if s.startswith('Description'):
            sizes = re.findall(r'(\d+)"', s); continue
        m = re.match(r'^SOFA (\d{4}) (.+?)\s{2,}(P\d)\s+(.*)$', s)
        if m:
            mdl, comp, tier, rest = m.groups()
            cells = re.findall(PRICE, rest)
            assert len(cells) == len(sizes), (pi, s, sizes)
            assert mdl == model['model'], (mdl, model)
            sofa.append({'model': mdl, 'compartment': comp.strip(), 'tier': tier, 'page': pi,
                         'prices': {sz: sen(c) for sz, c in zip(sizes, cells)}})
            continue
        raise SystemExit(f'unparsed sofa line p{pi}: {s!r}')
    if section == 'ACC':
        m = re.match(r'^(.+?)\s{2,}(.+?)\s{2,}(.+?)\s{2,}' + PRICE + r'$', s)
        if m:
            acc.append({'code': m.group(1).strip(), 'description': m.group(2).strip(), 'size': m.group(3).strip(), 'price_sen': sen(m.group(4)), 'page': pi})
            continue
        if re.fullmatch(r'[A-Z ]{1,12}', s) and acc:  # wrapped tail of a long code ("PILLOW", "SP")
            acc[-1]['code'] += ' ' + s
            continue
        raise SystemExit(f'unparsed accessory line p{pi}: {s!r}')
    if section == 'COMBO':
        combos.append({'page': pi, 'text': s})
        continue
    if section == 'MAINT':
        if s in ('Bedframe', 'Sofa', 'Common'):
            cur_group = s; continue
        if s.startswith('Item') :
            continue
        m = re.match(r'^(Gaps|Sizes):\s+(.*)$', s)
        if m:
            surch[f'{cur_group}/{m.group(1)}'] = [x.strip() for x in m.group(2).split(',')]; continue
        m = re.match(r'^(.+?)\s{2,}' + PRICE + r'$', s)
        if m and cur_surch:
            surch[cur_surch].append({'item': m.group(1).strip(), 'surcharge_sen': sen(m.group(2))}); continue
        if re.fullmatch(r'[A-Za-z ]+', s):
            cur_surch = f'{cur_group}/{s}'; surch[cur_surch] = []; continue
        raise SystemExit(f'unparsed maintenance line p{pi}: {s!r}')

json.dump({'source': 'HOOKKA quotation to The Conts, customer 300-T, effective 22 Oct 2026', 'bedframes': bed,
           'sofa_rows': sofa, 'accessories': acc, 'combos_text': combos, 'surcharges': surch},
          open(out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('bedframes', len(bed), 'sofa rows', len(sofa), 'accessories', len(acc), 'surcharge lists', {k: len(v) for k, v in surch.items()})
