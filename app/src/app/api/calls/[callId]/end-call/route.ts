import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { leaveRecallCall, RecallDeployError } from "@/lib/voice/recall";
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

  try {
    await leaveRecallCall(call.recallBotId);
  } catch (err) {
    const detail =
      err instanceof RecallDeployError
        ? `${err.message}${err.body ? ` :: ${err.body.slice(0, 400)}` : ""}`
        : err instanceof Error
          ? err.message
          : "Recall leave_call failed";
    return NextResponse.json(
      { error: detail },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, recallBotId: call.recallBotId });
}
