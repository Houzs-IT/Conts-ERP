/* Pure rules behind the Design card and the procurement sub-category dates
   (owner feedback, 14 Oct 2026). */

type FileLike = { id: number; submitted_on: string | null; uploaded_at: string };
type NoteLike = { id: number; noted_on: string; closed_by_file_id: number | null };

export interface TwoDVersion<F, N> { file: F; number: number; answered: N[] }
export interface TwoDRequest<N> { note: N; number: number; open: boolean; answeredBy: number | null }
export interface TwoDTimeline<F, N> {
  /** Newest first. number = V1..Vn by submit date, so older data reads the same way. */
  versions: Array<TwoDVersion<F, N>>;
  /** Newest first. */
  requests: Array<TwoDRequest<N>>;
  state: "none" | "submitted" | "amending";
  openCount: number;
}

const submitKey = (f: FileLike) => `${(f.submitted_on ?? f.uploaded_at).slice(0, 10)}|${f.uploaded_at}|${String(f.id).padStart(12, "0")}`;

/**
 * 2D: V1 is the first submission; an open amendment request puts 2D in Amending until an amended version (V2 on)
 * answers it. V1 never answers a request (owner, 15 Oct 2026): one recorded as closed by V1 reads as open.
 */
export function twoDTimeline<F extends FileLike, N extends NoteLike>(files: readonly F[], notes: readonly N[]): TwoDTimeline<F, N> {
  const asc = [...files].sort((a, b) => (submitKey(a) < submitKey(b) ? -1 : submitKey(a) > submitKey(b) ? 1 : 0));
  const numberOf = new Map(asc.map((f, i) => [f.id, i + 1]));
  const v1Id = asc[0]?.id;
  const closedBy = (n: NoteLike): number | null => (n.closed_by_file_id == null || n.closed_by_file_id === v1Id ? null : n.closed_by_file_id);
  const byNew = [...notes].sort((a, b) => (a.noted_on === b.noted_on ? b.id - a.id : a.noted_on < b.noted_on ? 1 : -1));
  const versions = asc.map((f, i) => ({
    file: f,
    number: i + 1,
    answered: i === 0 ? [] : [...notes].filter((n) => closedBy(n) === f.id).sort((a, b) => (a.noted_on === b.noted_on ? a.id - b.id : a.noted_on < b.noted_on ? -1 : 1)),
  })).reverse();
  const asc2 = [...byNew].reverse();
  const reqNo = new Map(asc2.map((n, i) => [n.id, i + 1]));
  const requests = byNew.map((n) => {
    const by = closedBy(n);
    return { note: n, number: reqNo.get(n.id) ?? 0, open: by == null, answeredBy: by == null ? null : numberOf.get(by) ?? null };
  });
  const openCount = requests.filter((r) => r.open).length;
  const state = asc.length === 0 ? "none" : openCount > 0 ? "amending" : "submitted";
  return { versions, requests, state, openCount };
}

export type DesignStepKey = "onsite" | "3d" | "2d";

/** The step that opens by default: the first one with nothing recorded (2D once everything has an entry). */
export function currentDesignStep(c: { onsite: number; threeD: number; twoD: number }): DesignStepKey {
  if (c.onsite === 0) return "onsite";
  if (c.threeD === 0) return "3d";
  return "2d";
}

type SubLike = { mode: "follow" | "own" | "none"; effective: { poDate: string | null; deliveryDate: string | null } };
export type SubDateBody = { mode: "own"; poDate: string | null; deliveryDate: string | null } | { mode: "none" };

/** Typing a sub-category date makes it its own (keeping the other date it showed); emptying both means no dates. */
export function subDateEdit(s: SubLike, field: "po" | "delivery", value: string | null): SubDateBody {
  const poDate = field === "po" ? value : s.effective.poDate;
  const deliveryDate = field === "delivery" ? value : s.effective.deliveryDate;
  return poDate == null && deliveryDate == null ? { mode: "none" } : { mode: "own", poDate, deliveryDate };
}

/** The plain status in the Design card header. */
export function designStatus(c: { onsite: number; threeD: number; twoD: number }, twoD: "none" | "submitted" | "amending"): string {
  if (c.onsite === 0) return "Waiting for onsite";
  if (c.threeD === 0) return "Waiting for 3D";
  if (c.twoD === 0) return "Waiting for 2D";
  return twoD === "amending" ? "2D amending" : "2D submitted";
}
