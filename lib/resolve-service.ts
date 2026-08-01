import "server-only";

import { ItemStatus, NotificationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ResolveResult = ResolveSuccess | ResolveConflict;

type ResolveSuccess = {
  success: true;
  item: {
    id: string;
    title: string;
    status: string;
    priority: string;
    resolvedById: string | null;
    resolvedAt: Date | null;
    workspaceId: string;
  };
  notificationAttempt: {
    id: string;
    status: string;
    itemId: string;
    resolverId: string;
  };
};

type ResolveConflict = {
  success: false;
  reason:
    | "not_claimed"
    | "not_your_claim"
    | "already_resolved"
    | "claim_expired";
  currentHolder: { id: string; name: string; email: string } | null;
  resolvedBy: { id: string; name: string; email: string } | null;
  itemStatus: string;
};

export async function resolveItem(
  itemId: string,
  userId: string,
): Promise<ResolveResult> {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.item.updateMany({
      where: {
        id: itemId,
        status: ItemStatus.CLAIMED,
        claimedById: userId,
        claimExpiresAt: { gt: new Date() },
      },
      data: {
        status: ItemStatus.RESOLVED,
        resolvedById: userId,
        resolvedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          status: true,
          claimedById: true,
          claimExpiresAt: true,
          claimedBy: { select: { id: true, name: true, email: true } },
          resolvedBy: { select: { id: true, name: true, email: true } },
        },
      });

      if (!item) {
        return {
          success: false as const,
          reason: "not_claimed" as const,
          currentHolder: null,
          resolvedBy: null,
          itemStatus: "unknown",
        };
      }

      if (item.status === ItemStatus.RESOLVED) {
        return {
          success: false as const,
          reason: "already_resolved" as const,
          currentHolder: item.claimedBy,
          resolvedBy: item.resolvedBy,
          itemStatus: item.status,
        };
      }

      if (item.status === ItemStatus.CLAIMED && item.claimedById !== userId) {
        return {
          success: false as const,
          reason: "not_your_claim" as const,
          currentHolder: item.claimedBy,
          resolvedBy: null,
          itemStatus: item.status,
        };
      }

      if (
        item.status === ItemStatus.CLAIMED &&
        item.claimedById === userId &&
        item.claimExpiresAt &&
        item.claimExpiresAt <= new Date()
      ) {
        return {
          success: false as const,
          reason: "claim_expired" as const,
          currentHolder: null,
          resolvedBy: null,
          itemStatus: item.status,
        };
      }

      return {
        success: false as const,
        reason: "not_claimed" as const,
        currentHolder: null,
        resolvedBy: null,
        itemStatus: item.status,
      };
    }

    const resolved = await tx.item.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        resolvedById: true,
        resolvedAt: true,
        workspaceId: true,
      },
    });

    const attempt = await tx.notificationAttempt.create({
      data: {
        itemId: resolved.id,
        resolverId: userId,
        status: NotificationStatus.PENDING,
      },
      select: {
        id: true,
        status: true,
        itemId: true,
        resolverId: true,
      },
    });

    return {
      success: true as const,
      item: resolved,
      notificationAttempt: attempt,
    };
  });

  return result;
}
