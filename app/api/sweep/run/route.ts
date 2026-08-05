import { NextRequest, NextResponse } from "next/server";
import { sweepStaleClaims } from "@/lib/sweep-service";

/**
 * GET /api/sweep/run (Vercel Cron)
 * POST /api/sweep/run (manual / verification)
 *
 * Releases stale CLAIMED items (claimExpiresAt < now) back to QUEUED.
 * Protected by CRON_SECRET.
 */

async function handleSweep(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepStaleClaims();
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return handleSweep(request);
}

export async function POST(request: NextRequest) {
  return handleSweep(request);
}