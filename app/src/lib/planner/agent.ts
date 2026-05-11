import { z } from "zod";

import { callStructured } from "@/lib/ai/structured";

export const PlannerTurnSchema = z.object({
  reply: z.string().min(20).max(1400),
  status: z.string().min(2).max(80),
  suggestedUpdates: z
    .object({
      name: z.string().min(2).max(140).optional(),
      summary: z.string().min(20).max(2000).optional(),
      coreMechanism: z.string().min(20).max(1200).optional(),
      responseCadenceHours: z.number().int().min(1).max(720).optional(),
      announcement: z.string().min(20).max(8000).optional(),
      stakeholderGroups: z
        .array(
          z.object({
            name: z.string().min(2).max(140),
            description: z.string().min(8).max(1000).optional(),
            behaviorSpec: z.string().min(20).max(2000).optional(),
            suggestedEmployeeEmails: z.array(z.string().email()).max(80),
          }),
        )
        .max(8)
        .optional(),
    })
    .optional(),
  missingQuestions: z.array(z.string().min(4).max(180)).max(5),
});

export type PlannerTurn = z.infer<typeof PlannerTurnSchema>;

export interface PlannerEmployeeContext {
  name: string;
  email: string;
  title: string | null;
  team: string | null;
}

export interface PlannerPlanContext {
  name: string;
  summary: string | null;
  coreMechanism: string | null;
  responseCadenceHours: number | null;
  announcement: string | null;
  stakeholderGroups: Array<{
    name: string;
    description: string | null;
    behaviorSpec: string | null;
    memberEmails: string[];
  }>;
  trainingDocs: Array<{
    filename: string;
    processingStatus: string;
    indexStatus: string;
    extractedText: string | null;
  }>;
}

const PLANNER_SYSTEM = `You are Grasp's leader-facing planning agent. You help a leader turn rough context into a structured change plan.

Your product job:
- Ask one useful question at a time.
- Suggest concrete fields the leader can accept or edit.
- Keep the tone plain, quick, and pragmatic.
- Prefer a small next step over a long questionnaire.

Planning rules:
- Ground suggestions in the current draft and uploaded context.
- Do not silently approve or launch anything.
- Do not invent employees. If you suggest employees for a group, use emails from the org chart only.
- Make behavior changes observable. Name who does what, when, where, how often, and with whom when possible.
- If the plan lacks enough information, ask the next best question instead of filling with generic text.`;

export async function runPlannerTurn(input: {
  userMessage: string;
  plan: PlannerPlanContext;
  employees: PlannerEmployeeContext[];
}): Promise<PlannerTurn> {
  const groups = input.plan.stakeholderGroups
    .map(
      (group) =>
        `- ${group.name}: ${group.description ?? "(no description)"} | behavior=${group.behaviorSpec ?? "(missing)"} | members=${group.memberEmails.join(", ") || "(none)"}`,
    )
    .join("\n");
  const docs = input.plan.trainingDocs
    .map((doc) => {
      const excerpt = (doc.extractedText ?? "").trim().slice(0, 3000);
      return `- ${doc.filename} (${doc.processingStatus}/${doc.indexStatus})\n  ${excerpt || "(not parsed yet)"}`;
    })
    .join("\n");
  const employees = input.employees
    .map(
      (employee) =>
        `- ${employee.name} <${employee.email}> team=${employee.team ?? "-"} title=${employee.title ?? "-"}`,
    )
    .join("\n");

  const user = `CURRENT CHANGE PLAN:
Name: ${input.plan.name}
Summary: ${input.plan.summary ?? "(empty)"}
Core mechanism: ${input.plan.coreMechanism ?? "(empty)"}
Response cadence hours: ${input.plan.responseCadenceHours ?? "(unset)"}
Announcement: ${input.plan.announcement ? "(draft exists)" : "(empty)"}

STAKEHOLDER GROUPS:
${groups || "(none)"}

UPLOADED CONTEXT:
${docs || "(none)"}

ORG CHART:
${employees || "(empty)"}

LEADER MESSAGE:
${input.userMessage}`;

  return callStructured(PlannerTurnSchema, {
    system: PLANNER_SYSTEM,
    user,
    toolName: "plan_next_turn",
    toolDescription:
      "Return the next assistant reply, optional suggested plan updates, and remaining questions.",
    temperature: 0.35,
    maxTokens: 2600,
  });
}
