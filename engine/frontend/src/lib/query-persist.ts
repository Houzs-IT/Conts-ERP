// Lightweight localStorage snapshot for the SCM document-list queries, modelled
// on HOOKKA's cached-fetch layer: render the last-known list INSTANTLY on a cold
// open (fresh session / full reload / PWA reopen) and revalidate in the
// background — no full-load spinner. react-query's in-memory cache already makes
// warm re-visits instant; this survives a reload, which the in-memory cache does
// not.
//
// HOOKKA guardrails baked in:
//   - Per-BUILD namespace (bug 1b/2f): the key carries the build id so a deploy
//     that changes a list's payload SHAPE can't hydrate the previous build's
//     shape; old-build snapshots are pruned on boot.
//   - Per-SESSION namespace (off-not-hide, 2026-07-16): the key also carries a
//     fingerprint of the bearer TOKEN, so one user's snapshot can never hydrate
//     into another user's session. Without this the snapshot was keyed by build +
//     company ONLY, so signing out of an admin account and signing in as a
//     restricted one on the same browser hydrated the ADMIN's rows — the list
//     painted them, then the scoped refetch removed them (render-then-hide).
//   - Logged-out browsers hold NO snapshot: with no token we prune and never
//     hydrate, so business rows don't sit at rest after sign-out.
//   - Never trusted as fresh: hydrated data is stamped stale so the first mount
//     always refetches (cache-while-revalidate).
//   - Whitelisted to the document LISTS only (not detail / sub-resource queries),
//     size-capped, and fail-soft on quota / corruption.
//   - Beta project pages (board, detail, workspace, records of the last few
//     projects) live in a second slot ("...:beta") with their own cap, under the
//     same build / session / company namespace, so the same rules apply.

import type { QueryClient } from "@tanstack/react-query";
import { authSessionFingerprint, subscribeAuthTokenChange } from "./authToken";
import {
  getActiveCompanyId,
  hasStoredCompanySelection,
  subscribeActiveCompany,
} from "./activeCompany";
import { BUILD_ID } from "./buildId";

// Unique per deploy; read from index.html (lib/buildId.ts), never compiled in.
const NS_PREFIX = "houzs-rq-snapshot:";
const BUILD_PREFIX = `${NS_PREFIX}${BUILD_ID}:`;
const MAX_BYTES = 1_500_000; // ~1.5 MB — skip the write if the snapshot exceeds it
const DEBOUNCE_MS = 1200;
const IDLE_TIMEOUT_MS = 5000;

// The snapshot is namespaced by BUILD (payload-shape drift, HOOKKA bug 1b/2f) AND
// by ACTIVE COMPANY — a cold open after switching company must NOT hydrate the
// other company's list (multi-company isolation). Both are read at call time
// because the active company can change during a session.
function activeCompany(): string {
  return String(getActiveCompanyId() ?? 0);
}

/**
 * Is the "0" bucket honest right now?
 *
 * `getActiveCompanyId()` is null in two very different situations: a
 * single-company install where nobody ever picks a company (0 genuinely means
 * "the backend hostname default"), and a brand-new tab on a multi-company
 * install in the moments before /auth/me says who we are. Hydrating the "0"
 * snapshot in the SECOND case can paint the default company's rows into a tab
 * that is about to resolve to another company — the exact cross-company
 * staleness the company namespace exists to prevent.
 *
 * The two are distinguishable: a browser where somebody has ever picked a
 * company carries a durable per-user record. When one exists and this tab has
 * not resolved yet, hydration waits for adoption instead of guessing.
 */
function companyBucketIsTrustworthy(): boolean {
  if (getActiveCompanyId() !== null) return true;
  return !hasStoredCompanySelection();
}
// Identity fingerprint for the CURRENT session. The bearer token is the only
// identity signal available synchronously at module-init time (hydrate runs
// before the first render, long before /auth/me resolves), and it already lives
// in the same storage — so a non-reversible short hash of it adds no exposure
// while making the namespace change the moment the signed-in user changes.
// Empty string when signed out.
function sessionFp(): string {
  return authSessionFingerprint();
}

/** Prefix owned by the CURRENT build + signed-in session (all companies). */
function sessionPrefix(): string {
  return `${BUILD_PREFIX}${sessionFp()}:`;
}

function snapKey(): string {
  return `${sessionPrefix()}${activeCompany()}`;
}

/** Drop every snapshot this module owns, across all builds/sessions/companies. */
export function clearQuerySnapshots(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // storage disabled / quota — nothing to clear.
  }
}

// The SCM document LIST query entities (first key segment). Detail queries use a
// distinct entity name ('*-detail') and are excluded automatically.
const LIST_ENTITIES = new Set([
  "mfg-sales-orders",
  "mfg-purchase-orders",
  "mfg-delivery-orders",
  "sales-invoices",
  "grns",
]);
// Sub-resource queries share a list entity's prefix but must NOT be persisted.
const SUBRESOURCE = new Set([
  "debtors",
  "deliverable-so-lines",
  "outstanding-po-items",
  "outstanding-so-items",
  "payments",
  "detail",
]);

function isListKey(key: readonly unknown[]): boolean {
  if (key.length < 2) return false;
  const entity = key[0];
  const second = key[1];
  if (typeof entity !== "string" || !LIST_ENTITIES.has(entity)) return false;
  /* Match the sub-resource name ANYWHERE in the key, not just at segment 1.
     The rule above ("must NOT be persisted") was already the intent; the test
     was `SUBRESOURCE.has(key[1])`, and the three PAYMENT LEDGERS put the id
     there instead — ['mfg-delivery-orders', <uuid>, 'payments'],
     ['mfg-sales-orders', <docNo>, 'payments'], ['sales-invoices', <uuid>,
     'payments'] — so every one of them passed the guard and was written to
     localStorage, then rehydrated (stamped updatedAt:1) on the next cold open.
     That put a PAYMENT LEDGER OF UNKNOWN AGE on disk and handed it back as
     query `data` — indistinguishable, to a reader, from a fresh successful
     read. MobilePOD turns exactly that data into the balance a driver
     collects, so a snapshot taken before the customer paid at the office could
     re-present a settled balance as outstanding while the real fetch was still
     in flight (fix/pod-balance, 2026-07-17).
     Scanning every segment cannot over-reject: SUBRESOURCE holds fixed
     sub-names, and the real list keys' other segments are statuses, 'all', or
     ids — none of which collide. ['mfg-purchase-orders', status, supplierId]
     is a LEGITIMATE 3-segment list key and still persists, which is why this
     is a name scan and not a length cap. */
  if (typeof second !== "string") return false;
  if (key.some((seg) => typeof seg === "string" && SUBRESOURCE.has(seg))) return false;
  return true;
}

// Beta (renovation workspace) queries are built by hooks/useQuery as
// ["uq", "renovation-beta", <kind>, ...]. Every Beta key starts that way (see the
// naming rule at the top of pages/renovation-beta/renovationBetaBoardApi.ts).
// isBetaKey is the broad match (sign-out clearing); only the kinds a project page
// and its tabs need to open without a spinner are written to disk. The timeline is
// left out on purpose: it is a live feed that always refetches on mount.
const BETA_SAVED_KINDS = new Set([
  "board", "detail", "workspace", "records",
  "site", "lines", "photos", "vo", "client-po", "defects", "sheets",
]);
const BETA_MAX_BYTES = 1_000_000; // ~1 MB — over this the oldest projects are dropped, the write still happens
const BETA_MAX_PROJECTS = 5;
const BETA_MAX_SHARED_BOARDS = 3; // all-project boards (Home, Calendar windows) kept beside the projects

export function isBetaKey(key: readonly unknown[]): boolean {
  return key[0] === "uq" && key[1] === "renovation-beta";
}

function isBetaSavedKey(key: readonly unknown[]): boolean {
  const kind = key[2];
  return isBetaKey(key) && typeof kind === "string" && BETA_SAVED_KINDS.has(kind);
}

// The project a Beta entry belongs to, or 0 for an all-project board. Detail,
// workspace and records carry the id first (["uq","renovation-beta",kind,id,...]);
// the board carries it after its date window (["uq","renovation-beta","board",from,to,id,...]).
function betaProjectId(key: readonly unknown[]): number {
  const id = key[key[2] === "board" ? 5 : 3];
  return typeof id === "number" && id > 0 ? id : 0;
}

interface BetaEntry {
  key: readonly unknown[];
  data: unknown;
  project: number;
  at: number;
}

/** The Beta slot's JSON: the newest few projects, trimmed to the cap, or null when there is nothing to keep. */
function betaSnapshot(qc: QueryClient): string | null {
  const entries: BetaEntry[] = [];
  for (const q of qc.getQueryCache().getAll()) {
    const key: readonly unknown[] = q.queryKey;
    if (q.state.status !== "success" || q.state.data == null || !isBetaSavedKey(key)) continue;
    entries.push({ key, data: q.state.data, project: betaProjectId(key), at: q.state.dataUpdatedAt });
  }
  // A project is as recent as its newest entry. Keep the latest few, newest first.
  const seen = new Map<number, number>();
  for (const { project, at } of entries) if (project > 0) seen.set(project, Math.max(seen.get(project) ?? 0, at));
  const projects = [...seen].sort((a, b) => b[1] - a[1]).slice(0, BETA_MAX_PROJECTS).map(([id]) => id);
  const shared = entries.filter((e) => e.project === 0).sort((a, b) => b.at - a.at).slice(0, BETA_MAX_SHARED_BOARDS);
  // Only what is kept gets serialised: a dropped project costs nothing on each save.
  const piece = (e: BetaEntry): string => `${JSON.stringify(JSON.stringify(e.key))}:${JSON.stringify(e.data)}`;
  const groups = projects.map((id) => entries.filter((e) => e.project === id).map(piece));
  const sharedPieces = shared.map(piece);
  // The written string, braces and commas included, so the cap is the real size.
  const bytes = (): number => [...sharedPieces, ...groups.flat()].reduce((n, p) => n + p.length + 1, 2);
  // Over the cap: oldest project first, the all-project boards last.
  while (groups.length > 0 && bytes() > BETA_MAX_BYTES) groups.pop();
  while (sharedPieces.length > 0 && bytes() > BETA_MAX_BYTES) sharedPieces.pop();
  const kept = [...sharedPieces, ...groups.flat()];
  if (kept.length === 0) return null;
  return `{${kept.join(",")}}`;
}

/** Serialize the whitelisted list queries to localStorage. */
function save(qc: QueryClient, company: string, session: string): void {
  // Signed out → never write. Otherwise a sign-out mid-debounce would persist the
  // outgoing user's rows under the anonymous key.
  // This QueryClient belongs to the company/session that installed persistence.
  // A company switch stores the new company id before reloading, and `pagehide`
  // then fires while this page still holds the OLD company's cache. Never write
  // those rows into the newly selected company's namespace.
  if (!session || sessionFp() !== session || activeCompany() !== company) return;
  try {
    const out: Record<string, unknown> = {};
    for (const q of qc.getQueryCache().getAll()) {
      if (q.state.status !== "success" || q.state.data == null) continue;
      if (!isListKey(q.queryKey as readonly unknown[])) continue;
      out[JSON.stringify(q.queryKey)] = q.state.data;
    }
    const json = JSON.stringify(out);
    if (json.length <= MAX_BYTES) localStorage.setItem(`${BUILD_PREFIX}${session}:${company}`, json);
  } catch {
    // quota exceeded / serialization error → skip this write.
  }
  // Beta has its own slot and cap, so a big project never crowds out the SCM
  // lists above (and a full SCM snapshot never blocks Beta).
  try {
    const beta = betaSnapshot(qc);
    const slot = `${BUILD_PREFIX}${session}:${company}:beta`;
    if (beta) localStorage.setItem(slot, beta);
    else localStorage.removeItem(slot);
  } catch {
    // Quota / serialization error: drop the old Beta slot rather than leave it taking space the SCM lists need.
    try {
      localStorage.removeItem(`${BUILD_PREFIX}${session}:${company}:beta`);
    } catch {
      // storage disabled: nothing to remove.
    }
  }
}

/** Seed the cache from the last snapshot, stamped stale so it revalidates. */
function hydrate(qc: QueryClient): void {
  // Signed out → hold nothing at rest and hydrate nothing.
  if (!sessionFp()) {
    clearQuerySnapshots();
    return;
  }
  try {
    // Prune every snapshot not owned by the current BUILD + SESSION: an old
    // payload shape must never linger, and another user's rows must never be
    // hydratable. Keep this session's per-company snapshots so switching company
    // and back is still instant. This also self-heals a browser already carrying
    // a pre-fix (build+company-only) snapshot — it simply doesn't match.
    const keep = sessionPrefix();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS_PREFIX) && !k.startsWith(keep)) localStorage.removeItem(k);
    }
    seed(qc, localStorage.getItem(snapKey()), isListKey);
  } catch {
    // Corrupt snapshot → ignore and start clean.
  }
  try {
    seed(qc, localStorage.getItem(`${snapKey()}:beta`), isBetaSavedKey);
  } catch {
    // Corrupt Beta snapshot → ignore; the SCM lists above are already in.
  }
}

function seed(qc: QueryClient, raw: string | null, accept: (key: readonly unknown[]) => boolean): void {
  if (!raw) return;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
  const saved: Array<[string, unknown]> = Object.entries(parsed);
  for (const [keyStr, data] of saved) {
    let key: unknown;
    try {
      key = JSON.parse(keyStr);
    } catch {
      continue;
    }
    if (!Array.isArray(key) || !accept(key)) continue;
    // updatedAt in the distant past → stale on first mount, so react-query
    // renders this snapshot instantly (no spinner) and refetches in the
    // background, replacing it with fresh data. Never treated as fresh.
    qc.setQueryData(key, data, { updatedAt: 1 });
  }
}

let disposeInstalledPersist: (() => void) | undefined;

/** Wire persistence: hydrate now (before first render) + save on cache changes. */
export function installQueryPersist(qc: QueryClient): () => void {
  // This application owns one global QueryClient. Make accidental re-installs
  // replace the previous wiring instead of accumulating cache/window listeners.
  disposeInstalledPersist?.();
  if (typeof window === "undefined" || !("localStorage" in window)) return () => {};
  let hydrated = false;
  if (companyBucketIsTrustworthy()) {
    hydrate(qc);
    hydrated = true;
  }
  // Capture the tenant context owned by this QueryClient. A delayed/flush save
  // must not change destination merely because the switcher updated storage.
  let installedCompany = activeCompany();
  let installedSession = sessionFp();
  // True only while this QueryClient was installed BEFORE the tab knew its
  // tenant. A deliberate company switch is a different thing entirely — it is
  // followed by a full reload, and its pending flush must keep writing to the
  // OLD bucket (see the pagehide/visibilitychange test).
  let awaitingCompany = getActiveCompanyId() === null;
  let disposed = false;
  let timer: number | undefined;
  let idleHandle: number | undefined;
  let idleFallback: number | undefined;
  const runSave = () => {
    idleHandle = undefined;
    idleFallback = undefined;
    save(qc, installedCompany, installedSession);
  };
  const scheduleIdleSave = () => {
    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(runSave, { timeout: IDLE_TIMEOUT_MS });
    } else {
      // Safari/WebViews without requestIdleCallback: yield at least one task so
      // a large JSON snapshot never runs inside the query notification stack.
      idleFallback = window.setTimeout(runSave, 0);
    }
  };
  const schedule = () => {
    if (disposed) return;
    if (timer !== undefined || idleHandle !== undefined || idleFallback !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      scheduleIdleSave();
    }, DEBOUNCE_MS);
  };
  const unsubscribeCache = qc.getQueryCache().subscribe(schedule);
  // Flush the latest state when the tab is hidden/closed so a snapshot taken
  // <DEBOUNCE_MS after the last change isn't lost.
  const flush = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    if (idleHandle !== undefined && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleHandle);
    }
    if (idleFallback !== undefined) window.clearTimeout(idleFallback);
    timer = undefined;
    idleHandle = undefined;
    idleFallback = undefined;
    save(qc, installedCompany, installedSession);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush();
  };
  window.addEventListener("pagehide", flush);
  window.addEventListener("visibilitychange", onVisibilityChange);

  const unsubscribeAuth = subscribeAuthTokenChange(() => {
    // Token changes are explicit identity lifecycle events. Cancel any work
    // owned by the previous identity and remove its list data before binding
    // this QueryClient to the next session. A company switch emits no token
    // event, so it cannot rebind and its old-cache flush remains refused.
    cancelPending();
    qc.removeQueries({
      predicate: (query) => {
        const key = query.queryKey as readonly unknown[];
        return isListKey(key) || isBetaKey(key);
      },
    });
    installedSession = sessionFp();
    installedCompany = activeCompany();
    awaitingCompany = getActiveCompanyId() === null;
    hydrated = hydrated && !awaitingCompany;
    if (!installedSession) clearQuerySnapshots();
  });

  // On a cold open in a new tab the active company resolves AFTER install:
  // adoptActiveCompanyForUser runs when /auth/me lands. Bind to the bucket that
  // is now known to be right and take the hydration deliberately skipped above.
  // Strictly the FIRST resolution — a later switch must not re-point this
  // client, or a queued flush would relabel one company's rows as another's.
  const unsubscribeCompany = subscribeActiveCompany(() => {
    if (!awaitingCompany) return;
    if (getActiveCompanyId() === null) return;
    awaitingCompany = false;
    cancelPending();
    installedCompany = activeCompany();
    if (!hydrated) {
      hydrate(qc);
      hydrated = true;
    }
  });

  function cancelPending(): void {
    if (timer !== undefined) window.clearTimeout(timer);
    if (idleHandle !== undefined && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleHandle);
    }
    if (idleFallback !== undefined) window.clearTimeout(idleFallback);
    timer = undefined;
    idleHandle = undefined;
    idleFallback = undefined;
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelPending();
    unsubscribeCache();
    unsubscribeAuth();
    unsubscribeCompany();
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("visibilitychange", onVisibilityChange);
    if (disposeInstalledPersist === dispose) disposeInstalledPersist = undefined;
  };
  disposeInstalledPersist = dispose;
  return dispose;
}
