"use server";

/**
 * Server actions for the voice intake flow.
 *
 * Phase 1 (upload step) uses the upload / paste / delete actions to drop
 * context onto the plan before the voice session starts. Phase 2 (voice
 * step) talks to OpenAI Realtime directly and routes its tool calls through
 * /api/intake/[id]/tool — those mutations skip this file entirely. Phase 3
 * (review form) reuses these `saveIntake*` actions, which are thin wrappers
 * around the planner services so the wizard step components plug straight
 * in.
 */

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
} from "@/lib/planner/services";

// ---------------------------------------------------------------------------
// Phase 1 — upload step
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Phase 3 — review form (these mirror the wizard's save actions but live
// here so the review form does not need to reach into the wizard's actions
// file).
// ---------------------------------------------------------------------------

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
