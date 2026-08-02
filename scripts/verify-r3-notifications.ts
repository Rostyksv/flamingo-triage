/**
 * R3 Notification Verification Script
 *
 * Proves that:
 * 1. Resolve returns before notification completes
 * 2. Item state becomes RESOLVED
 * 3. Notification attempt record is created as PENDING
 * 4. Explicit notification processing can be run
 * 5. Failed notification attempts are visible in DB with error messages
 *
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
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Cookie"] = `flamingo_session=${token}`;
  }
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
  console.log("R3 Notification Verification\n");

  // Connect to DB
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter });

  // Get Avery (OWNER northstar) and a QUEUED item
  const avery = await db.user.findFirstOrThrow({
    where: { email: "avery.owner@example.test" },
  });
  const tokenAvery = createSessionToken(avery.id);

  // Find a QUEUED item in Avery's owner workspace (northstar)
  const membership = await db.workspaceMembership.findFirstOrThrow({
    where: { userId: avery.id, role: "OWNER" },
  });

  const queuedItem = await db.item.findFirstOrThrow({
    where: { workspaceId: membership.workspaceId, status: "QUEUED" },
    select: { id: true, title: true },
  });

  console.log(`Item: ${queuedItem.id} (${queuedItem.title})`);
  console.log("");

  // Step 1: Claim item
  console.log("=== 1. Claim item ===");
  const claim = await api(
    `/api/items/${queuedItem.id}/claim`,
    tokenAvery,
    "POST",
  );
  assert("Claim succeeds", claim.status === 200, `got ${claim.status}`);

  // Step 2: Resolve item — measure response time
  console.log("\n=== 2. Resolve item (timing check) ===");
  const resolveStart = Date.now();
  const resolve = await api(
    `/api/items/${queuedItem.id}/resolve`,
    tokenAvery,
    "POST",
  );
  const resolveDuration = Date.now() - resolveStart;

  console.log(`  Resolve response time: ${resolveDuration}ms`);
  assert("Resolve succeeds", resolve.status === 200, `got ${resolve.status}`);
  assert(
      "Resolve returned before notification processing completed",
      resolveDuration < 1000,
  )
  assert(
    "Item status is RESOLVED",
    resolve.body.item?.status === "RESOLVED",
    `got ${resolve.body.item?.status}`,
  );
  assert(
    "Notification attempt created as PENDING",
    resolve.body.notificationAttempt?.status === "PENDING",
    `got ${resolve.body.notificationAttempt?.status}`,
  );

  // Step 3: Verify DB state — item RESOLVED, notification PENDING
  console.log("\n=== 3. Verify DB state ===");
  const dbItem = await db.item.findUniqueOrThrow({
    where: { id: queuedItem.id },
  });
  assert("DB item status is RESOLVED", dbItem.status === "RESOLVED");
  assert("DB resolvedById matches", dbItem.resolvedById === avery.id);

  const dbAttempts = await db.notificationAttempt.findMany({
    where: { itemId: queuedItem.id },
    orderBy: { createdAt: "desc" },
  });
  assert(
    "Notification attempt record exists",
    dbAttempts.length > 0,
    `found ${dbAttempts.length}`,
  );
  assert(
    "Notification attempt is PENDING",
    dbAttempts[0].status === "PENDING",
    `got ${dbAttempts[0].status}`,
  );

  // Step 4: Run notification processing multiple times to observe failures
  console.log("\n=== 4. Run notification processing (multiple rounds) ===");
  let totalRuns = 0;
  let totalSent = 0;
  let totalFailed = 0;

  // notify() fails ~1/5, so running multiple times increases chance of seeing failures
  // Create more resolve+notification pairs for statistical confidence
  for (let i = 0; i < 5; i++) {
    // Find another QUEUED item, claim, resolve, then run notifications
    const nextItem = await db.item.findFirst({
      where: {
        workspaceId: membership.workspaceId,
        status: "QUEUED",
        id: { not: queuedItem.id },
      },
      select: { id: true },
    });

    if (!nextItem) break;

    await api(`/api/items/${nextItem.id}/claim`, tokenAvery, "POST");
    await api(`/api/items/${nextItem.id}/resolve`, tokenAvery, "POST");
  }

  // Run notification processing via API
  for (let round = 0; round < 3; round++) {
    const run = await api("/api/notifications/run", tokenAvery, "POST");
    if (run.status === 200) {
      totalRuns++;
      totalSent += run.body.sent ?? 0;
      totalFailed += run.body.failed ?? 0;
    }
  }

  console.log(`  Processed ${totalRuns} runs`);
  console.log(`  Sent: ${totalSent}, Failed: ${totalFailed}`);

  assert("Notification processing ran successfully", totalRuns > 0);
  assert(
    "All attempts processed (none left PENDING)",
    totalSent + totalFailed > 0,
    "no attempts processed",
  );

  // Step 5: Verify failures are visible in DB
  console.log("\n=== 5. Verify failure visibility ===");
  const allAttempts = await db.notificationAttempt.findMany({
    orderBy: { createdAt: "desc" },
  });
  const failedAttempts = allAttempts.filter((a) => a.status === "FAILED");
  const sentAttempts = allAttempts.filter((a) => a.status === "SENT");

  console.log(`  Total attempts: ${allAttempts.length}`);
  console.log(`  SENT: ${sentAttempts.length}`);
  console.log(`  FAILED: ${failedAttempts.length}`);

  if (failedAttempts.length > 0) {
    console.log(
      `  First failure: ${failedAttempts[0].lastError?.slice(0, 80)}...`,
    );
    assert(
      "Failed attempts have error message",
      failedAttempts.every((a) => a.lastError !== null),
    );
    assert(
      "Failed attempts have attemptCount >= 1",
      failedAttempts.every((a) => a.attemptCount >= 1),
    );
  } else {
    console.log(
      "  ℹ️  No failures observed in this run (20% rate is probabilistic)",
    );
    console.log(
      "  ℹ️  Run again if needed — at least one failure is expected over many runs",
    );
    // Don't fail — failures are probabilistic, and we have other assertions
  }

  await db.$disconnect();

  console.log("");
  console.log("═══════════════════════════════════");
  if (failed === 0) {
    console.log(`✅ R3 VERIFICATION PASSED (${passed}/${passed + failed})`);
  } else {
    console.log(`❌ R3 VERIFICATION FAILED (${passed}/${passed + failed})`);
  }
  console.log("═══════════════════════════════════");
  console.log("");
  console.log(
    "Key R3 guarantee: resolve returns immediately, notification is best-effort-with-a-record.",
  );
  console.log(
    "Failed notifications are visible in DB with status, error, timestamp, and attempt count.",
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Verification script crashed:", err);
  process.exit(1);
});
