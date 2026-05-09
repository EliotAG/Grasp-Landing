/**
 * Step 5 (Core mechanism) AI assist.
 *
 * CFIR's core-vs-adaptable-periphery distinction applied to a single
 * rollout: what about this change cannot be lost in telephone? Used by the
 * agent later to preserve the load-bearing intent across local team
 * adaptations.
 */
import { z } from "zod";
import { callStructured } from "../structured";

export const CoreMechanismSchema = z.object({
  mechanism: z
    .string()
    .min(20)
    .max(800)
    .describe(
      "2–4 sentences naming the load-bearing intent of this change in plain language a frontline employee would understand.",
    ),
  whyItMatters: z
    .string()
    .min(20)
    .max(400)
    .describe(
      "1–2 sentences on what specifically degrades if this gets lost in telephone.",
    ),
});

export type CoreMechanism = z.infer<typeof CoreMechanismSchema>;

export const CORE_MECHANISM_SYSTEM_PROMPT = `You are helping leadership name the load-bearing core of a process change, per CFIR's core-vs-adaptable-periphery distinction.

The "core mechanism" is what cannot be lost as different teams locally adapt the rollout. Everything else is adaptable periphery.

Rules:
- Frame in terms of intent and outcome, not procedure. "Customer-facing context lives in one place where any teammate can find it" — not "everyone uses Salesforce."
- 2–4 sentences for the mechanism, plain language, no jargon.
- "whyItMatters" names what specifically breaks if this is lost — be concrete (a real downstream consequence, not a generic value statement).`;

export async function proposeCoreMechanism(input: {
  changeSummary: string;
  stakeholderGroups: Array<{ name: string; description: string | null; behaviorSpec: string | null }>;
}): Promise<CoreMechanism> {
  const groups = input.stakeholderGroups
    .map(
      (g) =>
        `- ${g.name}: ${g.description ?? "(no description)"} | Behavior: ${g.behaviorSpec ?? "(not yet specified)"}`,
    )
    .join("\n");

  const user = `CHANGE SUMMARY:
${input.changeSummary.trim()}

STAKEHOLDER GROUPS AND BEHAVIORS:
${groups || "(not yet specified)"}`;

  return callStructured(CoreMechanismSchema, {
    system: CORE_MECHANISM_SYSTEM_PROMPT,
    user,
    toolName: "propose_core_mechanism",
    toolDescription:
      "Name the load-bearing intent of this change (CFIR core) and what degrades if it is lost.",
    temperature: 0.3,
    maxTokens: 800,
  });
}
