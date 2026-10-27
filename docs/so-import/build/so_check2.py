import json,sys
R=json.load(open('so_parsed.json',encoding='utf-8'))
def payable(d):
    st=d['stated']
    if st.get('FINAL TOTAL'): return st['FINAL TOTAL'][-1],'final'
    s_=lines(d)
    for k,how in (('FINAL TOTAL X','finalx'),('GRAND TOTAL X','grandx'),('RM','rm'),('GRAND TOTAL','grand')):
        if st.get(k) and (s_ == 0 or st[k][-1] >= 0.5 * s_): return st[k][-1],how
    T=st.get('TOTAL',[])
    if not T: return None,'none'
    if len(T)>1 and abs(sum(T[:-1])-T[-1])<1: return T[-1],'sumtotal'
    return sum(T),'pagetotals'
def qn(q):
    try: return float(q)
    except: return 1.0
def net(i, discfmt=True):
    p,a=i['price'],i['amt']
    if p is not None and a is not None:
        if abs(qn(i['qty'])*p-a)<1: return a
        if i.get('disc') or (discfmt and p<a): return p
        return a
    return a if a is not None else (p or 0)
def lines(d): return sum(net(i, 'DISC' in (d['fmt'] or '')) for i in d['items'])
out=[]
for f,d in R.items():
    p,how=payable(d); s=lines(d)
    diff=s-(p or 0)
    out.append((f,p,how,s,diff))
    d['payable']=p; d['payable_how']=how; d['lines_sum']=s
json.dump(R,open('so_parsed.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
exact=[o for o in out if o[1] and abs(o[4])<1.5]
disc=[o for o in out if o[1] and o[4]>=1.5]
under=[o for o in out if o[1] and o[4]<=-1.5]
print('exact',len(exact),'lines>payable (discount)',len(disc),'lines<payable',len(under),'no payable',sum(1 for o in out if not o[1]))
for name,grp in (('DISCOUNT',disc),('UNDER',under)):
    for f,p,how,s,diff in sorted(grp,key=lambda o:-abs(o[4]/(o[1] or 1))):
        print(f'{name:8} {diff/(p or 1)*100:6.1f}% lines={s:10.2f} payable={p:10.2f} ({how}) {f[:75]}')
