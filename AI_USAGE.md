# AI Usage

This assignment was built with AI assistance. Below is what the AI contributed, where its output was rejected, and how everything was verified.

## How AI Was Used

AI acted as a pair programmer — proposing implementations, scaffolding files, and generating verification scripts. Every AI-produced artifact was reviewed, adapted, and verified before being committed.

| Area | AI's Role | My Role                                                                                                                                                                                                           |
|------|-----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Prisma schema | Proposed initial models with indexes | Reviewed, adjusted for pgBouncer compatibility, verified against assignment requirements                                                                                                                          |
| Seed script | Scaffolded `prisma/seed.ts` with user/workspace/item generation | Tuned the status distribution (~68% queued, ~17% claimed, ~15% resolved) and verified row counts                                                                                                                  |
| Auth helpers (`lib/auth.ts`) | Proposed HMAC-signed cookie pattern with timing-safe comparison | Reviewed the crypto primitives, tested session round-trip manually, kept `server-only` import guard                                                                                                               |
| Claim service (`lib/claim-service.ts`) | Proposed atomic `updateMany` inside `$transaction` for race-safe claim | Verified the concurrency guarantee with `npm run verify:r1`, confirmed it works through pgBouncer                                                                                                                 |
| Authorization policy (`lib/policy.ts`) | Drafted workspace access derivation from user memberships | Rejected the initial `throw Response` pattern (see below), rewrote to return-value pattern `checkCanMutate`                                                                                                       |
| Resolve + notifications | Drafted `resolve-service.ts` and `notification-runner.ts` | Verified timing with `verify:r3` (resolve returns in <1s, notify sleeps ~1s), confirmed failure visibility in DB                                                                                                  |
| Queue UI (`QueueTable`, `Button`, `ItemStatusBadge`) | Scaffolded the component structure and initial JSX | Iterated on: per-item loading states, responsive column hiding, scroll behavior, Button component extraction                                                                                                      |
| Keyset pagination (R4) | Proposed ROW(createdAt, id) > cursor approach and raw SQL for Index Cond embedding | Caught that Prisma's OR-based cursor puts condition in Filter instead of Index Cond — used `$queryRaw` with `ROW() > ROW()` instead. Added toast notifications (sonner) for action feedback visible after scroll. |
| Verification scripts | Drafted `verify-r1`, `verify-r2`, `verify-r3`, `verify-r5` | Fixed API paths, adjusted timing thresholds, removed unused imports, verified all four exit 0                                                                                                                     |
| Documentation (`README`, `DECISIONS`, `AI_USAGE`) | Drafted initial markdown | Reviewed every claim against actual code and verification output, corrected over-statements, updated R4/R5 status from skipped to implemented                                                                     |

## Where I Disagreed with the AI

### 1. Thrown Response objects in policy helpers

AI initially used `throw Response.json(...)` in `lib/policy.ts`. This pattern doesn't work in Next.js 16 App Router — the framework doesn't intercept thrown Response objects in route handlers.

**What I did:** Converted to a return-value pattern — `checkCanMutate` returns `{ allowed: boolean, status: number, body }` so route handlers explicitly return the error response. See `lib/policy.ts`.

### 2. Wrong import path for server action

AI wrote `import { loadMoreItems } from "@/app/actions"` in `app/page.tsx`. The Next.js `@` alias resolves to the project root, so `@/app/actions` becomes `/app/app/actions` — a module-not-found error.

**What I did:** Changed to `./actions` (relative import from same directory). See `app/page.tsx:5`.

### 3. Server Component count didn't update

AI initially rendered the queue count "Queue (6636)" entirely from the Server Component, so after claiming or resolving an item the table updated but the count stayed stale until a full page refresh.

**What I did:** Moved the displayed count into client state and updated it together with the local queue state after successful mutations. The UI now immediately reflects the current number of visible items without requiring a refresh.

### 4. Nested scrollable table

AI initially kept both the page and the table independently scrollable. During manual testing this felt awkward and made the queue harder to use.

**What I did:** Removed the nested scrolling so the page has a single natural scroll while keeping the table responsive.


## How I Verified Everything

Every piece of code — whether written by me, drafted by AI, or modified by both — was verified through:

| Check | Command | Result |
|-------|---------|--------|
| TypeScript strict | `npx tsc --noEmit` | 0 errors |
| ESLint | `npm run lint` | 0 errors, 0 warnings |
| Production build | `npm run build` | Compiled in 2.0s, all 12 routes listed |
| R1 concurrency | `npm run verify:r1` | Two simultaneous claims → one 200, one 409 |
| R2 authorization | `npm run verify:r2` | 12/12 assertions (owner, member, viewer, cross-workspace, unauthenticated) |
| R3 notifications | `npm run verify:r3` | 13/13 assertions (timing, resolve, notification attempt, failure visibility) |
| R4 pagination | EXPLAIN ANALYZE in README | Keyset query uses composite index Index Cond, ~2.6ms, no offset drift |
| R5 stale sweep | `npm run verify:r5` | 7/7 assertions (sweep releases expired, valid stays CLAIMED, late resolve rejected with claim_expired) |
| Full suite | `npm run verify:all` | All four pass sequentially |
| Browser UI | Manual at `localhost:3000` | Queue renders, claim/release/resolve work, responsive at narrow widths |

Every verification command can be run by a reviewer with a seeded database and a running dev server.
