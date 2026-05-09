"use server";

/**
 * Submit handler for the public baseline survey at /s/[token].
 *
 * Token-only auth: the URL itself is the credential. We never accept
 * an enrollmentId from the form because that would let any logged-in
 * employee submit on behalf of any other employee.
 *
 * Idempotent: re-submitting after completion is a no-op (the redirect
 * lands the user on the thank-you page on next render). The
 * `BaselineSurveyResponse.enrollmentId` is `@unique` so a duplicate
 * upsert can't double-count.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BaselineSurveyStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  BaselineSurveySchema,
  scoreCausality,
  scoreOregRtc,
} from "@/lib/surveys/baseline";

export interface SubmitResult {
  ok: boolean;
  error?: string;
}

export async function submitBaselineSurvey(
  token: string,
  raw: unknown,
): Promise<SubmitResult> {
  const enrollment = await prisma.changeEnrollment.findUnique({
    where: { surveyToken: token },
    select: { id: true, surveyStatus: true, changePlanId: true },
  });
  if (!enrollment) return { ok: false, error: "Survey link not recognized." };
  if (enrollment.surveyStatus === BaselineSurveyStatus.completed) {
    redirect(`/s/${token}`);
  }

  const parsed = BaselineSurveySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.errors[0]?.message ??
        "A few answers are missing. Please scroll up and finish them.",
    };
  }
  const data = parsed.data;

  // Prisma's Json column expects InputJsonValue (which carries an
  // index signature). Our scoring helpers return well-typed shapes, so
  // we cast to the JSON-compatible view here.
  const oreg = scoreOregRtc(data.oregRtc) as unknown as Prisma.InputJsonValue;
  const causality = scoreCausality(
    data.causalityOrientation,
  ) as unknown as Prisma.InputJsonValue;
  const workingPreferences =
    data.workingPreferences as unknown as Prisma.InputJsonValue;
  // The Prisma column is required; we kept the JSON-shape for back-
  // compat but the compressed instrument no longer collects it. Write
  // an empty object so existing rows aren't broken and a future
  // migration can drop the column without a code change here.
  const priorChangeExperience = {} as unknown as Prisma.InputJsonValue;

  await prisma.$transaction(async (tx) => {
    await tx.baselineSurveyResponse.upsert({
      where: { enrollmentId: enrollment.id },
      create: {
        enrollmentId: enrollment.id,
        oregRtc: oreg,
        causalityOrientation: causality,
        workingPreferences,
        priorChangeExperience,
      },
      update: {
        oregRtc: oreg,
        causalityOrientation: causality,
        workingPreferences,
        priorChangeExperience,
      },
    });
    await tx.changeEnrollment.update({
      where: { id: enrollment.id },
      data: {
        surveyStatus: BaselineSurveyStatus.completed,
        surveyCompletedAt: new Date(),
      },
    });
  });

  // The leadership status panel relies on this for live counts.
  revalidatePath(`/changes/${enrollment.changePlanId}`);
  redirect(`/s/${token}`);
}

/**
 * Lightweight "first touch" mark used by the page on initial GET so
 * the leadership status pill can move from `not_started` to
 * `in_progress` without waiting for a submit. Idempotent.
 *
 * NOTE: this is intentionally a plain async function (not a server
 * action) and does NOT call `revalidatePath`. Next 16 forbids cache
 * mutations during render, and the leadership change page reads from
 * Prisma directly with no cache wrapper, so it'll pick up the new
 * status on the leader's next navigation regardless. The page invokes
 * this from `after()` so the DB round-trip doesn't block the survey
 * response either.
 */
export async function markSurveyOpened(token: string): Promise<void> {
  const enrollment = await prisma.changeEnrollment.findUnique({
    where: { surveyToken: token },
    select: { id: true, surveyStatus: true },
  });
  if (!enrollment) return;
  if (enrollment.surveyStatus !== BaselineSurveyStatus.not_started) return;
  await prisma.changeEnrollment.update({
    where: { id: enrollment.id },
    data: {
      surveyStatus: BaselineSurveyStatus.in_progress,
      surveyStartedAt: new Date(),
    },
  });
}
