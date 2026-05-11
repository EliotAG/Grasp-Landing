/**
 * Recall.ai realtime participant events.
 *
 * This endpoint is attached per bot through `recording_config.realtime_endpoints`
 * so we know when the invited employee actually enters the Teams room.
 * It is distinct from `/api/calls/recall-webhook`, which only handles
 * bot lifecycle/status events.
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { startVoiceCallOutputMedia } from "@/lib/voice/dispatch";
import { verifyRecallRealtimeWebhookToken } from "@/lib/voice/realtime-events";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RecallParticipant {
  id?: number;
  name?: string | null;
  email?: string | null;
  platform?: string | null;
  extra_data?: unknown;
}

interface RecallParticipantEvent {
  event?: string;
  data?: {
    data?: {
      participant?: RecallParticipant;
      timestamp?: {
        absolute?: string;
        relative?: number;
      };
    };
    bot?: {
      id?: string;
      metadata?: unknown;
    };
  };
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const callId = url.searchParams.get("callId");
  const token = url.searchParams.get("token");
  if (!callId || !verifyRecallRealtimeWebhookToken(callId, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: RecallParticipantEvent;
  try {
    payload = (await req.json()) as RecallParticipantEvent;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!isParticipantEvent(payload.event)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const participant = payload.data?.data?.participant;
  const botId = payload.data?.bot?.id ?? null;
  if (!participant || !botId) {
    return NextResponse.json(
      { error: "Missing participant or bot id in payload" },
      { status: 400 },
    );
  }

  const call = await prisma.scheduledVoiceCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      recallBotId: true,
      participantJoinedAt: true,
      participantRecallId: true,
      enrollment: {
        select: {
          employee: { select: { email: true, name: true } },
        },
      },
    },
  });
  if (!call) {
    // The token is valid but the row no longer exists. Acknowledge so
    // Recall does not retry an event we can never consume.
    return NextResponse.json({ ok: true, ignored: "unknown_call" });
  }
  if (call.recallBotId && call.recallBotId !== botId) {
    return NextResponse.json({ ok: true, ignored: "bot_mismatch" });
  }

  const eventAt = parseRecallTimestamp(payload) ?? new Date();
  const targetMatched = matchesTargetParticipant(
    participant,
    call.enrollment.employee,
    payload.event,
    call.participantRecallId,
  );
  if (!targetMatched) {
    return NextResponse.json({ ok: true, ignored: "non_target_participant" });
  }

  const isJoinSignal =
    payload.event === "participant_events.join" ||
    payload.event === "participant_events.update";
  const isLeaveSignal = payload.event === "participant_events.leave";

  await prisma.scheduledVoiceCall.update({
    where: { id: call.id },
    data: {
      participantJoinedAt:
        isJoinSignal && !call.participantJoinedAt
          ? eventAt
          : call.participantJoinedAt,
      participantLastSeenAt: eventAt,
      participantLeftAt: isLeaveSignal ? eventAt : null,
      participantRecallId:
        typeof participant.id === "number" ? participant.id : call.participantRecallId,
      participantName: participant.name ?? null,
      participantEmail: participant.email ?? null,
      participantPlatform: participant.platform ?? null,
      participantLastEvent: payload as Prisma.InputJsonValue,
    },
  });

  if (isJoinSignal) {
    const output = await startVoiceCallOutputMedia(call.id);
    return NextResponse.json({ ok: true, output });
  }

  return NextResponse.json({ ok: true, cooldownStarted: isLeaveSignal });
}

/** Simple health check for Recall/manual endpoint validation. */
export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    service: "recall-participant-events",
  });
}

function isParticipantEvent(event: string | undefined): event is string {
  return (
    event === "participant_events.join" ||
    event === "participant_events.update" ||
    event === "participant_events.leave"
  );
}

function parseRecallTimestamp(payload: RecallParticipantEvent): Date | null {
  const absolute = payload.data?.data?.timestamp?.absolute;
  if (!absolute) return null;
  const parsed = new Date(absolute);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function matchesTargetParticipant(
  participant: RecallParticipant,
  employee: { email: string; name: string },
  event: string | undefined,
  priorParticipantRecallId: number | null,
): boolean {
  if (
    typeof participant.id === "number" &&
    priorParticipantRecallId !== null &&
    participant.id === priorParticipantRecallId
  ) {
    return true;
  }

  const participantEmail = participant.email?.trim().toLowerCase();
  if (participantEmail) {
    return participantEmail === employee.email.trim().toLowerCase();
  }

  // Recall notes that `join` can arrive before calendar-attendee email
  // matching has populated `participant.email`; in these one-person
  // rooms, the first non-bot attendee is the employee.
  return event === "participant_events.join" && !isLikelyBotParticipant(participant);
}

function isLikelyBotParticipant(participant: RecallParticipant): boolean {
  const name = participant.name?.trim().toLowerCase() ?? "";
  if (!name) return false;
  return name.includes("grasp") || name.includes("bot");
}
