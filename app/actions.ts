"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, setSessionCookie, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findWorkspaceItemsCursor } from "@/lib/items";
import type { ItemRecord } from "@/lib/items";

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

export async function loadMoreItems(
  cursorCreatedAt?: string,
  cursorId?: string,
): Promise<ItemRecord[]> {
  "use server";

  const user = await getCurrentUser();

  if (!user) {
    return [];
  }

  const workspaceIds = user.memberships.map((m) => m.workspaceId);

  return findWorkspaceItemsCursor({
    workspaceIds,
    cursor:
      cursorCreatedAt && cursorId
        ? { createdAt: cursorCreatedAt, id: cursorId }
        : undefined,
    limit: 50,
  });
}
