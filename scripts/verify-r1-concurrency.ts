/**
 * R1 Concurrency Verification Script
 *
 * Proves that exactly one claimant wins when two simultaneous claim
 * requests are sent for the same QUEUED item.
 *
 * The script:
 * 1. Picks the first QUEUED item from the database
 * 2. Picks two different users in the item's workspace
 * 3. Sends two simultaneous POST /api/items/:id/claim requests
 *    (one per user, via Promise.all)
 * 4. Asserts exactly one 200, one 409
 * 5. Asserts the winner is the DB claimant
 */

import "dotenv/config";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

interface QueuedItem {
  id: string;
  title: string;
}

async function api(path: string, sessionToken: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `flamingo_session=${sessionToken}`,
    },
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  console.log("R1 Concurrency Verification\n");

  const setupRes = await fetch(`${BASE_URL}/api/verify/r1-setup`);
  if (!setupRes.ok) {
    throw new Error(
      `Setup failed: ${setupRes.status} ${await setupRes.text()}`,
    );
  }
  const setup = await setupRes.json();
  const { item, userA, userB, cookieA, cookieB } = setup as {
    item: QueuedItem;
    userA: { id: string; name: string };
    userB: { id: string; name: string };
    cookieA: string;
    cookieB: string;
  };

  console.log(`Item:       ${item.id} (${item.title})`);
  console.log(`User A:     ${userA.name} (${userA.id})`);
  console.log(`User B:     ${userB.name} (${userB.id})`);
  console.log("");

  console.log("Sending two simultaneous claim requests...");

  const [resultA, resultB] = await Promise.all([
    api(`/api/items/${item.id}/claim`, cookieA),
    api(`/api/items/${item.id}/claim`, cookieB),
  ]);

  console.log(`User A response: ${resultA.status} — success=${resultA.body.success}`);
  console.log(`User B response: ${resultB.status} — success=${resultB.body.success}`);

  const statuses = [resultA.status, resultB.status];
  const hasOne200 = statuses.filter((s) => s === 200).length === 1;
  const hasOne409 = statuses.filter((s) => s === 409).length === 1;

  if (!hasOne200 || !hasOne409) {
    console.error("\n❌ FAIL: Expected exactly one 200 and one 409");
    console.error(`   Got: ${statuses.join(", ")}`);
    console.error(`   A body: ${JSON.stringify(resultA.body)}`);
    console.error(`   B body: ${JSON.stringify(resultB.body)}`);
    process.exit(1);
  }

  const loser = resultA.status === 409 ? resultA : resultB;
  const loserBody = loser.body;
  if (!loserBody.currentHolder) {
    console.error("\n❌ FAIL: Loser response missing currentHolder");
    console.error(`   Body: ${JSON.stringify(loserBody)}`);
    process.exit(1);
  }

  const stateRes = await fetch(`${BASE_URL}/api/verify/r1-final?itemId=${item.id}`);
  const state = await stateRes.json();

  if (!state.singleClaimant) {
    console.error("\n❌ FAIL: DB shows multiple or zero claimants");
    console.error(`   State: ${JSON.stringify(state)}`);
    process.exit(1);
  }

  if (state.claimedById === null) {
    console.error("\n❌ FAIL: DB shows no claimant after claim");
    process.exit(1);
  }

  const winnerName = resultA.status === 200 ? userA.name : userB.name;
  const loserName = resultA.status === 409 ? userA.name : userB.name;

  console.log("");
  console.log("═══════════════════════════════════");
  console.log("✅ R1 VERIFICATION PASSED");
  console.log("═══════════════════════════════════");
  console.log(`  Winner: ${winnerName}`);
  console.log(`  Loser:  ${loserName}`);
  console.log(`  Loser sees holder: ${loserBody.currentHolder.name}`);
  console.log(`  Item status: ${state.status}`);
  console.log(`  Final DB claimant: ${state.claimedByName} (${state.claimedById})`);
  console.log("");
}

main().catch((err) => {
  console.error("❌ Verification script failed:", err);
  process.exit(1);
});
