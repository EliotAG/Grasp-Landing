/**
 * Outbound amendment loop.
 *
 * When leadership decides to update the change ITSELF (rather than
 * just respond per-concern), Grasp fans the verbatim amendment to
 * every employee in scope, with attribution back to the concerns
 * that surfaced it.
 *
 * Three responsibilities live here:
 *
 *   1. `createAndDispatchAmendment` — orchestrator called from the
 *      change-page server action. Inserts the amendment + per-
 *      enrollment AmendmentDelivery rows, then drives a synchronous
 *      best-effort dispatch.
 *
 *   2. `dispatchAmendment` / `runAmendmentDelivery` — per-row
 *      dispatcher. Atomic claim, agent context load, proactive
 *      turn, channel send, mark dispatched.
 *
 *   3. `drainPendingAmendmentDeliveries` — cron-friendly drainer
 *      that picks up any rows still `scheduled` (e.g. because the
 *      inline dispatch hit the request-budget on a large org).
 *
 * Mirrors the shape of `check-ins.ts` so future drift-driven
 * proactive flows can reuse the same primitives.
 */

import {
  AmendmentAudience,
  AmendmentDeliveryStatus,
  Prisma,
} from "@prisma/client";

import { isAiEnabled } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db";

import { loadAgentContextByEmail } from "./context";
import type { AgentContext, PendingAmendment } from "./context";
import { runProactiveTurn, sendReplyOnAllChannels } from "./proactive";

/// Cap on how many deliveries the synchronous create-and-dispatch
/// path will fire inline before deferring the rest to the cron.
/// Keeps the create-amendment server action under the request
/// budget for large orgs.
const INLINE_DISPATCH_LIMIT = 8;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateAmendmentInput {
  changePlanId: string;
  authoredByUserId: string;
  summary: string;
  body: string;
  audience: AmendmentAudience;
  /// Optional concern ids that motivated this amendment. Used both
  /// for attribution in the agent's delivery turn and (when audience
  /// is `surfacers`) to scope the recipient list to the employees
  /// whose enrollments those concerns belong to.
  sourceConcernIds: string[];
}

export interface CreateAmendmentResult {
  amendmentId: string;
  /// Total number of AmendmentDelivery rows created for this amendment.
  totalDeliveries: number;
  /// Per-row dispatch outcomes for the rows we ran inline. Remaining
  /// rows (if any) stay in `scheduled` and the cron picks them up.
  inlineResults: Array<{
    deliveryId: string;
    result: AmendmentDispatchResult;
  }>;
  /// Number of deliveries deferred past the inline cap.
  deferred: number;
}

export interface AmendmentDispatchResult {
  ok: boolean;
  /// Set when we chose not to run a channel send (already claimed,
  /// no context, AI disabled with no fallback path, etc).
  skippedReason?: string;
  channels?: Awaited<ReturnType<typeof sendReplyOnAllChannels>>["channels"];
  reply?: string;
  error?: string;
}

/**
 * Create the amendment + delivery rows and kick off best-effort
 * inline dispatch. Returns immediately even if some rows are
 * deferred — the cron is the durability backstop.
 */
export async function createAndDispatchAmendment(
  input: CreateAmendmentInput,
): Promise<CreateAmendmentResult> {
  if (!input.summary.trim()) {
    throw new Error("Amendment summary is required");
  }
  if (!input.body.trim()) {
    throw new Error("Amendment body is required");
  }
  const sourceConcernIds = Array.from(
    new Set(input.sourceConcernIds.filter((id) => UUID_RE.test(id))),
  );

  const plan = await prisma.changePlan.findUnique({
    where: { id: input.changePlanId },
    select: { id: true, status: true },
  });
  if (!plan) {
    throw new Error("Change plan not found");
  }
  if (plan.status !== "active") {
    throw new Error(
      `Change plan must be active to publish an amendment (status=${plan.status}).`,
    );
  }

  // Resolve audience to a concrete enrollment set. The DB is the
  // source of truth — we always read fresh so a recently added
  // employee is included by default.
  const allEnrollments = await prisma.changeEnrollment.findMany({
    where: { changePlanId: plan.id },
    select: { id: true },
  });

  let recipientEnrollmentIds: string[];
  if (input.audience === "everyone") {
    recipientEnrollmentIds = allEnrollments.map((e) => e.id);
  } else {
    // surfacers: only the employees whose concerns motivated this
    // amendment. Falls back to "no one" if no source concerns were
    // attached, which we surface as a noisy error rather than
    // silently broadcasting.
    if (sourceConcernIds.length === 0) {
      throw new Error(
        "Audience is 'surfacers' but no source concerns are attached. Pick concerns or switch to 'everyone'.",
      );
    }
    const sourceConcerns = await prisma.concern.findMany({
      where: {
        id: { in: sourceConcernIds },
        enrollment: { changePlanId: plan.id },
      },
      select: { enrollmentId: true },
    });
    recipientEnrollmentIds = Array.from(
      new Set(sourceConcerns.map((c) => c.enrollmentId)),
    );
  }

  // Validate source concerns belong to this plan before persisting,
  // so dashboards never display amendment->concern links that
  // cross plans.
  const validSourceConcernIds =
    sourceConcernIds.length === 0
      ? []
      : (
          await prisma.concern.findMany({
            where: {
              id: { in: sourceConcernIds },
              enrollment: { changePlanId: plan.id },
            },
            select: { id: true },
          })
        ).map((c) => c.id);

  const amendment = await prisma.$transaction(async (tx) => {
    const created = await tx.changeAmendment.create({
      data: {
        changePlanId: plan.id,
        authoredByUserId: input.authoredByUserId,
        summary: input.summary.trim(),
        body: input.body.trim(),
        audience: input.audience,
      },
      select: { id: true },
    });
    if (validSourceConcernIds.length > 0) {
      await tx.amendmentSourceConcern.createMany({
        data: validSourceConcernIds.map((concernId) => ({
          amendmentId: created.id,
          concernId,
        })),
        skipDuplicates: true,
      });
    }
    if (recipientEnrollmentIds.length > 0) {
      await tx.amendmentDelivery.createMany({
        data: recipientEnrollmentIds.map((enrollmentId) => ({
          amendmentId: created.id,
          enrollmentId,
        })),
        skipDuplicates: true,
      });
    }
    return created;
  });

  // Fetch the deliveries we just created (or skipped) so we can
  // dispatch them. Always-fresh read covers the skipDuplicates case
  // where a stale row already existed.
  const deliveries = await prisma.amendmentDelivery.findMany({
    where: {
      amendmentId: amendment.id,
      status: AmendmentDeliveryStatus.scheduled,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const inline = deliveries.slice(0, INLINE_DISPATCH_LIMIT);
  const inlineResults: CreateAmendmentResult["inlineResults"] = [];
  for (const row of inline) {
    try {
      const result = await runAmendmentDelivery(row.id);
      inlineResults.push({ deliveryId: row.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      inlineResults.push({
        deliveryId: row.id,
        result: { ok: false, error: message },
      });
    }
  }

  return {
    amendmentId: amendment.id,
    totalDeliveries: deliveries.length,
    inlineResults,
    deferred: Math.max(0, deliveries.length - inline.length),
  };
}

/**
 * Drain undelivered amendment rows. Sequential, like the check-in
 * drainer, to avoid thundering Anthropic.
 */
export async function drainPendingAmendmentDeliveries(opts?: {
  limit?: number;
  /// When true, only dispatch rows whose enrollment plan is still
  /// active. Default true; cron always wants this.
  activePlanOnly?: boolean;
  /// When set, only drain deliveries whose enrollment is on this
  /// change plan. Used by the demo controls panel so a recorder
  /// can fire the deliveries for the plan they're filming without
  /// touching unrelated org-wide pending sends.
  planId?: string;
}): Promise<{
  drained: number;
  results: Array<{ deliveryId: string; result: AmendmentDispatchResult }>;
}> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
  const activePlanOnly = opts?.activePlanOnly ?? true;

  const due = await prisma.amendmentDelivery.findMany({
    where: {
      status: AmendmentDeliveryStatus.scheduled,
      ...(activePlanOnly || opts?.planId
        ? {
            enrollment: {
              ...(opts?.planId ? { changePlanId: opts.planId } : {}),
              ...(activePlanOnly ? { changePlan: { status: "active" } } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const results: Array<{ deliveryId: string; result: AmendmentDispatchResult }> = [];
  for (const row of due) {
    try {
      const result = await runAmendmentDelivery(row.id);
      results.push({ deliveryId: row.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({
        deliveryId: row.id,
        result: { ok: false, error: message },
      });
    }
  }
  return { drained: results.length, results };
}

/**
 * Dispatch a single AmendmentDelivery row. Atomic claim, then
 * load context and fire a proactive turn that surfaces the
 * verbatim amendment.
 */
export async function runAmendmentDelivery(
  deliveryId: string,
): Promise<AmendmentDispatchResult> {
  // Atomic claim. We move straight from `scheduled` to `dispatched`
  // so a concurrent cron can't double-fire. If the channel send
  // ultimately fails we'll flip it to `failed` below.
  const claim = await prisma.amendmentDelivery.updateMany({
    where: { id: deliveryId, status: AmendmentDeliveryStatus.scheduled },
    data: {
      status: AmendmentDeliveryStatus.dispatched,
      dispatchedAt: new Date(),
    },
  });
  if (claim.count === 0) {
    return { ok: true, skippedReason: "already claimed" };
  }

  const row = await prisma.amendmentDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      enrollment: {
        include: {
          employee: { select: { email: true, name: true } },
          changePlan: { select: { status: true } },
        },
      },
    },
  });
  if (!row) {
    return { ok: false, error: "Delivery row vanished after claim" };
  }
  if (row.enrollment.changePlan.status !== "active") {
    await markDelivery(deliveryId, AmendmentDeliveryStatus.skipped, {
      error: `Plan no longer active (status=${row.enrollment.changePlan.status})`,
    });
    return { ok: true, skippedReason: "plan inactive" };
  }

  const baseCtx = await loadAgentContextByEmail(row.enrollment.employee.email);
  if (!baseCtx) {
    await markDelivery(deliveryId, AmendmentDeliveryStatus.skipped, {
      error:
        "Could not load agent context (employee not active in any rollout)",
    });
    return { ok: true, skippedReason: "no context" };
  }

  // Hydrate the amendment we just claimed (and its source concerns)
  // and inject it into the context. We can't rely on the loader's
  // pendingAmendments because the claim already flipped status to
  // `dispatched`, so the loader's `status: scheduled` filter drops
  // it — synthesizing here is simpler than relaxing the loader.
  const amendmentRow = await prisma.changeAmendment.findUnique({
    where: { id: row.amendmentId },
    include: {
      authoredBy: { select: { name: true } },
      sourceConcerns: {
        include: {
          concern: {
            select: { id: true, summary: true, enrollmentId: true },
          },
        },
      },
    },
  });
  if (!amendmentRow) {
    await markDelivery(deliveryId, AmendmentDeliveryStatus.failed, {
      error: "Amendment row vanished after claim",
    });
    return { ok: false, error: "Amendment row vanished after claim" };
  }
  const ownConcernSummaries = amendmentRow.sourceConcerns
    .filter((sc) => sc.concern.enrollmentId === baseCtx.enrollmentId)
    .map((sc) => sc.concern.summary);
  const target: PendingAmendment = {
    deliveryId,
    amendmentId: amendmentRow.id,
    summary: amendmentRow.summary,
    body: amendmentRow.body,
    authorName: amendmentRow.authoredBy?.name ?? "Leadership",
    surfacedByEmployee: ownConcernSummaries.length > 0,
    creditedConcernSummaries: ownConcernSummaries,
    createdAt: amendmentRow.createdAt,
  };
  // Replace any pre-existing pending entry for this delivery (e.g.
  // if the loader caught a sibling amendment in the same query) so
  // there's no duplicate framing.
  const ctx: AgentContext = {
    ...baseCtx,
    pendingAmendments: [
      target,
      ...baseCtx.pendingAmendments.filter((a) => a.deliveryId !== deliveryId),
    ],
  };

  let reply: string;
  try {
    if (!isAiEnabled()) {
      reply = buildVerbatimAmendmentFallback(ctx, target);
    } else {
      reply = await runProactiveTurn(ctx, buildAmendmentSeed(ctx, target));
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Reply generation failed";
    await markDelivery(deliveryId, AmendmentDeliveryStatus.failed, {
      error: message,
    });
    return { ok: false, error: message };
  }

  const send = await sendReplyOnAllChannels(ctx, reply);
  const finalStatus = send.anyDelivered
    ? AmendmentDeliveryStatus.dispatched
    : AmendmentDeliveryStatus.failed;
  await markDelivery(deliveryId, finalStatus, {
    channels: send.channels,
    error: send.error,
  });

  return {
    ok: send.anyDelivered,
    channels: send.channels,
    reply,
    error: send.error ?? undefined,
  };
}

async function markDelivery(
  deliveryId: string,
  status: AmendmentDeliveryStatus,
  patch: {
    channels?: Awaited<ReturnType<typeof sendReplyOnAllChannels>>["channels"];
    error?: string | null;
  },
): Promise<void> {
  await prisma.amendmentDelivery.update({
    where: { id: deliveryId },
    data: {
      status,
      channels: patch.channels
        ? (patch.channels as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      error: patch.error ?? null,
    },
  });
}

/**
 * Per-turn seed system note. The system prompt's
 * `buildPendingAmendmentsBlock` carries the actual delivery rules;
 * this nudges the model to act now.
 */
function buildAmendmentSeed(
  ctx: AgentContext,
  amendment: PendingAmendment,
): string {
  const firstName = ctx.employee.name.split(" ")[0];
  return `[PROACTIVE TURN — leadership has published an amendment to the change ("${amendment.summary}"). Generate ONE message to ${firstName} that surfaces the verbatim amendment body per the "Leadership amendments to deliver this turn" section of the system prompt.${amendment.surfacedByEmployee ? ` Explicitly credit ${firstName} for surfacing the concern that prompted this — they raised it.` : ""} Do NOT call mark_concern_resolved on this turn — that comes later when ${firstName} reacts. Do NOT call record_three_dim_response — no signal yet.]`;
}

/**
 * Verbatim fallback when the AI key is missing. Surfaces the
 * amendment body directly, no LLM rewriting, so dev environments
 * still exercise the channel send.
 */
function buildVerbatimAmendmentFallback(
  ctx: AgentContext,
  amendment: PendingAmendment,
): string {
  const firstName = ctx.employee.name.split(" ")[0];
  const credit = amendment.surfacedByEmployee
    ? `You raised this — leadership updated the rollout in response.\n\n`
    : "";
  return `Hi ${firstName} — leadership pushed an update to the ${ctx.plan.name} rollout: ${amendment.summary}.\n\n${credit}From ${amendment.authorName}:\n${amendment.body}\n\n(This is a verbatim relay — the AI layer is disabled on this Grasp instance, so you're getting the leader's words directly. Reply if anything's unclear or this changes how things land for you.)`;
}
