/**
 * Recall.ai post-call webhook.
 *
 * When a Recall.ai bot finishes a meeting it POSTs a status-change
 * event here. We act on `bot.status_change` with `status = "done"`:
 *
 *   1. Look up the matching `ScheduledVoiceCall` by `recallBotId`.
 *   2. Pull the transcript JSON from Recall.ai.
 *   3. Persist it on the row + drop a synthetic AgentMessage pair so
 *      the next text turn has the call in conversation history.
 *   4. Run a Claude proactive turn over the transcript so tool side-
 *      effects (record_three_dim_baseline, record_implementation_intention,
 *      surface_concern) fire on the substance the voice loop captured.
 *
 * Auth: Recall.ai supports a per-bot signing token, but their docs
 * recommend confirming the bot id matches one we deployed before
 * running heavy work. We do that lookup as the gate.
 */

import { NextResponse } from "next/server";
import {
  AgentMessageChannel,
  AgentMessageRole,
  Prisma,
  VoiceCallStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/anthropic";
import { loadAgentContextByEmail } from "@/lib/agent/context";
import { runProactiveTurn } from "@/lib/agent/proactive";
import { fetchRecallTranscript } from "@/lib/voice/recall";

export const runtime = "nodejs";
export const maxDuration = 300;

interface RecallWebhookEvent {
  event?: string;
  data?: {
    bot?: {
      id?: string;
      status?: { code?: string };
    };
    bot_id?: string;
    status?: { code?: string } | string;
  };
}

export async function POST(req: Request): Promise<Response> {
  let payload: RecallWebhookEvent;
  try {
    payload = (await req.json()) as RecallWebhookEvent;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // Recall.ai's status_change payload puts the bot id either at
  // data.bot.id or data.bot_id depending on event variant; the
  // status code is similarly nested. Read defensively.
  const botId =
    payload.data?.bot?.id ?? payload.data?.bot_id ?? null;
  const statusCode =
    payload.data?.bot?.status?.code ??
    (typeof payload.data?.status === "object"
      ? payload.data?.status?.code
      : payload.data?.status) ??
    null;

  if (!botId) {
    return NextResponse.json(
      { error: "Missing bot id in payload" },
      { status: 400 },
    );
  }

  // We only care about call-end. Acknowledge other events silently
  // so Recall doesn't mark them as failed deliveries.
  const isDone =
    payload.event === "bot.done" ||
    statusCode === "done" ||
    statusCode === "call_ended";
  if (!isDone) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const call = await prisma.scheduledVoiceCall.findFirst({
    where: { recallBotId: botId },
    select: {
      id: true,
      enrollmentId: true,
      status: true,
      enrollment: { select: { employee: { select: { email: true, name: true } } } },
    },
  });
  if (!call) {
    // Not one of ours — acknowledge so Recall doesn't retry.
    console.warn("[recall-webhook] no ScheduledVoiceCall for bot", botId);
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (call.status === VoiceCallStatus.completed) {
    return NextResponse.json({ ok: true, alreadyCompleted: true });
  }

  let transcript: unknown = null;
  try {
    transcript = await fetchRecallTranscript(botId);
  } catch (err) {
    console.error("[recall-webhook] transcript fetch failed:", err);
  }

  await prisma.scheduledVoiceCall.update({
    where: { id: call.id },
    data: {
      status: VoiceCallStatus.completed,
      completedAt: new Date(),
      transcript:
        transcript === null
          ? Prisma.JsonNull
          : (transcript as Prisma.InputJsonValue),
      error: null,
    },
  });

  const transcriptText = renderTranscriptText(transcript);

  // Drop a synthetic conversation turn pair into AgentMessage so the
  // next text turn re-hydrates with the call as context. We mark
  // both rows as system-channel (the call surface) and tag the
  // content with a [voice kickoff] preamble so the model knows the
  // medium when it reads back the transcript.
  await prisma.agentMessage.createMany({
    data: [
      {
        enrollmentId: call.enrollmentId,
        role: AgentMessageRole.system,
        content: `[voice kickoff completed — Recall.ai bot ${botId} finished the call]`,
        channel: AgentMessageChannel.system,
      },
      {
        enrollmentId: call.enrollmentId,
        role: AgentMessageRole.system,
        content: `[voice kickoff transcript]\n${transcriptText.slice(0, 32_000)}`,
        channel: AgentMessageChannel.system,
      },
    ],
  });

  if (!isAiEnabled()) {
    // Without an AI key we can't run the extractor; the transcript
    // is at least persisted so the dashboard can show it.
    return NextResponse.json({ ok: true, extractor: "skipped_no_ai" });
  }

  const ctx = await loadAgentContextByEmail(call.enrollment.employee.email);
  if (!ctx) {
    console.warn(
      "[recall-webhook] no agent context for",
      call.enrollment.employee.email,
    );
    return NextResponse.json({ ok: true, extractor: "skipped_no_context" });
  }

  try {
    await runProactiveTurn(ctx, buildPostCallSeed(ctx, transcriptText));
  } catch (err) {
    console.error("[recall-webhook] proactive extractor failed:", err);
    return NextResponse.json({ ok: true, extractor: "failed" });
  }

  return NextResponse.json({ ok: true });
}

function buildPostCallSeed(
  ctx: { employee: { name: string } },
  transcriptText: string,
): string {
  const firstName = ctx.employee.name.split(" ")[0];
  // The seed is intentionally explicit about what we want extracted.
  // The voice agent was told NOT to call tools mid-call; this is
  // where the substance of the conversation becomes structured data.
  return [
    `[POST-CALL EXTRACTOR — you just finished a voice kickoff call with ${firstName}. The transcript is below. Your job for THIS turn:`,
    "",
    "1. Use record_three_dim_baseline to capture the cognitive / emotional / behavioral baseline you heard on the call.",
    "2. Use record_implementation_intention if a 'when X happens, I will do Y' commitment was articulated. If not, skip it.",
    "3. Use surface_concern for any concern worth a leader's attention. Zero is fine; don't fabricate.",
    `4. Then write ONE short text DM to ${firstName} recapping in three sentences what you heard and confirming the takeaways. Plain text, no markdown.`,
    "",
    "Do NOT re-elicit information you already heard on the call. Do NOT mention tools or that this is an extractor pass; speak as Grasp.",
    "",
    "--- TRANSCRIPT ---",
    transcriptText.slice(0, 24_000),
    "--- END TRANSCRIPT ---",
    "]",
  ].join("\n");
}

/**
 * Best-effort flattening of Recall.ai's transcript JSON into plain
 * text. The shape varies a bit by provider config (deepgram_streaming
 * vs the openai_realtime bridge); we try the common variants and fall
 * back to JSON-stringifying so the extractor at least sees something.
 */
function renderTranscriptText(transcript: unknown): string {
  if (!transcript) return "(transcript unavailable)";
  // Common shape: array of { speaker, words: [{ text, start_timestamp.* }] }
  // or { transcript: [...] }
  const root =
    Array.isArray(transcript)
      ? transcript
      : typeof transcript === "object" && transcript !== null
        ? ((transcript as { transcript?: unknown }).transcript ?? transcript)
        : transcript;

  if (Array.isArray(root)) {
    const lines: string[] = [];
    for (const segment of root) {
      if (typeof segment !== "object" || segment === null) continue;
      const s = segment as {
        speaker?: { name?: string; user_id?: string } | string;
        words?: Array<{ text?: string }>;
        text?: string;
      };
      const speaker =
        typeof s.speaker === "string"
          ? s.speaker
          : (s.speaker?.name ?? s.speaker?.user_id ?? "Speaker");
      const text =
        s.text ?? (Array.isArray(s.words) ? s.words.map((w) => w.text).join(" ") : "");
      if (text) lines.push(`${speaker}: ${text}`);
    }
    if (lines.length > 0) return lines.join("\n");
  }
  try {
    return JSON.stringify(transcript, null, 2);
  } catch {
    return "(unparseable transcript)";
  }
}

/** Some Recall configurations send GET pings to validate the URL. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true, service: "recall-webhook" });
}
