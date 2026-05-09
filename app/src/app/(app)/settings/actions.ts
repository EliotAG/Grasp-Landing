"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  canManageWorkspaceMembers,
  inviteOrganizationMember,
  normalizeInviteRole,
} from "@/lib/organization-invitations";

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
  const configuredUrl =
    process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const host = hdrs.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
