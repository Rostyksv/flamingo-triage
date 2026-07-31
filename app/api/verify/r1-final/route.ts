import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Verification helper: returns the final state of an item after claim.
 */
export async function GET(request: NextRequest) {
  const itemId = request.nextUrl.searchParams.get("itemId");

  if (!itemId) {
    return NextResponse.json({ error: "Missing itemId param" }, { status: 400 });
  }

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      status: true,
      claimedById: true,
      claimedBy: { select: { id: true, name: true } },
    },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  return NextResponse.json({
    singleClaimant: item.claimedById !== null,
    status: item.status,
    claimedById: item.claimedById,
    claimedByName: item.claimedBy?.name ?? null,
  });
}
