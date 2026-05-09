import type { OrganizationSlackIntegration } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db";

export interface SlackCredentials {
  botToken: string;
  signingSecret: string;
  teamId: string;
}

export interface OrganizationSlackConfig {
  source: "organization" | "env";
  organizationId: string | null;
  enabled: boolean;
  credentials: SlackCredentials | null;
  teamName: string | null;
  appId: string | null;
  botUserId: string | null;
  missing: string[];
  row: OrganizationSlackIntegration | null;
}

export interface SaveOrganizationSlackConfigInput {
  organizationId: string;
  enabled: boolean;
  slackTeamId: string;
  slackTeamName?: string;
  slackAppId?: string;
  slackBotUserId?: string;
  slackBotToken?: string;
  slackSigningSecret?: string;
}

function clean(value: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function envConfig(organizationId: string | null): OrganizationSlackConfig {
  const teamId = clean(process.env.SLACK_TEAM_ID);
  const teamName = clean(process.env.SLACK_TEAM_NAME);
  const appId = clean(process.env.SLACK_APP_ID);
  const botUserId = clean(process.env.SLACK_BOT_USER_ID);
  const botToken = clean(process.env.SLACK_BOT_TOKEN);
  const signingSecret = clean(process.env.SLACK_SIGNING_SECRET);
  const missing: string[] = [];
  if (!teamId) missing.push("SLACK_TEAM_ID");
  if (!botToken) missing.push("SLACK_BOT_TOKEN");
  if (!signingSecret) missing.push("SLACK_SIGNING_SECRET");

  return {
    source: "env",
    organizationId,
    enabled: missing.length === 0,
    credentials:
      teamId && botToken && signingSecret
        ? { teamId, botToken, signingSecret }
        : null,
    teamName,
    appId,
    botUserId,
    missing,
    row: null,
  };
}

function fromRow(row: OrganizationSlackIntegration): OrganizationSlackConfig {
  const missing: string[] = [];
  const teamId = clean(row.slackTeamId);
  const encryptedBotToken = clean(row.slackBotTokenEncrypted);
  const encryptedSigningSecret = clean(row.slackSigningSecretEncrypted);

  if (!teamId) missing.push("Slack team id");
  if (!encryptedBotToken) missing.push("Slack bot token");
  if (!encryptedSigningSecret) missing.push("Slack signing secret");

  let botToken: string | null = null;
  let signingSecret: string | null = null;
  if (encryptedBotToken) {
    try {
      botToken = decryptSecret(encryptedBotToken);
    } catch {
      missing.push("decryptable Slack bot token");
    }
  }
  if (encryptedSigningSecret) {
    try {
      signingSecret = decryptSecret(encryptedSigningSecret);
    } catch {
      missing.push("decryptable Slack signing secret");
    }
  }

  return {
    source: "organization",
    organizationId: row.organizationId,
    enabled: row.enabled,
    credentials:
      row.enabled && teamId && botToken && signingSecret
        ? { teamId, botToken, signingSecret }
        : null,
    teamName: clean(row.slackTeamName),
    appId: clean(row.slackAppId),
    botUserId: clean(row.slackBotUserId),
    missing,
    row,
  };
}

export async function getOrganizationSlackConfig(
  organizationId: string,
  options: { allowEnvFallback?: boolean } = {},
): Promise<OrganizationSlackConfig> {
  const allowEnvFallback = options.allowEnvFallback ?? true;
  const row = await prisma.organizationSlackIntegration.findUnique({
    where: { organizationId },
  });
  if (row) return fromRow(row);
  if (allowEnvFallback) return envConfig(organizationId);
  return {
    source: "organization",
    organizationId,
    enabled: false,
    credentials: null,
    teamName: null,
    appId: null,
    botUserId: null,
    missing: ["Slack is not configured for this workspace"],
    row: null,
  };
}

export async function getSlackConfigByTeamId(
  slackTeamId: string,
): Promise<OrganizationSlackConfig | null> {
  const row = await prisma.organizationSlackIntegration.findFirst({
    where: { enabled: true, slackTeamId },
  });
  if (row) return fromRow(row);
  const env = envConfig(null);
  return env.credentials?.teamId === slackTeamId ? env : null;
}

export async function getEnabledSlackConfigs(): Promise<OrganizationSlackConfig[]> {
  const rows = await prisma.organizationSlackIntegration.findMany({
    where: { enabled: true },
  });
  const configs = rows.map(fromRow);
  const env = envConfig(null);
  if (env.enabled) configs.push(env);
  return configs;
}

export async function saveOrganizationSlackConfig(
  input: SaveOrganizationSlackConfigInput,
): Promise<OrganizationSlackIntegration> {
  const botToken = clean(input.slackBotToken);
  const signingSecret = clean(input.slackSigningSecret);

  const data = {
    enabled: input.enabled,
    slackTeamId: clean(input.slackTeamId),
    slackTeamName: clean(input.slackTeamName),
    slackAppId: clean(input.slackAppId),
    slackBotUserId: clean(input.slackBotUserId),
    lastCheckError: null,
    ...(botToken ? { slackBotTokenEncrypted: encryptSecret(botToken) } : {}),
    ...(signingSecret
      ? { slackSigningSecretEncrypted: encryptSecret(signingSecret) }
      : {}),
  };

  return prisma.organizationSlackIntegration.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      ...data,
    },
    update: data,
  });
}

export async function disableOrganizationSlack(
  organizationId: string,
): Promise<void> {
  await prisma.organizationSlackIntegration.upsert({
    where: { organizationId },
    create: { organizationId, enabled: false },
    update: { enabled: false },
  });
}

export async function markOrganizationSlackCheck(
  organizationId: string,
  error: string | null,
): Promise<void> {
  await prisma.organizationSlackIntegration.update({
    where: { organizationId },
    data: {
      lastCheckedAt: new Date(),
      lastCheckError: error,
    },
  });
}

export function describeSlackConfigProblem(
  config: OrganizationSlackConfig,
): string | null {
  if (!config.enabled) return "Slack is disabled for this workspace.";
  if (!config.credentials) {
    return `Slack is missing configuration: ${config.missing.join(", ")}.`;
  }
  return null;
}
