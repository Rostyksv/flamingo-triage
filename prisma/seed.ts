import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  ItemPriority,
  ItemStatus,
  Prisma,
  PrismaClient,
  WorkspaceRole,
} from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });
const ITEM_COUNT = Number.parseInt(process.env.SEED_ITEM_COUNT ?? "10000", 10);
const CHUNK_SIZE = 1000;

type WorkspaceSeed = {
  slug: string;
  name: string;
};

type UserSeed = {
  email: string;
  name: string;
  memberships: Record<string, WorkspaceRole>;
};

const workspaces: WorkspaceSeed[] = [
  { slug: "support", name: "Support Team" },
  { slug: "billing", name: "Billing Team" },
  { slug: "engineering", name: "Engineering" },
];

const users: UserSeed[] = [
  {
    email: "avery.owner@example.test",
    name: "Avery Owner",
    memberships: { support: WorkspaceRole.OWNER, billing: WorkspaceRole.MEMBER },
  },
  {
    email: "blair.member@example.test",
    name: "Blair Member",
    memberships: {
      support: WorkspaceRole.MEMBER,
      billing: WorkspaceRole.VIEWER,
      engineering: WorkspaceRole.OWNER,
    },
  },
  {
    email: "casey.viewer@example.test",
    name: "Casey Viewer",
    memberships: { support: WorkspaceRole.VIEWER, engineering: WorkspaceRole.MEMBER },
  },
  {
    email: "devon.member@example.test",
    name: "Devon Member",
    memberships: { support: WorkspaceRole.MEMBER, billing: WorkspaceRole.MEMBER },
  },
  {
    email: "riley.owner@example.test",
    name: "Riley Owner",
    memberships: { billing: WorkspaceRole.OWNER, engineering: WorkspaceRole.VIEWER },
  },
];

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function weightedStatus(value: number) {
  if (value < 0.68) return ItemStatus.QUEUED;
  if (value < 0.85) return ItemStatus.CLAIMED;
  return ItemStatus.RESOLVED;
}

function weightedPriority(value: number) {
  if (value < 0.08) return ItemPriority.URGENT;
  if (value < 0.27) return ItemPriority.HIGH;
  if (value < 0.88) return ItemPriority.NORMAL;
  return ItemPriority.LOW;
}

function pick<T>(items: T[], value: number) {
  return items[Math.floor(value * items.length) % items.length];
}

async function main() {
  if (!Number.isFinite(ITEM_COUNT) || ITEM_COUNT < 1000) {
    throw new Error("SEED_ITEM_COUNT must be at least 1000 so queue behavior is realistic.");
  }

  console.log("Resetting existing seed data...");
  await prisma.notificationAttempt.deleteMany();
  await prisma.item.deleteMany();
  await prisma.workspaceMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();

  console.log("Creating workspaces, seeded users, and memberships...");
  const workspaceBySlug = new Map<string, { id: string; slug: string; name: string }>();

  for (const workspace of workspaces) {
    const created = await prisma.workspace.create({ data: workspace });
    workspaceBySlug.set(workspace.slug, created);
  }

  const usersByWorkspace = new Map<string, { id: string; role: WorkspaceRole }[]>();

  for (const userSeed of users) {
    const user = await prisma.user.create({
      data: { email: userSeed.email, name: userSeed.name },
    });

    for (const [workspaceSlug, role] of Object.entries(userSeed.memberships)) {
      const workspace = workspaceBySlug.get(workspaceSlug);
      if (!workspace) throw new Error(`Unknown workspace seed: ${workspaceSlug}`);

      await prisma.workspaceMembership.create({
        data: { userId: user.id, workspaceId: workspace.id, role },
      });

      const workspaceUsers = usersByWorkspace.get(workspace.id) ?? [];
      workspaceUsers.push({ id: user.id, role });
      usersByWorkspace.set(workspace.id, workspaceUsers);
    }
  }

  console.log(`Creating ${ITEM_COUNT.toLocaleString()} items with non-even status spread...`);
  const rand = random(0x51f1a2b3);
  const workspaceList = Array.from(workspaceBySlug.values());
  const now = Date.now();
  let created = 0;

  while (created < ITEM_COUNT) {
    const chunkLength = Math.min(CHUNK_SIZE, ITEM_COUNT - created);
    const data: Prisma.ItemCreateManyInput[] = [];

    for (let offset = 0; offset < chunkLength; offset += 1) {
      const sequence = created + offset + 1;
      const workspace = workspaceList[sequence % workspaceList.length];
      const status = weightedStatus(rand());
      const priority = weightedPriority(rand());
      const eligibleUsers = (usersByWorkspace.get(workspace.id) ?? []).filter(
        (membership) => membership.role !== WorkspaceRole.VIEWER,
      );
      const actor = pick(eligibleUsers, rand());
      const createdAt = new Date(now - Math.floor(rand() * 1000 * 60 * 60 * 24 * 45));

      data.push({
        workspaceId: workspace.id,
        title: `Case ${sequence.toString().padStart(5, "0")}`,
        description: `Seeded ${priority.toLowerCase()} triage item for ${workspace.name}.`,
        status,
        priority,
        claimedById: status === ItemStatus.CLAIMED ? actor.id : null,
        claimedAt:
          status === ItemStatus.CLAIMED
            ? new Date(now - Math.floor(rand() * 1000 * 60 * 60 * 2))
            : null,
        claimExpiresAt:
          status === ItemStatus.CLAIMED
            ? new Date(now + Math.floor(rand() * 1000 * 60 * 45))
            : null,
        resolvedById: status === ItemStatus.RESOLVED ? actor.id : null,
        resolvedAt:
          status === ItemStatus.RESOLVED
            ? new Date(now - Math.floor(rand() * 1000 * 60 * 60 * 24 * 14))
            : null,
        createdAt,
        updatedAt: createdAt,
      });
    }

    await prisma.item.createMany({ data });
    created += chunkLength;
  }

  const [userCount, workspaceCount, membershipCount, itemCounts] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count(),
    prisma.workspaceMembership.count(),
    prisma.item.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  console.log("Seed complete:");
  console.table({
    users: userCount,
    workspaces: workspaceCount,
    memberships: membershipCount,
    items: itemCounts.reduce((sum, row) => sum + row._count._all, 0),
  });
  console.table(
    itemCounts.map((row) => ({ status: row.status, count: row._count._all })),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
