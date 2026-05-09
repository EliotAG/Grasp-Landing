import Link from "next/link";
import {
  AmendmentDeliveryStatus,
  CheckInStatus,
  VoiceCallStatus,
} from "@prisma/client";

import {
  activateReadyPlanAction,
  cancelAmendmentAction,
  cancelCheckInAction,
  cancelVoiceCallAction,
  sendAmendmentNowAction,
  sendCheckInNowAction,
  sendVoiceCallNowAction,
} from "./actions";
import { requireAgentGraspAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";

export const metadata = { title: "Admin" };

const LOOKAHEAD_DAYS = 7;
const TABLE_LIMIT = 25;

export default async function AdminDashboard() {
  const session = await requireAgentGraspAdmin();
  const data = await loadAdminDashboard();

  return (
    <main className="mx-auto max-w-[1320px] px-6 py-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-grasp)]">
            Grasp operator console
          </p>
          <h1 className="serif mt-2 text-[46px] leading-[1.02]">
            Cron state and <span className="italic">upcoming sends.</span>
          </h1>
          <p className="mt-3 max-w-[720px] text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
            Signed in as {session.user.email}. This view is global across all
            organizations and only available to @agentgrasp.com accounts.
          </p>
        </div>
        <Link href="/dashboard" className="btn btn-secondary">
          Back to app
        </Link>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {data.cronCards.map((card) => (
          <CronCard key={card.label} card={card} />
        ))}
      </section>

      <section className="mt-10 grid gap-6 xl:grid-cols-2">
        <Panel
          title="Ready rollouts"
          subtitle={`Kickoff dates in the next ${LOOKAHEAD_DAYS} days`}
          empty="No ready rollouts are scheduled soon."
        >
          {data.readyPlans.map((plan) => (
            <ReadyPlanRow key={plan.id} plan={plan} />
          ))}
        </Panel>

        <Panel
          title="Scheduled check-ins"
          subtitle="Due now or within the lookahead window"
          empty="No check-ins are due soon."
        >
          {data.checkIns.map((row) => (
            <CheckInRow key={row.id} row={row} />
          ))}
        </Panel>

        <Panel
          title="Amendment deliveries"
          subtitle="Pending leadership updates waiting for delivery"
          empty="No amendment deliveries are queued."
        >
          {data.amendments.map((row) => (
            <AmendmentRow key={row.id} row={row} />
          ))}
        </Panel>

        <Panel
          title="Voice kickoff calls"
          subtitle="Recall bot deployments due soon"
          empty="No voice calls are scheduled soon."
        >
          {data.voiceCalls.map((row) => (
            <VoiceCallRow key={row.id} row={row} />
          ))}
        </Panel>
      </section>
    </main>
  );
}

async function loadAdminDashboard() {
  const now = new Date();
  const soon = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const [
    checkInCard,
    amendmentCard,
    voiceCard,
    readyPlans,
    checkIns,
    amendments,
    voiceCalls,
  ] = await Promise.all([
    loadCheckInCronCard(now),
    loadAmendmentCronCard(),
    loadVoiceCronCard(now),
    loadReadyPlans(soon),
    loadUpcomingCheckIns(soon),
    loadPendingAmendments(),
    loadUpcomingVoiceCalls(soon),
  ]);

  return {
    cronCards: [checkInCard, amendmentCard, voiceCard],
    readyPlans,
    checkIns,
    amendments,
    voiceCalls,
  };
}

async function loadCheckInCronCard(now: Date) {
  const [scheduled, due, failed, next, oldestOverdue, samples] =
    await Promise.all([
      prisma.scheduledCheckIn.count({
        where: { status: CheckInStatus.scheduled },
      }),
      prisma.scheduledCheckIn.count({
        where: {
          status: CheckInStatus.scheduled,
          scheduledFor: { lte: now },
        },
      }),
      prisma.scheduledCheckIn.count({ where: { status: CheckInStatus.failed } }),
      prisma.scheduledCheckIn.findFirst({
        where: { status: CheckInStatus.scheduled },
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      }),
      prisma.scheduledCheckIn.findFirst({
        where: {
          status: CheckInStatus.scheduled,
          scheduledFor: { lte: now },
        },
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      }),
      prisma.scheduledCheckIn.findMany({
        where: { status: CheckInStatus.failed, error: { not: null } },
        orderBy: { dispatchedAt: "desc" },
        take: 3,
        select: { error: true },
      }),
    ]);

  return {
    label: "Check-ins",
    cadence: "*/15 * * * *",
    scheduled,
    due,
    failed,
    nextAt: next?.scheduledFor ?? null,
    oldestOverdueAt: oldestOverdue?.scheduledFor ?? null,
    samples: samples.map((sample) => sample.error).filter(Boolean),
  };
}

async function loadAmendmentCronCard() {
  const [scheduled, failed, oldest, samples] = await Promise.all([
    prisma.amendmentDelivery.count({
      where: { status: AmendmentDeliveryStatus.scheduled },
    }),
    prisma.amendmentDelivery.count({
      where: { status: AmendmentDeliveryStatus.failed },
    }),
    prisma.amendmentDelivery.findFirst({
      where: { status: AmendmentDeliveryStatus.scheduled },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.amendmentDelivery.findMany({
      where: { status: AmendmentDeliveryStatus.failed, error: { not: null } },
      orderBy: { dispatchedAt: "desc" },
      take: 3,
      select: { error: true },
    }),
  ]);

  return {
    label: "Amendments",
    cadence: "*/5 * * * *",
    scheduled,
    due: scheduled,
    failed,
    nextAt: oldest?.createdAt ?? null,
    oldestOverdueAt: oldest?.createdAt ?? null,
    samples: samples.map((sample) => sample.error).filter(Boolean),
  };
}

async function loadVoiceCronCard(now: Date) {
  const [scheduled, due, failed, inviteFailed, next, oldestOverdue, samples] =
    await Promise.all([
      prisma.scheduledVoiceCall.count({
        where: { status: VoiceCallStatus.scheduled },
      }),
      prisma.scheduledVoiceCall.count({
        where: {
          status: VoiceCallStatus.scheduled,
          scheduledFor: { lte: now },
        },
      }),
      prisma.scheduledVoiceCall.count({
        where: { status: VoiceCallStatus.failed },
      }),
      prisma.scheduledVoiceCall.count({
        where: {
          status: VoiceCallStatus.scheduled,
          inviteError: { not: null },
        },
      }),
      prisma.scheduledVoiceCall.findFirst({
        where: { status: VoiceCallStatus.scheduled },
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      }),
      prisma.scheduledVoiceCall.findFirst({
        where: {
          status: VoiceCallStatus.scheduled,
          scheduledFor: { lte: now },
        },
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      }),
      prisma.scheduledVoiceCall.findMany({
        where: {
          OR: [{ status: VoiceCallStatus.failed }, { inviteError: { not: null } }],
        },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { error: true, inviteError: true },
      }),
    ]);

  return {
    label: "Voice calls",
    cadence: "* * * * *",
    scheduled,
    due,
    failed: failed + inviteFailed,
    nextAt: next?.scheduledFor ?? null,
    oldestOverdueAt: oldestOverdue?.scheduledFor ?? null,
    samples: samples
      .map((sample) => sample.error ?? sample.inviteError)
      .filter(Boolean),
  };
}

async function loadReadyPlans(soon: Date) {
  const plans = await prisma.changePlan.findMany({
    where: {
      status: "ready",
      kickoffDate: { lte: soon },
    },
    orderBy: [{ kickoffDate: "asc" }, { updatedAt: "desc" }],
    take: TABLE_LIMIT,
    select: {
      id: true,
      name: true,
      kickoffDate: true,
      organization: { select: { name: true, approvedAt: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  return Promise.all(
    plans.map(async (plan) => {
      const audience = await prisma.stakeholderGroupMember.findMany({
        where: { stakeholderGroup: { changePlanId: plan.id } },
        select: { employeeId: true },
        distinct: ["employeeId"],
      });
      return { ...plan, audienceSize: audience.length };
    }),
  );
}

async function loadUpcomingCheckIns(soon: Date) {
  return prisma.scheduledCheckIn.findMany({
    where: {
      status: CheckInStatus.scheduled,
      scheduledFor: { lte: soon },
    },
    orderBy: { scheduledFor: "asc" },
    take: TABLE_LIMIT,
    select: {
      id: true,
      kind: true,
      scheduledFor: true,
      enrollment: {
        select: {
          employee: { select: { name: true, email: true } },
          changePlan: {
            select: {
              id: true,
              name: true,
              organization: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

async function loadPendingAmendments() {
  return prisma.amendmentDelivery.findMany({
    where: { status: AmendmentDeliveryStatus.scheduled },
    orderBy: { createdAt: "asc" },
    take: TABLE_LIMIT,
    select: {
      id: true,
      createdAt: true,
      amendment: {
        select: {
          summary: true,
          changePlan: {
            select: {
              id: true,
              name: true,
              organization: { select: { name: true } },
            },
          },
        },
      },
      enrollment: {
        select: {
          employee: { select: { name: true, email: true } },
        },
      },
    },
  });
}

async function loadUpcomingVoiceCalls(soon: Date) {
  return prisma.scheduledVoiceCall.findMany({
    where: {
      status: VoiceCallStatus.scheduled,
      scheduledFor: { lte: soon },
    },
    orderBy: { scheduledFor: "asc" },
    take: TABLE_LIMIT,
    select: {
      id: true,
      scheduledFor: true,
      meetingJoinUrl: true,
      inviteSentAt: true,
      inviteError: true,
      enrollment: {
        select: {
          employee: { select: { name: true, email: true } },
        },
      },
      changePlan: {
        select: {
          id: true,
          name: true,
          organization: { select: { name: true } },
        },
      },
    },
  });
}

function CronCard({
  card,
}: {
  card: {
    label: string;
    cadence: string;
    scheduled: number;
    due: number;
    failed: number;
    nextAt: Date | null;
    oldestOverdueAt: Date | null;
    samples: Array<string | null>;
  };
}) {
  return (
    <article className="card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            {card.label}
          </p>
          <p className="serif mt-2 text-[34px] leading-none">{card.due}</p>
        </div>
        <span className="rounded-full border border-[color:var(--color-line-strong)] px-3 py-1 text-[11px] font-semibold text-[color:var(--color-muted)]">
          {card.cadence}
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3 text-[12px]">
        <Metric label="scheduled" value={card.scheduled} />
        <Metric label="due" value={card.due} />
        <Metric label="failed" value={card.failed} warn={card.failed > 0} />
      </dl>
      <div className="mt-5 space-y-1.5 text-[12.5px] text-[color:var(--color-muted)]">
        <p>Next: {formatDate(card.nextAt)}</p>
        <p>Oldest overdue: {formatDate(card.oldestOverdueAt)}</p>
      </div>
      {card.samples.length > 0 ? (
        <div className="mt-4 rounded-2xl bg-red-50/70 p-3 text-[12px] leading-[1.45] text-red-900">
          {card.samples[0]}
        </div>
      ) : null}
    </article>
  );
}

function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div>
      <dt className="uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
        {label}
      </dt>
      <dd className={warn ? "font-semibold text-red-700" : "font-semibold"}>
        {value}
      </dd>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-[color:var(--color-line)] px-6 py-5">
        <h2 className="serif text-[26px] leading-none">{title}</h2>
        <p className="mt-1 text-[13px] text-[color:var(--color-muted)]">
          {subtitle}
        </p>
      </div>
      <div className="divide-y divide-[color:var(--color-line)]">
        {children.length > 0 ? (
          children
        ) : (
          <p className="px-6 py-8 text-[14px] text-[color:var(--color-muted)]">
            {empty}
          </p>
        )}
      </div>
    </section>
  );
}

function ReadyPlanRow({
  plan,
}: {
  plan: Awaited<ReturnType<typeof loadReadyPlans>>[number];
}) {
  return (
    <div className="grid gap-4 px-6 py-4 lg:grid-cols-[1fr_auto]">
      <RowBody
        eyebrow={plan.organization.name}
        title={plan.name}
        href={`/changes/${plan.id}`}
        meta={[
          `Kickoff ${formatDate(plan.kickoffDate)}`,
          `${plan.audienceSize} people`,
          `Created by ${plan.createdBy.name ?? plan.createdBy.email ?? "unknown"}`,
          plan.organization.approvedAt ? "Approved org" : "Pending org approval",
        ]}
      />
      <form action={activateReadyPlanAction} className="flex items-center">
        <input type="hidden" name="id" value={plan.id} />
        <button type="submit" className="btn btn-primary px-4 py-2 text-[13px]">
          Activate now
        </button>
      </form>
    </div>
  );
}

function CheckInRow({
  row,
}: {
  row: Awaited<ReturnType<typeof loadUpcomingCheckIns>>[number];
}) {
  return (
    <QueueRow
      id={row.id}
      eyebrow={row.enrollment.changePlan.organization.name}
      title={`${row.kind.replace("_", " ")} check-in for ${row.enrollment.employee.name}`}
      href={`/changes/${row.enrollment.changePlan.id}`}
      meta={[
        row.enrollment.changePlan.name,
        row.enrollment.employee.email,
        `Scheduled ${formatDate(row.scheduledFor)}`,
      ]}
      sendAction={sendCheckInNowAction}
      cancelAction={cancelCheckInAction}
    />
  );
}

function AmendmentRow({
  row,
}: {
  row: Awaited<ReturnType<typeof loadPendingAmendments>>[number];
}) {
  return (
    <QueueRow
      id={row.id}
      eyebrow={row.amendment.changePlan.organization.name}
      title={row.amendment.summary}
      href={`/changes/${row.amendment.changePlan.id}`}
      meta={[
        row.amendment.changePlan.name,
        row.enrollment.employee.email,
        `Queued ${formatDate(row.createdAt)}`,
      ]}
      sendAction={sendAmendmentNowAction}
      cancelAction={cancelAmendmentAction}
    />
  );
}

function VoiceCallRow({
  row,
}: {
  row: Awaited<ReturnType<typeof loadUpcomingVoiceCalls>>[number];
}) {
  return (
    <QueueRow
      id={row.id}
      eyebrow={row.changePlan.organization.name}
      title={`Voice kickoff for ${row.enrollment.employee.name}`}
      href={`/changes/${row.changePlan.id}`}
      meta={[
        row.changePlan.name,
        row.enrollment.employee.email,
        `Scheduled ${formatDate(row.scheduledFor)}`,
        row.inviteError
          ? `Invite error: ${row.inviteError}`
          : row.inviteSentAt
            ? "Invite sent"
            : row.meetingJoinUrl
              ? "Meeting ready"
              : "Missing meeting URL",
      ]}
      sendAction={sendVoiceCallNowAction}
      cancelAction={cancelVoiceCallAction}
    />
  );
}

function QueueRow({
  id,
  eyebrow,
  title,
  href,
  meta,
  sendAction,
  cancelAction,
}: {
  id: string;
  eyebrow: string;
  title: string;
  href: string;
  meta: string[];
  sendAction: (formData: FormData) => Promise<void>;
  cancelAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="grid gap-4 px-6 py-4 lg:grid-cols-[1fr_auto]">
      <RowBody eyebrow={eyebrow} title={title} href={href} meta={meta} />
      <div className="flex flex-wrap items-center gap-2">
        <form action={sendAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="btn btn-primary px-4 py-2 text-[13px]">
            Send now
          </button>
        </form>
        <form action={cancelAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="btn btn-secondary px-4 py-2 text-[13px]"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

function RowBody({
  eyebrow,
  title,
  href,
  meta,
}: {
  eyebrow: string;
  title: string;
  href: string;
  meta: string[];
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
        {eyebrow}
      </p>
      <Link
        href={href}
        className="mt-1 block truncate text-[15px] font-semibold text-ink no-underline hover:underline"
      >
        {title}
      </Link>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-[color:var(--color-muted)]">
        {meta.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function formatDate(date: Date | null): string {
  if (!date) return "none";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
