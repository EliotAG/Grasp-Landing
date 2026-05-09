import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  GraphClientError,
  findGraphUserByEmail,
  findInstalledTeamsAppForUser,
  findTeamsAppByManifestId,
  getInstalledTeamsAppChat,
  installTeamsAppForUser,
} from "@/lib/graph/client";
import {
  describeTeamsConfigProblem,
  getEnvTeamsConfig,
  getOrganizationTeamsConfig,
  type OrganizationTeamsConfig,
} from "@/lib/teams/integration";

type BootstrapEmployee = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  microsoftAadObjectId: string | null;
  microsoftUserPrincipalName: string | null;
  teamsAppInstallationId: string | null;
  teamsAppInstalledAt: Date | null;
};

export type TeamsBootstrapOutcome =
  | "ready"
  | "installed"
  | "already_installed"
  | "teams_disabled"
  | "user_not_found"
  | "graph_not_configured"
  | "app_not_configured"
  | "failed";

export interface TeamsBootstrapResult {
  employeeId: string;
  email: string;
  outcome: TeamsBootstrapOutcome;
  message: string;
}

export interface TeamsBootstrapSummary {
  total: number;
  ready: number;
  installed: number;
  alreadyInstalled: number;
  userNotFound: number;
  failed: number;
  results: TeamsBootstrapResult[];
}

export interface TeamsBootstrapReadiness {
  employees: number;
  resolvedUsers: number;
  installedUsers: number;
  capturedReferences: number;
  readyRecipients: number;
  lastError: string | null;
}

export async function getTeamsGraphConfigStatus(
  organizationId?: string,
): Promise<{
  ok: boolean;
  missing: string[];
  manifestId: string | null;
  catalogId: string | null;
  config: OrganizationTeamsConfig;
}> {
  const config = organizationId
    ? await getOrganizationTeamsConfig(organizationId)
    : getEnvTeamsConfig();
  return {
    ok:
      config.enabled &&
      Boolean(config.credentials) &&
      Boolean(config.teamsAppCatalogId || config.teamsAppManifestId),
    missing: config.missing,
    manifestId: config.teamsAppManifestId,
    catalogId: config.teamsAppCatalogId,
    config,
  };
}

export async function testTeamsGraphBootstrapConfig(
  organizationId?: string,
): Promise<{
  ok: boolean;
  message: string;
}> {
  const status = await getTeamsGraphConfigStatus(organizationId);
  if (!status.ok) {
    return {
      ok: false,
      message:
        describeTeamsConfigProblem(status.config) ??
        `Missing Teams Graph bootstrap config: ${status.missing.join(", ")}.`,
    };
  }

  try {
    const teamsAppId = await resolveTeamsAppCatalogId(status.config);
    return {
      ok: true,
      message: `Microsoft Graph is reachable and Grasp Teams app ${teamsAppId} is available.`,
    };
  } catch (err) {
    return { ok: false, message: humanizeBootstrapError(err) };
  }
}

export async function getTeamsBootstrapReadiness(
  organizationId: string,
): Promise<TeamsBootstrapReadiness> {
  const employees = await prisma.employee.findMany({
    where: { organizationId },
    select: {
      id: true,
      email: true,
      microsoftAadObjectId: true,
      teamsAppInstalledAt: true,
      teamsBootstrapError: true,
    },
  });
  const aadIds = employees
    .map((e) => e.microsoftAadObjectId)
    .filter((id): id is string => Boolean(id));
  const emails = employees.map((e) => e.email);
  const referenceFilters: Prisma.TeamsConversationReferenceWhereInput[] = [
    { organizationId },
    { employeeId: { in: employees.map((e) => e.id) } },
  ];
  if (aadIds.length) referenceFilters.push({ aadObjectId: { in: aadIds } });
  if (emails.length) {
    referenceFilters.push({ userEmail: { in: emails, mode: "insensitive" } });
  }
  const refs = await prisma.teamsConversationReference.findMany({
    where: {
      OR: referenceFilters,
    },
    select: { employeeId: true, aadObjectId: true, userEmail: true },
  });

  const readyIds = new Set<string>();
  const employeeByAad = new Map(
    employees
      .filter((e) => e.microsoftAadObjectId)
      .map((e) => [e.microsoftAadObjectId!, e.id]),
  );
  const employeeByEmail = new Map(employees.map((e) => [e.email.toLowerCase(), e.id]));
  for (const ref of refs) {
    const employeeId =
      ref.employeeId ??
      employeeByAad.get(ref.aadObjectId) ??
      (ref.userEmail ? employeeByEmail.get(ref.userEmail.toLowerCase()) : undefined);
    if (employeeId) readyIds.add(employeeId);
  }

  return {
    employees: employees.length,
    resolvedUsers: employees.filter((e) => e.microsoftAadObjectId).length,
    installedUsers: employees.filter((e) => e.teamsAppInstalledAt).length,
    capturedReferences: refs.length,
    readyRecipients: readyIds.size,
    lastError: employees.find((e) => e.teamsBootstrapError)?.teamsBootstrapError ?? null,
  };
}

export async function bootstrapTeamsForOrganization(
  organizationId: string,
): Promise<TeamsBootstrapSummary> {
  const employees = await prisma.employee.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      organizationId: true,
      name: true,
      email: true,
      microsoftAadObjectId: true,
      microsoftUserPrincipalName: true,
      teamsAppInstallationId: true,
      teamsAppInstalledAt: true,
    },
  });

  const results: TeamsBootstrapResult[] = [];
  for (const employee of employees) {
    results.push(await ensureTeamsAppInstalledForEmployee(employee));
  }

  return {
    total: results.length,
    ready: results.filter((r) => r.outcome === "ready").length,
    installed: results.filter((r) => r.outcome === "installed").length,
    alreadyInstalled: results.filter((r) => r.outcome === "already_installed").length,
    userNotFound: results.filter((r) => r.outcome === "user_not_found").length,
    failed: results.filter(
      (r) =>
        r.outcome === "failed" ||
        r.outcome === "teams_disabled" ||
        r.outcome === "graph_not_configured" ||
        r.outcome === "app_not_configured",
    ).length,
    results,
  };
}

export async function ensureTeamsAppInstalledForEmployee(
  employee: BootstrapEmployee,
): Promise<TeamsBootstrapResult> {
  const ref = await findReadyReference(employee);
  if (ref) {
    await linkReferenceToEmployee(ref.id, employee);
    return {
      employeeId: employee.id,
      email: employee.email,
      outcome: "ready",
      message: "Conversation reference is already captured.",
    };
  }

  const configStatus = await getTeamsGraphConfigStatus(employee.organizationId);
  const problem = describeTeamsConfigProblem(configStatus.config);
  if (!configStatus.ok) {
    const message =
      problem ??
      `Missing Teams Graph bootstrap config: ${configStatus.missing.join(
        ", ",
      )}.`;
    await markBootstrapError(employee.id, message);
    return {
      employeeId: employee.id,
      email: employee.email,
      outcome: configStatus.config.enabled ? "graph_not_configured" : "teams_disabled",
      message,
    };
  }

  try {
    const teamsAppId = await resolveTeamsAppCatalogId(configStatus.config);
    const resolved = await resolveEmployeeIdentity(employee, configStatus.config);
    if (!resolved.microsoftAadObjectId) {
      return {
        employeeId: employee.id,
        email: employee.email,
        outcome: "user_not_found",
        message: "No Microsoft Entra user matched this employee email.",
      };
    }

    const existing = await findInstalledTeamsAppForUser(
      resolved.microsoftAadObjectId,
      teamsAppId,
      configStatus.config.credentials ?? undefined,
    );
    if (existing) {
      await markInstalled(employee.id, existing.id, null);
      return {
        employeeId: employee.id,
        email: employee.email,
        outcome: "already_installed",
        message: "Grasp Teams app is already installed for this user.",
      };
    }

    await installTeamsAppForUser(
      resolved.microsoftAadObjectId,
      teamsAppId,
      configStatus.config.credentials ?? undefined,
    );
    const installed = await findInstalledTeamsAppForUser(
      resolved.microsoftAadObjectId,
      teamsAppId,
      configStatus.config.credentials ?? undefined,
    );
    const chat = installed
      ? await getInstalledTeamsAppChat(
          resolved.microsoftAadObjectId,
          installed.id,
          configStatus.config.credentials ?? undefined,
        )
      : null;
    await markInstalled(employee.id, installed?.id ?? null, null);

    return {
      employeeId: employee.id,
      email: employee.email,
      outcome: "installed",
      message: chat
        ? "Installed Grasp in Teams personal scope and resolved the chat."
        : "Installed Grasp in Teams personal scope; waiting for Teams to deliver the bot conversation event.",
    };
  } catch (err) {
    const message = humanizeBootstrapError(err);
    await markBootstrapError(employee.id, message);
    return {
      employeeId: employee.id,
      email: employee.email,
      outcome: "failed",
      message,
    };
  }
}

export async function resolveTeamsReferenceForEmployee(input: {
  id: string;
  organizationId: string;
  email: string;
  microsoftAadObjectId: string | null;
}): Promise<{ id: string } | null> {
  const filters: Prisma.TeamsConversationReferenceWhereInput[] = [
    { employeeId: input.id },
    { userEmail: { equals: input.email, mode: "insensitive" } },
  ];
  if (input.microsoftAadObjectId) {
    filters.push({ aadObjectId: input.microsoftAadObjectId });
  }
  const ref = await prisma.teamsConversationReference.findFirst({
    where: { OR: filters },
    select: { id: true },
  });
  if (ref) {
    await prisma.teamsConversationReference.update({
      where: { id: ref.id },
      data: { employeeId: input.id, organizationId: input.organizationId },
    });
  }
  return ref;
}

async function resolveTeamsAppCatalogId(
  config: OrganizationTeamsConfig,
): Promise<string> {
  if (config.teamsAppCatalogId) return config.teamsAppCatalogId;
  if (!config.teamsAppManifestId) {
    throw new Error("Set TEAMS_APP_MANIFEST_ID or TEAMS_APP_CATALOG_ID.");
  }
  const app = await findTeamsAppByManifestId(
    config.teamsAppManifestId,
    config.credentials ?? undefined,
  );
  if (!app) {
    throw new Error(
      "Grasp Teams app was not found in the org app catalog. Upload/publish it before bootstrapping users.",
    );
  }
  return app.id;
}

async function resolveEmployeeIdentity(
  employee: BootstrapEmployee,
  config: OrganizationTeamsConfig,
): Promise<{
  microsoftAadObjectId: string | null;
}> {
  if (employee.microsoftAadObjectId) {
    return { microsoftAadObjectId: employee.microsoftAadObjectId };
  }

  const user = await findGraphUserByEmail(
    employee.email,
    config.credentials ?? undefined,
  );
  if (!user) {
    await markBootstrapError(
      employee.id,
      "No Microsoft Entra user matched this employee email.",
    );
    return { microsoftAadObjectId: null };
  }

  await prisma.employee.update({
    where: { id: employee.id },
    data: {
      microsoftAadObjectId: user.id,
      microsoftUserPrincipalName: user.userPrincipalName ?? user.mail ?? employee.email,
      teamsBootstrapCheckedAt: new Date(),
      teamsBootstrapError: null,
    },
  });
  return { microsoftAadObjectId: user.id };
}

async function findReadyReference(employee: BootstrapEmployee): Promise<{ id: string } | null> {
  const filters: Prisma.TeamsConversationReferenceWhereInput[] = [
    { employeeId: employee.id },
    { userEmail: { equals: employee.email, mode: "insensitive" } },
  ];
  if (employee.microsoftAadObjectId) {
    filters.push({ aadObjectId: employee.microsoftAadObjectId });
  }
  return prisma.teamsConversationReference.findFirst({
    where: { OR: filters },
    select: { id: true },
  });
}

async function linkReferenceToEmployee(
  referenceId: string,
  employee: BootstrapEmployee,
): Promise<void> {
  await prisma.teamsConversationReference.update({
    where: { id: referenceId },
    data: {
      employeeId: employee.id,
      organizationId: employee.organizationId,
    },
  });
}

async function markInstalled(
  employeeId: string,
  installationId: string | null,
  error: string | null,
): Promise<void> {
  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      teamsAppInstallationId: installationId,
      teamsAppInstalledAt: new Date(),
      teamsBootstrapCheckedAt: new Date(),
      teamsBootstrapError: error,
    },
  });
}

async function markBootstrapError(
  employeeId: string,
  error: string,
): Promise<void> {
  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      teamsBootstrapCheckedAt: new Date(),
      teamsBootstrapError: error,
    },
  });
}

function humanizeBootstrapError(err: unknown): string {
  if (err instanceof GraphClientError) {
    if (err.status === 403) {
      if (err.message.includes("AppCatalog.Read")) {
        return "Microsoft Graph can install Teams apps, but cannot look up the Grasp app in the Teams app catalog. Set TEAMS_APP_CATALOG_ID in .env.local, or grant AppCatalog.Read.All application permission with admin consent.";
      }
      if (err.message.includes("Insufficient privileges")) {
        return "Microsoft Graph cannot read users. Because this org chart already has Entra IDs this is only needed for future email resolution; grant User.Read.All or Directory.Read.All application permission if you want Graph to resolve users by email.";
      }
      return "Microsoft Graph denied the Teams app install request. Grant TeamsAppInstallation.ReadWriteForUser.All application permission with admin consent, then retry bootstrap.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Teams bootstrap failed.";
}
