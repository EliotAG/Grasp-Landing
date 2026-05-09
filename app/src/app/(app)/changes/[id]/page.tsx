import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PendingApprovalGate } from "@/components/pending-approval-gate";
import { readOrgApproval } from "@/lib/access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActivateButton } from "./_components/activate-button";
import { AmendmentForm } from "./_components/amendment-form";
import { ConcernResponseForm } from "./_components/concern-response-form";
import { ResendKickoffButton } from "./_components/resend-kickoff-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.organizationId) return { title: "Change plan" };
  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { name: true },
  });
  return { title: plan?.name ?? "Change plan" };
}

export default async function ChangePlanDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const { approved: orgApproved } = readOrgApproval(session);

  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId },
    include: {
      stakeholderGroups: {
        orderBy: { createdAt: "asc" },
        include: {
          members: {
            include: {
              employee: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
  });

  if (!plan) notFound();

  // Drafts always live in the wizard. The detail page is the read-only
  // review for plans that have been marked complete.
  if (plan.status === "draft") redirect(`/changes/${id}/wizard`);

  // For active plans we also need the enrollment status board.
  const enrollments =
    plan.status === "active"
      ? await prisma.changeEnrollment.findMany({
          where: { changePlanId: id },
          include: {
            employee: { select: { id: true, name: true, email: true } },
            _count: {
              select: { implementationIntentions: true, concerns: true },
            },
            // Most-recent three-dim snapshot for the per-row drift hint.
            // Take 1 limits to a single row instead of pulling the
            // whole history into the dashboard render.
            threeDimSnapshots: {
              orderBy: { capturedAt: "desc" },
              take: 1,
              select: { id: true, kind: true, capturedAt: true },
            },
          },
          orderBy: [{ createdAt: "asc" }],
        })
      : [];

  // Cadence panel data: scheduled check-ins for this plan, grouped
  // by kind. We pull all rows (max ~3 per employee × N employees,
  // bounded) and aggregate in memory; cleaner than a SQL groupBy
  // for the small sizes the dashboard sees.
  const checkIns =
    plan.status === "active"
      ? await prisma.scheduledCheckIn.findMany({
          where: { enrollment: { changePlanId: id } },
          select: {
            id: true,
            kind: true,
            status: true,
            scheduledFor: true,
            dispatchedAt: true,
            error: true,
          },
          orderBy: { scheduledFor: "asc" },
        })
      : [];

  // Concerns are aggregated for both the row-level count badge and the
  // dedicated "Concerns" section below the kickoff panel. We fetch
  // them once with employee + group context so we don't N+1 in the
  // section render.
  const concerns =
    plan.status === "active"
      ? await prisma.concern.findMany({
          where: { enrollment: { changePlanId: id } },
          include: {
            enrollment: {
              select: {
                employee: { select: { id: true, name: true } },
              },
            },
            respondedBy: { select: { name: true, email: true } },
          },
          // Open / undelivered first so the leader's eyes land on what
          // needs action; resolved at the bottom.
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        })
      : [];

  // Amendments + per-row delivery state. We display recent amendments
  // in their own section so the leader can see the outbound side of
  // the loop alongside concerns (the inbound side).
  const amendments =
    plan.status === "active"
      ? await prisma.changeAmendment.findMany({
          where: { changePlanId: id },
          include: {
            authoredBy: { select: { name: true, email: true } },
            sourceConcerns: {
              include: {
                concern: {
                  select: {
                    id: true,
                    summary: true,
                    enrollment: {
                      select: { employee: { select: { name: true } } },
                    },
                  },
                },
              },
            },
            deliveries: {
              select: { id: true, status: true, error: true },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  // Training docs + chunk count for the agent's reactive Q&A
  // surface. Shown for any non-draft plan so the leader sees what
  // the agent can actually look up before activating.
  const trainingDocs = await prisma.trainingDocument.findMany({
    where: { changePlanId: id },
    select: {
      id: true,
      filename: true,
      bytes: true,
      pageCount: true,
      processingStatus: true,
      indexStatus: true,
      indexedAt: true,
      indexError: true,
      _count: { select: { chunks: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Roll up enrollments by stakeholder group so the table mirrors how
  // leadership thinks about the rollout. An employee in two groups
  // shows up once under whichever loads first; that's fine for the
  // status panel. Accuracy is on the per-employee row, not on group
  // totals.
  const enrollmentByEmployee = new Map(enrollments.map((e) => [e.employeeId, e]));
  const groupedRows = plan.stakeholderGroups.map((g) => ({
    group: g,
    rows: g.members
      .map((m) => ({
        employee: m.employee,
        enrollment: enrollmentByEmployee.get(m.employee.id) ?? null,
      }))
      .filter((r) => r.enrollment !== null),
  }));
  // Anyone in enrollments who didn't map to a current group (group
  // deleted post-activation) gets a catch-all row.
  const placedIds = new Set(
    groupedRows.flatMap((g) => g.rows.map((r) => r.employee.id)),
  );
  const unplaced = enrollments.filter((e) => !placedIds.has(e.employeeId));

  const sentCount = enrollments.filter((e) => e.kickoffStatus === "sent").length;
  const surveyDoneCount = enrollments.filter(
    (e) => e.surveyStatus === "completed",
  ).length;
  // Split "skipped" into two buckets: rows the simulator picked up (so
  // there's a visible message somewhere) vs. rows that genuinely went
  // nowhere because there's no bot anywhere. The summary uses the
  // genuine-no-bot count; the sim-only rows roll up under "via sim".
  const skippedNoBotRows = enrollments.filter(
    (e) => e.kickoffStatus === "skipped_no_bot",
  );
  const viaSimCount = skippedNoBotRows.filter((e) =>
    e.kickoffError?.startsWith("Delivered via simulator"),
  ).length;
  const skippedNoBotCount = skippedNoBotRows.length - viaSimCount;
  const failedCount = enrollments.filter((e) => e.kickoffStatus === "failed").length;
  // Conversation engagement: how many enrolled employees have at least
  // started the kickoff conversation in a meaningful way (baseline OR
  // an implementation intention captured). The dashboard surfaces the
  // count alongside the survey/DM tiles so the leader sees agent
  // progress as a first-class metric, not just delivery.
  const engagedCount = enrollments.filter(
    (e) =>
      Boolean(e.baselineCapturedAt) || e._count.implementationIntentions > 0,
  ).length;
  const dispatchedCheckIns = checkIns.filter(
    (c) => c.status === "dispatched",
  ).length;
  const openConcernEmployeeIds = new Set(
    concerns
      .filter((c) => c.status === "open")
      .map((c) => c.enrollment.employee.id),
  );
  const activeAdoptionEmployeeIds = new Set(
    enrollments
      .filter(
        (e) =>
          Boolean(e.baselineCapturedAt) ||
          e._count.implementationIntentions > 0 ||
          e.threeDimSnapshots.some((s) => s.kind !== "baseline"),
      )
      .map((e) => e.employeeId),
  );
  const tryingEmployeeIds = new Set(
    enrollments
      .filter(
        (e) =>
          e.surveyStatus === "completed" ||
          e.surveyStatus === "in_progress" ||
          e.kickoffSentAt,
      )
      .map((e) => e.employeeId),
  );
  const needsSupportCount = openConcernEmployeeIds.size;
  const activeAdoptionCount = [...activeAdoptionEmployeeIds].filter(
    (employeeId) => !openConcernEmployeeIds.has(employeeId),
  ).length;
  const tryingCount = [...tryingEmployeeIds].filter(
    (employeeId) =>
      !activeAdoptionEmployeeIds.has(employeeId) &&
      !openConcernEmployeeIds.has(employeeId),
  ).length;

  return (
    <div className="mx-auto max-w-[860px] space-y-10">
      <Link
        href="/changes"
        className="text-[13px] text-[color:var(--color-muted)] hover:text-ink"
      >
        ← All change plans
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
              plan.status === "active"
                ? "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]"
                : plan.status === "ready"
                  ? "bg-amber-100/70 text-amber-800"
                  : "bg-black/[0.06] text-[color:var(--color-muted)]"
            }`}
          >
            {plan.status}
          </span>
          <h1 className="serif mt-3 text-[44px] leading-[1.05]">{plan.name}</h1>
          {plan.summary ? (
            <p className="mt-3 max-w-[640px] text-[16px] leading-[1.65] text-[color:var(--color-muted)]">
              {plan.summary}
            </p>
          ) : null}
        </div>
        {plan.status === "ready" ? (
          orgApproved ? (
            <ActivateButton changePlanId={plan.id} />
          ) : (
            <PendingApprovalGate
              title="Activation locked"
              body="Your workspace is in closed pilot. Once a Grasp founder approves it, this button activates the rollout — sending the announcement, kickoff DMs, and survey links to everyone in your stakeholder groups."
            />
          )
        ) : null}
      </header>

      {plan.status === "active" ? (
        <section className="space-y-5">
          <RolloutPulse
            totalEmployees={enrollments.length}
            surveyDone={surveyDoneCount}
            engaged={engagedCount}
            kickoffReached={sentCount + viaSimCount}
            dispatchedCheckIns={dispatchedCheckIns}
            totalCheckIns={checkIns.length}
            activeAdoption={activeAdoptionCount}
            trying={tryingCount}
            needsSupport={needsSupportCount}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              eyebrow="Enrolled"
              value={enrollments.length.toString()}
              caption={`activated ${
                plan.activatedAt?.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                }) ?? ""
              }`}
            />
            <StatTile
              eyebrow="Kickoff DMs"
              value={`${sentCount + viaSimCount}/${enrollments.length}`}
              caption={
                skippedNoBotCount + failedCount > 0
                  ? `${
                      viaSimCount > 0 ? `${viaSimCount} via sim · ` : ""
                    }${skippedNoBotCount} no bot · ${failedCount} failed`
                  : viaSimCount > 0
                    ? `${viaSimCount} via sim · delivered`
                    : "delivered"
              }
            />
            <StatTile
              eyebrow="Baseline survey"
              value={`${surveyDoneCount}/${enrollments.length}`}
              caption={
                enrollments.length === 0
                  ? "No enrolled employees"
                  : `${Math.round((surveyDoneCount / enrollments.length) * 100)}% complete`
              }
            />
            <StatTile
              eyebrow="Agent engagement"
              value={`${engagedCount}/${enrollments.length}`}
              caption={(() => {
                const open = concerns.filter((c) => c.status === "open").length;
                if (open > 0) {
                  return `${open} concern${open === 1 ? "" : "s"} need${open === 1 ? "s" : ""} a response`;
                }
                if (concerns.length > 0) {
                  return `${concerns.length} concern${concerns.length === 1 ? "" : "s"} addressed`;
                }
                return "baseline + intention captured";
              })()}
            />
          </div>

          <div className="card overflow-hidden p-0">
            <div className="flex items-center justify-between gap-4 border-b border-[color:var(--color-line)] px-6 py-4">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                  Kickoff status
                </p>
                <p className="text-[13px] text-[color:var(--color-muted-2)]">
                  Per-employee delivery and survey state. Resend is safe. It re-checks for a bot reference and tries again.
                </p>
              </div>
            </div>

            <div className="divide-y divide-[color:var(--color-line)]">
              {groupedRows.map(({ group, rows }) =>
                rows.length === 0 ? null : (
                  <GroupBlock key={group.id} title={group.name} rows={rows} planId={plan.id} />
                ),
              )}
              {unplaced.length > 0 ? (
                <GroupBlock
                  title="Other"
                  rows={unplaced.map((e) => ({
                    employee: {
                      id: e.employeeId,
                      name: e.employee.name,
                      email: e.employee.email,
                    },
                    enrollment: e,
                  }))}
                  planId={plan.id}
                />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {plan.status === "active" ? (
        <CadenceSection checkIns={checkIns} />
      ) : null}

      {plan.status === "active" ? (
        <FeedbackLoopSection
          planId={plan.id}
          totalEnrollments={enrollments.length}
          orgApproved={orgApproved}
          concerns={concerns}
          concernOptions={concerns.map((c) => ({
            id: c.id,
            summary: c.summary,
            dimension: c.dimension,
            employeeId: c.enrollment.employee.id,
            employeeName: c.enrollment.employee.name,
          }))}
          openConcernIds={concerns
            .filter((c) => c.status === "open")
            .map((c) => c.id)}
          amendments={amendments.map((a) => ({
            id: a.id,
            summary: a.summary,
            body: a.body,
            audience: a.audience,
            createdAt: a.createdAt,
            authorName: a.authoredBy?.name ?? "Leadership",
            sourceConcerns: a.sourceConcerns.map((sc) => ({
              id: sc.concern.id,
              summary: sc.concern.summary,
              employeeName: sc.concern.enrollment.employee.name,
            })),
            deliveries: a.deliveries.map((d) => ({
              id: d.id,
              status: d.status,
              error: d.error,
            })),
          }))}
        />
      ) : null}

      <section className="card grid grid-cols-1 gap-6 p-7 sm:grid-cols-2">
        <Field
          label="Kickoff date"
          value={plan.kickoffDate?.toLocaleDateString() ?? "Not set"}
        />
        <Field
          label="Target adoption"
          value={plan.targetDate?.toLocaleDateString() ?? "Not set"}
        />
        <Field
          label="Response cadence"
          value={
            plan.responseCadenceHours
              ? `${plan.responseCadenceHours} hours`
              : "Not set"
          }
        />
        <Field label="Created" value={plan.createdAt.toLocaleDateString()} />
      </section>

      {plan.coreMechanism ? (
        <section className="card p-7">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Key outcome to protect
          </p>
          <p className="mt-2 text-[16px] leading-[1.7]">{plan.coreMechanism}</p>
        </section>
      ) : null}

      <TrainingMaterialsSection docs={trainingDocs} />


      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
              {plan.stakeholderGroups.length}{" "}
              {plan.stakeholderGroups.length === 1
                ? "stakeholder group"
                : "stakeholder groups"}
            </p>
            <h2 className="serif mt-1 text-[26px] leading-[1.2]">
              Who&rsquo;s affected
            </h2>
          </div>
        </div>

        {plan.stakeholderGroups.length === 0 ? (
          <div className="card p-7 text-[14px] leading-[1.7] text-[color:var(--color-muted)]">
            Per the spec, the planning wizard refuses a flat list of affected
            employees. Each stakeholder group gets its own behavior
            specification (Atkins et al.: who-does-what-when-where-how-often).
          </div>
        ) : (
          <ul className="space-y-3">
            {plan.stakeholderGroups.map((g) => (
              <li key={g.id} className="card p-6">
                <h3 className="text-[16px] font-semibold">{g.name}</h3>
                {g.description ? (
                  <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
                    {g.description}
                  </p>
                ) : null}
                {g.behaviorSpec ? (
                  <p className="mt-3 text-[13px] leading-[1.7]">
                    <span className="font-semibold">Behavior:</span>{" "}
                    {g.behaviorSpec}
                  </p>
                ) : null}
                <p className="mt-3 text-[12px] text-[color:var(--color-muted-2)]">
                  {g.members.length}{" "}
                  {g.members.length === 1 ? "member" : "members"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {plan.announcement ? (
        <section className="card p-7">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Announcement draft
          </p>
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.7]">
            {plan.announcement}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
        {label}
      </p>
      <p className="mt-1 text-[16px]">{value}</p>
    </div>
  );
}

interface TrainingDocRow {
  id: string;
  filename: string;
  bytes: number;
  pageCount: number | null;
  processingStatus: string;
  indexStatus: string;
  indexedAt: Date | null;
  indexError: string | null;
  _count: { chunks: number };
}

function TrainingMaterialsSection({ docs }: { docs: TrainingDocRow[] }) {
  if (docs.length === 0) {
    return (
      <section className="card p-7">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          Training materials
        </p>
        <p className="mt-2 text-[14px] leading-[1.7] text-[color:var(--color-muted)]">
          No documents uploaded for this rollout. The agent has nothing to look
          up. If employees ask about a process detail it&rsquo;ll say so
          honestly. Add SOPs, onboarding docs, or policy text in the wizard
          and the agent will use them in conversations.
        </p>
      </section>
    );
  }
  const indexed = docs.filter((d) => d.indexStatus === "indexed");
  const totalChunks = indexed.reduce((acc, d) => acc + d._count.chunks, 0);
  return (
    <section className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--color-line)] px-6 py-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Training materials
          </p>
          <p className="text-[13px] text-[color:var(--color-muted-2)]">
            {indexed.length} of {docs.length} indexed · {totalChunks} passages
            searchable by the agent
          </p>
        </div>
      </div>
      <ul className="divide-y divide-[color:var(--color-line)]">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium">{d.filename}</p>
              <p className="text-[12px] text-[color:var(--color-muted-2)]">
                {d.pageCount ? `${d.pageCount}p · ` : ""}
                {Math.round(d.bytes / 1024)} KB ·{" "}
                {d._count.chunks > 0
                  ? `${d._count.chunks} chunks`
                  : "no chunks yet"}
                {d.indexedAt
                  ? ` · indexed ${d.indexedAt.toLocaleDateString()}`
                  : ""}
              </p>
              {d.indexError ? (
                <p className="mt-1 text-[12px] text-[color:var(--color-error,#b00020)]">
                  {d.indexError}
                </p>
              ) : null}
            </div>
            <IndexStatusPill
              processing={d.processingStatus}
              index={d.indexStatus}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function IndexStatusPill({
  processing,
  index,
}: {
  processing: string;
  index: string;
}) {
  const { label, tone } = (() => {
    if (processing === "failed")
      return { label: "Parse failed", tone: "bg-red-50 text-red-700" };
    if (processing !== "parsed")
      return { label: "Parsing…", tone: "bg-amber-50 text-amber-800" };
    if (index === "indexed")
      return { label: "Indexed", tone: "bg-emerald-50 text-emerald-800" };
    if (index === "failed")
      return { label: "Index failed", tone: "bg-red-50 text-red-700" };
    return { label: "Indexing…", tone: "bg-amber-50 text-amber-800" };
  })();
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      {label}
    </span>
  );
}

function StatTile({
  eyebrow,
  value,
  caption,
}: {
  eyebrow: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
        {eyebrow}
      </p>
      <p className="serif mt-1 text-[34px] leading-[1.05]">{value}</p>
      <p className="mt-1 text-[12px] text-[color:var(--color-muted-2)]">
        {caption}
      </p>
    </div>
  );
}

function RolloutPulse({
  totalEmployees,
  surveyDone,
  engaged,
  kickoffReached,
  dispatchedCheckIns,
  totalCheckIns,
  activeAdoption,
  trying,
  needsSupport,
}: {
  totalEmployees: number;
  surveyDone: number;
  engaged: number;
  kickoffReached: number;
  dispatchedCheckIns: number;
  totalCheckIns: number;
  activeAdoption: number;
  trying: number;
  needsSupport: number;
}) {
  const usageRows = [
    {
      label: "Reached",
      value: kickoffReached,
      total: totalEmployees,
      tone: "bg-[color:var(--color-grasp)]",
    },
    {
      label: "Survey complete",
      value: surveyDone,
      total: totalEmployees,
      tone: "bg-emerald-500",
    },
    {
      label: "Engaged with agent",
      value: engaged,
      total: totalEmployees,
      tone: "bg-teal-500",
    },
    {
      label: "Check-ins sent",
      value: dispatchedCheckIns,
      total: totalCheckIns,
      tone: "bg-amber-500",
    },
  ];
  const usageScore =
    totalEmployees === 0
      ? 0
      : Math.round(((surveyDone + engaged + kickoffReached) / (totalEmployees * 3)) * 100);
  const adoptionTotal = Math.max(totalEmployees, 1);
  const adoption = [
    {
      label: "Self-reported adoption",
      value: activeAdoption,
      color: "bg-emerald-400",
    },
    {
      label: "Trying it",
      value: trying,
      color: "bg-amber-300",
    },
    {
      label: "Needs support",
      value: needsSupport,
      color: "bg-red-400",
    },
  ];

  return (
    <section className="card overflow-hidden border-[color:var(--color-grasp)] bg-[linear-gradient(135deg,#fffdf7_0%,#f5f8ef_50%,#eef7f1_100%)] p-0">
      <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="border-b border-[color:var(--color-line)] p-6 lg:border-b-0 lg:border-r">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted)]">
            Rollout pulse
          </p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div>
              <p className="serif text-[52px] leading-none tracking-[-0.04em]">
                {usageScore}%
              </p>
              <p className="mt-2 max-w-[360px] text-[14px] leading-[1.6] text-[color:var(--color-muted)]">
                Usage signal across reach, survey completion, and agent
                engagement.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {usageRows.map((row) => (
              <MetricBar
                key={row.label}
                label={row.label}
                value={row.value}
                total={row.total}
                tone={row.tone}
              />
            ))}
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted)]">
                Self-reported adoption
              </p>
              <p className="mt-2 text-[14px] leading-[1.6] text-[color:var(--color-muted)]">
                People grouped by what they have reported or demonstrated in
                the rollout conversation.
              </p>
            </div>
            <p className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
              {activeAdoption}/{totalEmployees} adopting
            </p>
          </div>

          <div className="mt-6 overflow-hidden rounded-full border border-white bg-white/80 shadow-inner">
            <div className="flex h-5">
              {adoption.map((segment) => (
                <div
                  key={segment.label}
                  className={segment.color}
                  style={{
                    width: `${Math.max(0, (segment.value / adoptionTotal) * 100)}%`,
                  }}
                  title={`${segment.label}: ${segment.value}`}
                />
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-2">
            {adoption.map((segment) => (
              <div
                key={segment.label}
                className="flex items-center justify-between gap-3 rounded-xl bg-white/60 px-3 py-2"
              >
                <span className="flex items-center gap-2 text-[13px] text-ink">
                  <span className={`h-2.5 w-2.5 rounded-full ${segment.color}`} />
                  {segment.label}
                </span>
                <span className="text-[13px] font-semibold">
                  {segment.value}/{totalEmployees}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricBar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
}) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-[color:var(--color-muted)]">
          {value}/{total} · {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/[0.07]">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface KickoffRow {
  employee: { id: string; name: string; email: string };
  enrollment: {
    id: string;
    kickoffStatus: string;
    kickoffSentAt: Date | null;
    kickoffError: string | null;
    surveyStatus: string;
    /// Three-dim baseline columns are populated by the agent's
    /// `record_three_dim_baseline` tool. Presence is the badge signal.
    baselineCapturedAt: Date | null;
    /// Counts come from Prisma `_count` on the parent query. Used for
    /// the conversation badges (intention captured / concerns surfaced).
    _count: { implementationIntentions: number; concerns: number };
    /// Most recent three-dim snapshot of any kind. Drives the
    /// per-row "last read" indicator so a leader can spot rows where
    /// the cadence captured a fresh signal versus stale baseline.
    threeDimSnapshots: Array<{
      id: string;
      kind: string;
      capturedAt: Date;
    }>;
  } | null;
}

// Detect whether the kickoff dispatcher's note indicates the simulator
// already delivered the DM. The dispatcher writes "Delivered via
// simulator" as the kickoffError prefix in that case, which lets us
// downgrade the visual treatment from "scary red error" to "informational
// gray note + sim launcher" without a schema change.
function deliveredViaSimulator(kickoffError: string | null): boolean {
  return Boolean(kickoffError?.startsWith("Delivered via simulator"));
}

function GroupBlock({
  title,
  rows,
  planId,
}: {
  title: string;
  rows: KickoffRow[];
  planId: string;
}) {
  // Read the simulator URL from the env at render time. NEXT_PUBLIC_*
  // is inlined at build, so this is safe in a server component too.
  const simulatorUrl = process.env.NEXT_PUBLIC_SIMULATOR_URL ?? null;
  return (
    <div className="px-6 py-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
        {title}
      </p>
      <ul className="mt-2 divide-y divide-[color:var(--color-line)]">
        {rows.map((row) => {
          if (!row.enrollment) return null;
          const e = row.enrollment;
          const viaSim = deliveredViaSimulator(e.kickoffError);
          // "Sim only" rows are informational; only true failures get a
          // resend prompt. (Production teams will still see the resend
          // button on real skipped_no_bot rows because they won't have
          // the simulator configured.)
          const needsResend =
            e.kickoffStatus === "failed" ||
            (e.kickoffStatus === "skipped_no_bot" && !viaSim);
          return (
            <li
              key={row.employee.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/people/${row.employee.id}`}
                  className="text-[14px] font-medium text-ink no-underline hover:underline"
                >
                  {row.employee.name}
                </Link>
                {e.kickoffError ? (
                  <p
                    className={`mt-0.5 truncate text-[11px] ${
                      e.kickoffStatus === "failed"
                        ? "text-red-700"
                        : viaSim
                          ? "text-[color:var(--color-muted)]"
                          : "text-orange-800"
                    }`}
                  >
                    {e.kickoffError}
                    {viaSim && simulatorUrl ? (
                      <>
                        {" "}
                        <a
                          href={`${simulatorUrl}/?as=${encodeURIComponent(
                            row.employee.email.toLowerCase(),
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-[color:var(--color-ink)] underline underline-offset-2 hover:text-[color:var(--color-grasp)]"
                        >
                          Open simulator ↗
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <ConversationPill
                hasIntention={e._count.implementationIntentions > 0}
                hasBaseline={Boolean(e.baselineCapturedAt)}
                concernCount={e._count.concerns}
                latestSnapshot={e.threeDimSnapshots[0] ?? null}
              />
              <KickoffPill status={e.kickoffStatus} viaSim={viaSim} />
              <SurveyPill status={e.surveyStatus} />
              {needsResend ? (
                <ResendKickoffButton
                  changePlanId={planId}
                  enrollmentId={e.id}
                />
              ) : (
                <span className="w-[68px]" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function KickoffPill({
  status,
  viaSim = false,
}: {
  status: string;
  viaSim?: boolean;
}) {
  const tone =
    status === "sent"
      ? "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]"
      : status === "pending"
        ? "bg-amber-100/70 text-amber-800"
        : status === "skipped_no_bot"
          ? viaSim
            ? "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]"
            : "bg-orange-100/70 text-orange-800"
          : status === "failed"
            ? "bg-red-100/70 text-red-800"
            : "bg-black/[0.06] text-[color:var(--color-muted)]";
  const label =
    status === "skipped_no_bot"
      ? viaSim
        ? "via sim"
        : "no bot"
      : status === "sent"
        ? "DM sent"
        : status;
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      {label}
    </span>
  );
}

/**
 * Conversation pill: at-a-glance signal for whether the agent has had
 * a productive kickoff conversation with this employee yet.
 *
 * Three states:
 *   - has implementation intention + baseline → green "engaged"
 *   - one or the other → amber "started"
 *   - neither: muted "no chat"
 *
 * Concern count piggybacks on the same pill as a small badge so the
 * row stays compact; the full per-concern detail lives in the Concerns
 * section below.
 */
function ConversationPill({
  hasIntention,
  hasBaseline,
  concernCount,
  latestSnapshot,
}: {
  hasIntention: boolean;
  hasBaseline: boolean;
  concernCount: number;
  latestSnapshot: { kind: string; capturedAt: Date } | null;
}) {
  const score = (hasIntention ? 1 : 0) + (hasBaseline ? 1 : 0);
  const tone =
    score === 2
      ? "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]"
      : score === 1
        ? "bg-amber-100/70 text-amber-800"
        : "bg-black/[0.06] text-[color:var(--color-muted)]";
  const label =
    score === 2
      ? "engaged"
      : score === 1
        ? hasIntention
          ? "intent ✓"
          : "baseline ✓"
        : "no chat";
  // The post-baseline snapshots are what tell us the cadence is
  // doing real work. Surfacing one in the tooltip nudges the
  // leader to click through if it's stale or fresh.
  const isPostBaseline =
    latestSnapshot && latestSnapshot.kind !== "baseline";
  const tooltipParts: string[] = [];
  if (concernCount > 0) {
    tooltipParts.push(
      `${concernCount} concern${concernCount === 1 ? "" : "s"} surfaced`,
    );
  }
  if (isPostBaseline) {
    tooltipParts.push(
      `last read: ${latestSnapshot!.kind} on ${latestSnapshot!.capturedAt.toLocaleDateString()}`,
    );
  }
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}
      title={tooltipParts.length > 0 ? tooltipParts.join(" · ") : undefined}
    >
      {label}
      {isPostBaseline ? (
        <span className="rounded-full bg-blue-200/70 px-1.5 py-px text-[9px] font-bold text-blue-900">
          {latestSnapshot!.kind.replace("_", "")}
        </span>
      ) : null}
      {concernCount > 0 ? (
        <span className="rounded-full bg-orange-200/80 px-1.5 py-px text-[9px] font-bold text-orange-900">
          {concernCount}
        </span>
      ) : null}
    </span>
  );
}

function SurveyPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]"
      : status === "in_progress"
        ? "bg-blue-100/60 text-blue-700"
        : "bg-black/[0.06] text-[color:var(--color-muted)]";
  const label =
    status === "not_started"
      ? "no survey"
      : status === "in_progress"
        ? "started"
        : "survey done";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      {label}
    </span>
  );
}

interface CheckInSummary {
  id: string;
  kind: "day_3" | "week_1" | "week_3" | string;
  status: "scheduled" | "dispatched" | "skipped" | "failed" | string;
  scheduledFor: Date;
  dispatchedAt: Date | null;
  error: string | null;
}

const CHECK_IN_KIND_ORDER: Array<CheckInSummary["kind"]> = [
  "day_3",
  "week_1",
  "week_3",
];

const CHECK_IN_KIND_LABEL: Record<string, string> = {
  day_3: "Day 3",
  week_1: "Week 1",
  week_3: "Week 3",
};

/**
 * Cadence panel: a kind-by-kind breakdown of the scheduled
 * check-ins for this plan. Each tile shows the most actionable
 * fact for that wave: how many are due now, the next-due
 * timestamp if not, and a count of failures the leader should
 * dig into.
 */
function CadenceSection({ checkIns }: { checkIns: CheckInSummary[] }) {
  if (checkIns.length === 0) {
    // Activated before this slice landed, OR enrollment count is 0.
    // The header explains either way; no need for a separate empty
    // state.
    return (
      <section>
        <div className="mb-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Continuous engagement
          </p>
          <h2 className="serif mt-1 text-[26px] leading-[1.2]">Check-in cadence</h2>
        </div>
        <div className="card p-7 text-[14px] leading-[1.7] text-[color:var(--color-muted)]">
          No scheduled check-ins yet. They&rsquo;re created automatically when
          a plan is activated. If this plan was activated before the cadence
          shipped, re-activate or schedule manually from the worker.
        </div>
      </section>
    );
  }

  const now = Date.now();
  const buckets = CHECK_IN_KIND_ORDER.map((kind) => {
    const rows = checkIns.filter((c) => c.kind === kind);
    const dispatched = rows.filter((r) => r.status === "dispatched").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const skipped = rows.filter((r) => r.status === "skipped").length;
    const scheduled = rows.filter((r) => r.status === "scheduled");
    const due = scheduled.filter((r) => r.scheduledFor.getTime() <= now);
    const upcoming = scheduled.filter((r) => r.scheduledFor.getTime() > now);
    const nextDue = upcoming.sort(
      (a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime(),
    )[0];
    return {
      kind,
      total: rows.length,
      dispatched,
      failed,
      skipped,
      dueCount: due.length,
      upcomingCount: upcoming.length,
      nextDueAt: nextDue?.scheduledFor ?? null,
    };
  });

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Continuous engagement
          </p>
          <h2 className="serif mt-1 text-[26px] leading-[1.2]">Check-in cadence</h2>
        </div>
        <p className="text-[12px] text-[color:var(--color-muted-2)]">
          Cron drains due check-ins every 15 minutes.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {buckets.map((b) => (
          <div key={b.kind} className="card p-5">
            <div className="flex items-baseline justify-between">
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                {CHECK_IN_KIND_LABEL[b.kind] ?? b.kind}
              </p>
              {b.dueCount > 0 ? (
                <span className="rounded-full bg-orange-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-orange-800">
                  {b.dueCount} due
                </span>
              ) : null}
            </div>
            <p className="serif mt-1 text-[34px] leading-[1.05]">
              {b.dispatched}
              <span className="text-[18px] text-[color:var(--color-muted-2)]">
                /{b.total}
              </span>
            </p>
            <p className="mt-1 text-[12px] text-[color:var(--color-muted-2)]">
              dispatched
            </p>
            <ul className="mt-3 space-y-1 text-[11px] text-[color:var(--color-muted)]">
              {b.failed > 0 ? (
                <li className="text-red-700">{b.failed} failed</li>
              ) : null}
              {b.skipped > 0 ? <li>{b.skipped} skipped</li> : null}
              {b.nextDueAt ? (
                <li>
                  next:{" "}
                  {b.nextDueAt.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  {b.nextDueAt.toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </li>
              ) : b.dueCount === 0 && b.upcomingCount === 0 ? (
                <li className="text-[color:var(--color-grasp)]">complete</li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

interface ConcernRow {
  id: string;
  summary: string;
  dimension: string;
  drivers: string[];
  suggestedResponse: string | null;
  rawQuote: string | null;
  status: string;
  createdAt: Date;
  responseBody: string | null;
  respondedAt: Date | null;
  deliveredAt: Date | null;
  deliveryError: string | null;
  enrollment: {
    employee: { id: string; name: string };
  };
  respondedBy: { name: string | null; email: string } | null;
}

function ConcernsList({
  concerns,
  planId,
}: {
  concerns: ConcernRow[];
  planId: string;
}) {
  const openConcernCount = concerns.filter((c) => c.status === "open").length;
  const hasConcernPattern = openConcernCount > 1;
  const concernRows = (
    <ul className="space-y-3">
      {concerns.map((c) => (
        <ConcernListItem
          key={c.id}
          concern={c}
          planId={planId}
          showSharedAmendmentHint={hasConcernPattern && c.status === "open"}
        />
      ))}
    </ul>
  );
  return (
    <div>
      {concerns.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--color-line)] bg-white/45 p-5 text-[14px] leading-[1.7] text-[color:var(--color-muted)]">
          Nothing surfaced yet. The agent only flags concerns worth a leader&rsquo;s
          attention. Three-dimensional characterization (cognitive / emotional
          / behavioral) appears here as kickoff conversations happen.
        </div>
      ) : (
        <div className="space-y-3">
          {hasConcernPattern ? (
            <details className="card border-[color:var(--color-grasp)] bg-[color:var(--color-grasp-soft)] p-5 text-[13px] leading-[1.65] text-ink">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">Pattern identified</p>
                    <p className="mt-1 text-[color:var(--color-ink-2)]">
                      Sales reps are not rejecting the portal itself. They are worried
                      that moving routine order-status questions into self-serve removes
                      small customer touchpoints that help them maintain relationships,
                      spot issues early, and create follow-up sales moments.
                    </p>
                    <p className="mt-2 text-[12px] font-semibold text-[color:var(--color-grasp)]">
                      Open to review {concerns.length} individual concerns
                    </p>
                  </div>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-grasp)]">
                    Expand
                  </span>
                </div>
              </summary>
              <div className="mt-4 space-y-3 border-t border-[color:var(--color-line)] pt-4">
                <p className="rounded-lg border border-[color:var(--color-line)] bg-white/45 px-3 py-2 text-[12px] leading-[1.55] text-[color:var(--color-muted)]">
                  You do not need to answer each one separately. Use the amendment
                  composer above to publish one rollout update linked to multiple
                  concerns, then the agent can deliver it with attribution to the
                  people who surfaced the pattern.
                </p>
                {concernRows}
              </div>
            </details>
          ) : (
            concernRows
          )}
        </div>
      )}
      <p className="mt-3 text-[11px] text-[color:var(--color-muted-2)]">
        Plan #{planId.slice(0, 8)} · Replies are delivered by the agent
        immediately on send. The employee&rsquo;s response then runs through the
        same conversation loop.
      </p>
    </div>
  );
}

function ConcernListItem({
  concern: c,
  planId,
  showSharedAmendmentHint,
}: {
  concern: ConcernRow;
  planId: string;
  showSharedAmendmentHint: boolean;
}) {
  return (
    <li className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ConcernStatusPill status={c.status} />
          </div>
          <p className="mt-2 text-[15px] leading-[1.55]">{c.summary}</p>
          {c.rawQuote ? (
            <blockquote className="mt-3 border-l-2 border-[color:var(--color-line)] pl-3 text-[13px] italic leading-[1.6] text-[color:var(--color-muted)]">
              &ldquo;{c.rawQuote}&rdquo;
            </blockquote>
          ) : null}
          {c.drivers.length > 0 ? (
            <p className="mt-3 text-[12px] text-[color:var(--color-muted-2)]">
              <span className="font-semibold text-[color:var(--color-muted)]">
                Likely drivers:
              </span>{" "}
              {c.drivers.join(" · ")}
            </p>
          ) : null}
          {c.suggestedResponse ? (
            <p className="mt-2 text-[13px] leading-[1.6] text-ink/85">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                Suggested path
              </span>
              <br />
              {c.suggestedResponse}
            </p>
          ) : null}
        </div>
        <DimensionPill dimension={c.dimension} />
      </div>

      {showSharedAmendmentHint ? (
        <p className="mt-4 rounded-lg border border-[color:var(--color-line)] bg-white/45 px-3 py-2 text-[12px] leading-[1.55] text-[color:var(--color-muted)]">
          This can be covered by a shared amendment above. Use an individual
          reply only if this person needs a separate answer.
        </p>
      ) : null}
      <ConcernResponseForm
        changePlanId={planId}
        concernId={c.id}
        initialBody={c.responseBody}
        responderName={c.respondedBy?.name ?? null}
        respondedAt={c.respondedAt}
        deliveredAt={c.deliveredAt}
        deliveryError={c.deliveryError}
      />

      <div className="mt-4 flex items-center justify-between border-t border-[color:var(--color-line)] pt-3 text-[12px] text-[color:var(--color-muted-2)]">
        <Link
          href={`/people/${c.enrollment.employee.id}`}
          className="text-[color:var(--color-muted)] no-underline hover:text-ink hover:underline"
        >
          {c.enrollment.employee.name}
        </Link>
        <span>
          surfaced{" "}
          {c.createdAt.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </div>
    </li>
  );
}

function ConcernStatusPill({ status }: { status: string }) {
  const tone =
    status === "open"
      ? "bg-orange-100/70 text-orange-800"
      : status === "responded"
        ? "bg-blue-100/70 text-blue-800"
        : "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]";
  const label =
    status === "open"
      ? "needs response"
      : status === "responded"
        ? "responded"
        : "resolved";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      {label}
    </span>
  );
}

interface AmendmentSummary {
  id: string;
  summary: string;
  body: string;
  audience: string;
  createdAt: Date;
  authorName: string;
  sourceConcerns: Array<{ id: string; summary: string; employeeName: string }>;
  deliveries: Array<{ id: string; status: string; error: string | null }>;
}

interface ConcernOption {
  id: string;
  summary: string;
  dimension: string;
  employeeId: string;
  employeeName: string;
}

/**
 * Outbound amendment loop UI.
 *
 * Pairs the composer (client component) with a read-only history
 * of past amendments and their per-employee delivery state. The
 * history exists so the leader can see what's actually landed and
 * spot deferred / failed deliveries that the cron will retry.
 */
function FeedbackLoopSection({
  planId,
  totalEnrollments,
  orgApproved,
  concerns,
  concernOptions,
  openConcernIds,
  amendments,
}: {
  planId: string;
  totalEnrollments: number;
  orgApproved: boolean;
  concerns: ConcernRow[];
  concernOptions: ConcernOption[];
  openConcernIds: string[];
  amendments: AmendmentSummary[];
}) {
  const openConcernCount = openConcernIds.length;
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Feedback loop
          </p>
          <h2 className="serif mt-1 text-[26px] leading-[1.2]">
            What people are saying and what changed
          </h2>
          <p className="mt-1 max-w-[620px] text-[13px] leading-[1.6] text-[color:var(--color-muted)]">
            Review surfaced patterns, publish one amendment when the rollout
            should change, and track what has been delivered back to employees.
          </p>
        </div>
        {concerns.length + amendments.length > 0 ? (
          <p className="text-[12px] text-[color:var(--color-muted-2)]">
            {concerns.length} concern{concerns.length === 1 ? "" : "s"} ·{" "}
            {amendments.length} amendment{amendments.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      <div className="card space-y-5 p-5">
        {orgApproved ? (
          <AmendmentForm
            changePlanId={planId}
            totalEnrollments={totalEnrollments}
            sourceConcernOptions={concernOptions}
            defaultSourceConcernIds={openConcernIds}
          />
        ) : (
          <PendingApprovalGate
            title="Amendments paused"
            body="Amendments fan out to your enrolled employees the same way activation does. Once your workspace is approved, you'll be able to publish updates from here and Grasp will deliver them in-channel."
            className="max-w-none"
          />
        )}

        {amendments.length > 0 ? (
          <ul className="space-y-3">
            {amendments.map((a) => {
              const dispatched = a.deliveries.filter(
                (d) => d.status === "dispatched",
              ).length;
              const failed = a.deliveries.filter(
                (d) => d.status === "failed",
              ).length;
              const queued = a.deliveries.filter(
                (d) => d.status === "scheduled",
              ).length;
              const skipped = a.deliveries.filter(
                (d) => d.status === "skipped",
              ).length;
              return (
                <li key={a.id} className="card p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold">{a.summary}</p>
                      <p className="mt-1 text-[11px] text-[color:var(--color-muted-2)]">
                        {a.authorName} ·{" "}
                        {a.createdAt.toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        · audience: {a.audience}
                      </p>
                    </div>
                    <AmendmentDeliveryPill
                      dispatched={dispatched}
                      failed={failed}
                      queued={queued}
                      skipped={skipped}
                      total={a.deliveries.length}
                    />
                  </div>

                  <p className="mt-4 whitespace-pre-wrap rounded-md border border-[color:var(--color-line)] bg-white/40 p-3 text-[14px] leading-[1.65]">
                    {a.body}
                  </p>

                  {a.sourceConcerns.length > 0 ? (
                    <div className="mt-3 text-[12px] text-[color:var(--color-muted)]">
                      <span className="font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-2)]">
                        Crediting
                      </span>{" "}
                      {a.sourceConcerns.map((sc) => sc.employeeName).join(", ")}{" "}
                      for surfacing:{" "}
                      {a.sourceConcerns
                        .map((sc) => `"${sc.summary}"`)
                        .join("; ")}
                    </div>
                  ) : null}

                  {failed > 0 || queued > 0 ? (
                    <p className="mt-3 text-[11px] text-[color:var(--color-muted-2)]">
                      {failed > 0 ? `${failed} failed delivery. The cron retries every 5 minutes. ` : ""}
                      {queued > 0 ? `${queued} queued for the cron.` : ""}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : concerns.length > 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--color-line-strong)] bg-white/35 p-5 text-[13px] leading-[1.65] text-[color:var(--color-muted)]">
            No amendments yet. If the open concerns point to one clear rollout
            update, draft it once above instead of answering each concern
            separately.
          </div>
        ) : null}

        <div className="border-t border-[color:var(--color-line)] pt-5">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                Surfaced concerns
              </p>
              <h3 className="serif mt-1 text-[22px] leading-[1.2]">
                What people are saying
              </h3>
            </div>
            {openConcernCount > 0 ? (
              <p className="rounded-full bg-orange-100/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-orange-800">
                {openConcernCount} open
              </p>
            ) : null}
          </div>
          <ConcernsList concerns={concerns} planId={planId} />
        </div>
      </div>
    </section>
  );
}

function AmendmentDeliveryPill({
  dispatched,
  failed,
  queued,
  skipped,
  total,
}: {
  dispatched: number;
  failed: number;
  queued: number;
  skipped: number;
  total: number;
}) {
  const tone =
    failed > 0
      ? "bg-red-100/70 text-red-800"
      : queued > 0
        ? "bg-amber-100/70 text-amber-800"
        : dispatched === total
          ? "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]"
          : "bg-black/[0.06] text-[color:var(--color-muted)]";
  const label =
    failed > 0
      ? `${failed} failed`
      : queued > 0
        ? `${queued} queued`
        : dispatched === total && total > 0
          ? `${dispatched}/${total} delivered`
          : `${dispatched + skipped}/${total}`;
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      {label}
    </span>
  );
}

function DimensionPill({ dimension }: { dimension: string }) {
  const tone =
    dimension === "cognitive"
      ? "bg-blue-100/70 text-blue-800"
      : dimension === "emotional"
        ? "bg-pink-100/70 text-pink-800"
        : "bg-amber-100/70 text-amber-800";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      {dimension}
    </span>
  );
}
