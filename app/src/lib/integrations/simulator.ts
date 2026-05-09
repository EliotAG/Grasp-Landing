/**
 * Simulator integration: outbound send.
 *
 * Mirrors the shape of the Teams proactive adapter
 * (`src/lib/teams/proactive.ts`). The simulator is treated as just
 * another delivery channel — Grasp doesn't know or care that it's a
 * fake. When SIMULATOR_URL is unset (most production deploys), this
 * is a no-op.
 *
 * Usage:
 *   await sendSimMessage({ email, name, text, kind })
 *
 * Failures are swallowed by callers; the simulator is best-effort
 * out-of-band testing infrastructure, never load-bearing for
 * Grasp's primary Teams flow.
 */

export interface SimSendInput {
  email: string;
  name: string;
  text: string;
  kind?: "message" | "kickoff" | "system";
  title?: string | null;
}

export interface SimSendResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** True when no simulator is configured — caller can treat as success. */
  skipped?: boolean;
}

export async function sendSimMessage(
  input: SimSendInput,
): Promise<SimSendResult> {
  const baseUrl = process.env.SIMULATOR_URL?.trim().replace(/\/$/, "");
  const secret = process.env.SIMULATOR_SHARED_SECRET?.trim();
  if (!baseUrl || !secret) {
    return { ok: true, skipped: true };
  }
  try {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        user: {
          email: input.email,
          name: input.name,
          title: input.title ?? null,
        },
        text: input.text,
        kind: input.kind ?? "message",
      }),
      // Cap latency so a slow / down simulator doesn't hold up a kickoff
      // fan-out. The Teams send still happens regardless.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await res.text().catch(() => "(no body)"),
      };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown send error",
    };
  }
}

/**
 * Verify the shared secret on inbound webhook calls (Simulator -> Grasp).
 * Constant-time compare; mirrors the simulator's auth.ts.
 */
export function verifySimulatorWebhook(req: Request): boolean {
  const expected = process.env.SIMULATOR_SHARED_SECRET?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
