/**
 * Step 8 (Announcement) AI assist — streaming long-form draft.
 *
 * Per spec: "AI-assisted generation, but the leader owns the content."
 * The wizard server action wraps this in a ReadableStream the client reads
 * token-by-token; the leader can copy/edit the result and run scoring
 * (./scoring) against it.
 */
import { DEFAULT_MODEL, getAnthropic } from "../anthropic";

export const ANNOUNCEMENT_SYSTEM_PROMPT = `You are drafting an internal announcement for a leadership team rolling out a process change. The leader owns the final wording — your job is a strong first draft they will edit.

Required ingredients (the announcement will be scored against these rubrics — write to satisfy them):
- Deci & Ryan three-factor internalization: clear rationale, honest acknowledgment of the downside, and a choice/agency frame.
- Bridges 4 P's: Purpose (why), Picture (what it looks like when working), Plan (timeline + immediate next step), Part to Play (what each stakeholder group does).
- Loss-aversion reframing: gains made concrete, losses acknowledged honestly rather than hand-waved.

Style:
- 200–350 words. Plain language. No jargon, no marketing voice.
- Address employees directly ("you", "we"). One paragraph for context, one for what it looks like, one for next steps.
- Do NOT promise capabilities the agent does not have ("Grasp will remind you", "Grasp will track your progress automatically"). Stick to what leadership is committing to and what employees can expect.
- Do NOT include a subject line, signature, or salutation — just the body.`;

export interface AnnouncementContext {
  changeName: string;
  changeSummary: string;
  coreMechanism: string | null;
  responseCadenceHours: number | null;
  kickoffDate: Date | null;
  targetDate: Date | null;
  stakeholderGroups: Array<{
    name: string;
    description: string | null;
    behaviorSpec: string | null;
  }>;
}

function buildUserPrompt(ctx: AnnouncementContext): string {
  const groups = ctx.stakeholderGroups
    .map(
      (g) =>
        `- ${g.name}: ${g.description ?? "(no description)"}\n  Behavior: ${g.behaviorSpec ?? "(not yet specified)"}`,
    )
    .join("\n");

  return `CHANGE NAME: ${ctx.changeName}

PLAIN-LANGUAGE SUMMARY:
${ctx.changeSummary.trim()}

CORE MECHANISM (what cannot be lost):
${ctx.coreMechanism?.trim() || "(not yet specified)"}

TIMELINE:
Kickoff: ${ctx.kickoffDate?.toISOString().slice(0, 10) ?? "(unspecified)"}
Target adoption: ${ctx.targetDate?.toISOString().slice(0, 10) ?? "(unspecified)"}

LEADERSHIP RESPONSE CADENCE COMMITMENT:
${ctx.responseCadenceHours ? `${ctx.responseCadenceHours} hours from when a concern is surfaced` : "(unspecified)"}

STAKEHOLDER GROUPS AND BEHAVIORS:
${groups || "(none specified yet)"}

Write the announcement body now.`;
}

/**
 * Returns an async iterable of text chunks from Claude's streaming output.
 * Caller wraps this in a ReadableStream for transport to the browser.
 */
export async function* streamAnnouncementDraft(
  ctx: AnnouncementContext,
): AsyncGenerator<string, void, unknown> {
  const client = getAnthropic();
  const stream = client.messages.stream({
    model: DEFAULT_MODEL,
    max_tokens: 1500,
    temperature: 0.5,
    system: ANNOUNCEMENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(ctx) }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
