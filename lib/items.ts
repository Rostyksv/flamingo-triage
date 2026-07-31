import "server-only";

import { prisma } from "@/lib/db";

export type ItemRow = Awaited<ReturnType<typeof findItemById>>;

export type ItemListItem = Awaited<
  ReturnType<typeof findWorkspaceItems>
>[number];

/**
 * Find a single item by ID, including claimant info.
 * Does NOT enforce workspace membership — callers must apply policy.
 */
export async function findItemById(itemId: string) {
  return prisma.item.findUnique({
    where: { id: itemId },
    include: {
      claimedBy: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, name: true, slug: true } },
    },
  });
}

/**
 * List items in workspaces the user belongs to, with basic filtering.
 * Returns items ordered by priority desc, createdAt asc.
 */
export async function findWorkspaceItems(params: {
  workspaceIds: string[];
  status?: string;
  limit?: number;
}) {
  const { workspaceIds, status, limit = 50 } = params;

  if (workspaceIds.length === 0) {
    return [];
  }

  return prisma.item.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      ...(status ? { status: status as never } : {}),
    },
    include: {
      claimedBy: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, name: true, slug: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit,
  });
}
