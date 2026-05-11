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
   * Public page Recall.ai renders as the bot's camera. The page owns the
   * OpenAI Realtime WebRTC session and plays assistant audio back into Teams.
   * Omit this to deploy a silent watcher bot first.
   */
  outputMediaUrl?: string;
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

function recallAuthHeaders(): HeadersInit {
  const apiKey = process.env.RECALL_API_KEY?.trim();
  if (!apiKey) {
    throw new RecallDeployError("RECALL_API_KEY is not configured");
  }
  return {
    Authorization: `Token ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function outputMediaBody(outputMediaUrl: string): { camera: { kind: "webpage"; config: { url: string } } } {
  return {
    camera: {
      kind: "webpage",
      config: { url: outputMediaUrl },
    },
  };
}

export async function deployRecallBot(
  input: DeployRecallBotInput,
): Promise<DeployRecallBotResult> {
  recallAuthHeaders();
  if (input.outputMediaUrl && !process.env.OPENAI_API_KEY?.trim()) {
    throw new RecallDeployError(
      "OPENAI_API_KEY is not configured (required for the Realtime voice loop)",
    );
  }

  const body = {
    meeting_url: input.meetingUrl,
    bot_name: input.botName,
    join_at: input.joinAt?.toISOString(),
    variant: {
      microsoft_teams: "web_4_core",
    },
    ...(input.outputMediaUrl
      ? {
          output_media: outputMediaBody(input.outputMediaUrl),
        }
      : {}),
    recording_config: {
      include_bot_in_recording: { audio: true },
      ...(input.participantEventsWebhookUrl
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
        : {}),
    },
    automatic_leave: {
      // The bot doubles as our watcher. Do not let a brief empty room
      // kill the watcher before the app's 60s cooldown can decide
      // whether to stop output media or keep listening for a rejoin.
      everyone_left_timeout: { timeout: 3600, activate_after: 3600 },
      noone_joined_timeout: 3600,
      waiting_room_timeout: 1800,
      silence_detection: { timeout: 3600, activate_after: 1200 },
    },
    // Recall fans status-change events to this URL. We only act on
    // bot.status_change with status = done in the webhook.
    webhook_url: input.webhookUrl,
  };

  const res = await fetch(`https://${recallApiHost()}/api/v1/bot`, {
    method: "POST",
    headers: recallAuthHeaders(),
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

export async function startRecallOutputMedia(
  botId: string,
  outputMediaUrl: string,
): Promise<void> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new RecallDeployError(
      "OPENAI_API_KEY is not configured (required for the Realtime voice loop)",
    );
  }
  const res = await fetch(
    `https://${recallApiHost()}/api/v1/bot/${encodeURIComponent(botId)}/output_media/`,
    {
      method: "POST",
      headers: recallAuthHeaders(),
      body: JSON.stringify(outputMediaBody(outputMediaUrl)),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new RecallDeployError(
      `Recall.ai output media start failed: ${res.status} ${res.statusText}`,
      res.status,
      text,
    );
  }
}

export async function stopRecallOutputMedia(botId: string): Promise<void> {
  const res = await fetch(
    `https://${recallApiHost()}/api/v1/bot/${encodeURIComponent(botId)}/output_media/`,
    {
      method: "DELETE",
      headers: recallAuthHeaders(),
      body: JSON.stringify({ camera: true }),
    },
  );
  // Recall returns 204 on success; 404/400 can happen if output media
  // already stopped. Treat those as idempotent for cooldown drains.
  if (!res.ok && res.status !== 400 && res.status !== 404) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new RecallDeployError(
      `Recall.ai output media stop failed: ${res.status} ${res.statusText}`,
      res.status,
      text,
    );
  }
}

export async function leaveRecallCall(botId: string): Promise<void> {
  const res = await fetch(
    `https://${recallApiHost()}/api/v1/bot/${encodeURIComponent(botId)}/leave_call/`,
    {
      method: "POST",
      headers: recallAuthHeaders(),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new RecallDeployError(
      `Recall.ai leave_call failed: ${res.status} ${res.statusText}`,
      res.status,
      text,
    );
  }
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
