/**
 * R2 Authorization Verification Script
 *
 * Proves that:
 * 1. Owner/Member can read and mutate items in their workspace
 * 2. Viewer can read but NOT mutate items in their workspace
 * 3. Cross-workspace access returns 404 (doesn't leak existence)
 * 4. Unauthenticated requests return 401
 *
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { WorkspaceRole, ItemStatus } from "@prisma/client";

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

interface UserInfo {
  id: string;
  name: string;
  email: string;
  memberships: { workspaceId: string; role: string; workspace: { id: string; name: string; slug: string } }[];
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
  console.log("R2 Authorization Verification\n");

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter });

  const users = (await db.user.findMany({
    include: {
      memberships: { include: { workspace: true } },
    },
    orderBy: { name: "asc" },
  })) as unknown as UserInfo[];

  await db.$disconnect();

  const findUser = (name: string) => users.find((u) => u.name === name)!;

  const avery = findUser("Avery Chen");
  const blair = findUser("Blair Kim");
  const caseyUser = findUser("Casey Park");

  const supportId = avery.memberships.find((m) => m.role === WorkspaceRole.OWNER)!.workspaceId;
  const billingId = blair.memberships.find((m) => m.role === WorkspaceRole.VIEWER)!.workspaceId;
  const engineeringId = caseyUser.memberships.find((m) => m.role === WorkspaceRole.MEMBER)!.workspaceId;

  const wsNames = new Map(
    [avery, blair, caseyUser].flatMap((u) =>
      u.memberships.map((m) => [m.workspaceId, m.workspace.slug]),
    ),
  );

  console.log(`${wsNames.get(supportId)}: ${supportId}`);
  console.log(`${wsNames.get(billingId)}: ${billingId}`);
  console.log(`${wsNames.get(engineeringId)}: ${engineeringId}`);
  console.log("");

  const nsItem = await (async () => {
    const a = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const d = new PrismaClient({ adapter: a });
    const item = await d.item.findFirst({ where: { workspaceId: supportId, status: ItemStatus.QUEUED }, select: { id: true } });
    await d.$disconnect();
    return item;
  })();

  if (!nsItem) {
    console.error("No QUEUED items found in support workspace");
    process.exit(1);
  }

  const nsItemId = nsItem.id;

  const tokenAvery = createSessionToken(avery.id); // OWNER support, MEMBER billing
  const tokenBlair = createSessionToken(blair.id); // MEMBER support, VIEWER billing
  const tokenCasey = createSessionToken(caseyUser.id); // VIEWER support, MEMBER engineering

  console.log("=== 1. Owner reads own workspace item ===");
  const r1 = await api(`/api/items/${nsItemId}`, tokenAvery);
  assert("Owner can read item", r1.status === 200, `got ${r1.status}`);

  console.log("\n=== 2. Owner claims own workspace item ===");
  const r2 = await api(`/api/items/${nsItemId}/claim`, tokenAvery, "POST");
  assert("Owner can claim item", r2.status === 200, `got ${r2.status}`);

  console.log("\n=== 3. Owner releases own claim ===");
  const r3 = await api(`/api/items/${nsItemId}/release`, tokenAvery, "POST");
  assert("Owner can release item", r3.status === 200, `got ${r3.status}`);

  console.log("\n=== 4. Member reads own workspace item ===");
  const r4 = await api(`/api/items/${nsItemId}`, tokenBlair);
  assert("Member can read item", r4.status === 200, `got ${r4.status}`);

  console.log("\n=== 5. Member claims item ===");
  const r5 = await api(`/api/items/${nsItemId}/claim`, tokenBlair, "POST");
  assert("Member can claim item", r5.status === 200, `got ${r5.status}`);

  await api(`/api/items/${nsItemId}/release`, tokenBlair, "POST");

  console.log("\n=== 6. Viewer can read own workspace item ===");
  const r6 = await api(`/api/items/${nsItemId}`, tokenCasey);
  assert("Viewer can read item", r6.status === 200, `got ${r6.status}`);

  console.log("\n=== 7. Viewer CANNOT claim item ===");
  const r7 = await api(`/api/items/${nsItemId}/claim`, tokenCasey, "POST");
  assert("Viewer claim blocked", r7.status === 403, `got ${r7.status}`);

  console.log("\n=== 8. Viewer CANNOT release item ===");

  await api(`/api/items/${nsItemId}/claim`, tokenAvery, "POST");
  const r8 = await api(`/api/items/${nsItemId}/release`, tokenCasey, "POST");
  assert("Viewer release blocked", r8.status === 403, `got ${r8.status}`);

  await api(`/api/items/${nsItemId}/release`, tokenAvery, "POST");

  console.log("\n=== 9. Cross-workspace read returns 404 ===");

  const billingItem = await (async () => {
    const a = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const d = new PrismaClient({ adapter: a });
    const item = await d.item.findFirst({ where: { workspaceId: billingId }, select: { id: true } });
    await d.$disconnect();
    return item;
  })();

  if (billingItem) {
    const billingReadOk = await api(`/api/items/${billingItem.id}`, tokenBlair);
    assert("Blair (VIEWER billing) can read billing item", billingReadOk.status === 200, `got ${billingReadOk.status}`);

    const crossWs = await api(`/api/items/${billingItem.id}`, tokenCasey);
    assert("Casey (not in billing) gets 404 on billing item", crossWs.status === 404, `got ${crossWs.status}`);

    const unauth = await api(`/api/items/${billingItem.id}`, null);
    assert("Unauthenticated gets 401", unauth.status === 401, `got ${unauth.status}`);
  } else {
    console.log("  ⚠️  Skipped — no billing items found");
  }

  console.log("\n=== 10. Cross-workspace claim returns 404 ===");
  const engineeringItem = await (async () => {
    const a = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const d = new PrismaClient({ adapter: a });
    const item = await d.item.findFirst({ where: { workspaceId: engineeringId, status: ItemStatus.QUEUED }, select: { id: true } });
    await d.$disconnect();
    return item;
  })();

  if (engineeringItem) {
    const crossWsClaim = await api(`/api/items/${engineeringItem.id}/claim`, tokenAvery, "POST");
    assert("Avery (not in engineering) gets 404 on claim", crossWsClaim.status === 404, `got ${crossWsClaim.status}`);
  } else {
    console.log("  ⚠️  Skipped — no engineering items found");
  }

  console.log("");
  console.log("═══════════════════════════════════");
  if (failed === 0) {
    console.log(`✅ R2 VERIFICATION PASSED (${passed}/${passed + failed})`);
  } else {
    console.log(`❌ R2 VERIFICATION FAILED (${passed}/${passed + failed})`);
  }
  console.log("═══════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Verification script crashed:", err);
  process.exit(1);
});
