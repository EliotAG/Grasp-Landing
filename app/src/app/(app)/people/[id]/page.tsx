/**
 * Employee profile page.
 *
 * Reachable from any avatar/name in the org chart (tree or by-team view).
 * Surfaces the basics — name, title, team, email, manager, direct reports
 * — plus a list of every change plan in this org that this employee is
 * involved in (i.e. they're a member of one or more stakeholder groups
 * on the plan). Each surfaced change links into the existing change-plan
 * detail / wizard pages.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canManageWorkspaceMembers,
  displayMembershipRole,
} from "@/lib/organization-invitations";

import { initials, teamColor } from "../../org-chart/_lib/build-tree";
import { PersonInviteActions } from "./invite-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.organizationId) return { title: "Profile" };
  const employee = await prisma.employee.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { name: true },
  });
  return { title: employee?.name ?? "Profile" };
}

export default async function PersonProfile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const employee = await prisma.employee.findFirst({
    where: { id, organizationId },
    include: {
      manager: true,
      reports: { orderBy: [{ title: "asc" }, { name: "asc" }] },
      stakeholderMemberships: {
        include: {
          stakeholderGroup: {
            include: {
              changePlan: {
                select: {
                  id: true,
                  name: true,
                  summary: true,
                  status: true,
                  kickoffDate: true,
                  targetDate: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!employee) notFound();

  const [workspaceMember, pendingInvite] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        organizationId,
        user: { email: { equals: employee.email, mode: "insensitive" } },
      },
      select: {
        role: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.organizationInvitation.findFirst({
      where: {
        organizationId,
        email: { equals: employee.email, mode: "insensitive" },
        acceptedAt: null,
      },
      select: { role: true, createdAt: true },
    }),
  ]);

  // A person can be a member of multiple stakeholder groups on the same
  // plan; collapse those into one row per plan and keep the role labels.
  const planMap = new Map<
    string,
    {
      id: string;
      name: string;
      summary: string | null;
      status: string;
      kickoffDate: Date | null;
      targetDate: Date | null;
      groups: string[];
    }
  >();
  for (const m of employee.stakeholderMemberships) {
    const plan = m.stakeholderGroup.changePlan;
    const existing = planMap.get(plan.id);
    if (existing) {
      if (!existing.groups.includes(m.stakeholderGroup.name)) {
        existing.groups.push(m.stakeholderGroup.name);
      }
    } else {
      planMap.set(plan.id, {
        id: plan.id,
        name: plan.name,
        summary: plan.summary,
        status: plan.status,
        kickoffDate: plan.kickoffDate,
        targetDate: plan.targetDate,
        groups: [m.stakeholderGroup.name],
      });
    }
  }
  // Sort by status priority (active first), then most recent kickoff.
  const STATUS_RANK: Record<string, number> = {
    active: 0,
    ready: 1,
    draft: 2,
    completed: 3,
    archived: 4,
  };
  const involvedPlans = [...planMap.values()].sort((a, b) => {
    const s = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
    if (s !== 0) return s;
    const ad = a.kickoffDate?.getTime() ?? 0;
    const bd = b.kickoffDate?.getTime() ?? 0;
    return bd - ad;
  });

  const palette = teamColor(employee.team);
  const canInvite = canManageWorkspaceMembers(session!.user.role);

  return (
    <div className="mx-auto max-w-[860px] space-y-10">
      <Link
        href="/org-chart"
        className="text-[13px] text-[color:var(--color-muted)] hover:text-ink"
      >
        ← Org chart
      </Link>

      <header className="flex flex-wrap items-center gap-6">
        <span
          aria-hidden
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-[24px] font-semibold tracking-wide"
          style={{ background: palette.bg, color: palette.fg }}
        >
          {initials(employee.name)}
        </span>
        <div className="min-w-0 flex-1">
          {employee.team ? (
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: palette.fg }}
            >
              {employee.team}
            </p>
          ) : null}
          <h1 className="serif mt-1 text-[40px] leading-[1.05]">
            {employee.name}
          </h1>
          {employee.title ? (
            <p className="mt-1 text-[16px] text-[color:var(--color-muted)]">
              {employee.title}
            </p>
          ) : null}
          <p className="mt-2 text-[13px]">
            <a
              href={`mailto:${employee.email}`}
              className="text-[color:var(--color-muted)] hover:text-ink"
            >
              {employee.email}
            </a>
          </p>
        </div>
      </header>

      <section className="card grid grid-cols-1 gap-x-6 gap-y-5 p-7 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Reports to
          </p>
          {employee.manager ? (
            <Link
              href={`/people/${employee.manager.id}`}
              className="mt-2 inline-flex items-center gap-2.5 rounded-full bg-black/[0.03] px-3 py-1.5 text-[13.5px] font-medium text-ink no-underline transition-colors hover:bg-black/[0.06]"
            >
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold"
                style={{
                  background: teamColor(employee.manager.team).bg,
                  color: teamColor(employee.manager.team).fg,
                }}
              >
                {initials(employee.manager.name)}
              </span>
              <span className="truncate">
                {employee.manager.name}
                {employee.manager.title ? (
                  <span className="text-[color:var(--color-muted)]">
                    {" "}
                    · {employee.manager.title}
                  </span>
                ) : null}
              </span>
            </Link>
          ) : (
            <p className="mt-2 text-[14px] text-[color:var(--color-muted)]">
              Top of the chart.
            </p>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            {employee.reports.length === 1
              ? "1 direct report"
              : `${employee.reports.length} direct reports`}
          </p>
          {employee.reports.length === 0 ? (
            <p className="mt-2 text-[14px] text-[color:var(--color-muted)]">
              No one reports to {firstName(employee.name)}.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {employee.reports.map((r) => {
                const p = teamColor(r.team);
                return (
                  <li key={r.id}>
                    <Link
                      href={`/people/${r.id}`}
                      className="inline-flex items-center gap-2 rounded-full bg-black/[0.03] px-2.5 py-1 text-[12.5px] font-medium text-ink no-underline transition-colors hover:bg-black/[0.06]"
                      title={r.title ?? undefined}
                    >
                      <span
                        aria-hidden
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold"
                        style={{ background: p.bg, color: p.fg }}
                      >
                        {initials(r.name)}
                      </span>
                      {r.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="card p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
              Workspace access
            </p>
            <h2 className="serif mt-1 text-[24px] leading-[1.2]">
              Grasp account
            </h2>
            <p className="mt-2 max-w-[560px] text-[14px] leading-[1.65] text-[color:var(--color-muted)]">
              Org-chart people can be invited into this workspace by matching
              their work email to their Grasp sign-in email.
            </p>
          </div>
          {workspaceMember ? (
            <span className="pill">
              <span className="pill-dot" />
              {displayMembershipRole(workspaceMember.role)}
            </span>
          ) : pendingInvite ? (
            <span className="pill opacity-80">
              <span className="pill-dot" />
              Invited {displayMembershipRole(pendingInvite.role)}
            </span>
          ) : (
            <span className="pill opacity-50">
              <span className="pill-dot bg-[color:var(--color-muted)]" />
              Not invited
            </span>
          )}
        </div>

        <div className="mt-5">
          {workspaceMember ? (
            <p className="text-[14px] text-[color:var(--color-muted)]">
              {workspaceMember.user.name ?? workspaceMember.user.email} already
              has workspace access as{" "}
              {displayMembershipRole(workspaceMember.role).toLowerCase()}.
            </p>
          ) : pendingInvite ? (
            <p className="text-[14px] text-[color:var(--color-muted)]">
              An invite is pending for {employee.email}. They will join as{" "}
              {displayMembershipRole(pendingInvite.role).toLowerCase()} after
              signing in with this email.
            </p>
          ) : canInvite ? (
            <PersonInviteActions
              email={employee.email}
              sourcePath={`/people/${employee.id}`}
            />
          ) : (
            <p className="text-[14px] text-[color:var(--color-muted)]">
              Only workspace admins can invite this person.
            </p>
          )}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
              {involvedPlans.length}{" "}
              {involvedPlans.length === 1
                ? "change plan"
                : "change plans"}
            </p>
            <h2 className="serif mt-1 text-[26px] leading-[1.2]">
              Involved in
            </h2>
          </div>
        </div>

        {involvedPlans.length === 0 ? (
          <div className="card p-7 text-[14px] leading-[1.7] text-[color:var(--color-muted)]">
            {firstName(employee.name)} isn&rsquo;t a member of any
            stakeholder group on a current change plan. Once leadership
            adds them in the planning wizard, every plan they&rsquo;re part
            of will show up here.
          </div>
        ) : (
          <ul className="space-y-3">
            {involvedPlans.map((p) => {
              const href =
                p.status === "draft"
                  ? `/changes/${p.id}/wizard`
                  : `/changes/${p.id}`;
              return (
                <li key={p.id}>
                  <Link
                    href={href}
                    className="card block p-6 no-underline transition-colors hover:bg-white/85"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[16px] font-semibold text-ink">
                            {p.name}
                          </h3>
                          <StatusPill status={p.status} />
                        </div>
                        {p.summary ? (
                          <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-[1.6] text-[color:var(--color-muted)]">
                            {p.summary}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
                            As
                          </span>
                          {p.groups.map((g) => (
                            <span
                              key={g}
                              className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11.5px] font-medium text-ink"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      </div>
                      {p.kickoffDate ? (
                        <div className="shrink-0 text-right">
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
                            Kickoff
                          </p>
                          <p className="mt-0.5 text-[13px] text-ink">
                            {p.kickoffDate.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]"
      : "bg-black/[0.06] text-[color:var(--color-muted)]";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      {status}
    </span>
  );
}
