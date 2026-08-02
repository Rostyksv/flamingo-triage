# Design Decisions

Four key architectural decisions, three deliberate non-actions, and one refactor-first note for the Flamingo triage assignment.

---

## 1. Atomic claim via conditional UPDATE

**Context:** R1 requires that two simultaneous claim requests produce exactly one winner. User-space code (optimistic UI, read-then-write) cannot prove this.

**Chosen:** Prisma `$transaction` with `updateMany WHERE status='QUEUED'`. The first transaction to execute the UPDATE wins; subsequent callers see `count=0` and receive the current holder identity via a follow-up SELECT.

**Rejected alternative:** SELECT FOR UPDATE row-level locking. Rejected because pgBouncer transaction pooling can reset a session between SELECT and UPDATE, breaking lock continuity. `updateMany` with a conditional WHERE avoids this entirely.

**Cost:** Slightly more verbose conflict response (two queries inside the transaction).

**Wrong later when:** The conditional WHERE clause no longer suffices — e.g., if claim rules become complex enough to need multi-table checks in one atomic step.

---

## 2. Centralized authorization in policy helpers

**Context:** R2 requires server-side workspace + role enforcement. The assignment note about curl with pasted item IDs means component-level `disabled` buttons are not sufficient.

**Chosen:** All item routes call `checkCanMutate` from `lib/policy.ts`, which derives workspace access from the signed cookie's user memberships. Non-members get 404 (no existence leak), viewers get 403 on mutations. Read access is enforced by scoping queries to workspace IDs — items outside the user's workspaces are never returned.

**Rejected alternative:** Middleware-level authorization. Rejected because workspace membership requires a DB lookup, and Next.js middleware runs on the edge — adding DB access there would couple the edge runtime to Postgres.

**Cost:** Every route handler explicitly calls the policy helper (three lines per route).

**Wrong later when:** The app has 30+ route handlers and the per-route copy violates DRY. At that point, a route wrapper or server-component-level policy hook would be warranted.

---

## 3. Best-effort notification with durable records

**Context:** R3 requires `notify()` to be unreliable (~20% failure) and the app must not wait for it during resolve. Vercel serverless cannot rely on post-response work.

**Chosen:** Resolve commits item state and creates a PENDING `NotificationAttempt` in one transaction — returns immediately. An explicit `/api/notifications/run` endpoint (or `scripts/run-notifications.ts`) processes pending attempts, calls `notify()`, and records SENT or FAILED with error messages.

**Rejected alternative:** Fire-and-forget after response (`waitUntil` or background job). Rejected because Vercel free-tier functions freeze after response, making post-response work unreliable without a queue.

**Cost:** Notification status is eventually visible — a reviewer must run the notification runner explicitly to see SENT/FAILED states.

**Wrong later when:** A real message queue (SQS, BullMQ) is available and at-least-once delivery becomes a reasonable claim.

---

## 4. Client-side state management

**Context:** The triage UI needs to show current holder state after claim conflicts and eventual notification status changes. The initial queue is server-rendered for fast first paint. Client-side state is used only to reconcile local mutations immediately without waiting for another server render.

**Chosen:** Plain `useState` + `fetch` for mutations. The queue is server-rendered (RSC), and client-side actions just call API routes and update local state. No library overhead — the UI is simple enough that React Query's cache/invalidation features add complexity without benefit.

**Rejected alternative:** WebSocket or Server-Sent Events. Rejected as over-engineered for this scope. Reconciliation only happens reactively — via the response when a user's own claim/resolve/release conflicts. Passive viewers see no live updates until their next action or refresh; staleness is unbounded, not second-scale. Weakest guarantee here — first thing to add real-time to in production.

**Cost:** Manual state management (setState on each mutation). Acceptable given the simple UI — one table, three actions.

**Wrong later when:** Operator needs sub-second visibility and polling becomes a bottleneck.

---

## Deliberate Non-Actions

1. **No real OAuth.** The assignment says "don't build real auth." Seeded login with HMAC-signed cookies provides identity for all required authorization checks without OAuth complexity.

2. **No real-time WebSocket updates.** No real-time updates for passive viewers — only the acting user's own request gets reconciled state back. Kept scope manageable within the timebox.

3. **No automated R4 skip/repeat regression test** Verified manually (claiming/resolving mid-pagination didn't shift the cursor incorrectly), given R4 is optional and R1/R2/R3/R5 scripts already cover the higher-priority concurrency guarantees.
---

## Refactor-First Note

If this project were to grow beyond the assignment: the per-route `checkCanMutate` call pattern in every route handler should be extracted into a route wrapper or higher-order function. Currently three lines per route is manageable for 5 routes; at 30+, it's a maintenance risk.
