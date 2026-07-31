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
  reason: "not_claimed" | "not_your_claim" | "already_resolved";
  currentHolder: { id: string; name: string; email: string } | null;
  itemStatus: string;
};

export async function resolveItem(
  itemId: string,
  userId: string,
): Promise<ResolveResult> {
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

    if (item.status === ItemStatus.RESOLVED) {
      return {
        success: false as const,
        reason: "already_resolved" as const,
        currentHolder: null,
        itemStatus: item.status,
      };
    }

    if (item.status !== ItemStatus.CLAIMED) {
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

    const resolved = await tx.item.update({
      where: { id: itemId },
      data: {
        status: ItemStatus.RESOLVED,
        resolvedById: userId,
        resolvedAt: new Date(),
      },
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
