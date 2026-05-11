import type { RealtimeSessionPayload } from "@/lib/voice/intake-session";
import { loadAgentContextByEmployeeId } from "@/lib/agent/context";
import { buildVoiceSystemPrompt } from "@/lib/agent/voice-prompt";
import { prisma } from "@/lib/db";

const REALTIME_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions";
const DEFAULT_VOICE = "marin";
const DEFAULT_MODEL = "gpt-realtime";

interface RealtimeSession {
  id: string;
  model: string;
  voice?: string;
  client_secret: { value: string; expires_at: number };
}

export async function createVoiceCallRealtimeSession(
  callId: string,
): Promise<RealtimeSessionPayload> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured — voice calls are unavailable on this environment.",
    );
  }

  const call = await prisma.scheduledVoiceCall.findUnique({
    where: { id: callId },
    select: {
      enrollmentId: true,
      enrollment: { select: { employeeId: true } },
    },
  });
  if (!call) throw new Error("Voice call not found");

  const ctx = await loadAgentContextByEmployeeId(call.enrollment.employeeId, {
    enrollmentId: call.enrollmentId,
  });
  if (!ctx) {
    throw new Error("Could not load active voice-call context");
  }

  const response = await fetch(REALTIME_SESSIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      voice: DEFAULT_VOICE,
      modalities: ["audio", "text"],
      instructions: buildVoiceSystemPrompt(ctx),
      tools: [
        {
          type: "function",
          name: "end_call",
          description:
            "End the current Teams voice call by removing the Grasp Recall.ai bot from the meeting. Use this after you have given a brief closing summary, when the employee says they are done, says goodbye, or asks to end the call.",
          parameters: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                description:
                  "Short natural-language reason the call is ending.",
              },
            },
            required: ["reason"],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: "auto",
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      turn_detection: {
        type: "server_vad",
        threshold: 0.55,
        prefix_padding_ms: 300,
        silence_duration_ms: 600,
      },
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OpenAI realtime session failed: ${response.status} ${text.slice(0, 400)}`,
    );
  }

  const session = (await response.json()) as RealtimeSession;
  if (!session.client_secret?.value) {
    throw new Error("OpenAI returned a session without a client_secret");
  }

  return {
    session,
    handshakeUrl: `https://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model || DEFAULT_MODEL)}`,
    voice: session.voice || DEFAULT_VOICE,
  };
}
