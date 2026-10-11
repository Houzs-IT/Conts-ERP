/* Every "pick a person" field on a renovation project reads the people master
   (Project Maintenance). One person, or several (in-house crew of a site task). */

import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi, type Person, type PersonRole } from "./simpleApi";
import { inputClass } from "./renovationUi";

export function usePeople(role?: PersonRole) {
  return useQuery(["renovation", "people", role ?? "all"], () => simpleApi.people({ role }), [role], { staleTime: 60_000 });
}

/** People offered for a role: active ones, plus the current pick even when inactive or of another role. */
export function peopleOptions(all: readonly Person[], role: PersonRole | undefined, current: readonly number[]): Person[] {
  const cur = new Set(current);
  return all.filter((p) => cur.has(p.id) || (p.active && (!role || p.roles.includes(role))));
}

export function PersonSelect({ value, onChange, role, label, disabled, placeholder = "Not set" }: {
  value: number | null; onChange: (id: number | null) => void; role?: PersonRole; label: string; disabled?: boolean; placeholder?: string;
}) {
  const q = usePeople();
  const opts = peopleOptions(q.data?.data ?? [], role, value ? [value] : []);
  return (
    <select className={inputClass} aria-label={label} value={value ?? ""} disabled={disabled || q.loading}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{q.loading ? "Loading..." : placeholder}</option>
      {opts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactive)"}</option>)}
    </select>
  );
}

export function PeoplePicker({ value, onChange, role, label, disabled }: {
  value: number[]; onChange: (ids: number[]) => void; role?: PersonRole; label: string; disabled?: boolean;
}) {
  const q = usePeople();
  const opts = peopleOptions(q.data?.data ?? [], role, value);
  if (q.loading) return <p className="text-xs text-ink-secondary">Loading people...</p>;
  if (opts.length === 0) return <p className="text-xs text-ink-secondary">No {role === "site_crew" ? "site crew" : "people"} yet. Add them in Project Maintenance.</p>;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {opts.map((p) => {
        const on = value.includes(p.id);
        return (
          <button key={p.id} type="button" disabled={disabled} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
            className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary/10 text-ink font-medium" : "border-border text-ink-secondary hover:text-ink")}>
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
