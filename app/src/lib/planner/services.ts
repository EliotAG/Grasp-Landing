import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { Prisma, type ChangePlanWizardStep } from "@prisma/client";
import { put, del } from "@vercel/blob";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { parseTrainingDoc, isSupportedMime } from "@/lib/files/parse";
import { indexTrainingDocumentSafe } from "@/lib/agent/rag/indexer";
import { loadOwnedPlan } from "@/lib/changes/load";
import { DEFAULT_CHECK_IN_TEMPLATES } from "@/lib/rollout-schedule";

export type SaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: string };

export type GroupSaveResult =
  | { ok: true; savedAt: string; groupId: string }
  | { ok: false; error: string };

const MAX_DOC_BYTES = 25 * 1024 * 1024;

export const PlannerFrameSchema = z.object({
  name: z.string().trim().min(2, "Give this rollout a short name").max(140),
  summary: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const PlannerTimelineSchema = z.object({
  kickoffDate: z
    .string()
    .optional()
    .nullable()
    .transform((v) => toDate(v)),
  targetDate: z
    .string()
    .optional()
    .nullable()
    .transform((v) => toDate(v)),
});

export const PlannerGroupUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(140),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
  behaviorSpec: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : null)),
  memberEmployeeIds: z.array(z.string().uuid()).max(500),
});

export const PlannerCoreMechanismSchema = z.object({
  coreMechanism: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const PlannerSupportSchema = z.object({
  responseCadenceHours: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(720)])
    .nullable()
    .optional()
    .transform((v) => (typeof v === "number" ? v : null)),
  announcementSendOnBehalf: z
    .union([z.literal("on"), z.literal("off"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on"),
});

export const PlannerAnnouncementSchema = z.object({
  announcement: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export const PlannerPastedContextSchema = z.object({
  title: z.string().trim().max(140).optional(),
  text: z.string().trim().min(20, "Paste at least a few sentences of context").max(100_000),
});

async function persist(
  id: string,
  data: Prisma.ChangePlanUpdateInput,
): Promise<SaveResult> {
  const now = new Date();
  await prisma.changePlan.update({
    where: { id },
    data: { ...data, lastSavedAt: now },
  });
  revalidatePlan(id);
  return { ok: true, savedAt: now.toISOString() };
}

function fail(message: string): SaveResult {
  return { ok: false, error: message };
}

function failGroup(message: string): GroupSaveResult {
  return { ok: false, error: message };
}

function revalidatePlan(id: string) {
  revalidatePath(`/changes/${id}/intake`);
  revalidatePath(`/changes/${id}/wizard`, "layout");
  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
  revalidatePath("/dashboard");
}

export async function savePlannerFrame(
  id: string,
  input: z.input<typeof PlannerFrameSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(id);
  const parsed = PlannerFrameSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  return persist(id, { name: parsed.data.name, summary: parsed.data.summary });
}

export async function savePlannerTimeline(
  id: string,
  input: z.input<typeof PlannerTimelineSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(id);
  const parsed = PlannerTimelineSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid date");
  return persist(id, {
    kickoffDate: parsed.data.kickoffDate,
    targetDate: parsed.data.targetDate,
  });
}

export async function savePlannerCoreMechanism(
  id: string,
  input: z.input<typeof PlannerCoreMechanismSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(id);
  const parsed = PlannerCoreMechanismSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  return persist(id, { coreMechanism: parsed.data.coreMechanism });
}

export async function savePlannerSupport(
  id: string,
  input: z.input<typeof PlannerSupportSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(id);
  const parsed = PlannerSupportSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  return persist(id, {
    responseCadenceHours: parsed.data.responseCadenceHours,
    announcementSendOnBehalf: parsed.data.announcementSendOnBehalf,
  });
}

export async function savePlannerAnnouncement(
  id: string,
  input: z.input<typeof PlannerAnnouncementSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(id);
  const parsed = PlannerAnnouncementSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  return persist(id, {
    announcement: parsed.data.announcement,
    announcementScores: parsed.data.announcement ? undefined : Prisma.JsonNull,
  });
}

export async function upsertPlannerStakeholderGroup(
  changePlanId: string,
  input: z.input<typeof PlannerGroupUpsertSchema>,
): Promise<GroupSaveResult> {
  const { plan } = await loadOwnedPlan(changePlanId);
  const parsed = PlannerGroupUpsertSchema.safeParse(input);
  if (!parsed.success) return failGroup(parsed.error.errors[0]?.message ?? "Invalid input");
  const data = parsed.data;

  const groupId = await prisma.$transaction(async (tx) => {
    let id = data.id;
    if (id) {
      const existing = await tx.stakeholderGroup.findFirst({
        where: { id, changePlanId },
        select: { id: true },
      });
      if (!existing) throw new Error("Stakeholder group not found");
      await tx.stakeholderGroup.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          behaviorSpec: data.behaviorSpec,
        },
      });
    } else {
      const created = await tx.stakeholderGroup.create({
        data: {
          changePlanId,
          name: data.name,
          description: data.description,
          behaviorSpec: data.behaviorSpec,
        },
        select: { id: true },
      });
      id = created.id;
    }

    await tx.stakeholderGroupMember.deleteMany({
      where: { stakeholderGroupId: id },
    });
    if (data.memberEmployeeIds.length > 0) {
      const validEmployees = await tx.employee.findMany({
        where: {
          id: { in: data.memberEmployeeIds },
          organizationId: plan.organizationId,
        },
        select: { id: true },
      });
      await tx.stakeholderGroupMember.createMany({
        data: validEmployees.map((employee) => ({
          stakeholderGroupId: id!,
          employeeId: employee.id,
        })),
        skipDuplicates: true,
      });
    }
    return id;
  });

  await persist(changePlanId, {});
  return { ok: true, savedAt: new Date().toISOString(), groupId };
}

export async function savePastedPlannerContext(
  changePlanId: string,
  input: z.input<typeof PlannerPastedContextSchema>,
): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  await loadOwnedPlan(changePlanId);
  const parsed = PlannerPastedContextSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid context" };
  }

  const filename = parsed.data.title?.trim() || "Pasted rollout context";
  const text = parsed.data.text.trim();
  const doc = await prisma.trainingDocument.create({
    data: {
      changePlanId,
      filename,
      mimeType: "text/plain",
      bytes: Buffer.byteLength(text, "utf8"),
      blobUrl: `pasted-context:${changePlanId}/${crypto.randomUUID()}`,
      extractedText: text,
      processingStatus: "parsed",
    },
    select: { id: true },
  });

  after(async () => {
    await indexTrainingDocumentSafe(doc.id);
  });
  await persist(changePlanId, {});
  return { ok: true, documentId: doc.id };
}

export async function uploadPlannerContextDoc(
  changePlanId: string,
  formData: FormData,
): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  await loadOwnedPlan(changePlanId);
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided" };
  if (file.size === 0) return { ok: false, error: "File is empty" };
  if (file.size > MAX_DOC_BYTES) return { ok: false, error: "File exceeds 25 MB" };
  if (!isSupportedMime(file.type)) {
    return {
      ok: false,
      error: `Unsupported file type (${file.type}). Use PDF, DOCX, or Markdown.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const blobUrl = process.env.BLOB_READ_WRITE_TOKEN
    ? (
        await put(
          `training/${changePlanId}/${crypto.randomUUID()}-${file.name}`,
          buffer,
          {
            access: "public",
            contentType: file.type,
            addRandomSuffix: false,
          },
        )
      ).url
    : `local-upload:${changePlanId}/${file.name}`;

  const doc = await prisma.trainingDocument.create({
    data: {
      changePlanId,
      filename: file.name,
      mimeType: file.type,
      bytes: file.size,
      blobUrl,
      processingStatus: "pending",
    },
    select: { id: true },
  });

  let parseSucceeded = false;
  try {
    const parsed = await parseTrainingDoc(buffer, file.type);
    await prisma.trainingDocument.update({
      where: { id: doc.id },
      data: {
        processingStatus: "parsed",
        extractedText: parsed.text,
        pageCount: parsed.pageCount,
      },
    });
    parseSucceeded = true;
  } catch (err) {
    await prisma.trainingDocument.update({
      where: { id: doc.id },
      data: { processingStatus: "failed", error: errorMessage(err) },
    });
  }

  if (parseSucceeded) {
    after(async () => {
      await indexTrainingDocumentSafe(doc.id);
    });
  }

  await persist(changePlanId, {});
  return { ok: true, documentId: doc.id };
}

export async function deletePlannerContextDoc(
  changePlanId: string,
  documentId: string,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  const doc = await prisma.trainingDocument.findFirst({
    where: { id: documentId, changePlanId },
  });
  if (!doc) return fail("Document not found");
  if (process.env.BLOB_READ_WRITE_TOKEN && doc.blobUrl.startsWith("http")) {
    try {
      await del(doc.blobUrl);
    } catch {
      /* best effort */
    }
  }
  await prisma.trainingDocument.delete({ where: { id: documentId } });
  return persist(changePlanId, {});
}

export async function ensureDefaultCheckInTemplates(changePlanId: string) {
  await prisma.rolloutCheckInTemplate.createMany({
    data: DEFAULT_CHECK_IN_TEMPLATES.map((template) => ({
      changePlanId,
      kind: template.kind,
      offsetDays: template.offsetDays,
      enabled: template.enabled,
    })),
    skipDuplicates: true,
  });
}

export async function markPlannerComplete(
  changePlanId: string,
): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  const { plan } = await loadOwnedPlan(changePlanId);
  if (plan.status !== "draft") {
    return { ok: true, href: `/changes/${changePlanId}` };
  }
  const groupCount = await prisma.stakeholderGroup.count({
    where: { changePlanId },
  });
  if (!plan.name?.trim()) return { ok: false, error: "Plan needs a name." };
  if (groupCount === 0) {
    return { ok: false, error: "Plan needs at least one stakeholder group." };
  }
  await prisma.changePlan.update({
    where: { id: changePlanId },
    data: {
      status: "ready",
      currentStep: "approve" satisfies ChangePlanWizardStep,
      wizardCompletedAt: new Date(),
      lastSavedAt: new Date(),
    },
  });
  revalidatePlan(changePlanId);
  return { ok: true, href: `/changes/${changePlanId}` };
}

export interface PlannerReadinessIssue {
  key: string;
  label: string;
  required: boolean;
}

export function plannerReadiness(plan: {
  name: string | null;
  summary: string | null;
  coreMechanism: string | null;
  announcement: string | null;
  stakeholderGroups: Array<{
    name: string;
    behaviorSpec: string | null;
    members: unknown[];
  }>;
}) {
  const issues: PlannerReadinessIssue[] = [];
  if (!plan.name?.trim()) {
    issues.push({ key: "name", label: "Name the rollout.", required: true });
  }
  if (!plan.summary?.trim()) {
    issues.push({ key: "summary", label: "Add a plain-language summary.", required: false });
  }
  if (plan.stakeholderGroups.length === 0) {
    issues.push({ key: "groups", label: "Add at least one stakeholder group.", required: true });
  }
  if (plan.stakeholderGroups.some((group) => group.members.length === 0)) {
    issues.push({ key: "members", label: "Every stakeholder group needs at least one person.", required: false });
  }
  if (plan.stakeholderGroups.some((group) => !group.behaviorSpec?.trim())) {
    issues.push({ key: "behaviors", label: "Specify what each group needs to do.", required: false });
  }
  if (!plan.coreMechanism?.trim()) {
    issues.push({ key: "core", label: "Name the key outcome to protect.", required: false });
  }
  if (!plan.announcement?.trim()) {
    issues.push({ key: "announcement", label: "Draft the announcement.", required: false });
  }
  return issues;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}
