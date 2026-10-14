/* Every "pick a person" field on a renovation project reads the people list, which comes from the company's user
   accounts (owner, 14 Oct 2026): one person per account, labelled "Name · Position · Department" from the account.
   People imported from Notion that are not an account keep their name on old records but are not offered.
   One person, or several (in-house crew of a site task). */

import { X } from "lucide-react";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { PERSON_ROLE_LABEL } from "../../../vendor/shared/renovation-stages";
import { simpleApi, type Person, type PersonRole } from "./simpleApi";
import { inputClass } from "./renovationUi";

/** The position shown after a person's name (owner, 14 Oct 2026): the Position on the person's user account. A person
    not linked to an account (imported history) has none. Only a server from before migration 0113 (no `offered` on
    its rows) falls back to the old people master's roles. */
export function personPosition(p: { roles?: readonly PersonRole[] | null; position?: string | null; offered?: boolean }): string {
  if (p.position?.trim()) return p.position.trim();
  if (p.offered !== undefined) return "";
  return (p.roles ?? []).map((r) => PERSON_ROLE_LABEL[r]).join(", ");
}

export function usePeople(role?: PersonRole) {
  return useQuery(["renovation", "people", role ?? "all"], () => simpleApi.people({ role }), [role], { staleTime: 60_000 });
}

export const CREW_LABEL = "Crew (no login)";

/** "Name · Position · Department", skipping what is not set; site crew without a login reads "Name · Crew (no login)". */
export function personLabel(p: Pick<Person, "name"> & Partial<Pick<Person, "position" | "department" | "crew">>): string {
  return [p.name, p.position || (p.crew ? CREW_LABEL : null), p.department].map((v) => (v ?? "").trim()).filter(Boolean).join(" · ");
}

/** Whether a person may be picked now: linked to an active user account. A server from before migration 0113 sends
 *  no `offered`, and then the old rule holds (active, of the asked role). */
export function isOffered(p: Person, role?: PersonRole): boolean {
  if (p.offered !== undefined) return p.offered;
  return p.active && (!role || p.roles.includes(role));
}

/** People offered, plus the current pick even when it is no longer offered (an old record keeps its name). Accounts
 *  carry no project roles, so `role` only narrows the list on a server from before migration 0113, with one exception:
 *  asked for site crew, the crew without a login (Project Maintenance) are offered too. */
export function peopleOptions(all: readonly Person[], role: PersonRole | undefined, current: readonly number[]): Person[] {
  const cur = new Set(current);
  return all.filter((p) => cur.has(p.id) || isOffered(p, role) || (role === "site_crew" && p.crew === true));
}

export const NO_PEOPLE_TEXT = "No people yet. Add them as user accounts in Property OS (Users and roles).";
const NO_CREW_TEXT = "No people yet. Add user accounts in Property OS, or crew without a login in Project Maintenance.";
const notOffered = (p: Person) => (p.offered === false || !p.active ? " (no longer listed)" : "");

export function PersonSelect({ value, onChange, role, label, disabled, placeholder = "Not set", className = inputClass }: {
  value: number | null; onChange: (id: number | null) => void; role?: PersonRole; label: string; disabled?: boolean; placeholder?: string; className?: string;
}) {
  const q = usePeople();
  const opts = peopleOptions(q.data?.data ?? [], role, value ? [value] : []);
  return (
    <select className={className} aria-label={label} value={value ?? ""} disabled={disabled || q.loading}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{q.loading ? "Loading..." : placeholder}</option>
      {opts.map((p) => <option key={p.id} value={p.id}>{personLabel(p)}{notOffered(p)}</option>)}
    </select>
  );
}

/** Several people: a PersonSelect to add one more, and a chip with a remove x for each picked. */
export function PersonMultiSelect({ value, onChange, label, placeholder = "Add person", className, disabled }: {
  value: number[]; onChange: (ids: number[]) => void; label: string; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const q = usePeople();
  const byId = new Map((q.data?.data ?? []).map((p) => [p.id, p]));
  return (
    <div className="min-w-0">
      <PersonSelect label={label} placeholder={placeholder} value={null} disabled={disabled} className={className}
        onChange={(id) => { if (id != null && !value.includes(id)) onChange([...value, id]); }} />
      {value.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1" aria-label={`${label} picked`}>
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface py-0.5 pl-2 pr-0.5 text-[11px] text-ink">
              {byId.get(id)?.name ?? `#${id}`}
              {byId.get(id) && personPosition(byId.get(id)!) && <span className="text-[10px] text-ink-secondary">· {personPosition(byId.get(id)!)}</span>}
              <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? id}`} disabled={disabled}
                className="rounded-full p-0.5 text-ink-secondary hover:bg-err/10 hover:text-err" onClick={() => onChange(value.filter((x) => x !== id))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PeoplePicker({ value, onChange, role, label, disabled }: {
  value: number[]; onChange: (ids: number[]) => void; role?: PersonRole; label: string; disabled?: boolean;
}) {
  const q = usePeople();
  const opts = peopleOptions(q.data?.data ?? [], role, value);
  if (q.loading) return <p className="text-xs text-ink-secondary">Loading people...</p>;
  if (opts.length === 0) return <p className="text-xs text-ink-secondary">{role === "site_crew" ? NO_CREW_TEXT : NO_PEOPLE_TEXT}</p>;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {opts.map((p) => {
        const on = value.includes(p.id);
        return (
          <button key={p.id} type="button" disabled={disabled} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
            className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary/10 text-ink font-medium" : "border-border text-ink-secondary hover:text-ink")}>
            {personLabel(p)}
          </button>
        );
      })}
    </div>
  );
}
