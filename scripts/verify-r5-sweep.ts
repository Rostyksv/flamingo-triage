/**
 * R5 Stale Claims Sweep & Late Resolve Verification
 *
 * Proves:
 * 1. Sweep releases expired CLAIMED items back to QUEUED
 * 2. Resolve atomically rejects expired claims (claimExpiresAt < now)
 *    even before the sweep cron has run
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET = process.env.AUTH_SECRET!;

function createSessionToken(userId: string) {
  const payload = Buffer.from(
    JSON.stringify({ userId, issuedAt: Date.now() }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", AUTH_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

async function api(
  path: string,
  token: string | null,
  method: "GET" | "POST" = "GET",
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  if (token) headers["Cookie"] = `flamingo_session=${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers });
  const body = await res.json();
  return { status: res.status, body };
}

let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.log(`  ❌ ${description}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log("R5 Stale Claims Sweep & Late Resolve Verification\n");

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const db = new PrismaClient({ adapter });

  // Get Avery and their workspace
  const avery = await db.user.findFirstOrThrow({
    where: { email: "avery.owner@example.test" },
  });
  const token = createSessionToken(avery.id);
  const membership = await db.workspaceMembership.findFirstOrThrow({
    where: { userId: avery.id, role: "OWNER" },
  });

  // ── 1. Sweep endpoint exists ─────────────────────────────────────────
  console.log("=== 1. Sweep endpoint exists ===");
  const sweepRes = await api("/api/sweep/run", token, "POST", {
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  });
  assert("Sweep endpoint exists and responds", sweepRes.status === 200,
    `got ${sweepRes.status}`);
  assert("Sweep returns released count", typeof sweepRes.body.released === "number");

  // ── 2. Sweep releases expired claims ─────────────────────────────────
  console.log("\n=== 2. Sweep releases expired claims ===");
  // Create a CLAIMED item with an already-expired claim
  const expiredItem = await db.item.create({
    data: {
      workspaceId: membership.workspaceId,
      title: "R5 sweep test — expired claim",
      description: "Should be released by sweep",
      status: "CLAIMED",
      priority: "NORMAL",
      claimedById: avery.id,
      claimedAt: new Date(Date.now() - 40 * 60 * 1000),
      claimExpiresAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
    },
    select: { id: true, status: true },
  });
  console.log(`  Created expired item: ${expiredItem.id} (${expiredItem.status})`);

  // Create a still-valid CLAIMED item (should NOT be swept)
  const validItem = await db.item.create({
    data: {
      workspaceId: membership.workspaceId,
      title: "R5 sweep test — valid claim",
      description: "Should NOT be released by sweep",
      status: "CLAIMED",
      priority: "NORMAL",
      claimedById: avery.id,
      claimedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min from now
    },
    select: { id: true, status: true },
  });

  // Run sweep
  await api("/api/sweep/run", token, "POST", {
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  });

  const expiredAfter = await db.item.findUniqueOrThrow({ where: { id: expiredItem.id } });
  const validAfter = await db.item.findUniqueOrThrow({ where: { id: validItem.id } });
  assert(
    "Expired claim released to QUEUED",
    expiredAfter.status === "QUEUED" && expiredAfter.claimedById === null,
    `status=${expiredAfter.status}`,
  );
  assert(
    "Valid claim stays CLAIMED",
    validAfter.status === "CLAIMED" && validAfter.claimedById === avery.id,
    `status=${validAfter.status}`,
  );

  // ── 3. Late resolve is rejected even before sweep ────────────────────
  console.log("\n=== 3. Late resolve rejected (atomic gate) ===");
  // Create a third item with expired claim, then try to resolve BEFORE sweeping
  const lateItem = await db.item.create({
    data: {
      workspaceId: membership.workspaceId,
      title: "R5 resolve rejection test",
      description: "Resolve should fail — claim expired",
      status: "CLAIMED",
      priority: "NORMAL",
      claimedById: avery.id,
      claimedAt: new Date(Date.now() - 40 * 60 * 1000),
      claimExpiresAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
    },
    select: { id: true },
  });

  const lateResolve = await api(
    `/api/items/${lateItem.id}/resolve`, token, "POST",
  );
  assert(
    "Resolve on expired claim returns 409",
    lateResolve.status === 409,
    `got ${lateResolve.status}`,
  );
  assert(
    "Reason is claim_expired",
    lateResolve.body.reason === "claim_expired",
    `got ${lateResolve.body.reason}`,
  );

  // Item should still be CLAIMED (not resolved)
  const lateAfter = await db.item.findUniqueOrThrow({ where: { id: lateItem.id } });
  assert(
    "Item stays CLAIMED after failed resolve",
    lateAfter.status === "CLAIMED",
    `got ${lateAfter.status}`,
  );

  // ── Cleanup ──────────────────────────────────────────────────────────
  await db.item.deleteMany({
    where: { id: { in: [expiredItem.id, validItem.id, lateItem.id] } },
  });
  console.log("\n🧹 Cleaned up test items");

  await db.$disconnect();

  console.log("");
  console.log("═══════════════════════════════════");
  if (failed === 0) {
    console.log(`✅ R5 VERIFICATION PASSED (${passed}/${passed + failed})`);
  } else {
    console.log(`❌ R5 VERIFICATION FAILED (${passed}/${passed + failed})`);
  }
  console.log("═══════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Verification script crashed:", err);
  process.exit(1);
});
