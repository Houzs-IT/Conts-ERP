import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { Button } from "../../components/Button";
import { Skeleton } from "../../components/Skeleton";
import { useQuery } from "../../hooks/useQuery";
import { useToast } from "../../hooks/useToast";
import { api } from "../../api/client";
import { cn } from "../../lib/utils";
import type { Role } from "../../types";

export interface CategoryTreeSub {
  code: string;
  label: string;
}

export interface CategoryTreeGroup {
  code: string;
  label: string;
  subs: CategoryTreeSub[];
}

/** GET /api/roles/:id/category-access. `subs` holds "GROUP/SUB" codes. */
export interface CategoryAccessAnswer {
  restricted: boolean;
  groups: string[];
  subs: string[];
  other: boolean;
  catalog: CategoryTreeGroup[];
}

type BoxState = "on" | "partial" | "off";

const subKey = (group: string, sub: string): string => `${group}/${sub}`;

/** The same text for the same ticks, whatever order they were made in. With "All categories" on the ticks do not
    count (nothing is stored for them), so they never read as an unsaved change. */
const draftKey = (all: boolean, groups: ReadonlySet<string>, subs: ReadonlySet<string>, other: boolean): string =>
  all ? JSON.stringify([true]) : JSON.stringify([false, [...groups].sort(), [...subs].sort(), other]);

export interface RoleCategoryAccessProps {
  role: Role;
  canManage: boolean;
}

interface BoxProps {
  state: BoxState;
  readOnly: boolean;
  label: string;
  onClick: () => void;
}

interface SwitchProps {
  on: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}

/**
 * "Product categories" on a role: which categories and sub-categories the role sees on the Renovation project
 * screens (PO, Client PO and VO tabs). Switch on "All categories" (the default) and nothing is hidden. Switched off,
 * only the ticked groups, sub-categories and "Uncategorised" lines are shown. It has its own Save, apart from the
 * permission matrix, because it is stored on its own (PUT /api/roles/:id/category-access).
 */
export function RoleCategoryAccess({ role, canManage }: RoleCategoryAccessProps): ReactElement {
  const toast = useToast();
  const q = useQuery<CategoryAccessAnswer>(
    "/api/roles/category-access",
    () => api.get<CategoryAccessAnswer>(`/api/roles/${role.id}/category-access`),
    [role.id]
  );

  const [all, setAll] = useState(true);
  const [groups, setGroups] = useState<ReadonlySet<string>>(new Set());
  const [subs, setSubs] = useState<ReadonlySet<string>>(new Set());
  const [other, setOther] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState(draftKey(true, new Set(), new Set(), false));
  const [busy, setBusy] = useState(false);

  // Seed the draft from the server whenever the answer (re)loads.
  useEffect(() => {
    const d = q.data;
    if (!d) return;
    // The server already leaves out codes the catalog no longer has; a group missing from the drawn tree is dropped here too.
    const groupCodes = new Set(d.catalog.map((c) => c.code));
    const g = new Set(d.groups.filter((x) => groupCodes.has(x)));
    const s = new Set(d.subs);
    setAll(!d.restricted);
    setGroups(g);
    setSubs(s);
    setOther(d.other);
    setOpen(new Set(d.catalog.filter((c) => c.subs.some((x) => s.has(subKey(c.code, x.code)))).map((c) => c.code)));
    setSaved(draftKey(!d.restricted, g, s, d.other));
  }, [q.data]);

  const catalog = q.data?.catalog ?? [];
  const readOnly = !canManage;
  const nothingTicked = !all && groups.size === 0 && subs.size === 0 && !other;
  const dirty = draftKey(all, groups, subs, other) !== saved;

  const stateOf = useMemo(
    () =>
      (g: CategoryTreeGroup): BoxState => {
        if (groups.has(g.code)) return "on";
        return g.subs.some((x) => subs.has(subKey(g.code, x.code))) ? "partial" : "off";
      },
    [groups, subs]
  );

  function toggleGroup(g: CategoryTreeGroup) {
    if (readOnly) return;
    const g2 = new Set(groups);
    const s2 = new Set(subs);
    if (g2.has(g.code)) {
      g2.delete(g.code);
    } else {
      // Off or part ticked: tick the whole group (its single sub-category ticks are then redundant).
      g2.add(g.code);
      for (const x of g.subs) s2.delete(subKey(g.code, x.code));
    }
    setGroups(g2);
    setSubs(s2);
  }

  function toggleSub(g: CategoryTreeGroup, sub: CategoryTreeSub) {
    if (readOnly) return;
    const g2 = new Set(groups);
    const s2 = new Set(subs);
    const key = subKey(g.code, sub.code);
    if (g2.has(g.code)) {
      // The group was ticked whole: untick this one and keep the others one by one.
      g2.delete(g.code);
      for (const x of g.subs) if (x.code !== sub.code) s2.add(subKey(g.code, x.code));
    } else if (s2.has(key)) {
      s2.delete(key);
    } else {
      s2.add(key);
    }
    setGroups(g2);
    setSubs(s2);
  }

  function toggleOpen(code: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }

  function discard() {
    const d = q.data;
    if (!d) return;
    const groupCodes = new Set(d.catalog.map((c) => c.code));
    setAll(!d.restricted);
    setGroups(new Set(d.groups.filter((x) => groupCodes.has(x))));
    setSubs(new Set(d.subs));
    setOther(d.other);
  }

  async function save() {
    if (nothingTicked) return;
    setBusy(true);
    try {
      await api.put(`/api/roles/${role.id}/category-access`, {
        restricted: !all,
        groups: [...groups],
        subs: [...subs],
        other,
      });
      toast.success(all ? "This role sees all categories." : "Category access saved.");
      setSaved(draftKey(all, groups, subs, other));
      q.reload();
    } catch (e) {
      toast.error((e instanceof Error && e.message) || "Could not save the category access.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-border-subtle">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">Product categories</div>
          <div className="mt-0.5 max-w-[560px] text-[11.5px] text-ink-muted [text-wrap:pretty]">
            Choose which product categories this role sees on the Renovation project screens (PO, Client PO and VO
            tabs). Lines in the other categories are hidden. The main Supply Chain screens are not covered yet.
          </div>
        </div>
        <label className="flex flex-none items-center gap-2 text-[12.5px] font-medium text-ink">
          <Switch on={all} disabled={readOnly || q.loading || !q.data} onChange={setAll} ariaLabel="All categories" />
          All categories
        </label>
      </div>

      {q.loading && (
        <div className="px-4 pb-4">
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      )}
      {q.error && !q.loading && <div className="px-4 pb-4 text-[12px] text-err">{q.error}</div>}

      {q.data && !all && (
        <div className="border-t border-border-subtle">
          {catalog.map((g) => {
            const st = stateOf(g);
            const isOpen = open.has(g.code);
            return (
              <div key={g.code} className="border-b border-border-subtle">
                <div className="flex items-center gap-2.5 bg-surface px-4 py-2 hover:bg-surface-dim">
                  <Box state={st} readOnly={readOnly} label={g.label} onClick={() => toggleGroup(g)} />
                  <button
                    type="button"
                    onClick={() => toggleOpen(g.code)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <span className="truncate text-[13px] font-medium text-ink">{g.label}</span>
                    <span className="text-[11px] tabular-nums text-ink-muted">
                      {st === "on" ? "all" : `${g.subs.filter((x) => subs.has(subKey(g.code, x.code))).length} of ${g.subs.length}`}
                    </span>
                    <ChevronDown
                      size={13}
                      className={cn("ml-auto flex-none text-border-strong transition-transform duration-[120ms]", !isOpen && "-rotate-90")}
                    />
                  </button>
                </div>
                {isOpen && (
                  <div className="bg-surface-2 py-1">
                    {g.subs.map((x) => (
                      <div key={x.code} className="flex items-center gap-2.5 py-1.5 pl-11 pr-4">
                        <Box
                          state={st === "on" || subs.has(subKey(g.code, x.code)) ? "on" : "off"}
                          readOnly={readOnly}
                          label={`${g.label}, ${x.label}`}
                          onClick={() => toggleSub(g, x)}
                        />
                        <span className="text-[12.5px] text-ink-secondary">{x.label}</span>
                      </div>
                    ))}
                    {g.subs.length === 0 && <div className="py-1.5 pl-11 pr-4 text-[11.5px] text-ink-muted">No sub-categories.</div>}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-2.5 border-b border-border-subtle bg-surface px-4 py-2">
            <Box state={other ? "on" : "off"} readOnly={readOnly} label="Uncategorised" onClick={() => !readOnly && setOther((v) => !v)} />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">Uncategorised</div>
              <div className="text-[11px] text-ink-muted">Products that have no category yet.</div>
            </div>
          </div>
        </div>
      )}

      {q.data && (dirty || nothingTicked) && canManage && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle bg-surface-2 px-4 py-2.5">
          <span className={cn("text-[11.5px]", nothingTicked ? "text-err" : "text-ink-muted")}>
            {nothingTicked ? "Tick at least one category, or switch All categories back on." : "Unsaved changes to category access."}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={discard} className="h-[30px] px-2.5 text-[12px]">
              Discard
            </Button>
            <Button variant="primary" onClick={save} disabled={busy || nothingTicked || !dirty} className="h-[30px] px-3 text-[12px]">
              {busy ? "Saving…" : "Save categories"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Box({ state, readOnly, label, onClick }: BoxProps): ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "partial" ? "mixed" : state === "on"}
      aria-label={label}
      disabled={readOnly}
      onClick={onClick}
      className={cn(
        "flex h-4 w-4 flex-none items-center justify-center rounded border",
        state === "on" && "border-primary bg-primary text-white",
        state === "partial" && "border-accent bg-accent-soft text-accent",
        state === "off" && "border-border-strong bg-surface text-transparent",
        !readOnly && state === "off" && "hover:border-primary"
      )}
    >
      {state === "partial" ? <Minus size={10} /> : <Check size={10} />}
    </button>
  );
}

function Switch({ on, disabled, onChange, ariaLabel }: SwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60",
        on ? "border-primary bg-primary" : "border-border bg-surface-dim"
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-[18px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );
}
