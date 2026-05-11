import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_PREFIX = "v1";

function realtimeWebhookSecret(): string | null {
  return (
    process.env.RECALL_REALTIME_WEBHOOK_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    null
  );
}

export function createRecallRealtimeWebhookToken(callId: string): string {
  const secret = realtimeWebhookSecret();
  if (!secret) {
    throw new Error(
      "RECALL_REALTIME_WEBHOOK_SECRET or CRON_SECRET must be configured for Recall participant events",
    );
  }
  const signature = createHmac("sha256", secret).update(callId).digest("hex");
  return `${TOKEN_PREFIX}.${signature}`;
}

export function verifyRecallRealtimeWebhookToken(
  callId: string,
  token: string | null,
): boolean {
  if (!token) return false;
  const secret = realtimeWebhookSecret();
  if (!secret) return false;

  const expected = createRecallRealtimeWebhookToken(callId);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(token);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
