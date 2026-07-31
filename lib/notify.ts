const FAILURE_RATE = 0.2;
const LATENCY_MS = 1000;

export async function notify(itemId: string, resolverId: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

  if (Math.random() < FAILURE_RATE) {
    throw new Error(
      `Notification delivery failed for item ${itemId} (resolver: ${resolverId})`,
    );
  }
}
