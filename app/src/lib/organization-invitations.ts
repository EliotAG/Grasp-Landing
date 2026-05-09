import type { MembershipRole } from "@prisma/client";
import nodemailer from "nodemailer";

import { prisma } from "@/lib/db";
import { isResendConfigured, sendResendEmail } from "@/lib/email/resend";

export type WorkspaceInviteRole = Extract<MembershipRole, "admin" | "member">;

export function canManageWorkspaceMembers(
  role: MembershipRole | null | undefined,
) {
  return role === "owner" || role === "admin";
}

export function normalizeInviteRole(value: FormDataEntryValue | null) {
  return value === "member" ? "member" : "admin";
}

export function displayMembershipRole(role: MembershipRole) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "User";
}

export async function inviteOrganizationMember({
  organizationId,
  invitedByUserId,
  email,
  role,
  baseUrl,
}: {
  organizationId: string;
  invitedByUserId: string;
  email: string;
  role: WorkspaceInviteRole;
  baseUrl: string;
}) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { ok: false as const, error: "Enter an email address." };
  }

  const existingMember = await prisma.membership.findFirst({
    where: {
      organizationId,
      user: { email: { equals: normalizedEmail, mode: "insensitive" } },
    },
    select: { user: { select: { email: true } } },
  });
  if (existingMember) {
    return {
      ok: false as const,
      error: `${existingMember.user.email} already has access to this workspace.`,
    };
  }

  const [organization, inviter] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
    prisma.user.findUnique({
      where: { id: invitedByUserId },
      select: { name: true, email: true },
    }),
  ]);
  if (!organization) {
    return { ok: false as const, error: "Workspace not found." };
  }

  const invitation = await prisma.organizationInvitation.upsert({
    where: {
      organizationId_email: { organizationId, email: normalizedEmail },
    },
    create: {
      organizationId,
      email: normalizedEmail,
      role,
      invitedByUserId,
    },
    update: {
      role,
      invitedByUserId,
      acceptedByUserId: null,
      acceptedAt: null,
    },
    select: { email: true },
  });

  try {
    await sendInviteEmail({
      to: invitation.email,
      organizationName: organization.name,
      inviterName: inviter?.name ?? inviter?.email ?? "A workspace admin",
      role,
      signInUrl: `${baseUrl}/sign-in`,
    });
  } catch (err) {
    return {
      ok: false as const,
      error: `Invite saved, but email could not be sent: ${
        err instanceof Error ? err.message : "Unknown email error"
      }`,
    };
  }

  return {
    ok: true as const,
    message: `Invite sent to ${invitation.email}.`,
  };
}

async function sendInviteEmail({
  to,
  organizationName,
  inviterName,
  role,
  signInUrl,
}: {
  to: string;
  organizationName: string;
  inviterName: string;
  role: WorkspaceInviteRole;
  signInUrl: string;
}) {
  const from = process.env.EMAIL_FROM ?? "Grasp <noreply@withgrasp.com>";
  const roleLabel = displayMembershipRole(role);
  const subject = `${inviterName} invited you to ${organizationName} on Grasp`;
  const text = [
    `${inviterName} invited you to ${organizationName} on Grasp as ${roleLabel}.`,
    "",
    "Sign in with this email address to join the workspace:",
    signInUrl,
  ].join("\n");
  const html = `<!doctype html>
<html><body style="margin:0;padding:32px;background:#FAF9F6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:20px;padding:36px">
    <div style="font-family:Georgia,serif;font-size:24px;font-weight:300;letter-spacing:-0.02em;margin-bottom:8px">grasp</div>
    <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:300;letter-spacing:-0.02em;margin:24px 0 12px">You have been invited to ${escapeHtml(organizationName)}</h1>
    <p style="color:#595959;line-height:1.6;margin:0 0 20px">${escapeHtml(inviterName)} invited you as ${roleLabel}. Sign in with <strong>${escapeHtml(to)}</strong> and Grasp will add you to the workspace.</p>
    <a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:999px;padding:12px 18px;font-weight:600;font-size:14px">Sign in to Grasp</a>
    <p style="color:#888;font-size:13px;line-height:1.6;margin:28px 0 0">If you were not expecting this invite, you can ignore this email.</p>
  </div>
</body></html>`;

  if (isResendConfigured()) {
    await sendResendEmail({ to, from, subject, text, html });
    return;
  }

  if (
    process.env.EMAIL_SERVER_HOST &&
    process.env.EMAIL_SERVER_USER &&
    process.env.EMAIL_SERVER_PASSWORD
  ) {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER_HOST,
      port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
      auth: {
        user: process.env.EMAIL_SERVER_USER,
        pass: process.env.EMAIL_SERVER_PASSWORD,
      },
    });
    await transporter.sendMail({ to, from, subject, text, html });
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("\n────────────────────────────────────────────");
    console.log(`Workspace invite for ${to}:`);
    console.log(text);
    console.log("────────────────────────────────────────────\n");
    return;
  }

  throw new Error("Email delivery is not configured.");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
