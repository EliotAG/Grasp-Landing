/**
 * Recall.ai bot deployment.
 *
 * Deploys an AI bot into a leader-pasted Microsoft Teams meeting URL.
 * The bot routes meeting audio to OpenAI Realtime (over Recall.ai's
 * `output_media` provider bridge) so the model both hears and speaks
 * inside the meeting; Recall.ai handles voice activity detection,
 * barge-in, and reconnects.
 *
 * Documented Recall recipe: https://docs.recall.ai/docs/agent-quickstarts
 *
 * NOT used by the text agent — `runAgentTurn` stays on Claude. This
 * module exists purely so the optional voice kickoff has a Realtime
 * voice loop that shares the system prompt shape we already build.
 */

export interface DeployRecallBotInput {
  meetingUrl: string;
  /** Display name shown in the Teams roster while the bot is in the meeting. */
  botName: string;
  /** Pre-built voice system prompt (see voice-prompt.ts). */
  systemPrompt: string;
  /**
   * Public URL Recall.ai posts status-change events to (call started,
   * call ended, etc.). Wired to /api/calls/recall-webhook.
   */
  webhookUrl: string;
  /**
   * Public URL Recall.ai posts realtime participant events to. Used to
   * detect when the invited employee joins the Teams meeting.
   */
  participantEventsWebhookUrl?: string;
  /**
   * Optional join timestamp. When omitted Recall sends the bot
   * immediately; we usually pre-warm a minute or two before
   * `scheduledFor` so the bot is in the room when the user arrives.
   */
  joinAt?: Date;
}

export interface DeployRecallBotResult {
  id: string;
}

export class RecallDeployError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "RecallDeployError";
  }
}

function recallApiHost(): string {
  return process.env.RECALL_API_HOST?.trim() || "us-east-1.recall.ai";
}

export function isRecallConfigured(): boolean {
  return Boolean(
    process.env.RECALL_API_KEY?.trim() && process.env.OPENAI_API_KEY?.trim(),
  );
}

export async function deployRecallBot(
  input: DeployRecallBotInput,
): Promise<DeployRecallBotResult> {
  const apiKey = process.env.RECALL_API_KEY?.trim();
  if (!apiKey) {
    throw new RecallDeployError("RECALL_API_KEY is not configured");
  }
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) {
    throw new RecallDeployError(
      "OPENAI_API_KEY is not configured (required for the Realtime voice loop)",
    );
  }
  const realtimeModel =
    process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2";

  const body = {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    join_at: input.joinAt?.toISOString(),
    output_media: {
      // Recall.ai's documented OpenAI Realtime bridge: routes meeting
      // audio to OpenAI Realtime over WebSocket and pipes the model's
      // audio back into the meeting as the bot's voice.
      provider: "openai_realtime",
      config: {
        api_key: openaiKey,
        model: realtimeModel,
        voice: "alloy",
        instructions: input.systemPrompt,
      },
    },
    // Cheap streaming transcription; we only need it for the post-
    // call extractor pass and for the leader's recap UI.
    real_time_transcription: {
      provider: "deepgram_streaming",
    },
    recording_config: input.participantEventsWebhookUrl
      ? {
          realtime_endpoints: [
            {
              type: "webhook",
              url: input.participantEventsWebhookUrl,
              events: [
                "participant_events.join",
                "participant_events.update",
                "participant_events.leave",
              ],
            },
          ],
        }
      : undefined,
    // Recall fans status-change events to this URL. We only act on
    // bot.status_change with status = done in the webhook.
    webhook_url: input.webhookUrl,
  };

  const res = await fetch(`https://${recallApiHost()}/api/v1/bot`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new RecallDeployError(
      `Recall.ai deploy failed: ${res.status} ${res.statusText}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new RecallDeployError("Recall.ai response missing bot id");
  }
  return { id: json.id };
}

/**
 * Read transcript JSON for a bot, used by the post-call webhook to
 * load the conversation Recall stored when the call ended. Returns
 * the raw shape Recall.ai serves so the extractor can pick the
 * fields it cares about (we don't reshape here because the format
 * varies by provider config).
 */
export async function fetchRecallTranscript(
  botId: string,
): Promise<unknown> {
  const apiKey = process.env.RECALL_API_KEY?.trim();
  if (!apiKey) {
    throw new RecallDeployError("RECALL_API_KEY is not configured");
  }
  const res = await fetch(
    `https://${recallApiHost()}/api/v1/bot/${botId}/transcript/`,
    { headers: { Authorization: `Token ${apiKey}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new RecallDeployError(
      `Recall.ai transcript fetch failed: ${res.status} ${res.statusText}`,
      res.status,
      text,
    );
  }
  return await res.json();
}
