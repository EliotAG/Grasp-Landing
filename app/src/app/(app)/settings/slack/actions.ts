"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  WorkspacePendingApprovalError,
  assertOrgApproved,
} from "@/lib/access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  bootstrapSlackForOrganization,
  getSlackBootstrapReadiness,
} from "@/lib/slack/bootstrap";
import { testSlackAuth } from "@/lib/slack/client";
import {
  describeSlackConfigProblem,
  disableOrganizationSlack,
  getOrganizationSlackConfig,
  markOrganizationSlackCheck,
  saveOrganizationSlackConfig,
} from "@/lib/slack/integration";
import {
  SlackSendError,
  sendSlackMessageByContactId,
} from "@/lib/slack/proactive";

export type SaveSlackConfigState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export type BootstrapSlackState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export type CheckSlackEndpointState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export type SendSlackTestState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

function requireOrganizationId(
  session: { user?: { organizationId?: string | null } } | null,
) {
  const organizationId = session?.user?.organizationId;
  if (!session?.user || !organizationId) return null;
  return organizationId;
}

function denyIfNotApproved(
  session: Parameters<typeof assertOrgApproved>[0],
): { ok: false; error: string } | null {
  try {
    assertOrgApproved(session);
    return null;
  } catch (err) {
    if (err instanceof WorkspacePendingApprovalError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}

export async function saveSlackConfigAction(
  _prev: SaveSlackConfigState,
  formData: FormData,
): Promise<SaveSlackConfigState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  const enabled = formData.get("enabled") === "on";
  const slackTeamId = String(formData.get("slackTeamId") ?? "").trim();
  const slackTeamName = String(formData.get("slackTeamName") ?? "").trim();
  const slackAppId = String(formData.get("slackAppId") ?? "").trim();
  const slackBotUserId = String(formData.get("slackBotUserId") ?? "").trim();
  const slackBotToken = String(formData.get("slackBotToken") ?? "").trim();
  const slackSigningSecret = String(
    formData.get("slackSigningSecret") ?? "",
  ).trim();

  const existing = await prisma.organizationSlackIntegration.findUnique({
    where: { organizationId },
    select: {
      slackBotTokenEncrypted: true,
      slackSigningSecretEncrypted: true,
    },
  });

  if (enabled) {
    const missing: string[] = [];
    if (!slackTeamId) missing.push("Slack team id");
    if (!slackBotToken && !existing?.slackBotTokenEncrypted) {
      missing.push("Slack bot token");
    }
    if (!slackSigningSecret && !existing?.slackSigningSecretEncrypted) {
      missing.push("Slack signing secret");
    }
    if (missing.length) return { ok: false, error: `Missing ${missing.join(", ")}.` };
  }

  await saveOrganizationSlackConfig({
    organizationId,
    enabled,
    slackTeamId,
    slackTeamName,
    slackAppId,
    slackBotUserId,
    slackBotToken,
    slackSigningSecret,
  });
  revalidatePath("/settings");
  revalidatePath("/settings/slack");
  return { ok: true, message: enabled ? "Slack config saved." : "Slack config saved disabled." };
}

export async function disableSlackAction(
  _prev: SaveSlackConfigState,
  _formData?: FormData,
): Promise<SaveSlackConfigState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  await disableOrganizationSlack(organizationId);
  revalidatePath("/settings");
  revalidatePath("/settings/slack");
  return { ok: true, message: "Slack disabled for this workspace." };
}

export async function checkSlackEndpointAction(
  _prev?: CheckSlackEndpointState,
  _formData?: FormData,
): Promise<CheckSlackEndpointState> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Not signed in" };

  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host") ?? "localhost:3000";
  const endpoint = `${proto}://${host}/api/slack/events`;

  try {
    const resp = await fetch(endpoint, { cache: "no-store" });
    if (!resp.ok) {
      return { ok: false, error: `Endpoint responded with HTTP ${resp.status}.` };
    }
    const body = (await resp.json()) as { service?: string };
    return {
      ok: true,
      message: `Endpoint is reachable${body.service ? ` (${body.service})` : ""}.`,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Could not reach the Slack events endpoint.",
    };
  }
}

export async function testSlackAuthAction(
  _prev: BootstrapSlackState,
  _formData?: FormData,
): Promise<BootstrapSlackState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  const config = await getOrganizationSlackConfig(organizationId);
  const problem = describeSlackConfigProblem(config);
  if (problem || !config.credentials) {
    return { ok: false, error: problem ?? "Slack is not configured." };
  }

  try {
    const authResult = await testSlackAuth(config.credentials);
    await markOrganizationSlackCheck(organizationId, null);
    return {
      ok: true,
      message: `Slack auth works for ${authResult.teamName ?? authResult.teamId ?? "this workspace"}${authResult.botUserId ? ` as bot ${authResult.botUserId}` : ""}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Slack auth test failed.";
    await markOrganizationSlackCheck(organizationId, message);
    return { ok: false, error: message };
  }
}

export async function bootstrapSlackRecipientsAction(
  _prev: BootstrapSlackState,
  _formData?: FormData,
): Promise<BootstrapSlackState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  const summary = await bootstrapSlackForOrganization(organizationId);
  revalidatePath("/settings/slack");
  if (summary.total === 0) {
    return {
      ok: false,
      error: "Upload an org chart before bootstrapping Slack recipients.",
    };
  }

  const failures = summary.failed + summary.userNotFound;
  const message = `Checked ${summary.total} employees: ${summary.ready} ready, ${summary.linked} newly linked${
    failures ? `, ${failures} need attention` : ""
  }.`;
  return failures ? { ok: false, error: message } : { ok: true, message };
}

export async function sendSlackTestMessageAction(
  _prev: SendSlackTestState,
  formData: FormData,
): Promise<SendSlackTestState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  const contactId = String(formData.get("contactId") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();
  if (!contactId) return { ok: false, error: "Pick a recipient" };
  if (!text) return { ok: false, error: "Type a message to send" };
  if (text.length > 4000) {
    return { ok: false, error: "Message is too long (4000 char max)" };
  }

  const contact = await prisma.slackContact.findUnique({
    where: { id: contactId },
    select: { userName: true, userEmail: true, organizationId: true },
  });
  if (!contact) return { ok: false, error: "Recipient not found" };
  if (contact.organizationId !== organizationId) {
    return { ok: false, error: "Recipient belongs to a different workspace" };
  }

  try {
    await sendSlackMessageByContactId(contactId, text);
  } catch (err) {
    const message =
      err instanceof SlackSendError || err instanceof Error
        ? err.message
        : "Slack send failed";
    return { ok: false, error: message };
  }

  return {
    ok: true,
    message: `Sent to ${contact.userName ?? contact.userEmail ?? "Slack user"}.`,
  };
}

export async function readSlackReadinessForAction(organizationId: string) {
  return getSlackBootstrapReadiness(organizationId);
}
