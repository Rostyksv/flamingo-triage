import { NextRequest, NextResponse } from "next/server";
import { sweepStaleClaims } from "@/lib/sweep-service";

/**
 * POST /api/sweep/run
 *
 * Releases stale CLAIMED items (claimExpiresAt < now) back to QUEUED.
 * Protected by CRON_SECRET — Vercel Cron automatically sends
 * Authorization: Bearer ${CRON_SECRET} on scheduled invocations.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepStaleClaims();
  return NextResponse.json(result);
}
