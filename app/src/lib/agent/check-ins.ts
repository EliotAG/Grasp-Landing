/**
 * Scheduled check-in cadence — agent-initiated proactive turns at
 * day 3 / week 1 / week 3 after activation.
 *
 * Two responsibilities live here:
 *
 *   1. `scheduleCheckInsForPlan` — called from `activatePlan` once
 *      enrollments exist. Inserts one ScheduledCheckIn row per
 *      (enrollment, kind) pair. Idempotent via the
 *      (enrollmentId, kind) unique constraint + skipDuplicates.
 *
 *   2. `runScheduledCheckIn` / `drainDueCheckIns` — called by the
 *      `/api/cron/check-ins` route. Picks up due rows, runs a
 *      proactive agent turn seeded with the per-kind intent, sends
 *      via Teams + simulator, and records the outcome on the row.
 *
 * The cron and the dispatcher use a claim-then-act pattern: we mark
 * the row dispatched up-front (atomic update conditional on
 * status='scheduled') so a concurrent cron run can't double-fire it.
 * The sent/failed channel detail lands in `channels` JSON and the
 * `error` text on the same row.
 */

import {
  CheckInStatus,
  Prisma,
  ScheduledCheckInKind,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai/anthropic";
import { DEFAULT_CHECK_IN_TEMPLATES } from "@/lib/rollout-schedule";

import { loadAgentContextByEmail } from "./context";
import type { AgentContext, ActiveCheckIn } from "./context";
import { runProactiveTurn, sendReplyOnAllChannels } from "./proactive";

/// Day offsets from activation for each scheduled kind. Single source
/// of truth for both the scheduler and the UI's "next check-in"
/// countdown.
export const CHECK_IN_OFFSETS_DAYS: Record<ScheduledCheckInKind, number> = {
  day_3: 3,
  week_1: 7,
  week_3: 21,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Schedule the canonical (day_3, week_1, week_3) check-ins for every
 * enrollment of a plan. Anchor is the plan's activation timestamp;
 * we materialize each row with `scheduledFor = activatedAt + offset`.
 *
 * Safe to call multiple times — duplicates are skipped via the
 * (enrollmentId, kind) unique constraint, so a re-run on an already
 * activated plan is a no-op.
 */
export async function scheduleCheckInsForPlan(
  changePlanId: string,
): Promise<{ enrollments: number; scheduled: number }> {
  const plan = await prisma.changePlan.findUnique({
    where: { id: changePlanId },
    select: {
      activatedAt: true,
      checkInTemplates: {
        select: { kind: true, offsetDays: true, enabled: true },
        orderBy: { offsetDays: "asc" },
      },
    },
  });
  if (!plan?.activatedAt) {
    // No activation yet → nothing to schedule against. The activate
    // action calls this AFTER setting activatedAt, so this only
    // trips when called by hand at the wrong time.
    return { enrollments: 0, scheduled: 0 };
  }
  const enrollments = await prisma.changeEnrollment.findMany({
    where: { changePlanId },
    select: { id: true },
  });
  if (enrollments.length === 0) {
    return { enrollments: 0, scheduled: 0 };
  }

  const templates =
    plan.checkInTemplates.length > 0
      ? plan.checkInTemplates.filter((template) => template.enabled)
      : DEFAULT_CHECK_IN_TEMPLATES.filter((template) => template.enabled);

  if (templates.length === 0) {
    return { enrollments: enrollments.length, scheduled: 0 };
  }

  const rows: Prisma.ScheduledCheckInCreateManyInput[] = [];
  for (const e of enrollments) {
    for (const template of templates) {
      rows.push({
        enrollmentId: e.id,
        kind: template.kind,
        scheduledFor: new Date(
          plan.activatedAt.getTime() + template.offsetDays * DAY_MS,
        ),
      });
    }
  }

  const result = await prisma.scheduledCheckIn.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return { enrollments: enrollments.length, scheduled: result.count };
}

export interface CheckInDispatchResult {
  ok: boolean;
  /// Why we skipped the dispatch (already claimed / no enrollment /
  /// AI disabled etc). Set only when ok=true and we did NOT fire a
  /// channel send.
  skippedReason?: string;
  channels?: Awaited<ReturnType<typeof sendReplyOnAllChannels>>["channels"];
  reply?: string;
  error?: string;
}

/**
 * Drain all currently-due check-ins. Sequential because the LLM
 * loops are the bottleneck and we don't want to thunder-herd
 * Anthropic; on a busier day this becomes a queue-aware worker.
 *
 * Returns a per-row outcome list so the cron can log a digest.
 */
export async function drainDueCheckIns(opts?: {
  limit?: number;
  /// When true, only dispatch rows whose enrollment plan is still
  /// active. Default true; cron always wants this. Tests / manual
  /// runs may want to bypass.
  activePlanOnly?: boolean;
}): Promise<{
  drained: number;
  results: Array<{ checkInId: string; result: CheckInDispatchResult }>;
}> {
  return drainCheckIns({
    limit: opts?.limit,
    activePlanOnly: opts?.activePlanOnly ?? true,
  });
}

/**
 * Demo / one-plan variant of `drainDueCheckIns`. Filters to a single
 * `changePlanId` and otherwise behaves identically: claim-then-act,
 * sequential, returns the same digest shape.
 *
 * Used by the demo controls panel so a recorder can advance the
 * timeline for the plan they're filming without dispatching every
 * other org's pending check-ins. Also bypasses the activePlan gate
 * by default — the caller is on the plan's detail page, so it's
 * already the source of truth for "should I send".
 */
export async function dispatchPlanCheckIns(
  changePlanId: string,
  opts?: { limit?: number; activePlanOnly?: boolean },
): Promise<{
  drained: number;
  results: Array<{ checkInId: string; result: CheckInDispatchResult }>;
}> {
  return drainCheckIns({
    limit: opts?.limit,
    activePlanOnly: opts?.activePlanOnly ?? false,
    changePlanId,
  });
}

/**
 * Internal worker shared by `drainDueCheckIns` and
 * `dispatchPlanCheckIns`. Holds the actual queue/claim/dispatch
 * loop; the public exports just configure the WHERE clause.
 */
async function drainCheckIns(opts: {
  limit?: number;
  activePlanOnly: boolean;
  changePlanId?: string;
}): Promise<{
  drained: number;
  results: Array<{ checkInId: string; result: CheckInDispatchResult }>;
}> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));

  const due = await prisma.scheduledCheckIn.findMany({
    where: {
      status: CheckInStatus.scheduled,
      scheduledFor: { lte: new Date() },
      ...(opts.activePlanOnly || opts.changePlanId
        ? {
            enrollment: {
              ...(opts.changePlanId ? { changePlanId: opts.changePlanId } : {}),
              ...(opts.activePlanOnly
                ? { changePlan: { status: "active" } }
                : {}),
            },
          }
        : {}),
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: { id: true },
  });

  const results: Array<{ checkInId: string; result: CheckInDispatchResult }> = [];
  for (const row of due) {
    try {
      const result = await runScheduledCheckIn(row.id);
      results.push({ checkInId: row.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({
        checkInId: row.id,
        result: { ok: false, error: message },
      });
    }
  }
  return { drained: results.length, results };
}

/**
 * Run a single scheduled check-in. Intended to be called from the
 * cron drain loop; safe to call directly (e.g. from a "force send"
 * dashboard button). Idempotent under concurrent calls — the claim
 * step refuses to double-dispatch.
 */
export async function runScheduledCheckIn(
  checkInId: string,
): Promise<CheckInDispatchResult> {
  // Atomic claim. Only one caller wins the race.
  const claim = await prisma.scheduledCheckIn.updateMany({
    where: { id: checkInId, status: CheckInStatus.scheduled },
    data: {
      status: CheckInStatus.dispatched,
      dispatchedAt: new Date(),
    },
  });
  if (claim.count === 0) {
    return { ok: true, skippedReason: "already claimed" };
  }

  const row = await prisma.scheduledCheckIn.findUnique({
    where: { id: checkInId },
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
    return { ok: false, error: "Check-in row vanished after claim" };
  }
  if (row.enrollment.changePlan.status !== "active") {
    await markCheckIn(checkInId, CheckInStatus.skipped, {
      error: `Plan no longer active (status=${row.enrollment.changePlan.status})`,
    });
    return { ok: true, skippedReason: "plan inactive" };
  }

  const ctx = await loadAgentContextByEmail(row.enrollment.employee.email, {
    activeCheckIn: { id: row.id, kind: row.kind } satisfies ActiveCheckIn,
  });
  if (!ctx) {
    await markCheckIn(checkInId, CheckInStatus.skipped, {
      error: "Could not load agent context (employee not active in any rollout)",
    });
    return { ok: true, skippedReason: "no context" };
  }

  // Fallback path when the AI key is missing — we still send a
  // human-friendly nudge so dev environments can exercise the cron.
  let reply: string;
  try {
    if (!isAiEnabled()) {
      reply = buildVerbatimCheckInFallback(ctx, row.kind);
    } else {
      reply = await runProactiveTurn(ctx, buildCheckInSeed(row.kind, ctx));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reply generation failed";
    await markCheckIn(checkInId, CheckInStatus.failed, { error: message });
    return { ok: false, error: message };
  }

  const send = await sendReplyOnAllChannels(ctx, reply);
  const finalStatus = send.anyDelivered
    ? CheckInStatus.dispatched
    : CheckInStatus.failed;
  await markCheckIn(checkInId, finalStatus, {
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

async function markCheckIn(
  checkInId: string,
  status: CheckInStatus,
  patch: {
    channels?: Awaited<ReturnType<typeof sendReplyOnAllChannels>>["channels"];
    error?: string | null;
  },
): Promise<void> {
  await prisma.scheduledCheckIn.update({
    where: { id: checkInId },
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
 * Per-kind seed system note used to orient the agent for this
 * specific proactive turn. Distinct from the kind-aware block in
 * the system prompt — this is the "go now" instruction that
 * triggers the model to write a message instead of waiting.
 */
function buildCheckInSeed(
  kind: ScheduledCheckInKind,
  ctx: AgentContext,
): string {
  const firstName = ctx.employee.name.split(" ")[0];
  const labels: Record<ScheduledCheckInKind, string> = {
    day_3: "DAY 3",
    week_1: "WEEK 1",
    week_3: "WEEK 3",
  };
  return `[PROACTIVE TURN — scheduled ${labels[kind]} check-in for ${firstName}. Open the conversation per the "Active scheduled check-in" section in the system prompt. Send ONE message, then stop and wait for them to reply. Do NOT call record_three_dim_response on this turn — you don't have signal yet; that comes after they answer.]`;
}

function buildVerbatimCheckInFallback(
  ctx: AgentContext,
  kind: ScheduledCheckInKind,
): string {
  const firstName = ctx.employee.name.split(" ")[0];
  const lines: Record<ScheduledCheckInKind, string> = {
    day_3: `Hey ${firstName} — quick day-3 check on the ${ctx.plan.name} rollout. How's it going so far? Even one specific moment from the last couple days helps.`,
    week_1: `Hey ${firstName} — checking in a week into the ${ctx.plan.name} rollout. What's a recent moment where the new behavior either fit the workflow or didn't? No need for a status report.`,
    week_3: `Hey ${firstName} — three weeks into the ${ctx.plan.name} rollout. Does this feel different now than it did at the start? Anything you'd push back on or refine?`,
  };
  return `${lines[kind]}\n\n(This is a verbatim relay — the AI layer is disabled on this Grasp instance, so the message is template-only. Reply if anything's worth talking through.)`;
}
