# Flamingo Triage Assignment

**Live Demo:** https://flamingo-triage-sigma.vercel.app

A Next.js 16 App Router full-stack shared triage queue where seeded users claim, release, and resolve items under concurrency and workspace authorization constraints.

## Quick Start

```bash
cp .env.example .env
# Fill in DATABASE_URL (Supabase Postgres pooled URL), AUTH_SECRET and CRON_SECRET

npm install
npm run db:setup        # push schema + seed 10k items
npm run dev             # starts at http://localhost:3000
```

Open http://localhost:3000, pick a seeded user from the dropdown, and use the triage queue.

## Requirements Implemented

| Req | Description | Proof |
|-----|-------------|-------|
| R1 | Atomic claim — exactly one winner under concurrency | `npm run verify:r1` |
| R2 | Workspace + role authorization | `npm run verify:r2` |
| R3 | Resolve with best-effort notification records | `npm run verify:r3` |
| R4 | Keyset/cursor pagination over moving queue | EXPLAIN ANALYZE below |
| R5 | Stale claim sweep + atomic late resolve gate | `npm run verify:r5` |

Run all verifications: `npm run verify:all`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase Postgres pooled connection string (pgBouncer, port 6543) |
| `DIRECT_URL` | For migrations | Direct connection (port 5432) if using Prisma migrate |
| `AUTH_SECRET` | Yes | HMAC secret for seeded-login cookies (≥24 chars random) |
| `CRON_SECRET` | Yes | Secret that protects the `/api/sweep/run` cron endpoint (≥24 chars random) |

## Database Setup

```bash
npm run prisma:push   # apply schema to DB
npm run db:seed       # seed 10,000 items across 3 workspaces with 5 users
npm run db:setup      # both in one command
```

Uses Prisma 7 with `@prisma/adapter-pg` for serverless-safe connections.

## Seeded Users

| Name | Email | Workspaces |
|------|-------|------------|
| Avery Chen | avery.owner@example.test | support:owner, billing:member |
| Blair Kim | blair.member@example.test | billing:viewer, engineering:owner, support:member |
| Casey Park | casey.viewer@example.test | engineering:member, support:viewer |
| Devon Singh | devon.member@example.test | billing:member, support:member |
| Riley Brown | riley.owner@example.test | billing:owner, engineering:viewer |

## Verification

```bash
npm run verify:r1    # R1: concurrent claim race — exactly one winner
npm run verify:r2    # R2: workspace/role authorization — 12 assertions
npm run verify:r3    # R3: resolve + notification records — 13 assertions
npm run verify:r5    # R5: stale claim sweep + atomic late resolve gate
npm run verify:all   # all four (sequential)
npm run build        # production build
npm run lint         # ESLint
```

## Architecture Decisions

See [DECISIONS.md](./DECISIONS.md) for full rationale.

- **Atomic claim:** Prisma `$transaction` with conditional `updateMany WHERE status='QUEUED'`
- **Authorization:** Centralized `lib/policy.ts` — every route checks workspace + role
- **Notifications:** Best-effort-with-a-record — resolve returns immediately, notification attempts are durable
- **UI:** Next.js RSC for initial data, plain `useState` + `fetch` for client-side mutations. Toast feedback via Sonner.

## R4: Stable Keyset Pagination

The queue uses **keyset/cursor-based pagination** with the tuple `(createdAt, id)` to stay stable under concurrent queue mutations. Unlike offset-based pagination which silently skips or duplicates items when the queue changes between page loads, keyset pagination always returns the next 50 items after the cursor position regardless of status changes in previously loaded items.

### EXPLAIN ANALYZE

#### Naive approach: OFFSET = 100

```
Limit  (cost=635.49..635.62 rows=50 width=45) (actual time=5.141..5.148 rows=50 loops=1)
  ->  Sort  (cost=635.24..643.57 rows=3331 width=45) (actual time=5.121..5.136 rows=150 loops=1)
        Sort Key: "createdAt", id
        Sort Method: top-N heapsort  Memory: 35kB
        ->  Index Scan using Item_workspaceId_status_createdAt_id_idx on Item
              (actual time=0.158..4.457 rows=3320 loops=1)
              Index Cond: ("workspaceId" = ...)
              Filter: (status <> 'RESOLVED'::"ItemStatus")
              Rows Removed by Filter: 13
Planning Time: 0.642 ms
Execution Time: 5.184 ms
```

Offset forces Postgres to scan and discard the first 100 rows. Execution time grows linearly with offset.

#### Keyset approach: ROW(createdAt, id) > cursor

```
Limit  (cost=611.36..611.48 rows=50 width=45) (actual time=2.582..2.589 rows=50 loops=1)
  ->  Sort  (cost=611.36..619.45 rows=3239 width=45) (actual time=2.580..2.583 rows=50 loops=1)
        Sort Key: "createdAt", id
        Sort Method: top-N heapsort  Memory: 28kB
        ->  Index Scan using Item_workspaceId_status_createdAt_id_idx on Item
              (actual time=0.027..2.004 rows=3219 loops=1)
              Index Cond: (("workspaceId" = ...) AND (ROW("createdAt", id) > ROW('2026-06-17 14:58:44.212', '...')))
              Filter: (status <> 'RESOLVED'::"ItemStatus")
              Rows Removed by Filter: 11
Planning Time: 0.114 ms
Execution Time: 2.634 ms
```

Cursor is embedded directly in `Index Cond` — Postgres seeks the index to the starting position instead of scanning past rows. 2× faster than OFFSET 100, and execution time stays constant regardless of page depth.

Note: this uses `ROW(…) > ROW(…)` in raw SQL because Prisma's OR-based cursor (`createdAt > x OR (createdAt = x AND id > y)`) forces the cursor into a Filter rather than the Index Cond, scanning ~10× more rows.

Also manually verified: paginating deep while another user claims/resolves earlier items caused no duplicate/skipped rows — cursor is position-anchored, not offset-based. No automated script for this (optional req, R1/R2/R3/R5 scripts cover the required guarantees)

## R5: Stale Claim Sweep & Atomic Late Resolve Gate

Claims expire after 30 minutes (`claimExpiresAt`). Two mechanisms prevent orphaned claims:

1. **Sweep endpoint** (`POST /api/sweep/run`): Releases all CLAIMED items where `claimExpiresAt < now` back to QUEUED. Deployed via `vercel.json` cron (daily at midnight UTC). Protected by `CRON_SECRET` — Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
2. **Atomic resolve gate** (`lib/resolve-service.ts`): The `updateMany` in `resolveItem` includes `claimExpiresAt: { gt: new Date() }` in its WHERE clause. This means a late resolve (claim already expired) is rejected atomically with `claim_expired`, even before the sweep cron runs.

**Deployment note:** The sweep endpoint is intended to be triggered by Vercel Cron. On the Hobby plan it runs at most once per day; on higher plans it can run more frequently. Regardless of sweep frequency, the atomic resolve gate prevents expired claims from ever being resolved.
```bash
npm run verify:r5    # Proves sweep releases expired claims and late resolve is rejected
```

## Time Spent

Approximately 2 working days (around 14-16 hours), including implementation, verification scripts, deployment, and documentation.