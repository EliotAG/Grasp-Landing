"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  WorkspacePendingApprovalError,
  assertOrgApproved,
} from "@/lib/access";
import {
  getAppBaseUrlFromHeaders,
  getConfiguredAppBaseUrl,
} from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { parseOrganizationTextChannel } from "@/lib/channels";
import { prisma } from "@/lib/db";
import {
  canManageWorkspaceMembers,
  inviteOrganizationMember,
  normalizeInviteRole,
} from "@/lib/organization-invitations";

export type SavePrimaryChannelState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export async function savePrimaryTextChannelAction(
  _prev: SavePrimaryChannelState,
  formData: FormData,
): Promise<SavePrimaryChannelState> {
  const session = await auth();
  const organizationId = session?.user?.organizationId;
  if (!session?.user || !organizationId) {
    return { ok: false, error: "Not signed in to a workspace" };
  }

  try {
    assertOrgApproved(session);
  } catch (err) {
    if (err instanceof WorkspacePendingApprovalError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  const primaryTextChannel = parseOrganizationTextChannel(
    formData.get("primaryTextChannel"),
  );
  if (!primaryTextChannel) {
    return { ok: false, error: "Pick Teams or Slack." };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { primaryTextChannel },
  });

  revalidatePath("/settings");
  revalidatePath("/settings/teams");
  revalidatePath("/settings/slack");
  return {
    ok: true,
    message:
      primaryTextChannel === "slack"
        ? "Slack is now the primary employee messaging channel."
        : "Microsoft Teams is now the primary employee messaging channel.",
  };
}

export type InviteMemberState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null;

export async function inviteMemberAction(
  _prev: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const session = await auth();
  const organizationId = session?.user?.organizationId;
  const userId = session?.user?.id;
  if (!organizationId || !userId) {
    return { ok: false, error: "Sign in to a workspace first." };
  }
  if (!canManageWorkspaceMembers(session.user.role)) {
    return { ok: false, error: "Only workspace admins can invite people." };
  }

  const email = String(formData.get("email") ?? "");
  const role = normalizeInviteRole(formData.get("role"));
  const baseUrl = await getBaseUrl();
  const result = await inviteOrganizationMember({
    organizationId,
    invitedByUserId: userId,
    email,
    role,
    baseUrl,
  });

  revalidatePath("/settings");
  revalidatePath("/org-chart");
  const sourcePath = String(formData.get("sourcePath") ?? "");
  if (sourcePath.startsWith("/people/")) revalidatePath(sourcePath);
  return result;
}

async function getBaseUrl() {
  const configuredUrl = getConfiguredAppBaseUrl();
  if (configuredUrl) return configuredUrl;

  return getAppBaseUrlFromHeaders(await headers());
}
