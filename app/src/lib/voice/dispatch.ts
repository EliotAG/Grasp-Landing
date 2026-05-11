/**
 * Voice-call cron dispatcher.
 *
 * Drains `ScheduledVoiceCall` rows whose `scheduledFor` is within the
 * lead window (default 2 minutes ahead of now) and deploys a Recall.ai
 * bot into the meeting URL with the voice-tuned system prompt.
 *
 * Claim-then-act pattern: we flip `status` from `scheduled` →
 * `dispatched` atomically before deploying so a concurrent cron run
 * can't double-fire. On failure the row goes to `failed` with the
 * error string; on success the Recall bot id lands on the row and the
 * webhook (`/api/calls/recall-webhook`) finishes the lifecycle when
 * the call ends.
 */

import { VoiceCallStatus } from "@prisma/client";

import { absoluteAppUrl, getConfiguredAppBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/db";
import { loadAgentContextByEmail } from "@/lib/agent/context";
import { buildVoiceSystemPrompt } from "@/lib/agent/voice-prompt";

import { deployRecallBot, isRecallConfigured, RecallDeployError } from "./recall";
import { createRecallRealtimeWebhookToken } from "./realtime-events";

/** Default lead window: pre-warm the bot 2 minutes before the slot. */
const DEFAULT_LEAD_MINUTES = 2;

export interface VoiceDispatchResult {
  ok: boolean;
  callId: string;
  enrollmentId: string;
  recallBotId?: string;
  error?: string;
  skippedReason?: string;
}

function recallWebhookUrl(): string {
  const explicit = process.env.RECALL_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const base = getConfiguredAppBaseUrl();
  if (!base) {
    throw new Error(
      "RECALL_WEBHOOK_URL is not configured and no fallback app base URL is set",
    );
  }
  return absoluteAppUrl(base, "/api/calls/recall-webhook");
}

function recallParticipantEventsUrl(callId: string): string {
  const base = getConfiguredAppBaseUrl();
  if (!base) {
    throw new Error(
      "No app base URL is configured for Recall participant event webhooks",
    );
  }
  const url = new URL(
    absoluteAppUrl(base, "/api/calls/recall-participant-events/"),
  );
  url.searchParams.set("callId", callId);
  url.searchParams.set("token", createRecallRealtimeWebhookToken(callId));
  return url.toString();
}

export async function drainDueVoiceCalls(opts?: {
  limit?: number;
  leadMinutes?: number;
}): Promise<{
  drained: number;
  results: VoiceDispatchResult[];
}> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 25, 100));
  const lead = opts?.leadMinutes ?? DEFAULT_LEAD_MINUTES;
  const horizon = new Date(Date.now() + lead * 60_000);

  const due = await prisma.scheduledVoiceCall.findMany({
    where: {
      status: VoiceCallStatus.scheduled,
      scheduledFor: { lte: horizon },
      // Only deploy a bot for rows whose Graph invite step succeeded.
      // A null meetingJoinUrl means the calendar invite never sent
      // (Graph 403, missing policy, etc.) — we'd be deploying a bot
      // into a meeting URL the employee never received.
      meetingJoinUrl: { not: null },
      changePlan: { status: "active", voiceKickoffEnabled: true },
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: { id: true },
  });

  const results: VoiceDispatchResult[] = [];
  for (const row of due) {
    try {
      const result = await runScheduledVoiceCall(row.id);
      results.push(result);
    } catch (err) {
      results.push({
        ok: false,
        callId: row.id,
        enrollmentId: "<unknown>",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { drained: results.length, results };
}

export async function runScheduledVoiceCall(
  callId: string,
): Promise<VoiceDispatchResult> {
  const claim = await prisma.scheduledVoiceCall.updateMany({
    where: { id: callId, status: VoiceCallStatus.scheduled },
    data: {
      status: VoiceCallStatus.dispatched,
      dispatchedAt: new Date(),
    },
  });
  if (claim.count === 0) {
    return {
      ok: true,
      callId,
      enrollmentId: "<unknown>",
      skippedReason: "already claimed",
    };
  }

  const row = await prisma.scheduledVoiceCall.findUnique({
    where: { id: callId },
    include: {
      enrollment: {
        include: {
          employee: { select: { name: true, email: true } },
        },
      },
      changePlan: {
        select: {
          name: true,
          voiceKickoffEnabled: true,
          status: true,
          organization: { select: { name: true } },
        },
      },
    },
  });
  if (!row) {
    return {
      ok: false,
      callId,
      enrollmentId: "<unknown>",
      error: "Voice-call row vanished after claim",
    };
  }
  if (!row.changePlan.voiceKickoffEnabled) {
    await markVoiceCall(callId, VoiceCallStatus.skipped, {
      error: "Voice kickoff disabled on plan",
    });
    return {
      ok: true,
      callId,
      enrollmentId: row.enrollmentId,
      skippedReason: "voice disabled",
    };
  }
  if (!row.meetingJoinUrl) {
    await markVoiceCall(callId, VoiceCallStatus.skipped, {
      error:
        "Per-employee Teams meeting URL is missing — Graph invite step never succeeded for this row",
    });
    return {
      ok: true,
      callId,
      enrollmentId: row.enrollmentId,
      skippedReason: "no meeting url",
    };
  }
  if (row.changePlan.status !== "active") {
    await markVoiceCall(callId, VoiceCallStatus.skipped, {
      error: `Plan no longer active (status=${row.changePlan.status})`,
    });
    return {
      ok: true,
      callId,
      enrollmentId: row.enrollmentId,
      skippedReason: "plan inactive",
    };
  }
  if (!isRecallConfigured()) {
    await markVoiceCall(callId, VoiceCallStatus.skipped, {
      error:
        "RECALL_API_KEY / OPENAI_API_KEY not set on this environment — skipping voice deploy",
    });
    return {
      ok: true,
      callId,
      enrollmentId: row.enrollmentId,
      skippedReason: "recall not configured",
    };
  }

  const ctx = await loadAgentContextByEmail(row.enrollment.employee.email);
  if (!ctx) {
    await markVoiceCall(callId, VoiceCallStatus.skipped, {
      error:
        "Could not load agent context (employee not active in any rollout)",
    });
    return {
      ok: true,
      callId,
      enrollmentId: row.enrollmentId,
      skippedReason: "no context",
    };
  }
  const systemPrompt = buildVoiceSystemPrompt(ctx);

  let webhookUrl: string;
  try {
    webhookUrl = recallWebhookUrl();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markVoiceCall(callId, VoiceCallStatus.failed, { error: message });
    return { ok: false, callId, enrollmentId: row.enrollmentId, error: message };
  }

  try {
    const bot = await deployRecallBot({
      meetingUrl: row.meetingJoinUrl,
      botName: `Grasp · ${row.changePlan.organization.name}`.slice(0, 64),
      systemPrompt,
      webhookUrl,
      participantEventsWebhookUrl: recallParticipantEventsUrl(callId),
      // Recall accepts a join_at timestamp; we pass the row's
      // scheduledFor so the bot waits in the lobby until the slot.
      joinAt: row.scheduledFor,
    });
    await prisma.scheduledVoiceCall.update({
      where: { id: callId },
      data: { recallBotId: bot.id, error: null },
    });
    return {
      ok: true,
      callId,
      enrollmentId: row.enrollmentId,
      recallBotId: bot.id,
    };
  } catch (err) {
    const message =
      err instanceof RecallDeployError
        ? `${err.message}${err.body ? ` :: ${err.body.slice(0, 200)}` : ""}`
        : err instanceof Error
          ? err.message
          : "Recall deploy failed";
    await markVoiceCall(callId, VoiceCallStatus.failed, { error: message });
    return { ok: false, callId, enrollmentId: row.enrollmentId, error: message };
  }
}

async function markVoiceCall(
  callId: string,
  status: VoiceCallStatus,
  extra: { error?: string | null } = {},
): Promise<void> {
  await prisma.scheduledVoiceCall.update({
    where: { id: callId },
    data: {
      status,
      error: extra.error ?? null,
    },
  });
}
