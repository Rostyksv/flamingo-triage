import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { findItemById } from "@/lib/items";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { itemId } = await params;
  const item = await findItemById(itemId);

  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isMember = user.memberships.some(
    (m) => m.workspaceId === item.workspaceId,
  );

  if (!isMember) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ item });
}
