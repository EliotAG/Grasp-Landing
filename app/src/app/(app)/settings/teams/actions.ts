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
  describeTeamsConfigProblem,
  disableOrganizationTeams,
  getOrganizationTeamsConfig,
  saveOrganizationTeamsConfig,
  type OrganizationTeamsConfig,
} from "@/lib/teams/integration";
import {
  bootstrapTeamsForOrganization,
  testTeamsGraphBootstrapConfig,
} from "@/lib/teams/bootstrap";
import {
  TeamsSendError,
  sendTeamsMessageByReferenceId,
} from "@/lib/teams/proactive";

export type CheckTeamsEndpointState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export type SendTestMessageState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export type BootstrapTeamsState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export type SaveTeamsConfigState =
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

/**
 * Closed-pilot guard for any teams action that mutates state, talks
 * to Microsoft Graph, or sends a real Teams message. Returns the
 * tagged error object the action's state machine already understands;
 * callers do `if (denied) return denied`.
 */
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

function configProblem(config: OrganizationTeamsConfig): string | null {
  return describeTeamsConfigProblem(config);
}

export async function saveTeamsConfigAction(
  _prev: SaveTeamsConfigState,
  formData: FormData,
): Promise<SaveTeamsConfigState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  const enabled = formData.get("enabled") === "on";
  const microsoftTenantId = String(formData.get("microsoftTenantId") ?? "").trim();
  const microsoftAppId = String(formData.get("microsoftAppId") ?? "").trim();
  const microsoftAppPassword = String(
    formData.get("microsoftAppPassword") ?? "",
  ).trim();
  const teamsAppCatalogId = String(formData.get("teamsAppCatalogId") ?? "").trim();
  const teamsAppManifestId = String(formData.get("teamsAppManifestId") ?? "").trim();
  const serviceUrl = String(formData.get("serviceUrl") ?? "").trim();
  const voiceOrganizerUpn = String(formData.get("voiceOrganizerUpn") ?? "").trim();

  const existing = await prisma.organizationTeamsIntegration.findUnique({
    where: { organizationId },
    select: { microsoftAppPasswordEncrypted: true },
  });

  if (enabled) {
    const missing: string[] = [];
    if (!microsoftTenantId) missing.push("Microsoft tenant id");
    if (!microsoftAppId) missing.push("Microsoft app id");
    if (!microsoftAppPassword && !existing?.microsoftAppPasswordEncrypted) {
      missing.push("Microsoft app password");
    }
    if (!teamsAppCatalogId && !teamsAppManifestId) {
      missing.push("Teams app manifest id or catalog id");
    }
    if (missing.length) {
      return { ok: false, error: `Missing ${missing.join(", ")}.` };
    }
  }

  await saveOrganizationTeamsConfig({
    organizationId,
    enabled,
    microsoftTenantId,
    microsoftAppId,
    microsoftAppPassword,
    teamsAppCatalogId,
    teamsAppManifestId,
    serviceUrl,
    voiceOrganizerUpn,
  });
  revalidatePath("/settings");
  revalidatePath("/settings/teams");
  return { ok: true, message: enabled ? "Teams config saved." : "Teams config saved disabled." };
}

export async function disableTeamsAction(
  _prev: SaveTeamsConfigState,
  _formData?: FormData,
): Promise<SaveTeamsConfigState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  await disableOrganizationTeams(organizationId);
  revalidatePath("/settings");
  revalidatePath("/settings/teams");
  return { ok: true, message: "Teams disabled for this workspace." };
}

export async function checkTeamsEndpointAction(
  _prev?: CheckTeamsEndpointState,
  _formData?: FormData,
): Promise<CheckTeamsEndpointState> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Not signed in" };

  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host") ?? "localhost:3000";
  const endpoint = `${proto}://${host}/api/teams/messages`;

  const organizationId = session.user.organizationId;
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };
  const config = await getOrganizationTeamsConfig(organizationId);
  const problem = configProblem(config);
  if (problem) {
    return {
      ok: false,
      error: problem,
    };
  }

  try {
    const resp = await fetch(endpoint, { cache: "no-store" });
    if (!resp.ok) {
      return {
        ok: false,
        error: `Endpoint responded with HTTP ${resp.status}.`,
      };
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
          : "Could not reach the Teams messaging endpoint.",
    };
  }
}

export async function testTeamsGraphAction(
  _prev: BootstrapTeamsState,
  _formData?: FormData,
): Promise<BootstrapTeamsState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  const result = await testTeamsGraphBootstrapConfig(organizationId);
  return result.ok
    ? { ok: true, message: result.message }
    : { ok: false, error: result.message };
}

export async function bootstrapTeamsRecipientsAction(
  _prev: BootstrapTeamsState,
  _formData?: FormData,
): Promise<BootstrapTeamsState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) {
    return { ok: false, error: "Not signed in to a workspace" };
  }

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  const summary = await bootstrapTeamsForOrganization(organizationId);
  revalidatePath("/settings/teams");
  if (summary.total === 0) {
    return {
      ok: false,
      error: "Upload an org chart before bootstrapping Teams recipients.",
    };
  }

  const failures = summary.failed + summary.userNotFound;
  const message = `Checked ${summary.total} employees: ${summary.ready} ready, ${summary.installed} newly installed, ${summary.alreadyInstalled} already installed${
    failures ? `, ${failures} need attention` : ""
  }.`;
  return failures
    ? { ok: false, error: message }
    : { ok: true, message };
}

export async function sendTestMessageAction(
  _prev: SendTestMessageState,
  formData: FormData,
): Promise<SendTestMessageState> {
  const session = await auth();
  const organizationId = requireOrganizationId(session);
  if (!organizationId) return { ok: false, error: "Not signed in to a workspace" };

  const denied = denyIfNotApproved(session);
  if (denied) return denied;

  const referenceId = String(formData.get("referenceId") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();

  if (!referenceId) return { ok: false, error: "Pick a recipient" };
  if (!text) return { ok: false, error: "Type a message to send" };
  if (text.length > 4000)
    return { ok: false, error: "Message is too long (4000 char max)" };

  const ref = await prisma.teamsConversationReference.findUnique({
    where: { id: referenceId },
    select: { userName: true, userEmail: true, organizationId: true },
  });
  if (!ref) return { ok: false, error: "Recipient not found" };
  if (ref.organizationId && ref.organizationId !== organizationId) {
    return { ok: false, error: "Recipient belongs to a different workspace" };
  }

  try {
    await sendTeamsMessageByReferenceId(referenceId, text);
  } catch (err) {
    const msg =
      err instanceof TeamsSendError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Send failed";
    return { ok: false, error: msg };
  }

  revalidatePath("/settings/teams");
  return {
    ok: true,
    message: `Sent to ${ref.userName ?? ref.userEmail ?? "recipient"}.`,
  };
}
