import { z } from "zod";

import { callStructured } from "@/lib/ai/structured";

export const PlannerContextSummarySchema = z.object({
  headline: z.string().min(4).max(140),
  summary: z.string().min(20).max(1400),
  inferred: z.object({
    name: z.string().min(2).max(140).optional(),
    changeSummary: z.string().min(20).max(2000).optional(),
    coreMechanism: z.string().min(20).max(1200).optional(),
    likelyAudience: z.array(z.string().min(2).max(120)).max(8),
    likelyRisks: z.array(z.string().min(2).max(180)).max(8),
  }),
  citations: z
    .array(
      z.object({
        filename: z.string().min(1).max(240),
        note: z.string().min(4).max(240),
      }),
    )
    .max(8),
  nextQuestions: z.array(z.string().min(4).max(180)).min(1).max(5),
});

export type PlannerContextSummary = z.infer<typeof PlannerContextSummarySchema>;

export interface ContextDocInput {
  filename: string;
  extractedText: string | null;
}

const CONTEXT_SUMMARY_SYSTEM = `You are helping a leader create a change-management rollout plan in Grasp.

The leader may have uploaded rollout notes, SOPs, FAQs, policy docs, or meeting notes. Summarize the useful context quickly and infer a first draft of the rollout plan only where the documents support it.

Rules:
- Cite source filenames for important inferences.
- Do not invent facts that are not in the docs.
- Prefer concrete behavior changes over vague outcomes.
- Return questions that unblock the plan. One question per item.
- If docs conflict, call that out in summary and nextQuestions.`;

export async function summarizePlannerContext(input: {
  planName: string;
  planSummary: string | null;
  docs: ContextDocInput[];
}): Promise<PlannerContextSummary> {
  const docText = input.docs
    .map((doc) => {
      const text = (doc.extractedText ?? "").trim();
      return `# ${doc.filename}\n${text.slice(0, 12_000) || "(No extracted text available yet.)"}`;
    })
    .join("\n\n---\n\n");

  const user = `CURRENT DRAFT:
Name: ${input.planName}
Summary: ${input.planSummary ?? "(empty)"}

UPLOADED OR PASTED CONTEXT:
${docText || "(none)"}`;

  return callStructured(PlannerContextSummarySchema, {
    system: CONTEXT_SUMMARY_SYSTEM,
    user,
    toolName: "summarize_planner_context",
    toolDescription:
      "Summarize uploaded planning context and infer a cautious first draft of a rollout plan.",
    temperature: 0.25,
    maxTokens: 2400,
  });
}
