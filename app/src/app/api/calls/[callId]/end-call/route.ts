import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { verifyRecallRealtimeWebhookToken } from "@/lib/voice/realtime-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function recallApiHost(): string {
  return process.env.RECALL_API_HOST?.trim() || "us-east-1.recall.ai";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params;
  const token = new URL(req.url).searchParams.get("token");
  if (!verifyRecallRealtimeWebhookToken(callId, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const call = await prisma.scheduledVoiceCall.findUnique({
    where: { id: callId },
    select: { recallBotId: true, status: true },
  });
  if (!call?.recallBotId) {
    return NextResponse.json({ ok: true, skipped: "no_recall_bot" });
  }
  if (call.status === "completed") {
    return NextResponse.json({ ok: true, skipped: "already_completed" });
  }

  const apiKey = process.env.RECALL_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "RECALL_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const res = await fetch(
    `https://${recallApiHost()}/api/v1/bot/${encodeURIComponent(call.recallBotId)}/leave_call/`,
    {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Recall leave_call failed: ${res.status} ${text.slice(0, 400)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, recallBotId: call.recallBotId });
}
