/**
 * Webhook caller: simulator -> Grasp.
 *
 * When a "user" sends a message in the simulator UI, we POST it to
 * the Grasp webhook so the agent can react. Grasp's response (if any)
 * comes back via the same /api/messages endpoint Grasp uses for
 * proactive sends.
 *
 * Best-effort: webhook failures don't block the user message from
 * being saved, so the operator can still see what they typed.
 */

import { getSharedSecret } from "./auth";

export interface WebhookPayload {
  user: {
    email: string;
    name: string;
  };
  message: {
    id: string;
    text: string;
    createdAt: string;
  };
}

export interface WebhookResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function postToGrasp(
  payload: WebhookPayload,
): Promise<WebhookResult> {
  const url = process.env.GRASP_WEBHOOK_URL?.trim();
  const secret = getSharedSecret();
  if (!url) {
    return {
      ok: false,
      error: "GRASP_WEBHOOK_URL not configured — agent will not see this reply",
    };
  }
  if (!secret) {
    return { ok: false, error: "SIMULATOR_SHARED_SECRET not configured" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
      // Don't hang the user's message indefinitely if Grasp is down.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text() };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown webhook error",
    };
  }
}
