/**
 * /settings/teams
 *
 * Test rig for the Microsoft Teams integration. Lets the developer
 * confirm two halves of the bot loop independently:
 *
 *   1. Inbound: did the bot capture a ConversationReference when a
 *      user got the tenant-wide install or opened the app? (List below.)
 *   2. Outbound: can we send a proactive 1:1 DM through the stored
 *      reference without the user prompting first? (Form below.)
 *
 * Once both work in /settings/teams, the same proactive-send helper
 * powers the kickoff DMs and check-in cadence in the agent layer.
 */

import { headers } from "next/headers";
import Link from "next/link";

import { PendingApprovalGate } from "@/components/pending-approval-gate";
import { readOrgApproval } from "@/lib/access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamsBootstrapReadiness } from "@/lib/teams/bootstrap";
import {
  describeTeamsConfigProblem,
  getOrganizationTeamsConfig,
} from "@/lib/teams/integration";
import { BootstrapForm } from "./bootstrap-form";
import { TeamsConfigForm } from "./config-form";
import { SendForm } from "./send-form";

export const metadata = { title: "Teams · Settings" };
// Conversation references arrive on the bot endpoint outside the
// session lifecycle; force-dynamic so the list isn't stale.
export const dynamic = "force-dynamic";

export default async function TeamsSettingsPage() {
  const session = await auth();
  const _organizationId = session!.user.organizationId!;
  const { approved: orgApproved } = readOrgApproval(session);

  const employees = await prisma.employee.findMany({
    where: { organizationId: _organizationId },
    select: {
      id: true,
      email: true,
      name: true,
      team: true,
      microsoftAadObjectId: true,
    },
    orderBy: { name: "asc" },
  });
  const employeeByEmail = new Map(
    employees.map((e) => [e.email.toLowerCase(), e]),
  );
  const employeeByAad = new Map(
    employees
      .filter((e) => e.microsoftAadObjectId)
      .map((e) => [e.microsoftAadObjectId!, e]),
  );

  const refs = await prisma.teamsConversationReference.findMany({
    where: {
      OR: [
        { organizationId: _organizationId },
        { employeeId: { in: employees.map((e) => e.id) } },
        {
          aadObjectId: {
            in: employees
              .map((e) => e.microsoftAadObjectId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        { userEmail: { in: employees.map((e) => e.email), mode: "insensitive" } },
      ],
    },
    orderBy: { lastActivityAt: "desc" },
    take: 50,
  });

  const recipients = refs.map((r) => {
    const matched =
      (r.employeeId ? employees.find((e) => e.id === r.employeeId) : undefined) ??
      employeeByAad.get(r.aadObjectId) ??
      (r.userEmail ? employeeByEmail.get(r.userEmail.toLowerCase()) : undefined);
    const label = matched?.name ?? r.userName ?? r.userEmail ?? r.aadObjectId;
    const subParts: string[] = [];
    if (matched?.team) subParts.push(matched.team);
    if (r.userEmail) subParts.push(r.userEmail);
    if (!subParts.length) subParts.push("unmatched in org chart");
    return { id: r.id, label, sub: subParts.join(" · ") };
  });

  const [readiness, teamsConfig] = await Promise.all([
    getTeamsBootstrapReadiness(_organizationId),
    getOrganizationTeamsConfig(_organizationId),
  ]);
  const configProblem = describeTeamsConfigProblem(teamsConfig);
  const configured = !configProblem;

  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host") ?? "localhost:3000";
  const messagingEndpoint = `${proto}://${host}/api/teams/messages`;
  const manifestDownloadReady = Boolean(teamsConfig.credentials);

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
          <h1 className="serif mt-1 text-[40px] leading-[1.05]">
            Microsoft Teams
          </h1>
          <p className="mt-3 max-w-[640px] text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
            Configure this workspace's customer-owned Teams bot, verify Graph
            bootstrap, captured conversations, and proactive DMs before using
            Teams in a live rollout.
          </p>
        </div>
        <span
          className={`pill ${configured ? "" : "opacity-60"}`}
          title={configured ? "Teams is configured" : (configProblem ?? "Teams is not configured")}
        >
          <span
            className={`pill-dot ${configured ? "" : "bg-[color:var(--color-muted)]"}`}
          />
          {configured ? "Enabled" : teamsConfig.enabled ? "Incomplete" : "Disabled"}
        </span>
      </header>

      <section className="card p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">
            Workspace Teams app
          </h2>
          <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
            Each customer workspace owns its Azure Bot, Entra app permissions,
            and Teams app catalog entry. Leave disabled for customers that do
            not use Teams.
          </p>
        </header>

        {!orgApproved ? (
          <div className="mt-6">
            <PendingApprovalGate
              title="Teams setup locked"
              body="Connecting Teams provisions a real bot in your tenant and lets Grasp DM your employees. We open this once your workspace is approved — until then, you can still review the steps below so the rollout is one click away when we flip the switch."
              className="max-w-none"
            />
          </div>
        ) : (
          <>
            {teamsConfig.source === "env" ? (
              <p className="mt-5 rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                Using the local env fallback until a workspace config is saved.
                Saving this form moves the workspace to its own stored config.
              </p>
            ) : null}

            <div className="mt-6">
              <TeamsConfigForm
                value={{
                  enabled: teamsConfig.enabled,
                  microsoftTenantId: teamsConfig.row?.microsoftTenantId ?? "",
                  microsoftAppId: teamsConfig.row?.microsoftAppId ?? "",
                  hasPassword: Boolean(
                    teamsConfig.row?.microsoftAppPasswordEncrypted,
                  ),
                  teamsAppCatalogId: teamsConfig.row?.teamsAppCatalogId ?? "",
                  teamsAppManifestId: teamsConfig.row?.teamsAppManifestId ?? "",
                  serviceUrl: teamsConfig.row?.serviceUrl ?? "",
                }}
              />
            </div>
          </>
        )}
      </section>

      <section className="card p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <header>
            <h2 className="serif text-[22px] leading-[1.2]">
              Customer setup instructions
            </h2>
            <p className="mt-1 max-w-[680px] text-[14px] text-[color:var(--color-muted)]">
              Give these steps to the customer’s Microsoft 365 admin. They keep
              ownership of the Azure Bot, Entra app permissions, and Teams app
              package; Grasp only stores the IDs needed to send messages.
            </p>
          </header>
          {manifestDownloadReady ? (
            <a href="/api/teams/manifest" className="btn btn-primary">
              Download manifest.json
            </a>
          ) : (
            <span
              className="btn btn-secondary opacity-60"
              aria-disabled="true"
              title="Save the Microsoft app id and tenant id first"
            >
              Download manifest.json
            </span>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-[color:var(--color-line-strong)] bg-white/70 p-5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Messaging endpoint
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-[color:var(--color-line-strong)] bg-black/[0.025] px-3 py-2 text-[12.5px]">
            {messagingEndpoint}
          </pre>
          <p className="mt-2 text-[13px] leading-[1.6] text-[color:var(--color-muted)]">
            Put this exact URL in the Azure Bot resource. For local demos, keep
            the ngrok HTTPS URL stable and pointed at the running Next.js port.
          </p>
        </div>

        <ol className="mt-6 space-y-4 text-[14px] leading-[1.65] text-[color:var(--color-ink-2)]">
          <Step n={1} title="Create the customer's Azure Bot and Entra app">
            In Azure, create an Azure Bot backed by an Entra app registration.
            Copy the tenant id, app/client id, and a client secret into the
            workspace form above. Enable the Microsoft Teams channel on the bot.
          </Step>

          <Step n={2} title="Set the bot messaging endpoint">
            In the Azure Bot configuration, paste the messaging endpoint shown
            above. The endpoint must be public HTTPS and must end with{" "}
            <code className="font-mono text-[12.5px]">/api/teams/messages</code>.
          </Step>

          <Step n={3} title="Grant Graph application permissions">
            In the Entra app registration, add Application permissions for{" "}
            <code className="font-mono text-[12.5px]">User.Read.All</code>,{" "}
            <code className="font-mono text-[12.5px]">AppCatalog.Read.All</code>,{" "}
            <code className="font-mono text-[12.5px]">
              TeamsAppInstallation.ReadWriteForUser.All
            </code>
            , and{" "}
            <code className="font-mono text-[12.5px]">Chat.ReadBasic.All</code>
            . Then click Grant admin consent for the customer tenant.
          </Step>

          <Step n={4} title="Download and package the Teams manifest">
            Download the workspace-specific{" "}
            <code className="font-mono text-[12.5px]">manifest.json</code>{" "}
            above. Zip it at the root with{" "}
            <code className="font-mono text-[12.5px]">color.png</code> and{" "}
            <code className="font-mono text-[12.5px]">outline.png</code>. The
            downloaded manifest is already configured with this workspace’s app
            id, hostname, personal bot scope, valid domain, and{" "}
            <code className="font-mono text-[12.5px]">webApplicationInfo</code>.
          </Step>

          <Step n={5} title="Publish the app in Teams Admin Center">
            Upload the zip under Teams apps &gt; Manage apps, allow it for the
            tenant, then copy the Teams app catalog id back into the workspace
            form if Graph cannot find the app by manifest id.
          </Step>

          <Step n={6} title="Bootstrap and test recipients">
            Save the configuration, test Graph permissions, then bootstrap
            recipients. Once Teams sends install/open events, users appear under
            captured conversations and can receive a proactive test message.
          </Step>
        </ol>
      </section>

      <section className="card p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">
            Bootstrap recipients
          </h2>
          <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
            Admin install lets Grasp prepare Teams for users. Teams may still
            need to deliver an install/open event before a proactive DM is
            ready.
          </p>
        </header>

        <div className="mt-6">
          {!orgApproved ? (
            <p className="rounded-xl border border-dashed border-amber-300/70 bg-amber-50/60 p-5 text-[14px] text-amber-900">
              Bootstrap unlocks once your workspace is approved.
            </p>
          ) : configured ? (
            <BootstrapForm readiness={readiness} />
          ) : (
            <p className="rounded-xl border border-dashed border-[color:var(--color-line-strong)] bg-black/[0.015] p-5 text-[14px] text-[color:var(--color-muted)]">
              {configProblem ??
                "Enable and save Teams configuration before bootstrapping recipients."}
            </p>
          )}
        </div>
      </section>

      <section className="card p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">
            Captured conversations
          </h2>
          <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
            Users whose tenant-wide install, app open, or message produced a
            1:1 reference. We use these references to send proactive DMs.
          </p>
        </header>

        <div className="mt-6">
          {refs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--color-line-strong)] bg-black/[0.015] p-8 text-center">
              <p className="text-[14px] text-[color:var(--color-muted)]">
                No captured conversations yet. Use bootstrap above to install
                Grasp for org-chart employees; Teams will populate this list
                when it delivers the bot install/open event.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--color-line)] rounded-xl border border-[color:var(--color-line-strong)] bg-white/70">
              {refs.map((r) => {
                const matched =
                  (r.employeeId
                    ? employees.find((e) => e.id === r.employeeId)
                    : undefined) ??
                  employeeByAad.get(r.aadObjectId) ??
                  (r.userEmail
                    ? employeeByEmail.get(r.userEmail.toLowerCase())
                    : undefined);
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-4 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-ink">
                        {matched?.name ?? r.userName ?? "Unknown"}
                      </p>
                      <p className="truncate text-[12.5px] text-[color:var(--color-muted)]">
                        {r.userEmail ?? r.aadObjectId}
                        {matched?.team ? ` · ${matched.team}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`pill ${matched ? "" : "opacity-60"}`}
                        title={
                          matched
                            ? "Matched to org chart by email"
                            : "Not in this org chart"
                        }
                      >
                        <span
                          className={`pill-dot ${
                            matched
                              ? ""
                              : "bg-[color:var(--color-muted)]"
                          }`}
                        />
                        {matched ? "Org chart" : "Unmatched"}
                      </span>
                      <span className="text-[12px] text-[color:var(--color-muted)]">
                        {formatRelative(r.lastActivityAt)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="card p-7">
        <header>
          <h2 className="serif text-[22px] leading-[1.2]">
            Send a test message
          </h2>
          <p className="mt-1 text-[14px] text-[color:var(--color-muted)]">
            Sends a proactive 1:1 DM to a captured user. Same code path the
            agent will use for kickoff DMs and check-ins.
          </p>
        </header>

        <div className="mt-6">
          {!orgApproved ? (
            <p className="rounded-xl border border-dashed border-amber-300/70 bg-amber-50/60 p-5 text-[14px] text-amber-900">
              Sending real Teams DMs unlocks once your workspace is approved.
            </p>
          ) : !configured ? (
            <p className="text-[14px] text-[color:var(--color-muted)]">
              Enable and configure Teams for this workspace before sending a
              proactive test message.
            </p>
          ) : recipients.length === 0 ? (
            <p className="text-[14px] text-[color:var(--color-muted)]">
              Bootstrap recipients first. Once Teams has delivered a bot
              conversation reference for at least one user, they will appear
              here for a proactive DM test.
            </p>
          ) : (
            <SendForm recipients={recipients} />
          )}
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
    <li className="flex gap-4">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-grasp-soft)] text-[12px] font-semibold text-[color:var(--color-grasp)]"
      >
        {n}
      </span>
      <div>
        <p className="text-[14px] font-medium text-ink">{title}</p>
        <div className="mt-1 text-[13.5px] text-[color:var(--color-ink-2)]">
          {children}
        </div>
      </div>
    </li>
  );
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString();
}
