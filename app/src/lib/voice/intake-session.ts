/**
 * Server-side helpers for the voice intake session.
 *
 *   - `buildIntakeInstructions(plan, docs)` produces the system prompt the
 *     OpenAI Realtime model uses for the whole call.
 *   - `createIntakeRealtimeSession(planId)` calls OpenAI's
 *     `/v1/realtime/sessions` endpoint with the prompt + tool defs and
 *     returns the session metadata (including the ephemeral client secret).
 *
 * The intake API route is intentionally thin — it does auth + ownership
 * checks, then delegates everything else to this module.
 */

import { intakeToolDefinitions } from "@/lib/planner/intake-tools";
import { prisma } from "@/lib/db";

const REALTIME_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions";
const DEFAULT_VOICE = "marin";
const DEFAULT_MODEL =
  process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime";

/** What OpenAI returns from `POST /v1/realtime/sessions`. */
export interface RealtimeSession {
  id: string;
  model: string;
  voice?: string;
  expires_at?: number;
  client_secret: { value: string; expires_at: number };
}

export interface RealtimeSessionPayload {
  session: RealtimeSession;
  /** WebRTC handshake URL the browser POSTs its SDP offer to. */
  handshakeUrl: string;
  /** Echoed for the client UI. */
  voice: string;
}

export interface IntakePlanContext {
  name: string;
  summary: string | null;
  coreMechanism: string | null;
  kickoffDate: Date | null;
  targetDate: Date | null;
  responseCadenceHours: number | null;
  announcementSendOnBehalf: boolean;
  announcement: string | null;
  stakeholderGroups: Array<{
    name: string;
    description: string | null;
    behaviorSpec: string | null;
    memberCount: number;
  }>;
  trainingDocuments: Array<{
    filename: string;
    processingStatus: string;
    indexStatus: string;
    extractedText: string | null;
    bytes: number;
  }>;
}

/** Per-doc excerpt cap: keeps the system prompt under ~12k characters even
 *  when the leader uploads several long SOPs. */
const DOC_EXCERPT_CHARS = 3000;
/** Hard ceiling on number of docs we inline. Beyond this, the agent should
 *  call `search_docs` instead of getting more excerpts in the prompt. */
const MAX_INLINE_DOCS = 4;

export function buildIntakeInstructions(plan: IntakePlanContext): string {
  const today = new Date().toISOString().slice(0, 10);

  const groupsBlock =
    plan.stakeholderGroups.length === 0
      ? "(no stakeholder groups yet)"
      : plan.stakeholderGroups
          .map(
            (group) =>
              `- ${group.name} — ${group.memberCount} members — behavior: ${
                group.behaviorSpec?.trim() || "(missing)"
              }`,
          )
          .join("\n");

  const docsBlock =
    plan.trainingDocuments.length === 0
      ? "(no documents uploaded; ask the leader to describe everything from scratch)"
      : plan.trainingDocuments
          .slice(0, MAX_INLINE_DOCS)
          .map((doc) => {
            const status = `${doc.processingStatus}/${doc.indexStatus}`;
            const text = (doc.extractedText ?? "").trim();
            const excerpt = text
              ? text.slice(0, DOC_EXCERPT_CHARS) +
                (text.length > DOC_EXCERPT_CHARS ? "\n…" : "")
              : "(not parsed yet)";
            return `### ${doc.filename} (${status})\n${excerpt}`;
          })
          .join("\n\n");

  const overflowDocs =
    plan.trainingDocuments.length > MAX_INLINE_DOCS
      ? `\n(${plan.trainingDocuments.length - MAX_INLINE_DOCS} more docs available — use search_docs for excerpts)`
      : "";

  const missing = remainingGaps(plan);
  const remainingBlock =
    missing.length === 0
      ? "Everything required is on the plan; confirm it with the leader and call done() when they say it's good."
      : `Remaining gaps to land on:\n${missing.map((m) => `  - ${m}`).join("\n")}`;

  return [
    "You are Grasp, an AI assistant helping a company leader plan a behavior-change rollout. You are having a short, focused voice conversation to fill in the rollout details and persist them as you go.",
    "",
    "# Voice channel rules",
    "- Spoken English only. No markdown, no headers, no bullets, no code blocks, no links, no emoji. Read everything as natural speech.",
    "- One question per turn. After you ask, stop and listen.",
    "- Keep your turns short — two or three sentences max.",
    "- If a pause runs longer than five seconds after a question, gently re-ask in different words once, then move on.",
    "- If the leader is silent at the start, give them a one-sentence greeting first, then your first question.",
    "",
    "# Your job",
    "You need to confirm or capture five things and save each one with a function tool as soon as you and the leader agree on it:",
    "  1. Brief — short name, plain-language summary, and the key outcome to protect. Use set_brief.",
    "  2. Stakeholder groups — for each group: a name, a one-sentence description, an observable behavior, and the actual people. Use upsert_group, after search_employees.",
    "  3. Timing — kickoff date and target completion date. Use set_timing with ISO YYYY-MM-DD.",
    "  4. Support — follow-up cadence in hours and whether Grasp sends the announcement on the leader's behalf. Use set_support.",
    "  5. Announcement — the actual first message stakeholders will see. Use set_announcement.",
    "",
    "Save as you go. Do not batch saves at the end.",
    "",
    "# How to use the tools",
    "- Call read_plan_state at the start of the conversation and any time you need to re-ground in current state.",
    "- Always call search_employees BEFORE upsert_group with member emails. Never invent people. If you can't find someone the leader names, say so and ask the leader to clarify.",
    "- Call search_docs whenever the leader implies the answer is already in the docs and you want to verify a detail.",
    "- Call done() once every required field is set AND the leader has confirmed they're ready to move to review. Tell them in plain language right before that you're handing them off to the review screen.",
    "",
    "# Style",
    "- Use what's already in the docs to inform your questions; don't ask things the docs already answer.",
    "- If the docs cover most of the plan, your job is to confirm and fill the small gaps, not interview from scratch.",
    "- If the docs are sparse, ask broader questions: who needs to do something differently, what specifically should they do, when, where, with whom.",
    "- Behavior must be observable — push back if a leader gives you a vague aspiration.",
    "",
    "# Current plan snapshot",
    `Today: ${today}`,
    `Name: ${plan.name?.trim() || "(empty)"}`,
    `Summary: ${plan.summary?.trim() || "(empty)"}`,
    `Key outcome: ${plan.coreMechanism?.trim() || "(empty)"}`,
    `Kickoff: ${plan.kickoffDate ? plan.kickoffDate.toISOString().slice(0, 10) : "(empty)"}`,
    `Target: ${plan.targetDate ? plan.targetDate.toISOString().slice(0, 10) : "(empty)"}`,
    `Cadence (hours between follow-ups): ${plan.responseCadenceHours ?? "(empty)"}`,
    `Sender: ${plan.announcementSendOnBehalf ? "Grasp on leader's behalf" : "Leader sends"}`,
    `Announcement: ${plan.announcement?.trim() ? "(drafted)" : "(empty)"}`,
    "",
    "Stakeholder groups so far:",
    groupsBlock,
    "",
    remainingBlock,
    "",
    "# Uploaded context",
    docsBlock + overflowDocs,
  ].join("\n");
}

function remainingGaps(plan: IntakePlanContext): string[] {
  const gaps: string[] = [];
  if (!plan.name?.trim()) gaps.push("a short rollout name");
  if (!plan.summary?.trim()) gaps.push("a plain-language summary");
  if (!plan.coreMechanism?.trim()) gaps.push("the key outcome to protect");
  if (plan.stakeholderGroups.length === 0) {
    gaps.push("at least one stakeholder group with members and an observable behavior");
  } else {
    const noBehavior = plan.stakeholderGroups.filter(
      (group) => !group.behaviorSpec?.trim(),
    );
    if (noBehavior.length > 0) {
      gaps.push(
        `observable behaviors for: ${noBehavior.map((g) => g.name).join(", ")}`,
      );
    }
    const noMembers = plan.stakeholderGroups.filter(
      (group) => group.memberCount === 0,
    );
    if (noMembers.length > 0) {
      gaps.push(
        `members for: ${noMembers.map((g) => g.name).join(", ")}`,
      );
    }
  }
  if (!plan.kickoffDate || !plan.targetDate) {
    gaps.push("kickoff and target dates");
  }
  if (!plan.responseCadenceHours) gaps.push("follow-up cadence (hours)");
  if (!plan.announcement?.trim()) gaps.push("the announcement message");
  return gaps;
}

export async function loadIntakePlanContext(
  planId: string,
): Promise<IntakePlanContext | null> {
  const plan = await prisma.changePlan.findUnique({
    where: { id: planId },
    select: {
      name: true,
      summary: true,
      coreMechanism: true,
      kickoffDate: true,
      targetDate: true,
      responseCadenceHours: true,
      announcementSendOnBehalf: true,
      announcement: true,
      stakeholderGroups: {
        orderBy: { createdAt: "asc" },
        select: {
          name: true,
          description: true,
          behaviorSpec: true,
          _count: { select: { members: true } },
        },
      },
      trainingDocuments: {
        orderBy: { createdAt: "asc" },
        select: {
          filename: true,
          processingStatus: true,
          indexStatus: true,
          extractedText: true,
          bytes: true,
        },
      },
    },
  });
  if (!plan) return null;
  return {
    name: plan.name,
    summary: plan.summary,
    coreMechanism: plan.coreMechanism,
    kickoffDate: plan.kickoffDate,
    targetDate: plan.targetDate,
    responseCadenceHours: plan.responseCadenceHours,
    announcementSendOnBehalf: plan.announcementSendOnBehalf,
    announcement: plan.announcement,
    stakeholderGroups: plan.stakeholderGroups.map((group) => ({
      name: group.name,
      description: group.description,
      behaviorSpec: group.behaviorSpec,
      memberCount: group._count.members,
    })),
    trainingDocuments: plan.trainingDocuments,
  };
}

/**
 * Mint an OpenAI Realtime session pre-configured with our intake instructions
 * and tool registry. Returns the ephemeral key the browser uses to open a
 * WebRTC connection.
 *
 * Throws on misconfiguration or upstream failure. The route turns those into
 * 503/502 responses.
 */
export async function createIntakeRealtimeSession(
  planId: string,
): Promise<RealtimeSessionPayload> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured — voice intake is unavailable on this environment.",
    );
  }

  const planContext = await loadIntakePlanContext(planId);
  if (!planContext) throw new Error("Plan not found");

  const instructions = buildIntakeInstructions(planContext);
  const tools = intakeToolDefinitions();

  const body = {
    model: DEFAULT_MODEL,
    voice: DEFAULT_VOICE,
    modalities: ["audio", "text"],
    instructions,
    tools,
    tool_choice: "auto",
    input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
    turn_detection: {
      type: "server_vad",
      threshold: 0.55,
      prefix_padding_ms: 300,
      silence_duration_ms: 600,
    },
    temperature: 0.8,
  };

  const response = await fetch(REALTIME_SESSIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
