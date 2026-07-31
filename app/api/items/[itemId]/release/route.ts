import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { releaseItem } from "@/lib/claim-service";
import { findItemById } from "@/lib/items";
import { checkCanMutate } from "@/lib/policy";

export async function POST(
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

  const auth = checkCanMutate(user, item.workspaceId);
  if (!auth.allowed) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  const result = await releaseItem(itemId, user.id);

  if (!result.success) {
    return NextResponse.json(result, { status: 409 });
  }

  return NextResponse.json(result, { status: 200 });
}
