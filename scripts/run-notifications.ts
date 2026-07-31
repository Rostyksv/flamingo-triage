import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { notify } from "../lib/notify";

async function main() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  const pending = await prisma.notificationAttempt.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  for (const attempt of pending) {
    process.stdout.write(
      `  Processing ${attempt.id} (item: ${attempt.itemId})... `,
    );

    try {
      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: { attemptCount: { increment: 1 } },
      });

      await notify(attempt.itemId, attempt.resolverId);

      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: { status: "SENT", processedAt: new Date() },
      });

    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);

      await prisma.notificationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          lastError: errorMessage.slice(0, 500),
          processedAt: new Date(),
        },
      });

      console.log(`FAILED — ${errorMessage}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
