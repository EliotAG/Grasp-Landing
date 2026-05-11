/**
 * Voice-kickoff scheduling.
 *
 * Materializes one `ScheduledVoiceCall` row per affected enrollment and
 * — through Microsoft Graph — creates a per-employee Teams online
 * meeting and sends a real Outlook calendar invite with the meeting
 * URL embedded.
 *
 * Two-phase: (1) DB rows go in first inside a transaction, (2) Graph
 * calls happen after commit because they're external network IO and
 * we don't want a slow tenant to deadlock the activation. Per-row
 * Graph failures don't roll back the whole plan — the row stays
 * `scheduled` with `inviteError` populated, the dispatcher skips
 * rows missing `meetingJoinUrl`, and a future "resend invite"
 * dashboard action can retry.
 *
 * Order matches the kickoff-DM tier flush in [kickoff.ts]: depth-0
 * managers (those whose own manager is outside the plan) get the
 * earliest slots, then depth-1 reports, etc.
 *
 * Idempotent on retries: createMany uses the `enrollmentId` unique,
 * and the Graph step short-circuits when `meetingJoinUrl` is already
 * set. Safe to call twice.
 */

import { prisma } from "@/lib/db";
import {
  createCalendarEvent,
  createOnlineMeeting,
  GraphClientError,
  explainGraphError,
} from "@/lib/graph/client";
import { getOrganizationTeamsConfig } from "@/lib/teams/integration";

export interface VoiceScheduleSummary {
  scheduled: number;
  invited: number;
  inviteFailed: number;
  skipped: number;
  reason?:
    | "voice_disabled"
    | "no_enrollments"
    | "graph_not_configured"
    | "no_organizer";
}

/**
 * Kick off voice scheduling for a plan. Pulls plan + enrollments,
 * stages slot times manager-first, persists `ScheduledVoiceCall`
 * rows, then fans out per-row Graph calls to create Teams meetings
 * and send Outlook invites.
 */
export async function scheduleVoiceCallsForPlan(
  changePlanId: string,
): Promise<VoiceScheduleSummary> {
  const plan = await prisma.changePlan.findUnique({
    where: { id: changePlanId },
    select: {
      id: true,
      name: true,
      summary: true,
      voiceKickoffEnabled: true,
      voiceKickoffStartOffsetMinutes: true,
      voiceKickoffStaggerMinutes: true,
      voiceKickoffDurationMinutes: true,
      activatedAt: true,
      activatedBy: { select: { email: true, name: true } },
      organization: { select: { id: true, name: true } },
    },
  });
  if (!plan) throw new Error("Change plan not found");
  if (!plan.voiceKickoffEnabled) {
    return {
      scheduled: 0,
      invited: 0,
      inviteFailed: 0,
      skipped: 0,
      reason: "voice_disabled",
    };
  }
  const teamsConfig = await getOrganizationTeamsConfig(plan.organization.id);
  if (!teamsConfig.credentials) {
    return {
      scheduled: 0,
      invited: 0,
      inviteFailed: 0,
      skipped: 0,
      reason: "graph_not_configured",
    };
  }
  const organizerUpn =
    teamsConfig.voiceOrganizerUpn?.trim() ?? plan.activatedBy?.email?.trim();
  if (!organizerUpn) {
    return {
      scheduled: 0,
      invited: 0,
      inviteFailed: 0,
      skipped: 0,
      reason: "no_organizer",
    };
  }

  const enrollments = await prisma.changeEnrollment.findMany({
    where: { changePlanId },
    include: {
      employee: {
        select: { id: true, name: true, email: true, managerEmployeeId: true },
      },
      scheduledVoiceCall: {
        select: { id: true, meetingJoinUrl: true, graphEventId: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (enrollments.length === 0) {
    return {
      scheduled: 0,
      invited: 0,
      inviteFailed: 0,
      skipped: 0,
      reason: "no_enrollments",
    };
  }

  // Manager-first tier ordering. Mirrors `sendKickoffDms` so the
  // earliest slots go to enrollment-tree roots.
  const enrolledIds = new Set(enrollments.map((e) => e.employeeId));
  const managerByEmployeeId = new Map(
    enrollments.map((e) => [e.employeeId, e.employee.managerEmployeeId]),
  );
  function depthOf(employeeId: string): number {
    let depth = 0;
    const seen = new Set<string>([employeeId]);
    let cursor = managerByEmployeeId.get(employeeId) ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (enrolledIds.has(cursor)) depth += 1;
      cursor = managerByEmployeeId.get(cursor) ?? null;
    }
    return depth;
  }

  const ordered = [...enrollments]
    .map((e, originalIdx) => ({ e, originalIdx, depth: depthOf(e.employeeId) }))
    .sort((a, b) =>
      a.depth !== b.depth ? a.depth - b.depth : a.originalIdx - b.originalIdx,
    );

  const baseStart = new Date(
    (plan.activatedAt ?? new Date()).getTime() +
      plan.voiceKickoffStartOffsetMinutes * 60_000,
  );
  const durationMin = plan.voiceKickoffDurationMinutes;

  // Phase 1: insert ScheduledVoiceCall rows for any enrollment that
  // doesn't yet have one. We do this BEFORE any Graph IO so a
  // partial Graph fan-out can be resumed by re-running this fn.
  const newRows: Array<{
    enrollmentId: string;
    changePlanId: string;
    scheduledFor: Date;
  }> = [];
  ordered.forEach(({ e }, slotIdx) => {
    if (e.scheduledVoiceCall) return;
    newRows.push({
      enrollmentId: e.id,
      changePlanId,
      scheduledFor: new Date(
        baseStart.getTime() + slotIdx * plan.voiceKickoffStaggerMinutes * 60_000,
      ),
    });
  });
  if (newRows.length > 0) {
    await prisma.scheduledVoiceCall.createMany({
      data: newRows,
      skipDuplicates: true,
    });
  }

  // Phase 2: re-read the rows + per-row Graph fan-out. Sequential,
  // not parallel: tenants can throttle aggressively and a 50-person
  // burst is not worth the risk vs. ~50 sequential 200ms calls.
  const rows = await prisma.scheduledVoiceCall.findMany({
    where: { changePlanId },
    include: {
      enrollment: {
        include: {
          employee: { select: { name: true, email: true } },
        },
      },
    },
  });

  const summary: VoiceScheduleSummary = {
    scheduled: rows.length,
    invited: 0,
    inviteFailed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    if (row.meetingJoinUrl && row.graphEventId) {
      summary.invited += 1;
      continue;
    }
    try {
      const start = row.scheduledFor;
      const end = new Date(start.getTime() + durationMin * 60_000);
      const subject = `Grasp kickoff: ${plan.name}`;

      // 1. Create the unique Teams meeting on the organizer's
      //    calendar (the activator). Returns the join URL we
      //    embed in everything downstream.
      const meeting = await createOnlineMeeting({
        organizerUpn,
        subject,
        start,
        end,
        credentials: teamsConfig.credentials,
      });

      // 2. Send the actual calendar invite to the employee. Outlook
      //    fans out the invite as a real RSVP-able event — this is
      //    the part the .ics-attachment hack couldn't do.
      const event = await createCalendarEvent({
        organizerUpn,
        attendeeEmail: row.enrollment.employee.email,
        attendeeName: row.enrollment.employee.name,
        subject,
        bodyHtml: renderInviteBody({
          firstName:
            row.enrollment.employee.name.split(" ")[0] ||
            row.enrollment.employee.name,
          planName: plan.name,
          planSummary: plan.summary,
          joinUrl: meeting.joinWebUrl,
          durationMin,
        }),
        start,
        end,
        joinUrl: meeting.joinWebUrl,
        credentials: teamsConfig.credentials,
      });

      await prisma.scheduledVoiceCall.update({
        where: { id: row.id },
        data: {
          meetingJoinUrl: meeting.joinWebUrl,
          graphMeetingId: meeting.id,
          graphEventId: event.id,
          inviteSentAt: new Date(),
          inviteError: null,
        },
      });
      summary.invited += 1;
    } catch (err) {
      const message =
        err instanceof GraphClientError
          ? explainGraphError(err, organizerUpn)
          : err instanceof Error
            ? err.message
            : "Graph invite failed";
      console.error(
        "[voice/schedule] Graph invite failed for row",
        row.id,
        message,
      );
      await prisma.scheduledVoiceCall.update({
        where: { id: row.id },
        data: { inviteError: message },
      });
      summary.inviteFailed += 1;
    }
  }

  return summary;
}

function renderInviteBody(input: {
  firstName: string;
  planName: string;
  planSummary: string | null;
  joinUrl: string;
  durationMin: number;
}): string {
  // Outlook renders the body as HTML; keep markup minimal and inline
  // because some Outlook clients strip <style>.
  const summary = input.planSummary?.trim()
    ? `<p>About this rollout: ${escapeHtml(input.planSummary.trim())}</p>`
    : "";
  return [
    `<p>Hi ${escapeHtml(input.firstName)},</p>`,
    `<p>This is a ${input.durationMin}-minute voice kickoff for the &quot;${escapeHtml(input.planName)}&quot; rollout. Grasp will join the Teams meeting at the start time to talk you through the change live. The conversation gets summarized back into your Grasp thread when we&rsquo;re done.</p>`,
    summary,
    `<p><a href="${escapeAttr(input.joinUrl)}">Join the Teams meeting</a></p>`,
    `<p style="color:#666;font-size:12px">If you can&rsquo;t make this slot, just decline this invite. You&rsquo;ll still get the regular Grasp text DM with the announcement and survey link.</p>`,
  ].join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
