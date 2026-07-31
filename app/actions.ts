"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, setSessionCookie, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function selectSeededUser(formData: FormData) {
  const userId = formData.get("userId");

  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Choose a seeded user before continuing.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new Error("Selected seeded user was not found.");
  }

  await setSessionCookie(user.id);
  redirect("/");
}

export async function signOut() {
  await clearSessionCookie();
  redirect("/");
}

export async function loadMoreItems(offset: number = 0): Promise<{
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  claimedById: string | null;
  claimedAt: string | null;
  resolvedAt: string | null;
  workspaceId: string;
  claimedBy: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string; slug: string };
}[]> {
  "use server";

  const user = await getCurrentUser();

  if (!user) {
    return [];
  }

  const workspaceIds = user.memberships.map((m) => m.workspaceId);

  const items = await prisma.item.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      status: { not: "RESOLVED" },
    },
    include: {
      claimedBy: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, name: true, slug: true } },
    },
    orderBy: [
      { createdAt: "asc" },
    ],
    skip: offset,
    take: 50,
  });

  return items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    claimedById: item.claimedById,
    claimedAt: item.claimedAt?.toISOString() ?? null,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    workspaceId: item.workspaceId,
    claimedBy: item.claimedBy,
    workspace: item.workspace,
  }));
}
