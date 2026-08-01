import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { findWorkspaceItemsCursor } from "@/lib/items";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
  const cursorCreatedAt = searchParams.get("cursorCreatedAt") ?? undefined;
  const cursorId = searchParams.get("cursorId") ?? undefined;

  const workspaceIds = user.memberships.map((m) => m.workspaceId);

  const items = await findWorkspaceItemsCursor({
    workspaceIds,
    cursor: cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: cursorId } : undefined,
    limit,
    excludeResolved: status !== "RESOLVED",
  });

  return NextResponse.json({ items, count: items.length });
}
