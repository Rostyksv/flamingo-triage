import "server-only";

import { ItemStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface SweepResult {
  released: number;
}

/**
 * Release all CLAIMED items whose claimExpiresAt has passed.
 *
 * Intended to be invoked by Vercel Cron once per minute (or an explicit HTTP
 * request for verification).  Uses a single atomic updateMany so the sweep
 * itself is race-free: if a resolve races with the sweep, the atomic WHERE
 * on the resolve side protects correctness regardless of sweep timing.
 */
export async function sweepStaleClaims(): Promise<SweepResult> {
  const result = await prisma.item.updateMany({
    where: {
      status: ItemStatus.CLAIMED,
      claimExpiresAt: { lt: new Date() },
    },
    data: {
      status: ItemStatus.QUEUED,
      claimedById: null,
      claimedAt: null,
      claimExpiresAt: null,
    },
  });

  return { released: result.count };
}
