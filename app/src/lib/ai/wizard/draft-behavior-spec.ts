/**
 * Step 3 (Behaviors) AI assist — Atkins et al. behavior specification per
 * stakeholder group.
 *
 * The spec is explicit: "The wizard refuses vague outcomes like 'drive CRM
 * adoption.' It forces who-does-what-when-where-how-often-with-whom."
 *
 * This function drafts that specification for one group at a time. The
 * leader edits the result before saving.
 */
import { z } from "zod";
import { callStructured } from "../structured";

export const BehaviorSpecSchema = z.object({
  who: z.string().min(2).max(120),
  what: z.string().min(4).max(280),
  when: z.string().min(2).max(160),
  where: z.string().min(2).max(160),
  howOften: z.string().min(2).max(120),
  withWhom: z.string().min(2).max(160),
  /**
   * The single rendered paragraph the leader sees + edits + persists to
   * StakeholderGroup.behaviorSpec. We compose it server-side from the
   * structured fields above so the model can't accidentally drift formats.
   */
  rendered: z.string().min(20).max(1000),
});

export type BehaviorSpec = z.infer<typeof BehaviorSpecSchema>;

export const BEHAVIOR_SYSTEM_PROMPT = `You are drafting an Atkins-format behavior specification for one stakeholder group in a process change.

Required structure (Atkins et al.): who, what, when, where, how often, with whom.

Rules:
- Be concrete, not aspirational. "Sales reps log every customer interaction in the new CRM within 24 hours of the conversation" — not "sales reps adopt the new CRM."
- Use observable behavior the agent can later check on via non-leading questions.
- Match the grain of the change. A daily behavior gets a daily spec; a quarterly one gets a quarterly spec.
- Keep the rendered text to 2–3 sentences.`;

export async function draftBehaviorSpec(input: {
  changeSummary: string;
  groupName: string;
  groupDescription: string;
}): Promise<BehaviorSpec> {
  const user = `CHANGE SUMMARY:
${input.changeSummary.trim()}

STAKEHOLDER GROUP:
Name: ${input.groupName}
Role in change: ${input.groupDescription || "(not yet specified)"}`;

  return callStructured(BehaviorSpecSchema, {
    system: BEHAVIOR_SYSTEM_PROMPT,
    user,
    toolName: "draft_behavior_spec",
    toolDescription:
      "Draft an Atkins behavior specification (who/what/when/where/how often/with whom) for one stakeholder group.",
    temperature: 0.3,
  });
}
