import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { lookupSlackUserByEmail, openSlackDm, SlackApiError } from "./client";
import {
  describeSlackConfigProblem,
  getOrganizationSlackConfig,
} from "./integration";

type BootstrapEmployee = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
};

export type SlackBootstrapOutcome =
  | "ready"
  | "linked"
  | "slack_disabled"
  | "user_not_found"
  | "failed";

export interface SlackBootstrapResult {
  employeeId: string;
  email: string;
  outcome: SlackBootstrapOutcome;
  message: string;
}

export interface SlackBootstrapSummary {
  total: number;
  ready: number;
  linked: number;
  userNotFound: number;
  failed: number;
  results: SlackBootstrapResult[];
}

export interface SlackBootstrapReadiness {
  employees: number;
  linkedUsers: number;
  dmChannels: number;
  readyRecipients: number;
  lastError: string | null;
}

export async function getSlackBootstrapReadiness(
  organizationId: string,
): Promise<SlackBootstrapReadiness> {
  const [employees, contacts] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId },
      select: { id: true, slackBootstrapError: true },
    }),
    prisma.slackContact.findMany({
      where: { organizationId },
      select: {
        employeeId: true,
        slackUserId: true,
        slackDmChannelId: true,
        bootstrapError: true,
      },
    }),
  ]);
  const employeeIds = new Set(employees.map((e) => e.id));
  const readyRecipients = new Set(
    contacts
      .filter((c) => c.employeeId && c.slackDmChannelId && employeeIds.has(c.employeeId))
      .map((c) => c.employeeId!),
  );

  return {
    employees: employees.length,
    linkedUsers: contacts.filter((c) => c.employeeId && c.slackUserId).length,
    dmChannels: contacts.filter((c) => c.slackDmChannelId).length,
    readyRecipients: readyRecipients.size,
    lastError:
      contacts.find((c) => c.bootstrapError)?.bootstrapError ??
      employees.find((e) => e.slackBootstrapError)?.slackBootstrapError ??
      null,
  };
}

export async function bootstrapSlackForOrganization(
  organizationId: string,
): Promise<SlackBootstrapSummary> {
  const employees = await prisma.employee.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      organizationId: true,
      name: true,
      email: true,
    },
  });

  const results: SlackBootstrapResult[] = [];
  for (const employee of employees) {
    results.push(await ensureSlackContactForEmployee(employee));
  }

  return {
    total: results.length,
    ready: results.filter((r) => r.outcome === "ready").length,
    linked: results.filter((r) => r.outcome === "linked").length,
    userNotFound: results.filter((r) => r.outcome === "user_not_found").length,
    failed: results.filter(
      (r) => r.outcome === "failed" || r.outcome === "slack_disabled",
    ).length,
    results,
  };
}

export async function ensureSlackContactForEmployee(
  employee: BootstrapEmployee,
): Promise<SlackBootstrapResult> {
  const config = await getOrganizationSlackConfig(employee.organizationId);
  const problem = describeSlackConfigProblem(config);
  if (problem || !config.credentials) {
    const message = problem ?? "Slack is not configured.";
    await markBootstrapError(employee.id, message);
    return {
      employeeId: employee.id,
      email: employee.email,
      outcome: "slack_disabled",
      message,
    };
  }

  const existing = await findReadyContact(employee, config.credentials.teamId);
  if (existing?.slackDmChannelId) {
    await clearBootstrapError(existing.id);
    return {
      employeeId: employee.id,
      email: employee.email,
      outcome: "ready",
      message: "Slack DM channel is already open.",
    };
  }

  try {
    const user = existing?.slackUserId
      ? {
          id: existing.slackUserId,
          email: existing.userEmail ?? employee.email,
          name: existing.userName ?? employee.name,
        }
      : await lookupSlackUserByEmail(config.credentials, employee.email);
    const dmChannelId =
      existing?.slackDmChannelId ??
      (await openSlackDm(config.credentials, user.id));
    await upsertSlackContact({
      organizationId: employee.organizationId,
      employeeId: employee.id,
      slackTeamId: config.credentials.teamId,
      slackUserId: user.id,
      slackDmChannelId: dmChannelId,
      userEmail: user.email,
      userName: user.name,
      bootstrapError: null,
    });

    return {
      employeeId: employee.id,
      email: employee.email,
      outcome: "linked",
      message: "Resolved Slack user and opened a DM channel.",
    };
  } catch (err) {
    const message = humanizeSlackBootstrapError(err);
    await markBootstrapError(employee.id, message);
    return {
      employeeId: employee.id,
      email: employee.email,
      outcome:
        err instanceof SlackApiError && err.code === "users_not_found"
          ? "user_not_found"
          : "failed",
      message,
    };
  }
}

export async function resolveSlackContactForEmployee(employee: {
  id: string;
  organizationId: string;
  email: string;
}): Promise<{ id: string; slackDmChannelId: string | null } | null> {
  const contacts = await prisma.slackContact.findMany({
    where: {
      organizationId: employee.organizationId,
      OR: [
        { employeeId: employee.id },
        { userEmail: { equals: employee.email, mode: "insensitive" } },
      ],
    },
    orderBy: { lastActivityAt: "desc" },
    select: { id: true, slackDmChannelId: true },
  });
  return contacts[0] ?? null;
}

async function findReadyContact(
  employee: BootstrapEmployee,
  slackTeamId: string,
): Promise<{
  id: string;
  slackUserId: string;
  slackDmChannelId: string | null;
  userEmail: string | null;
  userName: string | null;
} | null> {
  return prisma.slackContact.findFirst({
    where: {
      organizationId: employee.organizationId,
      slackTeamId,
      OR: [
        { employeeId: employee.id },
        { userEmail: { equals: employee.email, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      slackUserId: true,
      slackDmChannelId: true,
      userEmail: true,
      userName: true,
    },
  });
}

export async function upsertSlackContact(input: {
  organizationId: string;
  employeeId: string | null;
  slackTeamId: string;
  slackUserId: string;
  slackDmChannelId: string | null;
  userEmail: string | null;
  userName: string | null;
  bootstrapError: string | null;
}): Promise<void> {
  const existing = await prisma.slackContact.findFirst({
    where: {
      OR: [
        { slackTeamId: input.slackTeamId, slackUserId: input.slackUserId },
        ...(input.employeeId
          ? [
              {
                organizationId: input.organizationId,
                employeeId: input.employeeId,
              } satisfies Prisma.SlackContactWhereInput,
            ]
          : []),
      ],
    },
    select: { id: true },
  });

  const data = {
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
    slackDmChannelId: input.slackDmChannelId,
    userEmail: input.userEmail?.toLowerCase() ?? null,
    userName: input.userName,
    bootstrapCheckedAt: new Date(),
    bootstrapError: input.bootstrapError,
    lastActivityAt: new Date(),
  };

  if (existing) {
    await prisma.slackContact.update({
      where: { id: existing.id },
      data,
    });
    if (input.employeeId) await clearEmployeeBootstrapError(input.employeeId);
    return;
  }

  await prisma.slackContact.create({ data });
  if (input.employeeId) await clearEmployeeBootstrapError(input.employeeId);
}

async function markBootstrapError(employeeId: string, message: string): Promise<void> {
  const now = new Date();
  await Promise.all([
    prisma.employee.update({
      where: { id: employeeId },
      data: {
        slackBootstrapCheckedAt: now,
        slackBootstrapError: message,
      },
    }),
    prisma.slackContact.updateMany({
      where: { employeeId },
      data: {
        bootstrapCheckedAt: now,
        bootstrapError: message,
      },
    }),
  ]);
}

async function clearBootstrapError(contactId: string): Promise<void> {
  await prisma.slackContact.update({
    where: { id: contactId },
    data: {
      bootstrapCheckedAt: new Date(),
      bootstrapError: null,
      lastActivityAt: new Date(),
    },
  });
}

async function clearEmployeeBootstrapError(employeeId: string): Promise<void> {
  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      slackBootstrapCheckedAt: new Date(),
      slackBootstrapError: null,
    },
  });
}

function humanizeSlackBootstrapError(err: unknown): string {
  if (err instanceof SlackApiError) {
    if (err.code === "users_not_found") {
      return "No Slack user matched this employee email.";
    }
    if (err.code === "missing_scope") {
      return "Slack app is missing required scopes for user lookup, DM open, or message send.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Slack bootstrap failed.";
}
