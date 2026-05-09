import { notFound, redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/lib/auth";

const ADMIN_EMAIL_DOMAIN = "@agentgrasp.com";

export function isAgentGraspAdminEmail(email?: string | null): boolean {
  return email?.trim().toLowerCase().endsWith(ADMIN_EMAIL_DOMAIN) ?? false;
}

export function isAgentGraspAdminSession(
  session: Session | null | undefined,
): boolean {
  return isAgentGraspAdminEmail(session?.user?.email);
}

export async function requireAgentGraspAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  if (!isAgentGraspAdminSession(session)) notFound();
  return session;
}
