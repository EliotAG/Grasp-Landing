"use server";

/**
 * Wizard server actions.
 *
 * Save actions are intentionally narrow per step: each one writes only its
 * own fields, validates with Zod, sets `lastSavedAt`, and returns
 * `{ savedAt }` for the autosave indicator. Errors are returned as
 * structured `{ ok: false, error }` so client forms can render inline.
 *
 * AI actions are tighter: they DO NOT persist, they just propose. The
 * leader accepts/edits and then the corresponding save action runs.
 *
 * Step advancement (`currentStep`) only moves forward when the leader
 * clicks Continue (via `advanceStep`); they can navigate freely between
 * already-visited steps via the rail.
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, type ChangePlanWizardStep } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadOwnedPlan } from "@/lib/changes/load";
import { isWizardStep, nextStep, WIZARD_STEPS } from "@/lib/wizard/steps";
import { isAiEnabled } from "@/lib/ai/anthropic";
import { proposeStakeholderGroups } from "@/lib/ai/wizard/extract-stakeholder-groups";
import { draftBehaviorSpec } from "@/lib/ai/wizard/draft-behavior-spec";
import { proposeCoreMechanism } from "@/lib/ai/wizard/draft-core-mechanism";
import {
  scoreAnnouncement,
  type AnnouncementScores,
} from "@/lib/ai/scoring";
import { isSupportedMime, parseTrainingDoc } from "@/lib/files/parse";
import { indexTrainingDocumentSafe } from "@/lib/agent/rag/indexer";
import { DEFAULT_CHECK_IN_TEMPLATES } from "@/lib/rollout-schedule";
import { put, del } from "@vercel/blob";

// ----- Save helpers ----------------------------------------------------------

type SaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: string };

/**
 * Stakeholder-group save result. We return the canonical id even on
 * updates so the client can confirm round-trips, and crucially so that
 * the FIRST save of a new draft tells the client its server id —
 * without it, the next save (e.g. ticking a second member) would
 * upsert a NEW group row instead of updating the just-created one.
 */
type GroupSaveResult =
  | { ok: true; savedAt: string; groupId: string }
  | { ok: false; error: string };

async function persist(
  id: string,
  data: Prisma.ChangePlanUpdateInput,
): Promise<SaveResult> {
  const now = new Date();
  await prisma.changePlan.update({
    where: { id },
    data: { ...data, lastSavedAt: now },
  });
  revalidatePath(`/changes/${id}/wizard`, "layout");
  revalidatePath("/changes");
  return { ok: true, savedAt: now.toISOString() };
}

function fail(message: string): SaveResult {
  return { ok: false, error: message };
}

// ----- Step navigation -------------------------------------------------------

export async function advanceStep(
  id: string,
  fromStep: ChangePlanWizardStep,
): Promise<void> {
  await loadOwnedPlan(id);
  const next = nextStep(fromStep);
  if (next) {
    await prisma.changePlan.update({
      where: { id },
      data: { currentStep: next },
    });
    revalidatePath(`/changes/${id}/wizard`, "layout");
    redirect(`/changes/${id}/wizard/${next}`);
  } else {
    redirect(`/changes/${id}/wizard/approve`);
  }
}

export async function jumpToStep(
  id: string,
  step: string,
): Promise<void> {
  await loadOwnedPlan(id);
  if (!isWizardStep(step)) throw new Error("Unknown wizard step");
  redirect(`/changes/${id}/wizard/${step}`);
}

// ----- Step 1: Frame ---------------------------------------------------------

const FrameSchema = z.object({
  name: z.string().trim().min(2, "Give this rollout a short name").max(140),
  summary: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function saveFrame(
  id: string,
  input: z.input<typeof FrameSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(id);
  const parsed = FrameSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  return persist(id, { name: parsed.data.name, summary: parsed.data.summary });
}

// ----- Step 2: Stakeholders --------------------------------------------------

const GroupUpsertSchema = z.object({
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

export async function saveStakeholderGroup(
  changePlanId: string,
  input: z.input<typeof GroupUpsertSchema>,
): Promise<GroupSaveResult> {
  const { plan } = await loadOwnedPlan(changePlanId);
  const parsed = GroupUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const groupId = await prisma.$transaction(async (tx) => {
    let id = data.id;
    if (id) {
      // Verify ownership before mutating.
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

    // Replace member set in one shot. Members are scoped to the parent
    // change plan's organization; we filter at insert to prevent cross-org
    // employee IDs sneaking in via a crafted form.
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
        data: validEmployees.map((e) => ({
          stakeholderGroupId: id!,
          employeeId: e.id,
        })),
        skipDuplicates: true,
      });
    }
    return id;
  });

  await persist(changePlanId, {});
  revalidatePath(`/changes/${changePlanId}/wizard/audience`);
  return { ok: true, savedAt: new Date().toISOString(), groupId };
}

export async function deleteStakeholderGroup(
  changePlanId: string,
  groupId: string,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  await prisma.stakeholderGroup.deleteMany({
    where: { id: groupId, changePlanId },
  });
  return persist(changePlanId, {});
}

export async function aiProposeStakeholderGroups(
  changePlanId: string,
): Promise<
  | {
      ok: true;
      groups: Array<{
        name: string;
        description: string;
        suggestedEmployeeIds: string[];
        rationale: string;
      }>;
    }
  | { ok: false; error: string }
> {
  if (!isAiEnabled()) return { ok: false, error: "AI is not configured" };
  const { plan } = await loadOwnedPlan(changePlanId);
  if (!plan.summary?.trim()) {
    return {
      ok: false,
      error: "Add a plain-language summary in the first step first.",
    };
  }
  const employees = await prisma.employee.findMany({
    where: { organizationId: plan.organizationId },
    include: { manager: { select: { name: true } } },
    orderBy: [{ team: "asc" }, { name: "asc" }],
    take: 200,
  });
  try {
    const result = await proposeStakeholderGroups({
      summary: plan.summary,
      orgChart: employees.map((e) => ({
        id: e.id,
        name: e.name,
        email: e.email,
        title: e.title,
        team: e.team,
        managerName: e.manager?.name ?? null,
      })),
    });
    return { ok: true, groups: result.groups };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ----- Step 3: Behaviors -----------------------------------------------------

const BehaviorSaveSchema = z.object({
  groupId: z.string().uuid(),
  behaviorSpec: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function saveBehaviorSpec(
  changePlanId: string,
  input: z.input<typeof BehaviorSaveSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  const parsed = BehaviorSaveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  await prisma.stakeholderGroup.updateMany({
    where: { id: parsed.data.groupId, changePlanId },
    data: { behaviorSpec: parsed.data.behaviorSpec },
  });
  return persist(changePlanId, {});
}

export async function aiDraftBehaviorSpec(
  changePlanId: string,
  groupId: string,
): Promise<{ ok: true; rendered: string } | { ok: false; error: string }> {
  if (!isAiEnabled()) return { ok: false, error: "AI is not configured" };
  const { plan } = await loadOwnedPlan(changePlanId);
  if (!plan.summary?.trim()) {
    return { ok: false, error: "Add a summary in the first step first." };
  }
  const group = await prisma.stakeholderGroup.findFirst({
    where: { id: groupId, changePlanId },
  });
  if (!group) return { ok: false, error: "Stakeholder group not found" };
  try {
    const spec = await draftBehaviorSpec({
      changeSummary: plan.summary,
      groupName: group.name,
      groupDescription: group.description ?? "",
    });
    return { ok: true, rendered: spec.rendered };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ----- Step 4: Timeline ------------------------------------------------------

const TimelineSchema = z.object({
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

export async function saveTimeline(
  changePlanId: string,
  input: z.input<typeof TimelineSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  const parsed = TimelineSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid date");
  return persist(changePlanId, {
    kickoffDate: parsed.data.kickoffDate,
    targetDate: parsed.data.targetDate,
  });
}

// ----- Step 5: Core mechanism ------------------------------------------------

const MechanismSchema = z.object({
  coreMechanism: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function saveCoreMechanism(
  changePlanId: string,
  input: z.input<typeof MechanismSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  const parsed = MechanismSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  return persist(changePlanId, { coreMechanism: parsed.data.coreMechanism });
}

export async function aiProposeCoreMechanism(
  changePlanId: string,
): Promise<{ ok: true; mechanism: string } | { ok: false; error: string }> {
  if (!isAiEnabled()) return { ok: false, error: "AI is not configured" };
  const { plan } = await loadOwnedPlan(changePlanId);
  if (!plan.summary?.trim()) {
    return { ok: false, error: "Add a summary in the first step first." };
  }
  const groups = await prisma.stakeholderGroup.findMany({
    where: { changePlanId },
    orderBy: { createdAt: "asc" },
  });
  try {
    const result = await proposeCoreMechanism({
      changeSummary: plan.summary,
      stakeholderGroups: groups.map((g) => ({
        name: g.name,
        description: g.description,
        behaviorSpec: g.behaviorSpec,
      })),
    });
    return { ok: true, mechanism: `${result.mechanism}\n\nWhy this matters: ${result.whyItMatters}` };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ----- Step 6: Cadence -------------------------------------------------------

const CadenceSchema = z.object({
  responseCadenceHours: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(720)])
    .nullable()
    .transform((v) => (typeof v === "number" ? v : null)),
  announcementSendOnBehalf: z
    .union([z.literal("on"), z.literal("off"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on"),
});

export async function saveCadence(
  changePlanId: string,
  input: z.input<typeof CadenceSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  const parsed = CadenceSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  return persist(changePlanId, {
    responseCadenceHours: parsed.data.responseCadenceHours,
    announcementSendOnBehalf: parsed.data.announcementSendOnBehalf,
  });
}

const ScheduleTemplateSchema = z.object({
  kind: z.enum(["day_3", "week_1", "week_3"]),
  enabled: z.boolean(),
  offsetDays: z.coerce.number().int().min(1).max(365),
});

const CheckInScheduleSchema = z.object({
  templates: z
    .array(ScheduleTemplateSchema)
    .length(3)
    .refine(
      (templates) => new Set(templates.map((template) => template.kind)).size === 3,
      "Each check-in can only appear once.",
    ),
});

export async function saveCheckInSchedule(
  changePlanId: string,
  input: z.input<typeof CheckInScheduleSchema>,
): Promise<SaveResult> {
  const { plan } = await loadOwnedPlan(changePlanId);
  if (plan.status === "active" || plan.status === "completed") {
    return fail("Edit the check-in schedule before activating the rollout.");
  }
  const parsed = CheckInScheduleSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid schedule");

  await prisma.$transaction(async (tx) => {
    await tx.rolloutCheckInTemplate.createMany({
      data: DEFAULT_CHECK_IN_TEMPLATES.map((template) => ({
        changePlanId,
        kind: template.kind,
        offsetDays: template.offsetDays,
        enabled: template.enabled,
      })),
      skipDuplicates: true,
    });
    for (const template of parsed.data.templates) {
      await tx.rolloutCheckInTemplate.update({
        where: {
          changePlanId_kind: {
            changePlanId,
            kind: template.kind,
          },
        },
        data: {
          enabled: template.enabled,
          offsetDays: template.offsetDays,
        },
      });
    }
    await tx.changePlan.update({
      where: { id: changePlanId },
      data: { lastSavedAt: new Date() },
    });
  });

  revalidatePath(`/changes/${changePlanId}/wizard`, "layout");
  revalidatePath("/changes");
  return { ok: true, savedAt: new Date().toISOString() };
}

// ----- Voice kickoff opt-in --------------------------------------------------

const VoiceKickoffSchema = z.object({
  enabled: z
    .union([z.literal("on"), z.literal("off"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on"),
});

export async function saveVoiceKickoff(
  changePlanId: string,
  input: z.input<typeof VoiceKickoffSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  const parsed = VoiceKickoffSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  }
  return persist(changePlanId, {
    voiceKickoffEnabled: parsed.data.enabled,
  });
}

/**
 * Wizard "Test connection" button — pokes Graph with the activator's
 * email so the leader knows whether tenant admin consent + the
 * Application Access Policy are in place BEFORE they activate.
 */
export async function testVoiceKickoffConnection(
  changePlanId: string,
): Promise<{ ok: boolean; detail: string; status?: number }> {
  const { session } = await loadOwnedPlan(changePlanId);
  const organizerUpn = session.user.email;
  if (!organizerUpn) {
    return {
      ok: false,
      detail:
        "Your Grasp account doesn't have an email on file — voice kickoff needs your Microsoft 365 UPN to create meetings on your behalf.",
    };
  }
  const { probeGraph } = await import("@/lib/graph/client");
  const result = await probeGraph(organizerUpn);
  return {
    ok: result.ok,
    detail: result.detail,
    status: result.status,
  };
}

// ----- Step 7: Materials -----------------------------------------------------

export interface UploadResult {
  ok: boolean;
  error?: string;
  documentId?: string;
}

const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

export async function uploadTrainingDoc(
  changePlanId: string,
  formData: FormData,
): Promise<UploadResult> {
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
  // Land the row first so the user sees pending state immediately even if
  // parse takes a moment.
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

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

  // Synchronous parse — files are small enough (<25 MB) that this fits in a
  // server-action timeout. Indexing (chunk + embed) is deferred via
  // `after()` so the action returns as soon as the row is parsed and the
  // user sees the "uploaded" state immediately; the embed round-trip
  // streams in afterwards.
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
  revalidatePath(`/changes/${changePlanId}/wizard/support`);
  return { ok: true, documentId: doc.id };
}

export async function deleteTrainingDoc(
  changePlanId: string,
  documentId: string,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  const doc = await prisma.trainingDocument.findFirst({
    where: { id: documentId, changePlanId },
  });
  if (!doc) return fail("Document not found");
  // Best-effort: blob delete failure should not block the row delete.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await del(doc.blobUrl);
    } catch {
      /* noop */
    }
  }
  await prisma.trainingDocument.delete({ where: { id: documentId } });
  return persist(changePlanId, {});
}

// ----- Step 8: Announcement --------------------------------------------------

const AnnouncementSaveSchema = z.object({
  announcement: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function saveAnnouncement(
  changePlanId: string,
  input: z.input<typeof AnnouncementSaveSchema>,
): Promise<SaveResult> {
  await loadOwnedPlan(changePlanId);
  const parsed = AnnouncementSaveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Invalid input");
  return persist(changePlanId, {
    announcement: parsed.data.announcement,
    // Editing the announcement invalidates the prior scoring pass. We use
    // Prisma's JsonNull sentinel rather than a literal null because the
    // column is typed as Json? and `null` is ambiguous between "set to JSON
    // null" and "set the column to NULL".
    announcementScores: parsed.data.announcement ? undefined : Prisma.JsonNull,
  });
}

export async function aiScoreAnnouncement(
  changePlanId: string,
): Promise<
  | { ok: true; scores: AnnouncementScores }
  | { ok: false; error: string }
> {
  const { plan } = await loadOwnedPlan(changePlanId);
  if (!plan.announcement?.trim()) {
    return { ok: false, error: "Write or generate an announcement first." };
  }
  if (!isAiEnabled()) return { ok: false, error: "AI is not configured" };
  try {
    const scores = await scoreAnnouncement({
      announcement: plan.announcement,
      changeSummary: plan.summary ?? plan.name,
    });
    await persist(changePlanId, {
      announcementScores: scores as unknown as Prisma.InputJsonValue,
    });
    return { ok: true, scores };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ----- Step 9: Review --------------------------------------------------------

export async function markWizardComplete(
  changePlanId: string,
): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  const { plan } = await loadOwnedPlan(changePlanId);
  if (plan.status !== "draft") {
    return { ok: true, href: `/changes/${changePlanId}` };
  }
  // Minimum-bar validation: name + at least one stakeholder group.
  const groupCount = await prisma.stakeholderGroup.count({
    where: { changePlanId },
  });
  if (!plan.name?.trim()) {
    return { ok: false, error: "Plan needs a name in the first step." };
  }
  if (groupCount === 0) {
    return { ok: false, error: "Plan needs at least one stakeholder group." };
  }
  await prisma.changePlan.update({
    where: { id: changePlanId },
    data: {
      status: "ready",
      wizardCompletedAt: new Date(),
      lastSavedAt: new Date(),
    },
  });
  revalidatePath("/changes");
  revalidatePath(`/changes/${changePlanId}`);
  return { ok: true, href: `/changes/${changePlanId}` };
}

// ----- helpers ---------------------------------------------------------------

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  // <input type="date"> serializes YYYY-MM-DD. Parse as UTC midnight so the
  // stored date is independent of the server's local timezone.
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

// Compile-time assertion that we cover all wizard steps in this file (the
// type system catches drift if WIZARD_STEPS gains a slug we don't handle).
type _StepCoverage = (typeof WIZARD_STEPS)[number]["slug"];
const _assertCoverage: _StepCoverage extends ChangePlanWizardStep ? true : never = true;
void _assertCoverage;
