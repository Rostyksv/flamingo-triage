import { NextResponse } from "next/server";
import { processPendingNotifications } from "@/lib/notification-runner";

export async function POST() {
  const result = await processPendingNotifications();
  return NextResponse.json(result);
}
