# Beta project cache: stop the reload spinner and the repeat fetches

Date: 2026-10-28. Status: plan, not built. Staging only (`/api/beta` is switched off in production).

## Goal

Opening a Beta project should not show "Loading project" when the browser has seen it before, and
should not repeat a request whose answer is still fresh. Do not verify on local dev (it signs in
against production). Verify on staging.

## Facts found in the code

- In-memory cache: `engine/frontend/src/lib/queryClient.ts` (staleTime 30 s, gcTime 30 min).
- Disk snapshot: `engine/frontend/src/lib/query-persist.ts`. `isListKey` only accepts five SCM
  entities. Beta keys look like `["uq","renovation-beta",...]` (see `buildQueryKey` in
  `hooks/useQuery.ts`), so they are never saved. `save()` writes one blob and skips the whole write
  above 1.5 MB.
- Home board key: `boardKey()` gives `["renovation-beta","board","","",0]` (all projects). Workspace
  board key: `boardKey(undefined,id)` (one project). Different payload shapes, so they must stay
  different keys (`useQuery.ts` header comment explains why).
- Server: Hono on Cloudflare Workers (`engine/backend/src/index.ts`), behind the Pages Function
  `functions/api/_middleware.ts`. Not Next.js. Responses are per user (category scope, finance
  hidden) and per company (`X-Company-Id` request header). `GET /api/beta/board` is at
  `engine/backend/src/routes/renovationBeta.ts:466`.

## Step 1: save Beta data to disk (main cause of the reload spinner)

File: `engine/frontend/src/lib/query-persist.ts` (+ its test).

- Add `isBetaKey(key)`: `key[0] === "uq" && key[1] === "renovation-beta"`. Do NOT widen `isListKey`.
- Save Beta queries to a second localStorage slot (`${BUILD_PREFIX}${session}:${company}:beta`) with
  its own cap (about 1 MB). Over the cap: drop the oldest project entries, never skip the write, and
  never touch the SCM slot.
- Keep only the last 5 visited projects (detail, workspace, records) plus the board entries.
- Hydrate the same way as today: `setQueryData(key, data, { updatedAt: 1 })` so it is always stale
  and refetches on mount.
- Add `isBetaKey` to the sign-out `removeQueries` predicate and to `clearQuerySnapshots` coverage
  (the prefix already matches).
- Before building: check the workspace payload for signed or expiring file URLs. If present, strip
  them from the snapshot or accept a short broken-image moment until the refetch lands.

## Step 2: stop the duplicate board fetch

Files: `hooks/useQuery.ts`, `pages/renovation-beta/renovationBetaBoardApi.ts`,
`pages/renovation-beta/RenovationBetaWorkspace.tsx`.

- Add optional `initialData?: () => T | undefined` and `initialDataUpdatedAt?: () => number | undefined`
  to `UseQueryOptions` and pass them to TanStack.
- Add `projectBoardFromHome(qc, id)` in `renovationBetaBoardApi.ts`: read the Home board from the
  cache, cut it to the one project and its events, return `{ data, at }` or `undefined`.
- In `WorkspaceScreen`, pass it to the `bq` query as `initialData` / `initialDataUpdatedAt`.
- Open question: Home's date range vs the workspace default range. If events differ, only take
  `projects`, `people`, `settings` from Home and leave `events` to the real fetch.
- Keep the two keys separate.

## Step 3: HTTP cache headers

File: `engine/backend/src/index.ts`, near the `/api/beta` routes (line ~465).

```ts
import { etag } from "hono/etag";
app.use("/api/beta/*", async (c, next) => {
  await next();
  if (c.req.method === "GET" && c.res.status === 200) {
    c.res.headers.set("Cache-Control", "private, no-cache");
    c.res.headers.append("Vary", "Authorization, X-Company-Id");
  }
});
app.use("/api/beta/*", etag());
```

- Never `public`. Never Hono `cache()` (one shared copy for all users).
- This saves download size only; the Worker still runs the queries. A version stamp that skips the
  queries is out of scope.
- Verify with Context7: `etag()` options. Verify on staging that the Pages Function
  (`functions/api/_middleware.ts`, response rebuilt near lines 183-185) passes `ETag` and 304 through.

## Step 4: guards so it does not come back

1. Naming rule. Comment at the top of `renovationBetaBoardApi.ts`: every Beta query key starts with
   `renovation-beta`; that name is what disk saving, sign-out clearing and `invalidateBeta` match.
2. Test (`query-persist.test.ts`): a Beta key is saved and hydrated; a non-Beta `uq` key is not; the
   Beta slot over the cap trims old projects and leaves the SCM slot alone; another session's Beta
   snapshot is not hydrated; sign-out removes Beta queries.
3. Test (backend): `GET /api/beta/board` and `/api/beta/projects/:id/workspace` responses carry
   `Cache-Control: private, no-cache` and `Vary` with `Authorization` and `X-Company-Id`. A route
   added later under `/api/beta/*` is covered by the prefix middleware, so one test on a second route
   proves the prefix, not just one route.
4. Staging reload check (manual, before each Beta release): open a project, reload, confirm the
   project shows with no "Loading project" screen and refreshes after. Also sign out and in as a
   second user on the same browser: no first-user data appears.

## Files

| File | Change |
|---|---|
| `engine/frontend/src/lib/query-persist.ts` | Beta slot, `isBetaKey`, cap, sign-out predicate |
| `engine/frontend/src/lib/query-persist.test.ts` | cases in guard 2 |
| `engine/frontend/src/hooks/useQuery.ts` | `initialData` options |
| `engine/frontend/src/pages/renovation-beta/renovationBetaBoardApi.ts` | `projectBoardFromHome`, naming comment |
| `engine/frontend/src/pages/renovation-beta/RenovationBetaWorkspace.tsx` | pass `initialData` on `bq` |
| `engine/backend/src/index.ts` | headers + `etag()` for `/api/beta/*` |
| `engine/backend/src/routes/renovationBeta.test.ts` (or nearest existing test) | guard 3 |

## Risks (plain)

- Old numbers may show for about a second after reload. Mitigation: snapshot is stamped stale and
  always refetched; writes already call `invalidateBeta`.
- Project data (incl. payment info) sits in browser storage. Same exposure as the SCM lists; kept per
  user and per company, cleared on sign-out.
- Missing `Vary` could show one user's cached answer to another on a shared browser. Mitigation:
  guard 3 and the staging two-user check.
- Beta slot too big could crowd out SCM lists. Mitigation: separate slot and cap.

## Rollback

One commit per step. Reverting step 1 is safe: old-build snapshots are pruned on boot, so the extra
slot disappears with the next deploy. Reverting step 3 only removes headers.

## Done means

`tsc --noEmit` clean in both engine/frontend and engine/backend, the new tests pass, related existing
tests pass (persist, useQuery, beta routes), and the staging reload check and two-user check pass.
Do not run the full engine suite (see memory: engine testing scope).

## Branch

Working tree is dirty on `feat/role-category-access`. Ask before switching branches.
