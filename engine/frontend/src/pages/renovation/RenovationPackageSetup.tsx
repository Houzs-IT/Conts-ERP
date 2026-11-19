/* New package: the 5-step setup the owner approved on 20 Nov 2026 (Basic info, Areas (optional), Products, SLA days
   (optional), Check and activate). A 组合 (kit) skips Areas: it has no area and goes into whatever area the salesperson
   is in. Save as draft at any step; only an Active one is offered in the sales order search. */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { PageHeader } from '../../components/Layout';
import { Button } from '../../components/Button';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../hooks/useToast';
import { refusalOf, useRenoMutation } from '../../lib/renovation/api';
import {
  createPackage, KIND_LABEL, KIND_LONG, NO_AREA, nextPackageCode, productLinesOf, type PackageKind, type PackageSection, type PackageStatus,
} from '../../lib/renovation/renovationPackagesApi';
import { Card, ErrorBanner, Field, inputCls, rm } from './shared';
import { AddAreaBar, emptyArea, PackageAddSearch, PackageLinesTable } from './RenovationPackageLines';
import { dayCell, KindPill, slaDaysOf } from './renovationPackageParts';
import { cn } from '../../lib/utils';

const STEPS: Array<[string, string]> = [
  ['Basic info', '编号、名字、类型'], ['Areas (optional)', '客厅、房间……'], ['Products', '加货和组合'],
  ['SLA days (optional)', '几天下单、几天送到'], ['Check and activate', '检查后启用'],
];

export function RenovationPackageSetup(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<PackageKind>('PACKAGE');
  const [code, setCode] = useState('');
  const codeTyped = useRef(false);
  const [name, setName] = useState('');
  const [building, setBuilding] = useState('');
  const [unitType, setUnitType] = useState('');
  const [salesNote, setSalesNote] = useState('');
  const [areas, setAreas] = useState<PackageSection[]>([emptyArea('Living room'), emptyArea('Master bedroom')]);
  const [cur, setCur] = useState(0);
  const [bulk, setBulk] = useState({ o: '', d: '' });
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    if (codeTyped.current) return;
    let live = true;
    nextPackageCode(kind).then((r) => { if (live && !codeTyped.current) setCode(r.code); }).catch(() => undefined);
    return () => { live = false; };
  }, [kind]);

  const changeKind = (k: PackageKind) => {
    setKind(k);
    if (!codeTyped.current) setCode('');
    if (k === 'KIT') setAreas((a) => [{ ...emptyArea(''), lines: a.flatMap((s) => s.lines) }]);
    else setAreas((a) => (a.length === 1 && !a[0].heading ? [{ ...emptyArea('Living room'), lines: a[0].lines }, emptyArea('Master bedroom')] : a));
    setCur(0);
  };

  const lines = productLinesOf(areas);
  const total = lines.reduce((t, l) => t + (l.skuPriceSen ?? 0) * l.qty, 0);
  const missing = lines.filter((l) => l.processingAfterDays == null && l.deliveryAfterDays == null).length;
  const headOk = code.trim() !== '' && name.trim() !== '';
  const save = useRenoMutation((status: PackageStatus) => createPackage({
    kind, code: code.trim(), name: name.trim(), building, unitType, salesNote, status,
    // An area left without a line is left out; a package without any area keeps its lines under no area.
    sections: areas.filter((s) => s.lines.length > 0),
  }));
  const finish = async (status: PackageStatus) => {
    setError(null);
    if (!headOk) { setError('Give the package a code and a name first (step 1).'); setStep(1); return; }
    try {
      const r = await save.mutateAsync(status);
      toast.success(status === 'ACTIVE' ? `${r.code} is active: sales can find it in the sales order search.` : `${r.code} saved as a draft.`);
      navigate(status === 'ACTIVE' ? '/scm/renovation/packages' : `/scm/renovation/packages/${r.id}`);
    } catch (e) { setError(refusalOf(e).message); }
  };
  const nextStep = step === 1 && kind === 'KIT' ? 3 : step + 1;
  const prevStep = step === 3 && kind === 'KIT' ? 1 : step - 1;
  const canNext = step < 5 && !(step === 1 && !headOk);
  if (!can('scm.renovation.quote')) return <div className="p-8 text-center text-[13px] text-ink-muted">You need the quotation permission to set up packages.</div>;

  return (
    <div className="space-y-4 pb-20">
      <PageHeader back="/scm/renovation/packages" eyebrow="Packages / New" title={`New ${kind === 'KIT' ? '组合' : 'package'}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <KindPill kind={kind} />
            <span className="text-[12.5px] text-ink-secondary">{lines.length} lines · {rm(total)}</span>
            <Button variant="secondary" disabled={save.isPending} onClick={() => void finish('DRAFT')}>Save as draft</Button>
          </div>
        )} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      <ol className="grid grid-cols-5 gap-1.5 rounded-xl border border-border bg-surface px-3 py-3" aria-label="Steps">
        {STEPS.map(([title, sub], i) => {
          const n = i + 1; const on = n === step; const done = n < step; const skipped = kind === 'KIT' && n === 2;
          return (
            <li key={title} className="min-w-0">
              <button type="button" disabled={skipped || (n > 1 && !headOk)} onClick={() => setStep(n)} aria-current={on ? 'step' : undefined}
                className={cn('flex w-full min-w-0 items-center gap-2 text-left disabled:cursor-not-allowed', skipped && 'opacity-40')}>
                <span className={cn('inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-[12px] font-bold',
                  on ? 'bg-primary text-white' : done ? 'bg-synced-bg text-synced' : 'bg-surface-2 text-ink-muted')}>{done ? <Check size={14} /> : n}</span>
                <span className="hidden min-w-0 sm:block">
                  <span className={cn('block truncate text-[12.5px]', on ? 'font-bold text-ink' : 'font-semibold text-ink-secondary')}>{title}</span>
                  <span className="block truncate text-[11px] text-ink-muted">{skipped ? '组合 skips this' : sub}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="text-[12.5px] font-semibold text-ink sm:hidden">Step {step}: {STEPS[step - 1][0]}</p>

      {step === 1 && (
        <Card title="Basic info">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Type"><select className={inputCls} value={kind} onChange={(e) => changeKind(e.target.value as PackageKind)}>
              <option value="PACKAGE">{KIND_LONG.PACKAGE}</option><option value="KIT">{KIND_LONG.KIT}</option></select></Field>
            <Field label="Code"><input className={cn(inputCls, 'font-mono uppercase')} value={code} onChange={(e) => { codeTyped.current = true; setCode(e.target.value.toUpperCase()); }} /></Field>
            <Field label="Name"><input className={inputCls} value={name} placeholder={kind === 'KIT' ? 'e.g. Master bedroom set (King)' : 'e.g. Skyline Embassy Type C Classic'} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Building (optional)"><input className={inputCls} value={building} onChange={(e) => setBuilding(e.target.value)} /></Field>
            <Field label="Unit type (optional)"><input className={inputCls} value={unitType} placeholder="e.g. Type A, 3 rooms" onChange={(e) => setUnitType(e.target.value)} /></Field>
            <Field label="Note for sales (optional)"><input className={inputCls} value={salesNote} placeholder="e.g. Classic look; sofa colour can change" onChange={(e) => setSalesNote(e.target.value)} /></Field>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-secondary">编号会自动建议：Package 用 <b>PKG-</b>，组合用 <b>KIT-</b>。编号就是 SO 里搜的那个字，起一个好记的。<br />组合跳过 Areas 那一步：它没有区域，带进单时放在你当时所在的区域。</p>
        </Card>
      )}

      {step === 2 && (
        <Card title="Areas (optional)">
          <div className="max-w-[560px] space-y-2">
            {areas.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <input aria-label="Area name" className={cn(inputCls, 'flex-1')} value={a.heading} placeholder={NO_AREA} onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)))} />
                <span className="w-14 text-[12px] text-ink-muted">{a.lines.length} lines</span>
                <Button variant="ghost" aria-label="Remove area" onClick={() => { const rest = areas.filter((_, j) => j !== i); setAreas(rest.length ? rest : [{ ...emptyArea(''), lines: a.lines }]); setCur(0); }}>×</Button>
              </div>
            ))}
            <AddAreaBar existing={areas.map((a) => a.heading)} onAdd={(n) => setAreas([...areas.filter((a) => a.heading || a.lines.length), emptyArea(n)])} />
          </div>
          <p className="mt-3 text-[12.5px] text-ink-secondary"><b>区域不是必填。</b>不分区域就把全部删掉，货会放在 "{NO_AREA}"，带进 SO 时放在你当时所在的区域。区域就是 SO 上的分组，名字随时可以改，打开 Package 后可以拖动换次序。</p>
        </Card>
      )}

      {step === 3 && (
        <Card title="Products">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="min-w-0 space-y-2">
              {kind === 'PACKAGE' && (
                <Field label="Adding to area"><select className={inputCls} value={cur} onChange={(e) => setCur(Number(e.target.value))}>
                  {areas.map((a, i) => <option key={i} value={i}>{a.heading || NO_AREA}</option>)}</select></Field>
              )}
              <PackageAddSearch autoFocus onAdd={(ls, label) => { setAreas(areas.map((a, i) => (i === Math.min(cur, areas.length - 1) ? { ...a, lines: [...a.lines, ...ls] } : a))); setAdded(`Added ${label}`); }} />
              {added && <p role="status" className="text-[12px] text-synced">{added}</p>}
            </div>
            <div className="min-w-0 rounded-lg border border-border">
              <PackageLinesTable sections={areas} onChange={setAreas} showAreas={kind === 'PACKAGE'} showSla={false} />
            </div>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-secondary">Package 只记<b>哪些货、几个</b>，不记价钱。价钱灰色显示今天 SKU Master 的售价，只是参考；带进 SO 时用当时的 SKU 售价，在 SO 上照样可以改。点一个组合，它的几行一次过加进来。</p>
        </Card>
      )}

      {step === 4 && (
        <Card title="SLA days (optional)">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-ink-secondary">Fill every empty line:</span>
            <input aria-label="Order after days for all" type="number" min={0} placeholder="order" className={dayCell} value={bulk.o} onChange={(e) => setBulk({ ...bulk, o: e.target.value })} />
            <input aria-label="Deliver after days for all" type="number" min={0} placeholder="deliver" className={dayCell} value={bulk.d} onChange={(e) => setBulk({ ...bulk, d: e.target.value })} />
            <Button variant="secondary" className="h-8" onClick={() => setAreas(areas.map((a) => ({ ...a, lines: a.lines.map((l) => (l.kind !== 'ITEM' && l.kind !== 'CHILD' ? l : {
              ...l,
              processingAfterDays: l.processingAfterDays ?? slaDaysOf(bulk.o),
              deliveryAfterDays: l.deliveryAfterDays ?? slaDaysOf(bulk.d),
            })) })))}>Apply</Button>
            <span className="ml-auto text-ink-muted">{missing} of {lines.length} lines without SLA</span>
          </div>
          <div className="rounded-lg border border-border"><PackageLinesTable sections={areas} onChange={setAreas} showAreas={kind === 'PACKAGE'} /></div>
          <p className="mt-3 text-[12.5px] text-ink-secondary">两个天数都从<b>开工那天</b>算起。例：下单 7、送到 30，开工 1 Dec，就是 8 Dec 前下单、31 Dec 前送到。先用 "Fill every empty line" 一次填完，特别的几行再改。空着也可以存，那行日期由人手填。</p>
        </Card>
      )}

      {step === 5 && (
        <Card title="Check and activate">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5 text-[13px]">
              {([
                [headOk, 'Code and name filled', 'fix'],
                [lines.length > 0, lines.length ? `${lines.length} lines added` : 'No product added yet', 'fix'],
                [missing === 0, missing ? `${missing} lines have no SLA days (allowed, dates typed by hand)` : 'Every line has SLA days', 'note'],
                [!areas.some((a) => a.lines.length === 0), areas.some((a) => a.lines.length === 0) ? 'An area has no lines (it will be left out)' : 'No empty area', 'note'],
              ] as Array<[boolean, string, 'fix' | 'note']>).map(([ok, text, sev]) => (
                <div key={text} className="flex items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', ok ? 'bg-synced-bg text-synced' : sev === 'note' ? 'bg-warning-bg text-warning-text' : 'bg-err-bg text-err')}>{ok ? 'OK' : sev === 'note' ? 'Note' : 'Fix'}</span>{text}
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold text-ink">{code} · {name || '(no name)'} <KindPill kind={kind} /></div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border px-3 py-2"><div className="text-[11px] text-ink-muted">Lines</div><div className="text-[18px] font-bold">{lines.length}</div></div>
                <div className="rounded-lg border border-border px-3 py-2"><div className="text-[11px] text-ink-muted">At SKU prices</div><div className="text-[18px] font-bold tabular-nums">{rm(total)}</div></div>
              </div>
              <p className="mt-2 text-[12.5px] text-ink-secondary">Save as draft：只有你看到，SO 里搜不到。<br />Activate：所有业务在 SO / VO 的搜索里都搜得到。</p>
            </div>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={step === 1} onClick={() => setStep(prevStep)}>Back</Button>
        <span className="flex-1" />
        {step < 5
          ? <Button disabled={!canNext} onClick={() => setStep(nextStep)}>Next: {STEPS[nextStep - 1][0]}</Button>
          : <Button disabled={!headOk || lines.length === 0 || save.isPending} onClick={() => void finish('ACTIVE')}>{save.isPending ? 'Saving…' : 'Activate'}</Button>}
      </div>
      <p className="text-[11.5px] text-ink-muted">{KIND_LABEL[kind]}: {kind === 'KIT' ? 'a few items that go in together, usually without an area.' : 'a whole unit, grouped by area.'}</p>
    </div>
  );
}
