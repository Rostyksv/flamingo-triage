import { NextResponse } from "next/server";
import { sweepStaleClaims } from "@/lib/sweep-service";

export async function POST() {
  const result = await sweepStaleClaims();
  return NextResponse.json(result);
}
