import { NextResponse } from "next/server";
import { getCurrentUser, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();

  return NextResponse.json({
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          memberships: user.memberships.map((membership) => ({
            workspaceId: membership.workspaceId,
            workspaceName: membership.workspace.name,
            workspaceSlug: membership.workspace.slug,
            role: membership.role,
          })),
        }
      : null,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = body?.userId;

  if (typeof userId !== "string" || userId.length === 0) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ error: "seeded user not found" }, { status: 404 });
  }

  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
