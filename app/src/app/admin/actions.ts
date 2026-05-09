"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  AmendmentDeliveryStatus,
  ChangeEnrollmentKickoffStatus,
  ChangePlanStatus,
  CheckInStatus,
  VoiceCallStatus,
} from "@prisma/client";

import { runAmendmentDelivery } from "@/lib/agent/amendments";
import { runScheduledCheckIn, scheduleCheckInsForPlan } from "@/lib/agent/check-ins";
import { requireAgentGraspAdmin } from "@/lib/admin";
import { sendKickoffDms } from "@/lib/changes/kickoff";
import { prisma } from "@/lib/db";
import { deleteCalendarEvent } from "@/lib/graph/client";
import { runScheduledVoiceCall } from "@/lib/voice/dispatch";
import { scheduleVoiceCallsForPlan } from "@/lib/voice/schedule";

type ActionResult = {
  ok: boolean;
  error?: string;
};

function readId(formData: FormData, key = "id"): string {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Missing item id");
  }
  return value;
}

function adminCancelNote(adminEmail: string | null | undefined): string {
  return `Admin cancelled by ${adminEmail ?? "unknown admin"} at ${new Date().toISOString()}`;
}

export async function activateReadyPlanAction(
  formData: FormData,
): Promise<void> {
  await requireAgentGraspAdmin();
  const changePlanId = readId(formData);
  const result = await activateReadyPlanAsAdmin(changePlanId);
  if (!result.ok) throw new Error(result.error);
}

export async function sendCheckInNowAction(
  formData: FormData,
): Promise<void> {
  await requireAgentGraspAdmin();
  const id = readId(formData);
  const result = await runScheduledCheckIn(id);
  revalidatePath("/admin");
  if (!result.ok) throw new Error(result.error ?? "Check-in dispatch failed");
}

export async function cancelCheckInAction(
  formData: FormData,
): Promise<void> {
  const session = await requireAgentGraspAdmin();
  const id = readId(formData);
  const result = await prisma.scheduledCheckIn.updateMany({
    where: { id, status: CheckInStatus.scheduled },
    data: {
      status: CheckInStatus.skipped,
      error: adminCancelNote(session.user.email),
    },
  });
  revalidatePath("/admin");
  if (result.count !== 1) throw new Error("Check-in is no longer scheduled");
}

export async function sendAmendmentNowAction(
  formData: FormData,
): Promise<void> {
  await requireAgentGraspAdmin();
  const id = readId(formData);
  const result = await runAmendmentDelivery(id);
  revalidatePath("/admin");
  if (!result.ok) throw new Error(result.error ?? "Amendment delivery failed");
}

export async function cancelAmendmentAction(
  formData: FormData,
): Promise<void> {
  const session = await requireAgentGraspAdmin();
  const id = readId(formData);
  const result = await prisma.amendmentDelivery.updateMany({
    where: { id, status: AmendmentDeliveryStatus.scheduled },
    data: {
      status: AmendmentDeliveryStatus.skipped,
      error: adminCancelNote(session.user.email),
    },
  });
  revalidatePath("/admin");
  if (result.count !== 1) {
    throw new Error("Amendment delivery is no longer scheduled");
  }
}

export async function sendVoiceCallNowAction(
  formData: FormData,
): Promise<void> {
  await requireAgentGraspAdmin();
  const id = readId(formData);
  const result = await runScheduledVoiceCall(id);
  revalidatePath("/admin");
  if (!result.ok) throw new Error(result.error ?? "Voice-call dispatch failed");
}

export async function cancelVoiceCallAction(
  formData: FormData,
): Promise<void> {
  const session = await requireAgentGraspAdmin();
  const id = readId(formData);
  const note = adminCancelNote(session.user.email);
  const row = await prisma.scheduledVoiceCall.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      graphEventId: true,
      changePlan: {
        select: {
          activatedBy: { select: { email: true } },
        },
      },
    },
  });
  if (!row) throw new Error("Voice call not found");
  if (row.status !== VoiceCallStatus.scheduled) {
    throw new Error("Voice call is no longer scheduled");
  }

  await prisma.scheduledVoiceCall.update({
    where: { id },
    data: { status: VoiceCallStatus.skipped, error: note },
  });

  const organizerEmail = row.changePlan.activatedBy?.email;
  if (row.graphEventId && organizerEmail) {
    try {
      await deleteCalendarEvent(organizerEmail, row.graphEventId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown Graph cancellation error";
      await prisma.scheduledVoiceCall.update({
        where: { id },
        data: { error: `${note}; Graph calendar cancellation failed: ${message}` },
      });
      revalidatePath("/admin");
      throw new Error(
        "Voice call skipped, but the Graph calendar invite could not be cancelled.",
      );
    }
  }

  revalidatePath("/admin");
}

async function activateReadyPlanAsAdmin(changePlanId: string): Promise<ActionResult> {
  const plan = await prisma.changePlan.findUnique({
    where: { id: changePlanId },
    select: {
      id: true,
      createdByUserId: true,
      status: true,
      announcement: true,
      wizardCompletedAt: true,
      organization: { select: { approvedAt: true } },
    },
  });
  if (!plan) return { ok: false, error: "Change plan not found" };
  if (!plan.organization.approvedAt) {
    return {
      ok: false,
      error: "Approve the workspace before activating this rollout.",
    };
  }
  if (plan.status !== ChangePlanStatus.ready) {
    return { ok: false, error: `Plan is ${plan.status}, not ready.` };
  }
  if (!plan.wizardCompletedAt) {
    return { ok: false, error: "Plan wizard is not complete." };
  }
  if (!plan.announcement?.trim()) {
    return { ok: false, error: "Plan has no announcement." };
  }

  const memberRows = await prisma.stakeholderGroupMember.findMany({
    where: { stakeholderGroup: { changePlanId } },
    select: { employeeId: true },
    distinct: ["employeeId"],
  });
  if (memberRows.length === 0) {
    return { ok: false, error: "Plan has no stakeholder-group members." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.changeEnrollment.createMany({
      data: memberRows.map((member) => ({
        changePlanId,
        employeeId: member.employeeId,
        kickoffStatus: ChangeEnrollmentKickoffStatus.pending,
        surveyToken: randomBytes(32).toString("base64url"),
      })),
      skipDuplicates: true,
    });
    await tx.changePlan.update({
      where: { id: changePlanId },
      data: {
        status: ChangePlanStatus.active,
        activatedAt: new Date(),
        activatedByUserId: plan.createdByUserId,
      },
    });
  });

  try {
    await scheduleVoiceCallsForPlan(changePlanId);
  } catch (err) {
    console.error("[admin] scheduleVoiceCallsForPlan failed:", err);
  }

  await sendKickoffDms(changePlanId);

  try {
    await scheduleCheckInsForPlan(changePlanId);
  } catch (err) {
    console.error("[admin] scheduleCheckInsForPlan failed:", err);
  }

  revalidatePath("/admin");
  revalidatePath(`/changes/${changePlanId}`);
  revalidatePath("/changes");
  return { ok: true };
}
