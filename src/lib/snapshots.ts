/**
 * Saved answers of the main screens' first reads, kept in this browser per person, so the next visit shows the screen
 * at once and reads it again behind (owner, 12 Nov 2026: "kept as a snapshot, so the page shows something at once").
 *
 * The rules, all enforced here so a screen gets them without code of its own (lib/useApi.ts reads, lib/api.ts keeps):
 *  - Only the reads listed in SNAPSHOT_READS are kept. Money screens, Users and roles, permissions, System health,
 *    reveals (door codes, access credentials, IC and bank numbers) and anything answered no-store never are
 *    (NEVER_SNAPSHOT, and api.ts for no-store). Pure money reads (the dashboard trend and channels, Portfolio,
 *    Performance, the Unit report) are left out too: their figures wait for the server (owner, 12 Nov 2026, rule 3).
 *  - Each entry belongs to one person: their user id, role and a fingerprint of their permissions, levels, side and
 *    Demo mode. Another person, a role or view-as change, or any change in what the session may see drops them all.
 *  - Before an entry is shown, the session must still be allowed the area of that read (snapshotAllowed).
 *  - Any write empties them, the same rule as readCache (api.ts wrote()), and an answer from a read sent before a
 *    write is never kept (api.ts remember() and its write counter).
 *  - At most SNAPSHOT_MAX_BYTES per person; the oldest go first.
 * What a screen shows from a snapshot is display-only: lib/snapshotView.ts keeps every action disabled until the
 * fresh answer has landed.
 */

/** The parts of the session that decide what a person's reads answer. */
export interface SnapshotWho {
  id: string;
  role: string;
  permissions?: string[];
  access?: Record<string, string>;
  side?: string;
  kind?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  demo?: { on?: boolean } | null;
}

export interface SnapshotEntry { id: string; owner: string; path: string; data: unknown; savedAt: number; bytes: number }

/** Where entries live between visits (IndexedDB in the browser, a Map in the tests). */
export interface SnapshotBackend {
  loadAll(): Promise<SnapshotEntry[]>;
  put(entry: SnapshotEntry): Promise<void>;
  remove(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}

export const SNAPSHOT_MAX_BYTES = 2_000_000;

/** The reads that may be kept, each with the permission areas (functions/_lib/access.ts AREAS and ROUTE_AREAS) that
 *  must not be "none" for the snapshot to be shown. `null`: a read every signed-in desk account may make. Each path
 *  must be exactly the one the screen asks for (the same as lib/routePrefetch.ts). */
const SNAPSHOT_READS: { path: RegExp; areas: string[] | null }[] = [
  // Dashboard: the tiles (money tiles are not shown from a snapshot, DashboardPage), Today and Needs attention.
  { path: /^\/dashboard\/(kpis|today|exceptions)$/, areas: ['dashboard'] },
  // Calendar: the board and the channel marks. View-only while shown from a snapshot.
  { path: /^\/reservations\/calendar\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}(&property=[^&]+)?$/, areas: ['calendar'] },
  { path: /^\/integrations$/, areas: ['calendar'] },
  // Reservations and Guests lists (not a guest's record).
  { path: /^\/reservations(\?[^/]*)?$/, areas: ['reservations'] },
  { path: /^\/guests\?[^/]*$/, areas: ['guests'] },
  // Today, Cleaning board, Maintenance list.
  { path: /^\/operations\/day\?date=\d{4}-\d{2}-\d{2}$/, areas: ['operations'] },
  { path: /^\/housekeeping\/board\?date=\d{4}-\d{2}-\d{2}$/, areas: ['cleaning'] },
  { path: /^\/housekeeping\/cleaners\?active=1$/, areas: null },
  { path: /^\/maintenance\/issues(\?view=open&limit=\d+)?$/, areas: ['maintenance'] },
  // Units: the tree, the roster, the contract types and one unit's record (secrets are never in it).
  { path: /^\/properties$/, areas: ['properties', 'unitSettings'] },
  { path: /^\/units$/, areas: null },
  { path: /^\/units\/detail\?unitId=[^&]+$/, areas: ['properties'] },
  { path: /^\/contract-types$/, areas: null },
  // Owners list, this month.
  { path: /^\/owners$/, areas: ['owners'] },
];

/** Never kept, whatever SNAPSHOT_READS says: reveals and secrets, money screens, Users and roles, permissions,
 *  System health, sign-in and the person's own account, and exports. */
export const NEVER_SNAPSHOT = /reveal|secret|access-credentials|export|\/(finance|statements|payouts|owner-close|deductions|airbnb-recon|approvals|expenses|payment-vouchers|credit-notes|collections|bank|billing|accounting|users|departments|permissions|access-rules|system|audit|account|auth)(\/|\?|$)/i;

/** Whether a read's answer may be kept at all. */
export function snapshottable(path: string): boolean {
  return !NEVER_SNAPSHOT.test(path) && SNAPSHOT_READS.some(r => r.path.test(path));
}

const FIELD_ROLES = new Set(['housekeeper', 'technician', 'renovator']);

/** The person's level in an area, the same reading as lib/areaAccess.ts levelOf (kept here without React imports so
 *  this file loads in the tests). */
function levelIn(who: SnapshotWho, area: string): string {
  if (who.role === 'management') return 'full';
  if (who.role === 'owner' || FIELD_ROLES.has(who.role)) return 'none';
  return who.access ? who.access[area] ?? 'none' : 'edit';
}

/** Whether this session would still be allowed the read: a snapshot of a read it may no longer make is not shown. */
export function snapshotAllowed(who: SnapshotWho | null | undefined, path: string): boolean {
  if (!who || !snapshottable(path)) return false;
  if (who.role === 'owner' || FIELD_ROLES.has(who.role)) return false;
  const rule = SNAPSHOT_READS.find(r => r.path.test(path))!;
  return rule.areas === null || rule.areas.some(a => levelIn(who, a) !== 'none');
}

/** FNV-1a, enough to tell two permission sets apart in a key. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The key every entry of this person carries: user id, role, and a fingerprint of everything that changes what the
 *  server answers them (permissions, levels, side, department, position, Demo mode). */
export function snapshotOwner(who: SnapshotWho): string {
  const print = JSON.stringify([
    who.role, who.side ?? '', who.kind ?? '', who.departmentId ?? '', who.positionId ?? '', !!who.demo?.on,
    [...(who.permissions ?? [])].sort(),
    Object.entries(who.access ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
  return `${who.id}|${who.role}|${hash(print)}`;
}

let backend: SnapshotBackend | null = null;
let hydrating: Promise<void> = Promise.resolve();
/** Entries read from storage before the person was known. */
let loaded: SnapshotEntry[] = [];
/** The current person's entries, by path. */
const mem = new Map<string, SnapshotEntry>();
let who: SnapshotWho | null = null;
let owner: string | null = null;
/** Moved by every clear, so a save scheduled before it is dropped. */
let generation = 0;

const later: (fn: () => void) => void = (fn) => {
  const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(fn, { timeout: 1000 }); else setTimeout(fn, 0);
};
const quietly = (p: Promise<unknown> | undefined) => { p?.catch(() => { /* storage blocked or full: just not kept */ }); };

/** Uses this storage and reads what it holds. Called once at start-up (main.tsx), and by the tests. */
export function setSnapshotBackend(next: SnapshotBackend | null) {
  backend = next;
  loaded = []; mem.clear(); owner = null; who = null; generation++;
  const at = generation;
  hydrating = next ? next.loadAll().then(list => { if (at !== generation) return; loaded = list; if (owner) adopt(); }).catch(() => {}) : Promise.resolve();
}

/** Resolves once the stored entries are read, or after `ms`, whichever is first (session.tsx waits for it alongside
 *  the session read, so the first screen can already use them). */
export function snapshotsReady(ms = 400): Promise<void> {
  return Promise.race([hydrating, new Promise<void>(r => setTimeout(r, ms))]);
}

/** Moves the stored entries of the current person into memory and drops everyone else's. */
function adopt() {
  const others: string[] = [];
  for (const e of loaded) {
    if (e.owner === owner) mem.set(e.path, e); else others.push(e.id);
  }
  loaded = [];
  if (others.length) quietly(backend?.remove(others));
  evict();
}

/** The signed-in person, or null when signed out. A different person, role or permission set drops every entry kept
 *  for the one before. */
export function setSnapshotOwner(next: SnapshotWho | null) {
  const nextOwner = next ? snapshotOwner(next) : null;
  who = next;
  if (nextOwner === owner) return;
  owner = nextOwner;
  if (!owner) { clearSnapshots(); return; }
  generation++;
  for (const e of mem.values()) loaded.push(e);
  mem.clear();
  adopt();
}

/** The kept answer for this read, when the current session may still see it. */
export function snapshotOf(path: string): { data: unknown; savedAt: number } | undefined {
  if (!owner || !who) return undefined;
  const e = mem.get(path);
  if (!e) return undefined;
  if (e.owner !== owner || !snapshotAllowed(who, path)) { forgetSnapshot(path); return undefined; }
  return { data: e.data, savedAt: e.savedAt };
}

/** Keeps a read's answer for the next visit. Measured and stored when the browser is idle; a clear in between drops it. */
export function saveSnapshot(path: string, data: unknown) {
  if (!owner || !who || !snapshotAllowed(who, path)) return;
  const at = generation, forOwner = owner;
  later(() => {
    if (at !== generation || forOwner !== owner) return;
    let json: string | undefined;
    try { json = JSON.stringify(data); } catch { return; }
    if (json === undefined) return;
    const bytes = json.length * 2; // UTF-16, as the browser counts it
    if (bytes > SNAPSHOT_MAX_BYTES) return;
    const entry: SnapshotEntry = { id: `${forOwner}\n${path}`, owner: forOwner, path, data, savedAt: Date.now(), bytes };
    mem.delete(path);
    mem.set(path, entry);
    evict();
    if (mem.get(path) === entry) quietly(backend?.put(entry));
  });
}

/** Drops the oldest entries until the person's total is under the cap. */
function evict() {
  let total = 0;
  for (const e of mem.values()) total += e.bytes;
  if (total <= SNAPSHOT_MAX_BYTES) return;
  const oldest = [...mem.values()].sort((a, b) => a.savedAt - b.savedAt);
  const gone: string[] = [];
  for (const e of oldest) {
    if (total <= SNAPSHOT_MAX_BYTES) break;
    mem.delete(e.path); gone.push(e.id); total -= e.bytes;
  }
  quietly(backend?.remove(gone));
}

export function forgetSnapshot(path: string) {
  const e = mem.get(path);
  if (!e) return;
  mem.delete(path);
  quietly(backend?.remove([e.id]));
}

/** Empties every snapshot. `stored: false` only empties this tab's copy (another tab already cleared storage). */
export function clearSnapshots({ stored = true }: { stored?: boolean } = {}) {
  generation++;
  mem.clear();
  loaded = [];
  if (stored) quietly(backend?.clear());
}

/** What is kept for the current person (the tests, and the PR's storage figure). */
export function snapshotStats(): { entries: number; bytes: number; paths: string[] } {
  let bytes = 0;
  for (const e of mem.values()) bytes += e.bytes;
  return { entries: mem.size, bytes, paths: [...mem.keys()] };
}

/** IndexedDB storage: structured copies, no JSON parse on the way back, and room beyond localStorage's few MB. */
export function indexedDbBackend(): SnapshotBackend | null {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return null;
  const STORE = 'entries';
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open('conts-snapshots', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = <T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void) => open().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
  return {
    loadAll: () => run<SnapshotEntry[]>('readonly', s => s.getAll() as IDBRequest<SnapshotEntry[]>),
    put: e => run<void>('readwrite', s => { s.put(e); }),
    remove: ids => run<void>('readwrite', s => { ids.forEach(id => s.delete(id)); }),
    clear: () => run<void>('readwrite', s => { s.clear(); }),
  };
}
