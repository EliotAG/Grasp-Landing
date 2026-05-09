"use server";

/**
 * Per-change-plan server actions outside the wizard.
 *
 * - activatePlan: ready -> active. Creates one ChangeEnrollment per
 *   distinct affected employee (idempotent on retries) and fans out
 *   kickoff DMs.
 * - resendKickoff: re-runs the single-row dispatch for one enrollment.
 *   Used by the Resend button on the kickoff status panel for rows
 *   that ended up `skipped_no_bot` or `failed`.
 *
 * The activate transaction is intentionally tight (just the data
 * mutation). DM dispatch happens after commit so a Bot Connector
 * timeout does not roll back the activation.
 */

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { AmendmentAudience, ChangePlanStatus } from "@prisma/client";

import {
  WorkspacePendingApprovalError,
  assertOrgApproved,
} from "@/lib/access";
import { loadOwnedPlan } from "@/lib/changes/load";
import { prisma } from "@/lib/db";
import {
  sendKickoffDmForEnrollment,
  sendKickoffDms,
} from "@/lib/changes/kickoff";
import { deliverPendingResponses } from "@/lib/agent/proactive";
import { scheduleCheckInsForPlan } from "@/lib/agent/check-ins";
import { scheduleVoiceCallsForPlan } from "@/lib/voice/schedule";
import {
  createAndDispatchAmendment,
  type CreateAmendmentResult,
} from "@/lib/agent/amendments";

interface ActivateResult {
  ok: boolean;
  error?: string;
  enrolled?: number;
  sent?: number;
  skippedNoBot?: number;
  failed?: number;
}

export async function activatePlan(
  changePlanId: string,
): Promise<ActivateResult> {
  const { session, plan } = await loadOwnedPlan(changePlanId);

  // Closed-pilot gate. Activation is the moment Grasp starts talking
  // to real employees, so it's where the workspace-level approval
  // must be enforced. Refuse cleanly with the error shape the UI
  // already knows how to render.
  try {
    assertOrgApproved(session);
  } catch (err) {
    if (err instanceof WorkspacePendingApprovalError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  if (plan.status !== ChangePlanStatus.ready) {
    return {
      ok: false,
      error:
        plan.status === ChangePlanStatus.draft
          ? "Finish the planning wizard before activating."
          : `Plan is already ${plan.status}.`,
    };
  }
  if (!plan.wizardCompletedAt) {
    return {
      ok: false,
      error: "Mark the wizard complete before activating.",
    };
  }
  if (!plan.announcement?.trim()) {
    return {
      ok: false,
      error: "Add an announcement on the wizard before activating.",
    };
  }

  // Distinct affected employees across all stakeholder groups in this plan.
  const memberRows = await prisma.stakeholderGroupMember.findMany({
    where: { stakeholderGroup: { changePlanId } },
    select: { employeeId: true },
    distinct: ["employeeId"],
  });

  if (memberRows.length === 0) {
    // Differentiate "no groups at all" from "groups exist but all empty"
    // so the leader knows exactly which wizard step to revisit.
    const groupCount = await prisma.stakeholderGroup.count({
      where: { changePlanId },
    });
    if (groupCount === 0) {
      return {
        ok: false,
        error:
          "No stakeholder groups defined yet. Open the wizard's audience step and add at least one group.",
      };
    }
    const emptyGroups = await prisma.stakeholderGroup.findMany({
      where: { changePlanId, members: { none: {} } },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    const names = emptyGroups
      .slice(0, 3)
      .map((g) => `"${g.name}"`)
      .join(", ");
    const more =
      emptyGroups.length > 3 ? ` and ${emptyGroups.length - 3} more` : "";
    return {
      ok: false,
      error: `Stakeholder group${emptyGroups.length === 1 ? "" : "s"} ${names}${more} ${
        emptyGroups.length === 1 ? "has" : "have"
      } no members. Open the wizard's audience step and add at least one employee to each group.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.changeEnrollment.createMany({
      data: memberRows.map((m) => ({
        changePlanId,
        employeeId: m.employeeId,
        // 32 bytes of entropy, base64url-encoded -> 43 chars, URL-safe.
        // Globally unique by collision math; the @unique constraint on
        // surveyToken is the safety net.
        surveyToken: randomBytes(32).toString("base64url"),
      })),
      skipDuplicates: true,
    });

    await tx.changePlan.update({
      where: { id: changePlanId },
      data: {
        status: ChangePlanStatus.active,
        activatedAt: new Date(),
        activatedByUserId: session.user.id,
      },
    });
  });

  // Stage per-employee voice-kickoff slots BEFORE the DMs go out, so
  // each kickoff DM can include the slot date and an .ics attachment
  // pointing at the materialized ScheduledVoiceCall. No-op (and safe
  // to retry) when voice kickoff isn't enabled on the plan.
  try {
    await scheduleVoiceCallsForPlan(changePlanId);
  } catch (err) {
    console.error("[activatePlan] scheduleVoiceCallsForPlan failed:", err);
  }

  // Fan out DMs after commit. Awaited inline so the leader sees the
  // result. If it overruns the 30s server-action budget on very large
  // orgs, the Resend button on the status panel drains the rest.
  const summary = await sendKickoffDms(changePlanId);

  // Schedule the cadence (day 3 / week 1 / week 3) against the
  // freshly-set activatedAt timestamp. Idempotent on retries via
  // the (enrollmentId, kind) unique constraint, so a stuck activate
  // that gets re-run won't double-schedule.
  try {
    await scheduleCheckInsForPlan(changePlanId);
  } catch (err) {
    // Don't block activation on scheduling — the row exists, the
    // DMs went out. A later resend / manual reschedule can repair
    // the cadence. Surface in logs so we know to investigate.
    console.error("[activatePlan] scheduleCheckInsForPlan failed:", err);
  }

  revalidatePath(`/changes/${changePlanId}`);
  revalidatePath("/changes");
  return {
    ok: true,
    enrolled: summary.total,
    sent: summary.sent,
    skippedNoBot: summary.skippedNoBot,
    failed: summary.failed,
  };
}

interface ResendResult {
  ok: boolean;
  error?: string;
  status?: "sent" | "skipped_no_bot" | "failed";
}

export async function resendKickoff(
  changePlanId: string,
  enrollmentId: string,
): Promise<ResendResult> {
  await loadOwnedPlan(changePlanId);

  const enrollment = await prisma.changeEnrollment.findFirst({
    where: { id: enrollmentId, changePlanId },
    select: { id: true },
  });
  if (!enrollment) return { ok: false, error: "Enrollment not found" };

  // Reset the row to pending so the dispatcher's update-on-result fires
  // a fresh kickoffSentAt / kickoffError pair.
  await prisma.changeEnrollment.update({
    where: { id: enrollmentId },
    data: { kickoffStatus: "pending", kickoffError: null },
  });

  const status = await sendKickoffDmForEnrollment(enrollmentId);
  revalidatePath(`/changes/${changePlanId}`);
  return { ok: true, status };
}

interface RespondToConcernResult {
  ok: boolean;
  error?: string;
  /// Whether the proactive delivery succeeded on at least one channel.
  delivered?: boolean;
  /// Per-channel breakdown surfaced to the dashboard so the leader
  /// knows where their reply landed.
  channels?: {
    teams: "sent" | "skipped_no_bot" | "failed" | "skipped";
    simulator: "sent" | "skipped" | "failed";
  };
}

/**
 * Leader replies to a previously-surfaced concern.
 *
 * Flow:
 *   1. Persist the response on the Concern row (status -> responded).
 *   2. Synthesize a delivery message via the proactive agent loop.
 *   3. Send via Teams (best-effort) + simulator (mirror).
 *   4. Mark deliveredAt iff at least one channel accepted.
 *
 * The proactive turn happens inline so the leader sees the outcome
 * (delivered? failed? sim-only?) immediately on save. Worst case it
 * fits inside the server-action budget for a single concern; if the
 * LLM call hangs, the leader's response itself is already persisted
 * and the next user-initiated turn from the employee will pick it
 * up via the system prompt.
 */
export async function respondToConcern(
  changePlanId: string,
  concernId: string,
  body: string,
): Promise<RespondToConcernResult> {
  const trimmed = body.trim();
  if (trimmed.length < 4) {
    return { ok: false, error: "Write a longer reply before sending." };
  }
  if (trimmed.length > 4000) {
    return { ok: false, error: "Reply is too long — keep it under 4000 chars." };
  }
  const { session } = await loadOwnedPlan(changePlanId);

  // Guard the concern belongs to this plan, so a hand-crafted POST
  // can't reply to a concern in someone else's org.
  const concern = await prisma.concern.findFirst({
    where: {
      id: concernId,
      enrollment: { changePlanId },
    },
    select: { id: true, enrollmentId: true, status: true, deliveredAt: true },
  });
  if (!concern) return { ok: false, error: "Concern not found" };

  await prisma.concern.update({
    where: { id: concernId },
    data: {
      responseBody: trimmed,
      respondedByUserId: session.user.id,
      respondedAt: new Date(),
      status: "responded",
      // Reset delivery state so the new response is treated as a
      // fresh delivery attempt (handles the edit-after-send case).
      deliveredAt: null,
      deliveryError: null,
    },
  });

  // Kick the proactive turn synchronously so the dashboard reflects
  // the outcome on save. The proactive helper handles its own
  // logging + persistence; we just propagate the channel summary.
  let delivery: Awaited<ReturnType<typeof deliverPendingResponses>>;
  try {
    delivery = await deliverPendingResponses(concern.enrollmentId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delivery failed";
    await prisma.concern.update({
      where: { id: concernId },
      data: { deliveryError: message },
    });
    revalidatePath(`/changes/${changePlanId}`);
    return {
      ok: true,
      delivered: false,
      error: `Saved your reply but delivery failed: ${message}. The next message from the employee will pick it up automatically.`,
    };
  }

  revalidatePath(`/changes/${changePlanId}`);
  return {
    ok: true,
    delivered: delivery.ok,
    channels: delivery.channels,
    error: delivery.ok ? undefined : delivery.error,
  };
}

interface PublishAmendmentResult {
  ok: boolean;
  error?: string;
  amendmentId?: string;
  /// Total deliveries created for the amendment.
  total?: number;
  /// Number that succeeded inline (channel ack received).
  delivered?: number;
  /// Number that failed inline.
  failed?: number;
  /// Number deferred to the cron because the inline cap was hit.
  deferred?: number;
}

/**
 * Leadership publishes a verbatim amendment to the change itself.
 *
 * The action:
 *   1. Validates inputs (length caps, audience consistency, source
 *      concern ownership).
 *   2. Hands off to `createAndDispatchAmendment` which creates the
 *      amendment + per-enrollment delivery rows and runs a
 *      best-effort inline dispatch.
 *   3. Returns a digest the UI can render so the leader sees the
 *      delivery split immediately on save.
 */
export async function publishAmendment(
  changePlanId: string,
  input: {
    summary: string;
    body: string;
    audience: AmendmentAudience;
    sourceConcernIds: string[];
  },
): Promise<PublishAmendmentResult> {
  const summary = input.summary.trim();
  const body = input.body.trim();
  if (summary.length < 4) {
    return { ok: false, error: "Add a short summary (at least 4 chars)." };
  }
  if (summary.length > 200) {
    return { ok: false, error: "Summary must be under 200 chars." };
  }
  if (body.length < 10) {
    return { ok: false, error: "Write a longer amendment body." };
  }
  if (body.length > 4000) {
    return { ok: false, error: "Amendment body is too long — keep it under 4000 chars." };
  }
  const { session, plan } = await loadOwnedPlan(changePlanId);
  // Amendments fan out to live employees the same way activation does
  // — same gate.
  try {
    assertOrgApproved(session);
  } catch (err) {
    if (err instanceof WorkspacePendingApprovalError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  if (plan.status !== ChangePlanStatus.active) {
    return {
      ok: false,
      error: `Change plan must be active to publish an amendment (status=${plan.status}).`,
    };
  }

  let result: CreateAmendmentResult;
  try {
    result = await createAndDispatchAmendment({
      changePlanId,
      authoredByUserId: session.user.id,
      summary,
      body,
      audience: input.audience,
      sourceConcernIds: input.sourceConcernIds,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Amendment failed",
    };
  }

  let delivered = 0;
  let failed = 0;
  for (const r of result.inlineResults) {
    if (r.result.ok && !r.result.skippedReason) delivered += 1;
    else if (!r.result.ok) failed += 1;
  }

  revalidatePath(`/changes/${changePlanId}`);
  return {
    ok: true,
    amendmentId: result.amendmentId,
    total: result.totalDeliveries,
    delivered,
    failed,
    deferred: result.deferred,
  };
}
