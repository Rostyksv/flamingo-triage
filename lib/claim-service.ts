import "server-only";

import { prisma } from "@/lib/db";

export type ClaimResult = ClaimSuccess | ClaimConflict;
export type ReleaseResult = ReleaseSuccess | ReleaseConflict;

type ClaimSuccess = {
  success: true;
  item: {
    id: string;
    title: string;
    status: string;
    priority: string;
    claimedById: string | null;
    claimedAt: Date | null;
    claimExpiresAt: Date | null;
    workspaceId: string;
    claimedBy: { id: string; name: string; email: string } | null;
  };
};

type ClaimConflict = {
  success: false;
  reason: "already_claimed" | "already_resolved" | "not_queued";
  currentHolder: { id: string; name: string; email: string } | null;
  itemStatus: string;
};

type ReleaseSuccess = {
  success: true;
  item: {
    id: string;
    title: string;
    status: string;
    priority: string;
    workspaceId: string;
  };
};

type ReleaseConflict = {
  success: false;
  reason: "not_claimed" | "not_your_claim" | "already_resolved";
  currentHolder: { id: string; name: string; email: string } | null;
  itemStatus: string;
};

/**
 * Atomically claim an item. Uses a conditional UPDATE inside a transaction
 * so that only one concurrent caller can claim a QUEUED item.
 *
 * The WHERE clause includes `status: "QUEUED"` — the first transaction to
 * execute the UPDATE succeeds; subsequent callers get count=0 and receive the
 * current holder via a follow-up SELECT.
 */
export async function claimItem(itemId: string, userId: string): Promise<ClaimResult> {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.item.updateMany({
      where: {
        id: itemId,
        status: "QUEUED",
      },
      data: {
        status: "CLAIMED",
        claimedById: userId,
        claimedAt: new Date(),
        claimExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    if (updated.count === 0) {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          status: true,
          claimedBy: { select: { id: true, name: true, email: true } },
        },
      });

      if (!item) {
        return {
          success: false as const,
          reason: "not_queued" as const,
          currentHolder: null,
          itemStatus: "unknown",
        };
      }

      if (item.status === "RESOLVED") {
        return {
          success: false as const,
          reason: "already_resolved" as const,
          currentHolder: null,
          itemStatus: item.status,
        };
      }

      return {
        success: false as const,
        reason: "already_claimed" as const,
        currentHolder: item.claimedBy,
        itemStatus: item.status,
      };
    }

    const item = await tx.item.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        claimedById: true,
        claimedAt: true,
        claimExpiresAt: true,
        workspaceId: true,
        claimedBy: { select: { id: true, name: true, email: true } },
      },
    });

    return {
      success: true as const,
      item,
    };
  });

  return result;
}

/**
 * Release an item back to QUEUED. Only the current claimant can release.
 */
export async function releaseItem(itemId: string, userId: string): Promise<ReleaseResult> {
  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        status: true,
        claimedById: true,
        claimedBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!item) {
      return {
        success: false as const,
        reason: "not_claimed" as const,
        currentHolder: null,
        itemStatus: "unknown",
      };
    }

    if (item.status === "RESOLVED") {
      return {
        success: false as const,
        reason: "already_resolved" as const,
        currentHolder: null,
        itemStatus: item.status,
      };
    }

    if (item.status !== "CLAIMED") {
      return {
        success: false as const,
        reason: "not_claimed" as const,
        currentHolder: null,
        itemStatus: item.status,
      };
    }

    if (item.claimedById !== userId) {
      return {
        success: false as const,
        reason: "not_your_claim" as const,
        currentHolder: item.claimedBy,
        itemStatus: item.status,
      };
    }

    const updated = await tx.item.update({
      where: { id: itemId },
      data: {
        status: "QUEUED",
        claimedById: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        workspaceId: true,
      },
    });

    return {
      success: true as const,
      item: updated,
    };
  });

  return result;
}
