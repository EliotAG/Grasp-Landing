import type { OrganizationTeamsIntegration } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db";
import { trimOrNull } from "@/lib/utils";

export interface TeamsCredentials {
  appId: string;
  appPassword: string;
  tenantId: string;
}

export interface OrganizationTeamsConfig {
  source: "organization" | "env";
  organizationId: string | null;
  enabled: boolean;
  credentials: TeamsCredentials | null;
  teamsAppCatalogId: string | null;
  teamsAppManifestId: string | null;
  serviceUrl: string | null;
  missing: string[];
  row: OrganizationTeamsIntegration | null;
}

export interface SaveOrganizationTeamsConfigInput {
  organizationId: string;
  enabled: boolean;
  microsoftTenantId: string;
  microsoftAppId: string;
  microsoftAppPassword?: string;
  teamsAppCatalogId?: string;
  teamsAppManifestId?: string;
  serviceUrl?: string;
}

function envConfig(organizationId: string | null): OrganizationTeamsConfig {
  const appId = trimOrNull(process.env.MicrosoftAppId);
  const appPassword = trimOrNull(process.env.MicrosoftAppPassword);
  const tenantId = trimOrNull(process.env.MicrosoftAppTenantId);
  const missing: string[] = [];
  if (!appId) missing.push("MicrosoftAppId");
  if (!appPassword) missing.push("MicrosoftAppPassword");
  if (!tenantId) missing.push("MicrosoftAppTenantId");

  const manifestId =
    trimOrNull(process.env.TEAMS_APP_MANIFEST_ID) ??
    trimOrNull(process.env.MicrosoftAppId);
  const catalogId = trimOrNull(process.env.TEAMS_APP_CATALOG_ID);
  if (!manifestId && !catalogId) {
    missing.push("TEAMS_APP_MANIFEST_ID or TEAMS_APP_CATALOG_ID");
  }

  return {
    source: "env",
    organizationId,
    enabled: missing.length === 0,
    credentials:
      appId && appPassword && tenantId
        ? { appId, appPassword, tenantId }
        : null,
    teamsAppCatalogId: catalogId,
    teamsAppManifestId: manifestId,
    serviceUrl: null,
    missing,
    row: null,
  };
}

function fromRow(row: OrganizationTeamsIntegration): OrganizationTeamsConfig {
  const missing: string[] = [];
  const appId = trimOrNull(row.microsoftAppId);
  const tenantId = trimOrNull(row.microsoftTenantId);
  const encrypted = trimOrNull(row.microsoftAppPasswordEncrypted);
  const catalogId = trimOrNull(row.teamsAppCatalogId);
  const manifestId = trimOrNull(row.teamsAppManifestId);

  if (!appId) missing.push("Microsoft app id");
  if (!tenantId) missing.push("Microsoft tenant id");
  if (!encrypted) missing.push("Microsoft app password");
  if (!catalogId && !manifestId) {
    missing.push("Teams app manifest id or catalog id");
  }

  let appPassword: string | null = null;
  if (encrypted) {
    try {
      appPassword = decryptSecret(encrypted);
    } catch {
      missing.push("decryptable Microsoft app password");
    }
  }

  return {
    source: "organization",
    organizationId: row.organizationId,
    enabled: row.enabled,
    credentials:
      row.enabled && appId && tenantId && appPassword
        ? { appId, appPassword, tenantId }
        : null,
    teamsAppCatalogId: catalogId,
    teamsAppManifestId: manifestId,
    serviceUrl: trimOrNull(row.serviceUrl),
    missing,
    row,
  };
}

export async function getOrganizationTeamsConfig(
  organizationId: string,
  options: { allowEnvFallback?: boolean } = {},
): Promise<OrganizationTeamsConfig> {
  const allowEnvFallback = options.allowEnvFallback ?? true;
  const row = await prisma.organizationTeamsIntegration.findUnique({
    where: { organizationId },
  });
  if (row) return fromRow(row);
  if (allowEnvFallback) return envConfig(organizationId);
  return {
    source: "organization",
    organizationId,
    enabled: false,
    credentials: null,
    teamsAppCatalogId: null,
    teamsAppManifestId: null,
    serviceUrl: null,
    missing: ["Teams is not configured for this workspace"],
    row: null,
  };
}

export async function getTeamsConfigByMicrosoftAppId(
  microsoftAppId: string,
): Promise<OrganizationTeamsConfig | null> {
  const row = await prisma.organizationTeamsIntegration.findFirst({
    where: { enabled: true, microsoftAppId },
  });
  return row ? fromRow(row) : null;
}

export function getEnvTeamsConfig(): OrganizationTeamsConfig {
  return envConfig(null);
}

export async function saveOrganizationTeamsConfig(
  input: SaveOrganizationTeamsConfigInput,
): Promise<OrganizationTeamsIntegration> {
  const secret = trimOrNull(input.microsoftAppPassword);
  const encrypted = secret ? encryptSecret(secret) : undefined;

  const data = {
    enabled: input.enabled,
    microsoftTenantId: trimOrNull(input.microsoftTenantId),
    microsoftAppId: trimOrNull(input.microsoftAppId),
    teamsAppCatalogId: trimOrNull(input.teamsAppCatalogId),
    teamsAppManifestId: trimOrNull(input.teamsAppManifestId),
    serviceUrl: trimOrNull(input.serviceUrl),
    lastCheckError: null,
    ...(encrypted ? { microsoftAppPasswordEncrypted: encrypted } : {}),
  };

  return prisma.organizationTeamsIntegration.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      ...data,
    },
    update: data,
  });
}

export async function disableOrganizationTeams(
  organizationId: string,
): Promise<void> {
  await prisma.organizationTeamsIntegration.upsert({
    where: { organizationId },
    create: { organizationId, enabled: false },
    update: { enabled: false },
  });
}

export async function markOrganizationTeamsCheck(
  organizationId: string,
  error: string | null,
): Promise<void> {
  await prisma.organizationTeamsIntegration.update({
    where: { organizationId },
    data: {
      lastCheckedAt: new Date(),
      lastCheckError: error,
    },
  });
}

export function describeTeamsConfigProblem(config: OrganizationTeamsConfig): string | null {
  if (!config.enabled) return "Teams is disabled for this workspace.";
  if (!config.credentials) {
    return `Teams is missing configuration: ${config.missing.join(", ")}.`;
  }
  if (!config.teamsAppCatalogId && !config.teamsAppManifestId) {
    return "Teams is missing the app catalog id or manifest id.";
  }
  return null;
}
