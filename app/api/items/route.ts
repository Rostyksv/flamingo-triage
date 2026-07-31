import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { findWorkspaceItems } from "@/lib/items";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  const workspaceIds = user.memberships.map((m) => m.workspaceId);

  const items = await findWorkspaceItems({ workspaceIds, status, limit });

  return NextResponse.json({ items, count: items.length });
}
