import Link from "next/link";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canManageWorkspaceMembers,
  displayMembershipRole,
} from "@/lib/organization-invitations";
import {
  describeTeamsConfigProblem,
  getOrganizationTeamsConfig,
} from "@/lib/teams/integration";
import {
  describeSlackConfigProblem,
  getOrganizationSlackConfig,
} from "@/lib/slack/integration";
import { InviteMemberForm } from "./invite-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const [teamsConfig, slackConfig, members, pendingInvites, employees] =
    await Promise.all([
    getOrganizationTeamsConfig(organizationId),
    getOrganizationSlackConfig(organizationId),
    prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { name: true, email: true, image: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.organizationInvitation.findMany({
      where: { organizationId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, createdAt: true },
    }),
    prisma.employee.findMany({
      where: { organizationId },
      orderBy: [{ team: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        title: true,
        team: true,
      },
    }),
  ]);
  const teamsProblem = describeTeamsConfigProblem(teamsConfig);
  const teamsStatus = !teamsProblem
    ? "Enabled"
    : teamsConfig.enabled
      ? "Incomplete"
      : "Disabled";
  const slackProblem = describeSlackConfigProblem(slackConfig);
  const slackStatus = !slackProblem
    ? "Enabled"
    : slackConfig.enabled
      ? "Incomplete"
      : "Disabled";
  const canInvite = canManageWorkspaceMembers(session!.user.role);
  const memberEmails = new Set(
    members.map((member) => member.user.email.toLowerCase()),
  );
  const pendingInviteEmails = new Set(
    pendingInvites.map((invite) => invite.email.toLowerCase()),
  );
  const orgChartSuggestions = employees.filter((employee) => {
    const email = employee.email.toLowerCase();
    return !memberEmails.has(email) && !pendingInviteEmails.has(email);
  });

  return (
    <div className="space-y-10">
      <header>
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          Workspace
        </p>
        <h1 className="serif mt-1 text-[40px] leading-[1.05]">Settings</h1>
        <p className="mt-3 max-w-[640px] text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
          Manage the workspace settings that are available today.
        </p>
      </header>

      <section className="card max-w-[860px] p-7">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="serif text-[22px] leading-[1.2]">
              Workspace access
            </h2>
            <p className="mt-1 max-w-[620px] text-[14px] text-[color:var(--color-muted)]">
              Invite leaders and operators into this workspace. Admins can
              invite people and configure workspace settings; users can plan and
              review rollouts without managing access.
            </p>
          </div>
          <span className="pill">
            <span className="pill-dot" />
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </header>

        <div className="mt-6">
          {!canInvite ? (
            <p className="mb-4 rounded-xl border border-dashed border-[color:var(--color-line-strong)] bg-black/[0.015] p-4 text-[13.5px] text-[color:var(--color-muted)]">
              Only workspace admins can invite other people.
            </p>
          ) : null}
          <InviteMemberForm
            canInvite={canInvite}
            suggestions={orgChartSuggestions}
          />
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
              Members
            </p>
            <ul className="mt-3 divide-y divide-[color:var(--color-line)] rounded-xl border border-[color:var(--color-line-strong)] bg-white/70">
              {members.map((member) => (
                <li
                  key={`${member.userId}-${member.organizationId}`}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-ink">
                      {member.user.name ?? member.user.email}
                    </p>
                    <p className="truncate text-[12.5px] text-[color:var(--color-muted)]">
                      {member.user.email}
                    </p>
                  </div>
                  <span className="pill shrink-0">
                    <span className="pill-dot" />
                    {displayMembershipRole(member.role)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
              Pending invites
            </p>
            {pendingInvites.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-[color:var(--color-line-strong)] bg-black/[0.015] p-5 text-[13.5px] text-[color:var(--color-muted)]">
                No pending invites.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[color:var(--color-line)] rounded-xl border border-[color:var(--color-line-strong)] bg-white/70">
                {pendingInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-ink">
                        {invite.email}
                      </p>
                      <p className="truncate text-[12.5px] text-[color:var(--color-muted)]">
                        Invited {formatDate(invite.createdAt)}
                      </p>
                    </div>
                    <span className="pill shrink-0 opacity-80">
                      <span className="pill-dot" />
                      {displayMembershipRole(invite.role)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="card max-w-[760px] p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">Integrations</h2>
          <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
            Test and monitor integrations that are wired into the product.
          </p>
        </header>

        <ul className="mt-6 divide-y divide-[color:var(--color-line)] rounded-xl border border-[color:var(--color-line-strong)] bg-white/70">
          <li className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-[14px] font-medium text-ink">
                Microsoft Teams
              </p>
              <p className="mt-0.5 text-[12.5px] text-[color:var(--color-muted)]">
                {teamsProblem ??
                  "Configure the bot, inspect captured conversations, and send a proactive test message."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`pill ${teamsProblem ? "opacity-60" : ""}`}>
                <span
                  className={`pill-dot ${
                    teamsProblem ? "bg-[color:var(--color-muted)]" : ""
                  }`}
                />
                {teamsStatus}
              </span>
              <Link href="/settings/teams" className="btn btn-secondary">
                Open
              </Link>
            </div>
          </li>
          <li className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-[14px] font-medium text-ink">Slack</p>
              <p className="mt-0.5 text-[12.5px] text-[color:var(--color-muted)]">
                {slackProblem ??
                  "Configure the app, bootstrap users by email, and send a proactive test message."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`pill ${slackProblem ? "opacity-60" : ""}`}>
                <span
                  className={`pill-dot ${
                    slackProblem ? "bg-[color:var(--color-muted)]" : ""
                  }`}
                />
                {slackStatus}
              </span>
              <Link href="/settings/slack" className="btn btn-secondary">
                Open
              </Link>
            </div>
          </li>
          <li className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[14px] font-medium text-ink">
                  Slack setup notes
                </p>
                <p className="mt-0.5 text-[12.5px] text-[color:var(--color-muted)]">
                  Slack uses a customer-owned Slack app with bot scopes, event
                  subscriptions, and workspace install.
                </p>
              </div>
              <span className="pill opacity-60">
                <span className="pill-dot bg-[color:var(--color-muted)]" />
                Docs
              </span>
            </div>
            <div className="mt-4 rounded-xl border border-dashed border-[color:var(--color-line-strong)] bg-black/[0.015] px-4 py-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                Planned setup
              </p>
              <ol className="mt-2 space-y-1.5 text-[12.5px] leading-[1.55] text-[color:var(--color-ink-2)]">
                <li>Create a Slack app in the customer workspace.</li>
                <li>
                  Add bot scopes for direct messages, user lookup, and event
                  delivery.
                </li>
                <li>
                  Point event subscriptions and interactivity to the Grasp
                  workspace webhook.
                </li>
                <li>
                  Install the app to the workspace, then test a proactive DM
                  from this page.
                </li>
              </ol>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
