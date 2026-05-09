/**
 * Step 2 (Stakeholders) AI assist.
 *
 * Per spec: "The wizard does not collect a flat list of affected employees.
 * It forces leadership to identify distinct stakeholder groups, label them,
 * and specify how each is affected and why."
 *
 * Given the plain-language change summary + a flattened org chart, propose
 * 2–6 stakeholder groups with rationale. Leader edits the result; nothing
 * is persisted by this function.
 */
import { z } from "zod";
import { callStructured } from "../structured";

export const StakeholderProposalSchema = z.object({
  groups: z
    .array(
      z.object({
        name: z
          .string()
          .min(2)
          .max(80)
          .describe(
            "Short noun phrase, e.g. 'Sales reps', 'Sales managers', 'Operations'.",
          ),
        description: z
          .string()
          .min(8)
          .max(400)
          .describe(
            "1–2 sentences on why this group is affected and what role they play in the change.",
          ),
        suggestedEmployeeIds: z
          .array(z.string().uuid())
          .max(40)
          .describe(
            "Employee UUIDs from the provided org chart that belong in this group. May be empty if uncertain.",
          ),
        rationale: z
          .string()
          .min(8)
          .max(280)
          .describe(
            "One-sentence explanation for the leader: why this group matters in this rollout, distinct from the others.",
          ),
      }),
    )
    .min(1)
    .max(6),
});

export type StakeholderProposal = z.infer<typeof StakeholderProposalSchema>;

export interface OrgChartRow {
  id: string;
  name: string;
  email: string;
  title: string | null;
  team: string | null;
  managerName: string | null;
}

export const STAKEHOLDER_SYSTEM_PROMPT = `You are assisting a leadership team using Grasp to plan a process change.

Your task: from a plain-language change summary plus the company's org chart, propose distinct stakeholder groups affected by this change. Per the research base (Atkins et al.; CFIR), a rollout almost always has multiple related but distinct behaviors — collapse those into "affected employees" and you degrade everything downstream.

Rules:
- Propose 2–6 groups. Fewer is better than padded.
- Each group must be doing something distinct in this change. If two groups have the same behavior, they are one group.
- Use exact org-chart employee UUIDs in suggestedEmployeeIds. Do not invent IDs.
- Group names are short, neutral, and recognisable to the leader (e.g. "Sales managers", not "Sales leadership coaching layer").
- It is OK to leave suggestedEmployeeIds empty for a group if the org chart doesn't make membership obvious — the leader will pick.
- Do NOT include groups for "leadership" unless leadership themselves are the ones doing a new behavior.`;

export async function proposeStakeholderGroups(input: {
  summary: string;
  orgChart: OrgChartRow[];
}): Promise<StakeholderProposal> {
  const orgChartText = input.orgChart
    .map(
      (r) =>
        `- ${r.id}  ${r.name}  <${r.email}>  team=${r.team ?? "-"}  title=${r.title ?? "-"}  manager=${r.managerName ?? "-"}`,
    )
    .join("\n");

  const user = `CHANGE SUMMARY:
${input.summary.trim()}

ORG CHART (id  name  email  team  title  manager):
${orgChartText || "(empty — leader has not uploaded an org chart yet)"}`;

  return callStructured(StakeholderProposalSchema, {
    system: STAKEHOLDER_SYSTEM_PROMPT,
    user,
    toolName: "propose_stakeholder_groups",
    toolDescription:
      "Return 2–6 distinct stakeholder groups affected by this change, each with members from the org chart and a one-line rationale.",
    temperature: 0.3,
    maxTokens: 2048,
  });
}
