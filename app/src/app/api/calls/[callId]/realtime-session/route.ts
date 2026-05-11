import { NextResponse } from "next/server";

import { createVoiceCallRealtimeSession } from "@/lib/voice/call-realtime-session";
import { verifyRecallRealtimeWebhookToken } from "@/lib/voice/realtime-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params;
  const token = new URL(req.url).searchParams.get("token");
  if (!verifyRecallRealtimeWebhookToken(callId, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await createVoiceCallRealtimeSession(callId);
    return NextResponse.json({
      sessionId: payload.session.id,
      model: payload.session.model,
      voice: payload.voice,
      clientSecret: payload.session.client_secret.value,
      clientSecretExpiresAt: payload.session.client_secret.expires_at,
      handshakeUrl: payload.handshakeUrl,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create voice session";
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
