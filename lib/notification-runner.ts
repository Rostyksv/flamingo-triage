import "server-only";

import { NotificationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";

export interface NotificationRunResult {
  processed: number;
  sent: number;
  failed: number;
  details: {
    id: string;
    itemId: string;
    status: NotificationStatus;
    error?: string;
  }[];
}

export async function processPendingNotifications(): Promise<NotificationRunResult> {
  const pending = await prisma.notificationAttempt.findMany({
    where: { status: NotificationStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });

  const details: NotificationRunResult["details"] = [];
  let sent = 0;
  let failed = 0;

  for (const attempt of pending) {
    try {
      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: { attemptCount: { increment: 1 } },
      });

      await notify(attempt.itemId, attempt.resolverId);

      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: NotificationStatus.SENT,
          processedAt: new Date(),
        },
      });

      details.push({
        id: attempt.id,
        itemId: attempt.itemId,
        status: NotificationStatus.SENT,
      });
      sent++;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);

      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: NotificationStatus.FAILED,
          lastError: errorMessage.slice(0, 500),
          processedAt: new Date(),
        },
      });

      details.push({
        id: attempt.id,
        itemId: attempt.itemId,
        status: NotificationStatus.FAILED,
        error: errorMessage,
      });
      failed++;
    }
  }

  return { processed: pending.length, sent, failed, details };
}
