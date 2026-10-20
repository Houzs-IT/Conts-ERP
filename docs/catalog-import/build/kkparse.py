import re, json, sys
sys.stdout.reconfigure(encoding='utf-8')
L=open('kk_lines.txt',encoding='utf-8').read().splitlines()
UNITS=r'(pcs|PCS|set|no|nos|bag|roll|ft|sq ft|trip)'
items=[]; page=None; section=None; bad=[]
for i,l in enumerate(L):
    m=re.match(r'--- p(\d+) table (\d+)',l)
    if m: page=int(m.group(1)); section=None; continue
    if section is None: section=l.strip(); continue
    if re.match(r'^(Item|Mini Hardware|.*Unit RM$|.*Item RM$)',l) and not re.search(r'\d+\.\d\d$',l): continue
    m=re.match(r'^(.*?)\s+'+UNITS+r'\s+(\d+\.\d\d)$',l)
    if m: items.append(dict(page=page,section=section,name=m.group(1).strip(),unit=m.group(2),price=float(m.group(3)),line=i+1)); continue
    m=re.match(r'^(.*?)\s+(\d+\.\d\d)$',l)
    if m: items.append(dict(page=page,section=section,name=m.group(1).strip(),unit='',price=float(m.group(2)),line=i+1)); continue
    bad.append((i+1,page,section,l))
json.dump(items,open('kk_auto.json','w',encoding='utf-8'),ensure_ascii=False,indent=0)
print(len(items))
for b in bad: print('NOPRICE',b)
for it in items:
    if not it['unit'] and it['page']<=2: print('NOUNIT',it)
