/**
 * Kickoff DM dispatch.
 *
 * Once a change plan flips to `active`, every ChangeEnrollment row
 * (one per affected employee) needs a 1:1 Teams DM with the
 * announcement, leadership's response-cadence commitment, and a
 * personal link to the baseline survey.
 *
 * The send is best-effort per-row: a missing TeamsConversationReference
 * (employee never installed the bot) marks the row `skipped_no_bot` so
 * leadership can hit Resend later. A connector-level failure marks it
 * `failed` with the error string for triage.
 *
 * Concurrency is intentionally small (KICKOFF_BATCH_SIZE) so a 200-
 * person fan-out doesn't burst the Bot Connector and so any single bad
 * conversation reference doesn't take down the rest of the batch.
 */

import { ChangeEnrollmentKickoffStatus } from "@prisma/client";

import { getOrganizationPrimaryTextChannel } from "@/lib/channels";
import { prisma } from "@/lib/db";
import { sendSimMessage } from "@/lib/integrations/simulator";
import {
  SlackSendError,
  sendSlackMessageByEmployee,
} from "@/lib/slack/proactive";
import {
  describeSlackConfigProblem,
  getOrganizationSlackConfig,
} from "@/lib/slack/integration";
import {
  TeamsSendError,
  sendTeamsMessageByReferenceId,
} from "@/lib/teams/proactive";
import {
  ensureTeamsAppInstalledForEmployee,
  resolveTeamsReferenceForEmployee,
} from "@/lib/teams/bootstrap";
import {
  describeTeamsConfigProblem,
  getOrganizationTeamsConfig,
} from "@/lib/teams/integration";

const KICKOFF_BATCH_SIZE = 8;

/**
 * Best-effort canonical URL for the survey link in the DM body.
 *
 * - In production we expect AUTH_URL set (Auth.js already requires it).
 * - In dev we fall back to localhost. Set AUTH_URL / NEXTAUTH_URL to override,
 *   otherwise PORT lets the survey link follow the active dev server.
 */
function appBaseUrl(): string {
  const url =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (url) return url.replace(/\/$/, "");
  const port = process.env.PORT?.trim() || "3001";
  return `http://localhost:${port}`;
}

function formatVoiceSlot(date: Date): string {
  // Tighter than toLocaleString defaults — we want "Tue, May 13, 9:30 AM".
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

interface DispatchSummary {
  total: number;
  sent: number;
  skippedNoBot: number;
  failed: number;
}

/**
 * Send the kickoff DM to every `pending` enrollment for this plan.
 *
 * Safe to re-run: only enrollments still in `pending` are touched, so
 * a partial fan-out can be resumed by calling this again.
 */
export async function sendKickoffDms(
  changePlanId: string,
): Promise<DispatchSummary> {
  const plan = await prisma.changePlan.findUnique({
    where: { id: changePlanId },
    select: {
      id: true,
      announcement: true,
      responseCadenceHours: true,
      voiceKickoffEnabled: true,
    },
  });
  if (!plan) throw new Error("Change plan not found");

  const enrollments = await prisma.changeEnrollment.findMany({
    where: {
      changePlanId,
      kickoffStatus: ChangeEnrollmentKickoffStatus.pending,
    },
    include: {
      employee: true,
      scheduledVoiceCall: {
        select: {
          id: true,
          scheduledFor: true,
          meetingJoinUrl: true,
          inviteSentAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const summary: DispatchSummary = {
    total: enrollments.length,
    sent: 0,
    skippedNoBot: 0,
    failed: 0,
  };

  // Manager-first tier flush. Depth = how many transitive ancestors
  // are themselves enrolled in this plan. Top-of-rollout (managers
  // whose own manager is outside the plan) is depth 0; their reports
  // are depth 1; reports-of-reports are depth 2; etc. We send one
  // tier at a time so a report never receives the kickoff DM before
  // their manager has, even if it costs us serial latency between
  // tiers. Within a tier we fall back to the existing batch loop and
  // createdAt ordering.
  const enrolledIds = new Set(enrollments.map((e) => e.employeeId));
  const employeeById = new Map(
    enrollments.map((e) => [e.employeeId, e.employee]),
  );

  function depthOf(employeeId: string): number {
    let depth = 0;
    const seen = new Set<string>([employeeId]);
    let cursor = employeeById.get(employeeId)?.managerEmployeeId ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (enrolledIds.has(cursor)) depth += 1;
      cursor = employeeById.get(cursor)?.managerEmployeeId ?? null;
    }
    return depth;
  }

  const tiers = new Map<number, typeof enrollments>();
  for (const e of enrollments) {
    const d = depthOf(e.employeeId);
    if (!tiers.has(d)) tiers.set(d, []);
    tiers.get(d)!.push(e);
  }
  const orderedDepths = [...tiers.keys()].sort((a, b) => a - b);

  for (const d of orderedDepths) {
    const tier = tiers.get(d)!;
    for (let i = 0; i < tier.length; i += KICKOFF_BATCH_SIZE) {
      const batch = tier.slice(i, i + KICKOFF_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((e) =>
          sendOne(
            e.id,
            e.employee,
            {
              announcement: plan.announcement,
              responseCadenceHours: plan.responseCadenceHours,
              surveyToken: e.surveyToken,
              voice: pickVoiceContext(
                plan.voiceKickoffEnabled,
                e.scheduledVoiceCall,
              ),
            },
          ),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value === "sent") summary.sent += 1;
          else if (r.value === "skipped_no_bot") summary.skippedNoBot += 1;
          else summary.failed += 1;
        } else {
          summary.failed += 1;
        }
      }
    }
  }

  return summary;
}

/**
 * Single-enrollment dispatch (also used by the "Resend DM" button on
 * the kickoff status panel).
 */
export async function sendKickoffDmForEnrollment(
  enrollmentId: string,
): Promise<"sent" | "skipped_no_bot" | "failed"> {
  const enrollment = await prisma.changeEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      employee: true,
      changePlan: {
        select: {
          announcement: true,
          responseCadenceHours: true,
          voiceKickoffEnabled: true,
        },
      },
      scheduledVoiceCall: {
        select: {
          id: true,
          scheduledFor: true,
          meetingJoinUrl: true,
          inviteSentAt: true,
        },
      },
    },
  });
  if (!enrollment) throw new Error("Enrollment not found");
  return sendOne(
    enrollment.id,
    enrollment.employee,
    {
      announcement: enrollment.changePlan.announcement,
      responseCadenceHours: enrollment.changePlan.responseCadenceHours,
      surveyToken: enrollment.surveyToken,
      voice: pickVoiceContext(
        enrollment.changePlan.voiceKickoffEnabled,
        enrollment.scheduledVoiceCall,
      ),
    },
  );
}

/**
 * Distill the (voice-enabled, scheduled-row) pair into either a DM
 * voice block or null. Voice is ONLY included in the DM when the
 * Graph invite step has actually succeeded (`meetingJoinUrl` and
 * `inviteSentAt` both populated). A row that exists but failed
 * to send the calendar invite shouldn't make us claim "I've put a
 * meeting on your calendar."
 */
function pickVoiceContext(
  enabled: boolean,
  row: {
    scheduledFor: Date;
    meetingJoinUrl: string | null;
    inviteSentAt: Date | null;
  } | null,
): DmContext["voice"] {
  if (!enabled || !row) return null;
  if (!row.meetingJoinUrl || !row.inviteSentAt) return null;
  return {
    scheduledFor: row.scheduledFor,
    meetingUrl: row.meetingJoinUrl,
  };
}

interface DmContext {
  announcement: string | null;
  responseCadenceHours: number | null;
  surveyToken: string;
  /**
   * When voice kickoff is enabled AND we successfully sent the
   * Outlook calendar invite via Graph, the DM body names the slot
   * and surfaces the join URL inline. The actual calendar event
   * (with proper RSVP) is delivered by Outlook, not by this DM —
   * this is just the chat-side complement.
   */
  voice: {
    scheduledFor: Date;
    meetingUrl: string;
  } | null;
}

async function sendOne(
  enrollmentId: string,
  employee: {
    id: string;
    organizationId: string;
    email: string;
    name: string;
    microsoftAadObjectId: string | null;
    microsoftUserPrincipalName: string | null;
    teamsAppInstallationId: string | null;
    teamsAppInstalledAt: Date | null;
  },
  ctx: DmContext,
): Promise<"sent" | "skipped_no_bot" | "failed"> {
  const body = renderKickoffDm(ctx);

  // Mirror to the simulator (parallel channel). We AWAIT the result so
  // we can record whether the simulator actually accepted the DM — that
  // turns the "no Teams bot installed" status from a scary red error
  // into a friendly "delivered via simulator" note when running locally.
  const simResult = await sendSimMessage({
    email: employee.email,
    name: employee.name,
    text: body,
    kind: "kickoff",
  });
  if (!simResult.ok && !simResult.skipped) {
    console.error(
      "[sim] kickoff mirror failed:",
      simResult.error ?? simResult.status,
    );
  }
  const simDelivered = simResult.ok && !simResult.skipped;

  const primaryChannel = await getOrganizationPrimaryTextChannel(
    employee.organizationId,
  );

  if (primaryChannel === "slack") {
    const slackConfig = await getOrganizationSlackConfig(employee.organizationId);
    const slackProblem = describeSlackConfigProblem(slackConfig);
    if (slackProblem) {
      await prisma.changeEnrollment.update({
        where: { id: enrollmentId },
        data: {
          kickoffStatus: ChangeEnrollmentKickoffStatus.skipped_no_bot,
          kickoffError: simDelivered
            ? `Delivered via simulator. (${slackProblem})`
            : slackProblem,
          kickoffSentAt: simDelivered ? new Date() : null,
        },
      });
      return "skipped_no_bot";
    }

    try {
      await sendSlackMessageByEmployee(employee, body);
      await prisma.changeEnrollment.update({
        where: { id: enrollmentId },
        data: {
          kickoffStatus: ChangeEnrollmentKickoffStatus.sent,
          kickoffSentAt: new Date(),
          kickoffError: null,
        },
      });
      return "sent";
    } catch (err) {
      const message =
        err instanceof SlackSendError || err instanceof Error
          ? err.message
          : "Unknown Slack send error";
      console.error("[slack] kickoff send failed:", message);
      await prisma.changeEnrollment.update({
        where: { id: enrollmentId },
        data: {
          kickoffStatus: ChangeEnrollmentKickoffStatus.failed,
          kickoffError: simDelivered
            ? `Slack send failed: ${message}. (Delivered via simulator for testing.)`
            : message,
        },
      });
      return "failed";
    }
  }

  const teamsConfig = await getOrganizationTeamsConfig(employee.organizationId);
  const teamsProblem = describeTeamsConfigProblem(teamsConfig);
  if (teamsProblem) {
    await prisma.changeEnrollment.update({
      where: { id: enrollmentId },
      data: {
        kickoffStatus: ChangeEnrollmentKickoffStatus.skipped_no_bot,
        kickoffError: simDelivered
          ? `Delivered via simulator. (${teamsProblem})`
          : teamsProblem,
        kickoffSentAt: simDelivered ? new Date() : null,
      },
    });
    return "skipped_no_bot";
  }

  let ref = await resolveTeamsReferenceForEmployee(employee);

  let bootstrapMessage: string | null = null;
  if (!ref) {
    const bootstrap = await ensureTeamsAppInstalledForEmployee(employee);
    bootstrapMessage = bootstrap.message;
    ref = await resolveTeamsReferenceForEmployee(employee);
  }

  if (!ref) {
    const issue =
      bootstrapMessage ??
      (employee.teamsAppInstalledAt || employee.teamsAppInstallationId
        ? "Grasp is installed for this user, but Teams has not delivered the bot conversation reference yet."
        : "Grasp could not bootstrap Teams for this user. Check Teams settings for Graph permission or user-resolution errors.");
    await prisma.changeEnrollment.update({
      where: { id: enrollmentId },
      data: {
        kickoffStatus: ChangeEnrollmentKickoffStatus.skipped_no_bot,
        // Channel-aware note: in dev with the simulator the message
        // landed somewhere visible, so don't alarm the leader. Without
        // the simulator we keep the production-style instruction.
        kickoffError: simDelivered
          ? `Delivered via simulator. (${issue})`
          : issue,
        // Stamp sent-at when at least the simulator delivered, so the
        // dashboard's "delivered" timestamp reflects when the DM
        // actually went out — not just the Teams channel.
        kickoffSentAt: simDelivered ? new Date() : null,
      },
    });
    return "skipped_no_bot";
  }

  try {
    await sendTeamsMessageByReferenceId(ref.id, body);
    await prisma.changeEnrollment.update({
      where: { id: enrollmentId },
      data: {
        kickoffStatus: ChangeEnrollmentKickoffStatus.sent,
        kickoffSentAt: new Date(),
        kickoffError: null,
      },
    });
    return "sent";
  } catch (err) {
    const message =
      err instanceof TeamsSendError || err instanceof Error
        ? err.message
        : "Unknown send error";
    await prisma.changeEnrollment.update({
      where: { id: enrollmentId },
      data: {
        kickoffStatus: ChangeEnrollmentKickoffStatus.failed,
        // If sim succeeded but Teams failed, callers still see the row
        // as "failed" (Teams is the prod channel) but get a hint that
        // the test surface received it.
        kickoffError: simDelivered
          ? `Teams send failed: ${message}. (Delivered via simulator for testing.)`
          : message,
      },
    });
    return "failed";
  }
}

function renderKickoffDm(ctx: DmContext): string {
  const surveyUrl = `${appBaseUrl()}/s/${ctx.surveyToken}`;
  const announcement = (ctx.announcement ?? "").trim();
  const cadenceLine = ctx.responseCadenceHours
    ? `Leadership has committed to responding to questions or concerns within ${ctx.responseCadenceHours} hours. I'll make sure your input reaches them.`
    : "Leadership has committed to a response cadence and I'll make sure your input reaches them.";

  const lines: string[] = [
    announcement || "Leadership is rolling out a new change.",
    "",
    cadenceLine,
    "",
  ];

  if (ctx.voice) {
    // The real calendar event is delivered by Outlook (we created it
    // via Graph at activation). This block is the chat-side
    // complement: it names the slot in the same DM thread the
    // employee is reading, and surfaces a Join link inline so they
    // can click through without opening their calendar.
    lines.push(
      `I've also put a voice kickoff on your calendar for ${formatVoiceSlot(
        ctx.voice.scheduledFor,
      )} — check your Outlook for the meeting invite (you can Accept or Decline there). I'll join the meeting at that time and we can talk through the change live.`,
      "",
      `Join link: ${ctx.voice.meetingUrl}`,
      "",
      `In the meantime, I'd like to learn a bit about how you work and how you tend to experience change. It takes about 3 minutes and the answers stay between us. I use them to tailor how I check in with you.`,
      "",
      surveyUrl,
    );
  } else {
    lines.push(
      `Before we get going, I'd like to learn a bit about how you work and how you tend to experience change. It takes about 3 minutes and the answers stay between us. I use them to tailor how I check in with you.`,
      "",
      surveyUrl,
    );
  }

  return lines.join("\n");
}

