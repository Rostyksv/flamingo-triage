import { ItemStatus, WorkspaceRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSessionToken } from "@/lib/auth";

/**
 * Verfication helper: picks the first QUEUED item and two users
 * in its workspace, returns pre-signed cookies for both.
 */
export async function GET() {
  const item = await prisma.item.findFirst({
    where: { status: ItemStatus.QUEUED },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, workspaceId: true },
  });

  if (!item) {
    return NextResponse.json({ error: "No QUEUED items found" }, { status: 500 });
  }

  const members = await prisma.workspaceMembership.findMany({
    where: {
      workspaceId: item.workspaceId,
      role: { in: [WorkspaceRole.OWNER, WorkspaceRole.MEMBER] },
    },
    include: { user: { select: { id: true, name: true } } },
    take: 2,
  });

  if (members.length < 2) {
    return NextResponse.json(
      { error: "Not enough workspace members for concurrency test" },
      { status: 500 },
    );
  }

  const [memberA, memberB] = members;

  return NextResponse.json({
    item,
    userA: memberA.user,
    userB: memberB.user,
    cookieA: createSessionToken(memberA.user.id),
    cookieB: createSessionToken(memberB.user.id),
  });
}
