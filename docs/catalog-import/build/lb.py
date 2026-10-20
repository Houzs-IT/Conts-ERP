import sys, fitz, re, json
sys.stdout.reconfigure(encoding='utf-8')
CODE=re.compile(r'^(KPQ\d+|PS\d+Y|KS\d+|TS\d+|UV\d+|T\d{4}(-M)?|M\d{4}[A-Z]?(-[A-Z0-9]+)?|SS\d+[A-Z]?(-[A-Z0-9]+)?)$')
out=[]
for path,label in [(sys.argv[1],'QUARTZ'),(sys.argv[2],'SINTERED')]:
    d=fitz.open(path)
    for n,pg in enumerate(d,1):
        L=[]
        for b in pg.get_text('dict')['blocks']:
            for l in b.get('lines',[]):
                t=''.join(s['text'] for s in l['spans']).strip()
                if t: L.append((l['bbox'],t))
        series=[t for _,t in L if t.endswith('SERIES') and t!='SINTERED STONE SERIES']
        for (bx,t) in L:
            if not CODE.match(t): continue
            x,y=bx[0],bx[1]
            near=[(b2,t2) for (b2,t2) in L if -20<=b2[1]-y<=75 and -5<=b2[0]-x<=300 and (b2,t2)!=(bx,t)]
            size=[t2 for b2,t2 in near if t2.startswith('SIZE') and abs(b2[0]-x)<10]
            if not size: continue
            size=min([(abs(b2[1]-y),t2) for b2,t2 in near if t2.startswith('SIZE') and abs(b2[0]-x)<10])[1]
            rem=[(abs(b2[1]-y),t2) for b2,t2 in near if re.match(r'^(SURFACE|REMARK)',t2) and abs(b2[0]-x)<10]
            rem=min(rem)[1] if rem else ''
            thk=[(abs(b2[1]-y),t2) for b2,t2 in near if re.match(r'^\d+(\.\d+)?\s*mm$',t2,re.I)]
            thk=min(thk)[1] if thk else ''
            nm=[(b2[1]-y,t2) for b2,t2 in near if 5<b2[1]-y<20 and abs(b2[0]-x)<10 and not re.match(r'^(SIZE|SURFACE|REMARK|THICKNESS)',t2)]
            nm=min(nm)[1] if nm else ''
            out.append(dict(file=label,page=n,code=t,name=nm,size=size.split(':',1)[1].strip(),finish=rem.split(':',1)[1].strip() if rem else '',thk=thk,series=series[0] if series else ''))
json.dump(out,open(sys.argv[3],'w',encoding='utf-8'),ensure_ascii=False,indent=0)
print(len(out))
from collections import Counter
print(Counter((o['file'],o['series'] or o['finish']) for o in out))
for o in out:
    if not o['name'] or not o['thk']: print('MISSING',o)
