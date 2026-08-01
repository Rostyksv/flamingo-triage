import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ItemRecord = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  claimedById: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  resolvedById: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  claimedBy: { id: string; name: string; email: string } | null;
  resolvedBy: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string; slug: string };
};

const itemInclude = {
  claimedBy: { select: { id: true, name: true, email: true } },
  resolvedBy: { select: { id: true, name: true, email: true } },
  workspace: { select: { id: true, name: true, slug: true } },
} as const;

type PrismaItemRow = Awaited<
  ReturnType<typeof prisma.item.findFirst<{ include: typeof itemInclude }>>
>;

export async function findItemById(itemId: string): Promise<ItemRecord | null> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: itemInclude,
  });
  return item ? toItemRecord(item) : null;
}

/**
 * Keyset/cursor-based pagination over workspace items.
 *
 * Uses `ROW(createdAt, id) > ROW($cursor_createdAt, $cursor_id)` directly
 * in raw SQL so Postgres can seek the composite index in the Index Cond
 * rather than pushing the cursor into a Filter (which is what Prisma's
 * OR-based approach forces).
 *
 * The first page (no cursor) uses Prisma's findMany for simplicity.
 */
export async function findWorkspaceItemsCursor(params: {
  workspaceIds: string[];
  cursor?: { createdAt: string; id: string };
  limit?: number;
  excludeResolved?: boolean;
}): Promise<ItemRecord[]> {
  const { workspaceIds, cursor, limit = 50, excludeResolved = true } = params;

  if (workspaceIds.length === 0) {
    return [];
  }

  if (cursor) {
    const cursorDate = new Date(cursor.createdAt);

    const rows = (await prisma.$queryRaw`
      SELECT
        "Item".*,
        CASE WHEN "claimedBy"."id" IS NOT NULL THEN
          json_build_object(
            'id', "claimedBy"."id",
            'name', "claimedBy"."name",
            'email', "claimedBy"."email"
          )
        END AS "claimedBy",
        CASE WHEN "resolvedBy"."id" IS NOT NULL THEN
          json_build_object(
            'id', "resolvedBy"."id",
            'name', "resolvedBy"."name",
            'email', "resolvedBy"."email"
          )
        END AS "resolvedBy",
        json_build_object(
          'id', "workspace"."id",
          'name', "workspace"."name",
          'slug', "workspace"."slug"
        ) AS "workspace"
      FROM "Item"
      LEFT JOIN "User" AS "claimedBy" ON "Item"."claimedById" = "claimedBy"."id"
      LEFT JOIN "User" AS "resolvedBy" ON "Item"."resolvedById" = "resolvedBy"."id"
      LEFT JOIN "Workspace" AS "workspace" ON "Item"."workspaceId" = "workspace"."id"
      WHERE "Item"."workspaceId" IN (${Prisma.join(workspaceIds)})
        ${excludeResolved ? Prisma.sql`AND "Item".status != 'RESOLVED'` : Prisma.empty}
        AND ROW("Item"."createdAt", "Item"."id") > ROW(${cursorDate}::timestamp, ${cursor.id}::text)
      ORDER BY "Item"."createdAt" ASC, "Item"."id" ASC
      LIMIT ${limit}
    `) as ItemRecord[];

    return rows.map(mapRawItem);
  }

  const where: Prisma.ItemWhereInput = {
    workspaceId: { in: workspaceIds },
  };

  if (excludeResolved) {
    where.status = { not: "RESOLVED" };
  }

  return prisma.item.findMany({
    where,
    include: itemInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  }).then((rows) => rows.map(toItemRecord));
}

function toItemRecord(row: PrismaItemRow): ItemRecord {
  return {
    id: row!.id,
    title: row!.title,
    description: row!.description,
    status: row!.status,
    priority: row!.priority,
    claimedById: row!.claimedById,
    claimedAt: row!.claimedAt?.toISOString() ?? null,
    claimExpiresAt: row!.claimExpiresAt?.toISOString() ?? null,
    resolvedById: row!.resolvedById,
    resolvedAt: row!.resolvedAt?.toISOString() ?? null,
    createdAt: row!.createdAt.toISOString(),
    updatedAt: row!.updatedAt.toISOString(),
    workspaceId: row!.workspaceId,
    claimedBy: row!.claimedBy ?? null,
    resolvedBy: row!.resolvedBy ?? null,
    workspace: row!.workspace,
  };
}

/**
 * Raw SQL rows come with Item.* columns flat plus json_build_object for
 * claimedBy/workspace. Dates are already ISO strings from the driver.
 */
function mapRawItem(row: Record<string, unknown>): ItemRecord {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    status: row.status as string,
    priority: row.priority as string,
    claimedById: (row.claimedById as string) ?? null,
    claimedAt: (row.claimedAt as string) ?? null,
    claimExpiresAt: (row.claimExpiresAt as string) ?? null,
    resolvedById: (row.resolvedById as string) ?? null,
    resolvedAt: (row.resolvedAt as string) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    workspaceId: row.workspaceId as string,
    claimedBy: (row.claimedBy as ItemRecord["claimedBy"]) ?? null,
    resolvedBy: (row.resolvedBy as ItemRecord["resolvedBy"]) ?? null,
    workspace: row.workspace as ItemRecord["workspace"],
  };
}
