/**
 * Three empirical scoring rubrics for the announcement draft, run in
 * parallel. Per spec §"Step 1 / Announcement drafting":
 *
 *   - Deci & Ryan three-factor internalization: rationale, acknowledgment of
 *     downside, choice framing.
 *   - Bridges 4 P's: Purpose, Picture, Plan, Part to Play.
 *   - Loss-aversion reframing: gains made concrete, losses acknowledged.
 *
 * Each rubric returns its own findings + a one-shot suggested revision so
 * the leader can iterate. The wizard surfaces gaps inline.
 */
import { z } from "zod";
import { callStructured } from "../structured";

// Suggestions are paste-ready paragraphs of revision text — Claude
// routinely produces 3–6 sentences here, so we leave generous headroom
// (the prompts ask for ~2000 chars). The cap exists to protect the UI
// from a runaway response, not to police prose length.
const SUGGESTION_MAX = 2400;

const Gap = z.object({
  field: z.string().min(1).max(80),
  finding: z.string().min(4).max(400),
});

export const DeciRyanScoreSchema = z.object({
  rationale: z.enum(["present", "weak", "absent"]),
  downside: z.enum(["present", "weak", "absent"]),
  choice: z.enum(["present", "weak", "absent"]),
  gaps: z.array(Gap).max(6),
  suggestion: z.string().max(SUGGESTION_MAX),
});

export const BridgesScoreSchema = z.object({
  purpose: z.enum(["present", "weak", "absent"]),
  picture: z.enum(["present", "weak", "absent"]),
  plan: z.enum(["present", "weak", "absent"]),
  partToPlay: z.enum(["present", "weak", "absent"]),
  gaps: z.array(Gap).max(6),
  suggestion: z.string().max(SUGGESTION_MAX),
});

export const LossAversionScoreSchema = z.object({
  gainsConcrete: z.enum(["present", "weak", "absent"]),
  lossesAcknowledged: z.enum(["present", "weak", "absent"]),
  gaps: z.array(Gap).max(6),
  suggestion: z.string().max(SUGGESTION_MAX),
});

export const AnnouncementScoresSchema = z.object({
  deciRyan: DeciRyanScoreSchema,
  bridges: BridgesScoreSchema,
  lossAversion: LossAversionScoreSchema,
});

export type AnnouncementScores = z.infer<typeof AnnouncementScoresSchema>;
export type DeciRyanScore = z.infer<typeof DeciRyanScoreSchema>;
export type BridgesScore = z.infer<typeof BridgesScoreSchema>;
export type LossAversionScore = z.infer<typeof LossAversionScoreSchema>;

const DECI_RYAN_SYSTEM = `You score a leadership announcement against Deci & Ryan's three-factor internalization framework.

For each factor, mark "present", "weak", or "absent":
- rationale: Does the message explain WHY this change is happening, in terms an employee would find honest and complete?
- downside: Does it acknowledge what is being given up, what will be hard, or what trade-offs leadership is making?
- choice: Does it frame the employee as having agency (channels for feedback, ability to raise concerns, room to adapt locally) rather than as the object of a decision?

Return up to 6 specific gaps (each tied to a "field" — use rationale/downside/choice) and one consolidated suggested revision (concrete sentences the leader could paste in). Keep \`suggestion\` under ~2000 characters.`;

const BRIDGES_SYSTEM = `You score a leadership announcement against William Bridges' 4 P's framework for change communication.

For each P, mark "present", "weak", or "absent":
- purpose: Why this change exists.
- picture: What it will look and feel like when working — concretely, not abstractly.
- plan: The timeline and the immediate next step.
- partToPlay: What each stakeholder group is being asked to do.

Return up to 6 specific gaps and one consolidated suggested revision. Keep \`suggestion\` under ~2000 characters.`;

const LOSS_AVERSION_SYSTEM = `You score a leadership announcement against the loss-aversion reframing principle: humans weight losses ~2x gains, so vague gains and unspoken losses degrade trust and adoption.

For each factor, mark "present", "weak", or "absent":
- gainsConcrete: Are the gains stated in concrete, observable terms (not "improved efficiency", but "you'll stop re-keying the same notes into two systems")?
- lossesAcknowledged: Are the things employees are losing — old workflows, autonomy, comfort, status, time — named honestly rather than glossed?

Return up to 6 specific gaps and one consolidated suggested revision. Keep \`suggestion\` under ~2000 characters.`;

interface ScoreInput {
  announcement: string;
  changeSummary: string;
}

function userPrompt({ announcement, changeSummary }: ScoreInput): string {
  return `CHANGE SUMMARY (for context):
${changeSummary.trim()}

ANNOUNCEMENT DRAFT TO SCORE:
"""
${announcement.trim()}
"""`;
}

export async function scoreAnnouncement(
  input: ScoreInput,
): Promise<AnnouncementScores> {
  const [deciRyan, bridges, lossAversion] = await Promise.all([
    callStructured(DeciRyanScoreSchema, {
      system: DECI_RYAN_SYSTEM,
      user: userPrompt(input),
      toolName: "score_deci_ryan",
      toolDescription:
        "Score the announcement against Deci & Ryan three-factor internalization.",
      temperature: 0.2,
    }),
    callStructured(BridgesScoreSchema, {
      system: BRIDGES_SYSTEM,
      user: userPrompt(input),
      toolName: "score_bridges",
      toolDescription:
        "Score the announcement against Bridges 4 P's.",
      temperature: 0.2,
    }),
    callStructured(LossAversionScoreSchema, {
      system: LOSS_AVERSION_SYSTEM,
      user: userPrompt(input),
      toolName: "score_loss_aversion",
      toolDescription:
        "Score the announcement against loss-aversion reframing.",
      temperature: 0.2,
    }),
  ]);
  return { deciRyan, bridges, lossAversion };
}
