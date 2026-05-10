/**
 * Hydrates everything the agent needs to know about an in-flight
 * change conversation with a specific employee.
 *
 * One enrollment = one (employee, change plan) pair. The agent's
 * "memory" is that enrollment plus the on-disk message history; we
 * don't lean on Anthropic's caching or model memory for any persisted
 * state.
 *
 * `loadAgentContext` returns null when the email doesn't resolve to an
 * active enrollment. Callers (sim webhook, Teams message handler)
 * should treat that as "we hear you but you're not currently in a
 * rollout" and respond accordingly.
 */

import type { ScheduledCheckInKind, ThreeDimSnapshotKind } from "@prisma/client";

import { prisma } from "@/lib/db";

export interface AgentEmployee {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  title: string | null;
  microsoftAadObjectId: string | null;
  microsoftUserPrincipalName: string | null;
  teamsAppInstallationId: string | null;
  teamsAppInstalledAt: Date | null;
}

export interface AgentChangePlan {
  id: string;
  name: string;
  summary: string | null;
  announcement: string | null;
  coreMechanism: string | null;
  responseCadenceHours: number | null;
  kickoffDate: Date | null;
  targetDate: Date | null;
  organizationName: string;
}

export interface AgentStakeholderGroup {
  id: string;
  name: string;
  description: string | null;
  behaviorSpec: string | null;
}

/**
 * A direct report of this employee who is also enrolled in the SAME
 * change plan. Drives the "you are also a manager in this rollout"
 * prompt block — present only when the array is non-empty.
 */
export interface AgentDirectReport {
  id: string;
  name: string;
  title: string | null;
  /// Stakeholder group the report belongs to in this plan, when
  /// resolvable. Null when the report isn't mapped to any group on
  /// this plan (rare, but possible if they were enrolled directly).
  stakeholderGroupName: string | null;
}

/**
 * Survey-derived profile used to branch the system prompt.
 *
 * The values are read off the `BaselineSurveyResponse.causalityOrientation`
 * JSON. We tolerate the survey not being completed yet — the agent
 * just falls back to neutral framing.
 */
export interface AgentProfile {
  surveyCompleted: boolean;
  /// "autonomy" | "control" | "impersonal" | null
  dominantCausality: string | null;
  /// Oreg RTC composite, 1–6 scale (higher = more change-resistant).
  rtcScore: number | null;
  /// Free-text channel preference if the survey asked. We surface
  /// this verbatim into the prompt so the agent matches the tone.
  channelPreference: string | null;
  /// Free-text "ideal time of day" answer.
  preferredTimeOfDay: string | null;
}

/**
 * Leadership reply to a previously-surfaced concern that hasn't yet
 * been delivered to this employee. The agent surfaces it on the next
 * turn (proactive or user-initiated) and we mark it `deliveredAt`
 * once the channel ack comes back.
 */
export interface PendingLeadershipResponse {
  concernId: string;
  concernSummary: string;
  concernDimension: string;
  concernRawQuote: string | null;
  /// Verbatim reply from leadership. The agent must NOT paraphrase
  /// this away — it can frame and contextualize, but the substance
  /// must reach the employee.
  responseBody: string;
  /// Display name of the responder (or "Leadership" if unknown).
  /// The agent surfaces by name only when asked.
  responderName: string;
  respondedAt: Date;
}

/**
 * Leadership-authored amendment to the change itself, scheduled to
 * be delivered to this employee but not yet pushed to a channel.
 *
 * The agent surfaces these on its next turn (proactive or
 * user-initiated), framing the verbatim leadership update with
 * attribution back to the concerns that prompted it.
 */
export interface PendingAmendment {
  /// AmendmentDelivery row id — the dispatcher uses this to mark the
  /// row dispatched after the channel ack lands.
  deliveryId: string;
  amendmentId: string;
  /// Short human label for the amendment, dashboard-style.
  summary: string;
  /// Verbatim leadership update. Agent MUST surface this intact.
  body: string;
  /// Display name of the leader who authored it (or "Leadership").
  authorName: string;
  /// True when this employee's own prior concern(s) drove the
  /// amendment — the agent should explicitly credit them.
  surfacedByEmployee: boolean;
  /// Concern summaries this employee personally surfaced that
  /// motivated the amendment. Empty when not credited.
  creditedConcernSummaries: string[];
  createdAt: Date;
}

export interface AgentContext {
  enrollmentId: string;
  employee: AgentEmployee;
  plan: AgentChangePlan;
  /// First (and usually only) stakeholder group this employee belongs
  /// to within this plan. The agent uses this group's behaviorSpec as
  /// the "specific behavior we're talking about" anchor.
  stakeholderGroup: AgentStakeholderGroup | null;
  /// All groups in the plan — handy when the agent needs to refer to
  /// other groups' behaviors ("sales managers will be reviewing your
  /// logs weekly", etc).
  allGroups: AgentStakeholderGroup[];
  profile: AgentProfile;
  /// Whether the agent has already captured a three-dim baseline for
  /// this employee in this change. When true, the agent should not
  /// re-elicit; when false, it should weave the elicitation in.
  hasBaseline: boolean;
  /// Whether at least one implementation intention is on file. When
  /// true, the agent should reference / refine rather than re-elicit.
  hasImplementationIntention: boolean;
  /// Concerns where leadership has replied but we haven't yet
  /// delivered the reply to this employee. The agent must surface
  /// these on its next turn.
  pendingLeadershipResponses: PendingLeadershipResponse[];
  /// Concerns the agent has already DELIVERED a response for and is
  /// waiting on the employee to react. The agent surfaces these so
  /// it can call `mark_concern_resolved` with the real id when the
  /// employee signals satisfaction. Excludes concerns already
  /// resolved or still open.
  awaitingResolutionConcerns: AwaitingResolutionConcern[];
  /// First three-dim snapshot, captured at kickoff. Null until the
  /// agent has run the kickoff baseline tool.
  baselineSnapshot: ThreeDimSnapshotSummary | null;
  /// Most recent three-dim snapshot of any kind (baseline counts
  /// when nothing else exists). Distinct from `baselineSnapshot`
  /// once a check-in capture overlays it. Used to spot drift.
  latestSnapshot: ThreeDimSnapshotSummary | null;
  /// Set when this context was loaded by the scheduled check-in
  /// runner. Drives the prompt seed and the snapshot kind written
  /// by `record_three_dim_response`.
  activeCheckIn: ActiveCheckIn | null;
  /// Leadership amendments scheduled for this employee but not yet
  /// delivered. The agent must surface them on its next turn.
  pendingAmendments: PendingAmendment[];
  /// Roll-up of leadership-uploaded training docs for this plan.
  /// Drives the prompt's "you can look this up" framing — without
  /// it the agent has no way to know the lookup tool is worth
  /// reaching for.
  trainingCorpus: TrainingCorpusSummary;
  /// Direct reports of this employee who are also enrolled in the
  /// same plan. Empty for individual contributors and for managers
  /// whose reports happen not to be in this rollout's audience.
  directReportsInPlan: AgentDirectReport[];
}

export interface TrainingCorpusSummary {
  /// Number of docs whose chunk index is ready (`indexStatus = indexed`).
  indexedDocCount: number;
  /// Total chunks across those docs — rough proxy for how much
  /// detail the agent has access to.
  indexedChunkCount: number;
  /// Filenames of indexed docs (capped, for the prompt summary).
  filenames: string[];
  /// True when at least one doc is still pending or failed indexing
  /// — the agent should know "more is coming" so it doesn't claim
  /// the corpus is final.
  hasPending: boolean;
}

export interface AwaitingResolutionConcern {
  concernId: string;
  summary: string;
  dimension: string;
  deliveredAt: Date;
}

/**
 * Three-dimensional snapshot capture (Piderit). The agent reads
 * the baseline + most recent capture to spot drift across the
 * cadence ("at kickoff she said tired-but-game; at day 3 she's
 * frustrated").
 */
export interface ThreeDimSnapshotSummary {
  id: string;
  kind: ThreeDimSnapshotKind;
  cognitive: string;
  emotional: string;
  behavioral: string;
  capturedAt: Date;
}

/**
 * The check-in kind currently being run, when this context was
 * loaded by the scheduled-check-in dispatcher. Lets the
 * `record_three_dim_response` tool stamp the right kind on the
 * snapshot it writes, and lets the prompt builder include the
 * cadence-aware seed instructions.
 */
export interface ActiveCheckIn {
  id: string;
  kind: ScheduledCheckInKind;
}

export interface LoadAgentContextOptions {
  /// Set by the scheduled check-in runner so the agent knows which
  /// check-in is in flight (drives snapshot kind + prompt seed).
  activeCheckIn?: ActiveCheckIn;
  /// Pin the context load to one specific enrollment instead of the
  /// "most recently activated active plan" default. Used by the
  /// inbound-message router when it has explicitly chosen which
  /// rollout an ambiguous message belongs to.
  enrollmentId?: string;
}

/**
 * Resolve a Grasp employee email to an `AgentContext` for their most
 * recent active enrollment, or null when there's no active rollout
 * involving them.
 *
 * Active = parent ChangePlan.status === 'active'. We pick the most
 * recently activated plan when the employee is in more than one
 * (sequential rollouts is the v1 default per the spec, but data-wise
 * nothing prevents overlap).
 */
/**
 * Lightweight per-enrollment summary for the inbound message router.
 *
 * Built for the case where one employee is enrolled in multiple
 * active change plans simultaneously. The router needs enough context
 * to disambiguate which rollout a user's ambiguous message refers to,
 * but NOT the full prompt-building payload that `loadAgentContext`
 * assembles. Keeping this tight matters because we send N of these
 * to a small Claude call on every multi-rollout inbound message.
 */
export interface ActiveEnrollmentSummary {
  enrollmentId: string;
  changePlanId: string;
  planName: string;
  /// Two-sentence summary the planner authored at announcement time.
  planSummary: string | null;
  /// One-line "the actual behavior we want" anchor. Distinguishing
  /// signal when two plans share generic names like "Q3 rollout".
  coreMechanism: string | null;
  kickoffDate: Date | null;
  targetDate: Date | null;
  /// Stakeholder group label this employee belongs to on this plan.
  /// Helps the router infer rollout scope ("Sales managers" vs
  /// "Engineering ICs") from terms in the user's message.
  stakeholderGroupName: string | null;
  /// Snippet of the most recent agent message in this enrollment's
  /// transcript (any role). Capped to a short preview so the router
  /// has recency context without ballooning the prompt.
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
}

const LAST_MESSAGE_PREVIEW_CHARS = 240;

export async function loadActiveEnrollmentSummariesByEmployeeId(
  employeeId: string,
): Promise<ActiveEnrollmentSummary[]> {
  const enrollments = await prisma.changeEnrollment.findMany({
    where: {
      employeeId,
      changePlan: { status: "active" },
    },
    orderBy: { changePlan: { activatedAt: "desc" } },
    include: {
      changePlan: {
        select: {
          id: true,
          name: true,
          summary: true,
          coreMechanism: true,
          kickoffDate: true,
          targetDate: true,
          stakeholderGroups: {
            include: {
              members: {
                where: { employeeId },
                select: { employeeId: true },
              },
            },
          },
        },
      },
    },
  });
  if (enrollments.length === 0) return [];

  // One small query per enrollment to pull the freshest message
  // preview. We don't `groupBy` because we need the actual content
  // string, not just metadata, and the per-employee enrollment fan-out
  // is small (typically 1–3) at MLP volume.
  const summaries = await Promise.all(
    enrollments.map(async (e) => {
      const lastMsg = await prisma.agentMessage.findFirst({
        where: { enrollmentId: e.id },
        orderBy: { createdAt: "desc" },
        select: { content: true, createdAt: true, role: true },
      });
      const memberGroup = e.changePlan.stakeholderGroups.find(
        (g) => g.members.length > 0,
      );
      return {
        enrollmentId: e.id,
        changePlanId: e.changePlan.id,
        planName: e.changePlan.name,
        planSummary: e.changePlan.summary,
        coreMechanism: e.changePlan.coreMechanism,
        kickoffDate: e.changePlan.kickoffDate,
        targetDate: e.changePlan.targetDate,
        stakeholderGroupName: memberGroup?.name ?? null,
        lastMessagePreview: lastMsg
          ? truncatePreview(lastMsg.content, LAST_MESSAGE_PREVIEW_CHARS)
          : null,
        lastMessageAt: lastMsg?.createdAt ?? null,
      } satisfies ActiveEnrollmentSummary;
    }),
  );
  return summaries;
}

export async function loadActiveEnrollmentSummariesByEmail(
  email: string,
): Promise<ActiveEnrollmentSummary[]> {
  const employee = await prisma.employee.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!employee) return [];
  return loadActiveEnrollmentSummariesByEmployeeId(employee.id);
}

function truncatePreview(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export async function loadAgentContextByEmail(
  email: string,
  options: LoadAgentContextOptions = {},
): Promise<AgentContext | null> {
  const employee = await prisma.employee.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: AGENT_EMPLOYEE_SELECT,
  });
  if (!employee) return null;
  return loadAgentContextForEmployee(employee, options);
}

export async function loadAgentContextByEmployeeId(
  employeeId: string,
  options: LoadAgentContextOptions = {},
): Promise<AgentContext | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: AGENT_EMPLOYEE_SELECT,
  });
  if (!employee) return null;
  return loadAgentContextForEmployee(employee, options);
}

const AGENT_EMPLOYEE_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  email: true,
  title: true,
  microsoftAadObjectId: true,
  microsoftUserPrincipalName: true,
  teamsAppInstallationId: true,
  teamsAppInstalledAt: true,
} as const;

async function loadAgentContextForEmployee(
  employee: {
    id: string;
    organizationId: string;
    name: string;
    email: string;
    title: string | null;
    microsoftAadObjectId: string | null;
    microsoftUserPrincipalName: string | null;
    teamsAppInstallationId: string | null;
    teamsAppInstalledAt: Date | null;
  },
  options: LoadAgentContextOptions,
): Promise<AgentContext | null> {
  // When `enrollmentId` is pinned, look up that specific enrollment
  // (and confirm the plan is still active and belongs to this
  // employee). Otherwise pick the most recently activated active plan
  // — the legacy default for users with at most one rollout.
  const enrollment = options.enrollmentId
    ? await prisma.changeEnrollment.findFirst({
        where: {
          id: options.enrollmentId,
          employeeId: employee.id,
          changePlan: { status: "active" },
        },
        include: {
          response: true,
          changePlan: {
            include: {
              organization: { select: { name: true } },
              stakeholderGroups: {
                include: {
                  members: {
                    where: { employeeId: employee.id },
                    select: { employeeId: true },
                  },
                },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      })
    : await prisma.changeEnrollment.findFirst({
        where: {
          employeeId: employee.id,
          changePlan: { status: "active" },
        },
        orderBy: { changePlan: { activatedAt: "desc" } },
        include: {
          response: true,
          changePlan: {
            include: {
              organization: { select: { name: true } },
              stakeholderGroups: {
                include: {
                  members: {
                    where: { employeeId: employee.id },
                    select: { employeeId: true },
                  },
                },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      });
  if (!enrollment) return null;

  const allGroups: AgentStakeholderGroup[] = enrollment.changePlan.stakeholderGroups.map(
    (g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      behaviorSpec: g.behaviorSpec,
    }),
  );
  const memberGroup =
    enrollment.changePlan.stakeholderGroups.find((g) => g.members.length > 0) ?? null;

  // Derive profile from survey JSON. The wizard / survey form persists
  // these as free-form JSON columns; we narrow defensively here so a
  // schema drift doesn't crash the agent.
  const causality = enrollment.response?.causalityOrientation as
    | { subscale?: { autonomy?: number; control?: number; impersonal?: number } }
    | null
    | undefined;
  const dominant = pickDominant(causality?.subscale);
  const oreg = enrollment.response?.oregRtc as
    | { score?: number }
    | null
    | undefined;
  const prefs = enrollment.response?.workingPreferences as
    | { channelPreference?: string; preferredTimeOfDay?: string }
    | null
    | undefined;

  // Cheap "have we done baseline / intention yet" lookups + pending
  // and awaiting-resolution concerns + snapshot history. Parallel
  // because independent.
  const [
    intentionCount,
    pendingResponses,
    awaitingResolution,
    snapshotRows,
    pendingAmendmentRows,
    trainingDocs,
    indexedChunkCount,
    directReportRows,
  ] = await Promise.all([
    prisma.implementationIntention.count({
      where: { enrollmentId: enrollment.id },
    }),
    prisma.concern.findMany({
      where: {
        enrollmentId: enrollment.id,
        respondedAt: { not: null },
        deliveredAt: null,
      },
      include: {
        respondedBy: { select: { name: true } },
      },
      orderBy: { respondedAt: "asc" },
    }),
    prisma.concern.findMany({
      where: {
        enrollmentId: enrollment.id,
        status: "responded",
        deliveredAt: { not: null },
      },
      orderBy: { deliveredAt: "asc" },
      select: {
        id: true,
        summary: true,
        dimension: true,
        deliveredAt: true,
      },
    }),
    // Two snapshots are enough for drift framing in the prompt:
    // the baseline (or oldest) and the latest. We could fetch all
    // and let the prompt builder pick, but cap the read since the
    // table grows over time.
    prisma.threeDimSnapshot.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { capturedAt: "asc" },
    }),
    // Amendments scheduled for delivery to this enrollment but not
    // yet dispatched. Agent must surface them on the next turn. We
    // pull the amendment + author + the source concerns that
    // belong to THIS enrollment so the agent can credit the
    // employee's own surfacing where appropriate.
    prisma.amendmentDelivery.findMany({
      where: {
        enrollmentId: enrollment.id,
        status: "scheduled",
      },
      orderBy: { createdAt: "asc" },
      include: {
        amendment: {
          include: {
            authoredBy: { select: { name: true } },
            sourceConcerns: {
              include: {
                concern: {
                  select: {
                    id: true,
                    summary: true,
                    enrollmentId: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    // Training-doc summary for the prompt's lookup-tool block.
    // We pull lightweight metadata for ALL docs on the plan (so we
    // can flag pending / failed) and a separate count of chunks
    // backing the indexed subset. Both are cheap on the corpus
    // sizes we expect at MLP volume.
    prisma.trainingDocument.findMany({
      where: { changePlanId: enrollment.changePlan.id },
      select: { id: true, filename: true, indexStatus: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.trainingDocumentChunk.count({
      where: {
        trainingDocument: {
          changePlanId: enrollment.changePlan.id,
          indexStatus: "indexed",
        },
      },
    }),
    // Direct reports who are also enrolled in this plan. Drives the
    // manager prompt block. We only need name/title for display and
    // the report's stakeholder group on THIS plan for context — the
    // agent doesn't need their full profile.
    prisma.employee.findMany({
      where: {
        managerEmployeeId: employee.id,
        changeEnrollments: {
          some: { changePlanId: enrollment.changePlan.id },
        },
      },
      select: {
        id: true,
        name: true,
        title: true,
        stakeholderMemberships: {
          where: {
            stakeholderGroup: { changePlanId: enrollment.changePlan.id },
          },
          select: { stakeholderGroup: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Most recent dispatched check-in inside the conversation window.
  // If the agent's last proactive nudge was within ~48 hours, ANY
  // snapshot the agent captures from the next user-initiated turn
  // should be stamped with that check-in's kind — the user is still
  // responding to it. We look this up unconditionally so a regular
  // webhook-triggered turn (e.g. user reply to the day-3 message)
  // gets the right snapshot kind without the caller having to know.
  let inferredActiveCheckIn: ActiveCheckIn | null = null;
  if (!options.activeCheckIn) {
    const recent = await prisma.scheduledCheckIn.findFirst({
      where: {
        enrollmentId: enrollment.id,
        status: "dispatched",
        dispatchedAt: {
          gte: new Date(Date.now() - 48 * 60 * 60 * 1000),
          not: null,
        },
      },
      orderBy: { dispatchedAt: "desc" },
      select: { id: true, kind: true, dispatchedAt: true },
    });
    if (recent) {
      // Skip if a snapshot of this kind already exists since the
      // dispatch — the conversation has already produced its
      // capture and any further snapshots should be ad_hoc.
      const alreadyCaptured = snapshotRows.some(
        (s) =>
          s.kind === recent.kind &&
          recent.dispatchedAt !== null &&
          s.capturedAt >= recent.dispatchedAt,
      );
      if (!alreadyCaptured) {
        inferredActiveCheckIn = { id: recent.id, kind: recent.kind };
      }
    }
  }
  const hasBaseline =
    Boolean(enrollment.baselineCognitive) ||
    Boolean(enrollment.baselineEmotional) ||
    Boolean(enrollment.baselineBehavioral);
  const pendingLeadershipResponses: PendingLeadershipResponse[] =
    pendingResponses.map((c) => ({
      concernId: c.id,
      concernSummary: c.summary,
      concernDimension: c.dimension,
      concernRawQuote: c.rawQuote,
      responseBody: c.responseBody ?? "",
      responderName: c.respondedBy?.name ?? "Leadership",
      respondedAt: c.respondedAt!,
    }));

  return {
    enrollmentId: enrollment.id,
    employee: {
      id: employee.id,
      organizationId: employee.organizationId,
      name: employee.name,
      email: employee.email,
      title: employee.title,
      microsoftAadObjectId: employee.microsoftAadObjectId,
      microsoftUserPrincipalName: employee.microsoftUserPrincipalName,
      teamsAppInstallationId: employee.teamsAppInstallationId,
      teamsAppInstalledAt: employee.teamsAppInstalledAt,
    },
    plan: {
      id: enrollment.changePlan.id,
      name: enrollment.changePlan.name,
      summary: enrollment.changePlan.summary,
      announcement: enrollment.changePlan.announcement,
      coreMechanism: enrollment.changePlan.coreMechanism,
      responseCadenceHours: enrollment.changePlan.responseCadenceHours,
      kickoffDate: enrollment.changePlan.kickoffDate,
      targetDate: enrollment.changePlan.targetDate,
      organizationName: enrollment.changePlan.organization.name,
    },
    stakeholderGroup: memberGroup
      ? {
          id: memberGroup.id,
          name: memberGroup.name,
          description: memberGroup.description,
          behaviorSpec: memberGroup.behaviorSpec,
        }
      : null,
    allGroups,
    profile: {
      surveyCompleted: Boolean(enrollment.response),
      dominantCausality: dominant,
      rtcScore: typeof oreg?.score === "number" ? oreg.score : null,
      channelPreference: prefs?.channelPreference ?? null,
      preferredTimeOfDay: prefs?.preferredTimeOfDay ?? null,
    },
    hasBaseline,
    hasImplementationIntention: intentionCount > 0,
    pendingLeadershipResponses,
    awaitingResolutionConcerns: awaitingResolution.map((c) => ({
      concernId: c.id,
      summary: c.summary,
      dimension: c.dimension,
      deliveredAt: c.deliveredAt!,
    })),
    // Prefer a real baseline-kind snapshot row; fall back to a
    // synthesized summary built from the denormalized baseline*
    // columns on the enrollment. This bridges plans that captured
    // their baseline before the ThreeDimSnapshot table existed —
    // without it, the response tool would think there's no baseline
    // and re-fire the kickoff path.
    baselineSnapshot: (() => {
      const real = snapshotRows.find((s) => s.kind === "baseline");
      if (real) return toSnapshotSummary(real);
      if (
        enrollment.baselineCognitive &&
        enrollment.baselineEmotional &&
        enrollment.baselineBehavioral &&
        enrollment.baselineCapturedAt
      ) {
        return {
          id: `legacy:${enrollment.id}`,
          kind: "baseline" as const,
          cognitive: enrollment.baselineCognitive,
          emotional: enrollment.baselineEmotional,
          behavioral: enrollment.baselineBehavioral,
          capturedAt: enrollment.baselineCapturedAt,
        };
      }
      return null;
    })(),
    latestSnapshot:
      snapshotRows.length > 0
        ? toSnapshotSummary(snapshotRows[snapshotRows.length - 1])
        : null,
    activeCheckIn: options.activeCheckIn ?? inferredActiveCheckIn,
    trainingCorpus: (() => {
      const indexed = trainingDocs.filter((d) => d.indexStatus === "indexed");
      const pending = trainingDocs.some((d) => d.indexStatus !== "indexed");
      return {
        indexedDocCount: indexed.length,
        indexedChunkCount,
        // Cap the filename list — the prompt only needs enough
        // context to know what the agent CAN look up, not the
        // entire corpus inventory.
        filenames: indexed.slice(0, 12).map((d) => d.filename),
        hasPending: pending,
      } satisfies TrainingCorpusSummary;
    })(),
    pendingAmendments: pendingAmendmentRows.map((row) => {
      const ownConcerns = row.amendment.sourceConcerns
        .filter((sc) => sc.concern.enrollmentId === enrollment.id)
        .map((sc) => sc.concern.summary);
      return {
        deliveryId: row.id,
        amendmentId: row.amendmentId,
        summary: row.amendment.summary,
        body: row.amendment.body,
        authorName: row.amendment.authoredBy?.name ?? "Leadership",
        surfacedByEmployee: ownConcerns.length > 0,
        creditedConcernSummaries: ownConcerns,
        createdAt: row.createdAt,
      } satisfies PendingAmendment;
    }),
    directReportsInPlan: directReportRows.map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      stakeholderGroupName:
        row.stakeholderMemberships[0]?.stakeholderGroup.name ?? null,
    })),
  };
}

function toSnapshotSummary(row: {
  id: string;
  kind: ThreeDimSnapshotKind;
  cognitive: string;
  emotional: string;
  behavioral: string;
  capturedAt: Date;
}): ThreeDimSnapshotSummary {
  return {
    id: row.id,
    kind: row.kind,
    cognitive: row.cognitive,
    emotional: row.emotional,
    behavioral: row.behavioral,
    capturedAt: row.capturedAt,
  };
}

function pickDominant(
  subscale: { autonomy?: number; control?: number; impersonal?: number } | undefined,
): string | null {
  if (!subscale) return null;
  const entries = Object.entries(subscale).filter(
    ([, v]) => typeof v === "number",
  ) as [string, number][];
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}
