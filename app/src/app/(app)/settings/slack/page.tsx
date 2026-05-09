import { headers } from "next/headers";
import Link from "next/link";

import { PendingApprovalGate } from "@/components/pending-approval-gate";
import { readOrgApproval } from "@/lib/access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSlackBootstrapReadiness } from "@/lib/slack/bootstrap";
import {
  describeSlackConfigProblem,
  getOrganizationSlackConfig,
} from "@/lib/slack/integration";
import { SlackBootstrapForm } from "./bootstrap-form";
import { SlackConfigForm } from "./config-form";
import { SlackSendForm } from "./send-form";

export const metadata = { title: "Slack · Settings" };
export const dynamic = "force-dynamic";

export default async function SlackSettingsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const { approved: orgApproved } = readOrgApproval(session);

  const [employees, contacts, readiness, slackConfig] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId },
      select: { id: true, email: true, name: true, team: true },
      orderBy: { name: "asc" },
    }),
    prisma.slackContact.findMany({
      where: { organizationId },
      orderBy: { lastActivityAt: "desc" },
      take: 50,
    }),
    getSlackBootstrapReadiness(organizationId),
    getOrganizationSlackConfig(organizationId),
  ]);

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const employeeByEmail = new Map(
    employees.map((e) => [e.email.toLowerCase(), e]),
  );
  const recipients = contacts
    .filter((c) => c.slackDmChannelId)
    .map((c) => {
      const matched =
        (c.employeeId ? employeeById.get(c.employeeId) : undefined) ??
        (c.userEmail ? employeeByEmail.get(c.userEmail.toLowerCase()) : undefined);
      const label = matched?.name ?? c.userName ?? c.userEmail ?? c.slackUserId;
      const subParts: string[] = [];
      if (matched?.team) subParts.push(matched.team);
      if (c.userEmail) subParts.push(c.userEmail);
      subParts.push(c.slackDmChannelId ?? "no DM channel");
      return { id: c.id, label, sub: subParts.join(" · ") };
    });

  const configProblem = describeSlackConfigProblem(slackConfig);
  const configured = !configProblem;
  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host") ?? "localhost:3000";
  const eventsEndpoint = `${proto}://${host}/api/slack/events`;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            <Link
              href="/settings"
              className="text-[color:var(--color-muted)] no-underline hover:text-ink"
            >
              Settings
            </Link>{" "}
            / Integrations
          </p>
          <h1 className="serif mt-1 text-[40px] leading-[1.05]">Slack</h1>
          <p className="mt-3 max-w-[680px] text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
            Configure a customer-owned Slack app, bootstrap employees by email,
            and verify proactive first-contact DMs before using Slack in a live
            rollout.
          </p>
        </div>
        <span
          className={`pill ${configured ? "" : "opacity-60"}`}
          title={configured ? "Slack is configured" : (configProblem ?? "Slack is not configured")}
        >
          <span
            className={`pill-dot ${configured ? "" : "bg-[color:var(--color-muted)]"}`}
          />
          {configured ? "Enabled" : slackConfig.enabled ? "Incomplete" : "Disabled"}
        </span>
      </header>

      <section className="card p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">
            Workspace Slack app
          </h2>
          <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
            Store the Slack app credentials needed to verify events, look users
            up by email, open DMs, and post proactive messages.
          </p>
        </header>

        {!orgApproved ? (
          <div className="mt-6">
            <PendingApprovalGate
              title="Slack setup locked"
              body="Connecting Slack lets Grasp DM your employees. We open this once your workspace is approved; until then, you can review the setup steps below."
              className="max-w-none"
            />
          </div>
        ) : (
          <>
            {slackConfig.source === "env" ? (
              <p className="mt-5 rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                Using the local env fallback until a workspace config is saved.
                Saving this form moves the workspace to its own stored config.
              </p>
            ) : null}

            <div className="mt-6">
              <SlackConfigForm
                value={{
                  enabled: slackConfig.enabled,
                  slackTeamId: slackConfig.row?.slackTeamId ?? "",
                  slackTeamName: slackConfig.row?.slackTeamName ?? "",
                  slackAppId: slackConfig.row?.slackAppId ?? "",
                  slackBotUserId: slackConfig.row?.slackBotUserId ?? "",
                  hasBotToken: Boolean(slackConfig.row?.slackBotTokenEncrypted),
                  hasSigningSecret: Boolean(
                    slackConfig.row?.slackSigningSecretEncrypted,
                  ),
                }}
              />
            </div>
          </>
        )}
      </section>

      <section className="card p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">
            Customer setup instructions
          </h2>
          <p className="mt-1 max-w-[680px] text-[14px] text-[color:var(--color-muted)]">
            Create and install a Slack app in the customer workspace, then paste
            the credentials above. Proactive first-contact DMs require user
            email lookup and DM-open permissions.
          </p>
        </header>

        <div className="mt-6 rounded-2xl border border-[color:var(--color-line-strong)] bg-white/70 p-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Events endpoint
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-[color:var(--color-line-strong)] bg-black/[0.025] px-3 py-2 text-[12.5px]">
            {eventsEndpoint}
          </pre>
          <p className="mt-2 text-[13px] leading-[1.6] text-[color:var(--color-muted)]">
            Add this URL to the Slack app Events API. For local demos, use an
            HTTPS tunnel pointed at the running Next.js port.
          </p>
        </div>

        <ol className="mt-6 space-y-4 text-[14px] leading-[1.65] text-[color:var(--color-ink-2)]">
          <Step n={1} title="Create and install the Slack app">
            Create a Slack app in the customer workspace and install it after
            granting the bot scopes below.
          </Step>
          <Step n={2} title="Grant bot scopes">
            Add scopes for <code className="font-mono text-[12.5px]">chat:write</code>,{" "}
            <code className="font-mono text-[12.5px]">im:write</code>,{" "}
            <code className="font-mono text-[12.5px]">im:history</code>,{" "}
            <code className="font-mono text-[12.5px]">users:read</code>, and{" "}
            <code className="font-mono text-[12.5px]">users:read.email</code>.
          </Step>
          <Step n={3} title="Enable event subscriptions">
            Point the Events API request URL to the endpoint above and subscribe
            to direct message events for the bot.
          </Step>
          <Step n={4} title="Save credentials and bootstrap">
            Save the team id, bot token, signing secret, and optional bot user
            id here, then run bootstrap to resolve employees by email and open
            proactive DM channels.
          </Step>
        </ol>
      </section>

      <section className="card p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">
            Proactive DM bootstrap
          </h2>
          <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
            Resolve org-chart employees to Slack users and open bot DM channels
            before any employee messages Grasp.
          </p>
        </header>
        <div className="mt-6">
          <SlackBootstrapForm readiness={readiness} />
        </div>
      </section>

      <section className="card p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">
            Send a test Slack DM
          </h2>
          <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
            Sends through the same proactive helper used by kickoff DMs,
            check-ins, and leadership responses.
          </p>
        </header>
        <div className="mt-6">
          <SlackSendForm recipients={recipients} />
        </div>
      </section>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-grasp)] text-[12px] font-semibold text-white">
        {n}
      </span>
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-1">{children}</p>
      </div>
    </li>
  );
}
