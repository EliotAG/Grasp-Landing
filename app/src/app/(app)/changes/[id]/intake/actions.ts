"use server";

import { revalidatePath } from "next/cache";

import { isAiEnabled } from "@/lib/ai/anthropic";
import { draftBehaviorSpec } from "@/lib/ai/wizard/draft-behavior-spec";
import { proposeCoreMechanism } from "@/lib/ai/wizard/draft-core-mechanism";
import { streamAnnouncementDraft } from "@/lib/ai/wizard/draft-announcement";
import { proposeStakeholderGroups } from "@/lib/ai/wizard/extract-stakeholder-groups";
import { prisma } from "@/lib/db";
import { loadOwnedPlan } from "@/lib/changes/load";
import { runPlannerTurn, type PlannerTurn } from "@/lib/planner/agent";
import {
  deletePlannerContextDoc,
  markPlannerComplete,
  savePastedPlannerContext,
  savePlannerAnnouncement,
  savePlannerCoreMechanism,
  savePlannerFrame,
  savePlannerSupport,
  savePlannerTimeline,
  uploadPlannerContextDoc,
  upsertPlannerStakeholderGroup,
  type SaveResult,
} from "@/lib/planner/services";
import { summarizePlannerContext as summarizeContextWithAi } from "@/lib/planner/context-summary";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function pastePlannerContextAction(
  changePlanId: string,
  input: { title?: string; text: string },
) {
  return savePastedPlannerContext(changePlanId, input);
}

export async function uploadPlannerContextAction(
  changePlanId: string,
  formData: FormData,
) {
  return uploadPlannerContextDoc(changePlanId, formData);
}

export async function deletePlannerContextAction(
  changePlanId: string,
  documentId: string,
) {
  return deletePlannerContextDoc(changePlanId, documentId);
}

export async function summarizePlannerContextAction(
  changePlanId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof summarizeContextWithAi>>>> {
  if (!isAiEnabled()) return { ok: false, error: "AI is not configured" };
  await loadOwnedPlan(changePlanId);
  const plan = await prisma.changePlan.findUnique({
    where: { id: changePlanId },
    select: {
      name: true,
      summary: true,
      trainingDocuments: {
        orderBy: { createdAt: "asc" },
        select: { filename: true, extractedText: true },
      },
    },
  });
  if (!plan) return { ok: false, error: "Change plan not found" };
  if (plan.trainingDocuments.length === 0) {
    return { ok: false, error: "Upload or paste context first." };
  }
  try {
    const summary = await summarizeContextWithAi({
      planName: plan.name,
      planSummary: plan.summary,
      docs: plan.trainingDocuments,
    });
    return { ok: true, data: summary };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function applyContextSummaryAction(
  changePlanId: string,
  input: {
    name?: string;
    summary?: string;
    coreMechanism?: string;
  },
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  if (input.name || input.summary) {
    const existing = await prisma.changePlan.findUnique({
      where: { id: changePlanId },
      select: { name: true, summary: true },
    });
    const frame = await savePlannerFrame(changePlanId, {
      name: input.name || existing?.name || "Untitled draft",
      summary: input.summary ?? existing?.summary ?? undefined,
    });
    if (!frame.ok) return frame;
  }
  if (input.coreMechanism) {
    const core = await savePlannerCoreMechanism(changePlanId, {
      coreMechanism: input.coreMechanism,
    });
    if (!core.ok) return core;
  }
  revalidatePath(`/changes/${changePlanId}/intake`);
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function sendPlannerMessageAction(
  changePlanId: string,
  userMessage: string,
): Promise<ActionResult<PlannerTurn>> {
  if (!isAiEnabled()) {
    return {
      ok: true,
      data: {
        reply:
          "I can collect the plan structure, but AI is not configured on this instance yet. Add the missing fields in the plan panel or set ANTHROPIC_API_KEY to enable suggestions.",
        status: "AI disabled",
        missingQuestions: ["What is changing, and who needs to do something differently?"],
      },
    };
  }
  const { plan } = await loadOwnedPlan(changePlanId);
  const [groups, docs, employees] = await Promise.all([
    prisma.stakeholderGroup.findMany({
      where: { changePlanId },
      orderBy: { createdAt: "asc" },
      include: {
        members: { include: { employee: { select: { email: true } } } },
      },
    }),
    prisma.trainingDocument.findMany({
      where: { changePlanId },
      orderBy: { createdAt: "asc" },
      select: {
        filename: true,
        processingStatus: true,
        indexStatus: true,
        extractedText: true,
      },
    }),
    prisma.employee.findMany({
      where: { organizationId: plan.organizationId },
      orderBy: [{ team: "asc" }, { name: "asc" }],
      select: { name: true, email: true, team: true, title: true },
      take: 250,
    }),
  ]);

  try {
    const turn = await runPlannerTurn({
      userMessage,
      plan: {
        name: plan.name,
        summary: plan.summary,
        coreMechanism: plan.coreMechanism,
        responseCadenceHours: plan.responseCadenceHours,
        announcement: plan.announcement,
        stakeholderGroups: groups.map((group) => ({
          name: group.name,
          description: group.description,
          behaviorSpec: group.behaviorSpec,
          memberEmails: group.members.map((member) => member.employee.email),
        })),
        trainingDocs: docs,
      },
      employees,
    });
    return { ok: true, data: turn };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function generatePlannerSuggestionsAction(
  changePlanId: string,
): Promise<
  ActionResult<{
    groups: NonNullable<PlannerTurn["suggestedUpdates"]>["stakeholderGroups"];
    coreMechanism?: string;
    announcement?: string;
  }>
> {
  if (!isAiEnabled()) return { ok: false, error: "AI is not configured" };
  const { plan } = await loadOwnedPlan(changePlanId);
  if (!plan.summary?.trim()) {
    return { ok: false, error: "Add or apply a summary first." };
  }

  const employees = await prisma.employee.findMany({
    where: { organizationId: plan.organizationId },
    include: { manager: { select: { name: true } } },
    orderBy: [{ team: "asc" }, { name: "asc" }],
    take: 200,
  });
  const existingGroups = await prisma.stakeholderGroup.findMany({
    where: { changePlanId },
    orderBy: { createdAt: "asc" },
  });

  try {
    const groupPromise = proposeStakeholderGroups({
      summary: plan.summary,
      orgChart: employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        email: employee.email,
        title: employee.title,
        team: employee.team,
        managerName: employee.manager?.name ?? null,
      })),
    });
    const corePromise = proposeCoreMechanism({
      changeSummary: plan.summary,
      stakeholderGroups: existingGroups.map((group) => ({
        name: group.name,
        description: group.description,
        behaviorSpec: group.behaviorSpec,
      })),
    });

    const [groupProposal, core] = await Promise.all([groupPromise, corePromise]);
    const groups = await Promise.all(
      groupProposal.groups.map(async (group) => {
        let behaviorSpec: string | undefined;
        try {
          const behavior = await draftBehaviorSpec({
            changeSummary: plan.summary!,
            groupName: group.name,
            groupDescription: group.description,
          });
          behaviorSpec = behavior.rendered;
        } catch {
          behaviorSpec = undefined;
        }
        return {
          name: group.name,
          description: group.description,
          behaviorSpec,
          suggestedEmployeeEmails: group.suggestedEmployeeIds
            .map((id) => employees.find((employee) => employee.id === id)?.email)
            .filter((email): email is string => Boolean(email)),
        };
      }),
    );

    let announcement = "";
    try {
      const chunks: string[] = [];
      for await (const chunk of streamAnnouncementDraft({
        changeName: plan.name,
        changeSummary: plan.summary,
        coreMechanism: `${core.mechanism}\n\nWhy this matters: ${core.whyItMatters}`,
        responseCadenceHours: plan.responseCadenceHours,
        kickoffDate: plan.kickoffDate,
        targetDate: plan.targetDate,
        stakeholderGroups: groups.map((group) => ({
          name: group.name,
          description: group.description ?? null,
          behaviorSpec: group.behaviorSpec ?? null,
        })),
      })) {
        chunks.push(chunk);
      }
      announcement = chunks.join("");
    } catch {
      announcement = "";
    }

    return {
      ok: true,
      data: {
        groups,
        coreMechanism: `${core.mechanism}\n\nWhy this matters: ${core.whyItMatters}`,
        announcement: announcement || undefined,
      },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function applyPlannerSuggestionsAction(
  changePlanId: string,
  suggestions: NonNullable<PlannerTurn["suggestedUpdates"]>,
): Promise<SaveResult> {
  const { plan } = await loadOwnedPlan(changePlanId);
  const employeeRows = await prisma.employee.findMany({
    where: { organizationId: plan.organizationId },
    select: { id: true, email: true },
  });
  const employeesByEmail = new Map(
    employeeRows.map((employee) => [employee.email.toLowerCase(), employee.id]),
  );

  if (suggestions.name || suggestions.summary) {
    const existing = await prisma.changePlan.findUnique({
      where: { id: changePlanId },
      select: { name: true, summary: true },
    });
    const result = await savePlannerFrame(changePlanId, {
      name: suggestions.name || existing?.name || "Untitled draft",
      summary: suggestions.summary ?? existing?.summary ?? undefined,
    });
    if (!result.ok) return result;
  }
  if (suggestions.coreMechanism) {
    const result = await savePlannerCoreMechanism(changePlanId, {
      coreMechanism: suggestions.coreMechanism,
    });
    if (!result.ok) return result;
  }
  if (suggestions.responseCadenceHours) {
    const result = await savePlannerSupport(changePlanId, {
      responseCadenceHours: suggestions.responseCadenceHours,
      announcementSendOnBehalf: false,
    });
    if (!result.ok) return result;
  }
  if (suggestions.announcement) {
    const result = await savePlannerAnnouncement(changePlanId, {
      announcement: suggestions.announcement,
    });
    if (!result.ok) return result;
  }
  for (const group of suggestions.stakeholderGroups ?? []) {
    const result = await upsertPlannerStakeholderGroup(changePlanId, {
      name: group.name,
      description: group.description,
      behaviorSpec: group.behaviorSpec,
      memberEmployeeIds: group.suggestedEmployeeEmails
        .map((email) => employeesByEmail.get(email.toLowerCase()))
        .filter((id): id is string => Boolean(id)),
    });
    if (!result.ok) return result;
  }

  return { ok: true, savedAt: new Date().toISOString() };
}

export async function saveIntakeFrameAction(
  changePlanId: string,
  input: { name: string; summary: string },
) {
  return savePlannerFrame(changePlanId, input);
}

export async function saveIntakeTimelineAction(
  changePlanId: string,
  input: { kickoffDate: string; targetDate: string },
) {
  return savePlannerTimeline(changePlanId, input);
}

export async function saveIntakeCoreAction(
  changePlanId: string,
  input: { coreMechanism: string },
) {
  return savePlannerCoreMechanism(changePlanId, input);
}

export async function saveIntakeSupportAction(
  changePlanId: string,
  input: { responseCadenceHours: number | ""; announcementSendOnBehalf: boolean },
) {
  return savePlannerSupport(changePlanId, input);
}

export async function saveIntakeAnnouncementAction(
  changePlanId: string,
  input: { announcement: string },
) {
  return savePlannerAnnouncement(changePlanId, input);
}

export async function markIntakeReadyAction(changePlanId: string) {
  return markPlannerComplete(changePlanId);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}
