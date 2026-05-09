/**
 * Shared "load + ownership-check" helper for change-plan server actions.
 *
 * Centralizes the auth + tenant scoping pattern that previously lived
 * inline in the wizard actions. Any server action that needs to mutate
 * a ChangePlan should go through this so we cannot accidentally expose
 * a plan to a user whose org doesn't own it.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth-actions";
import { prisma } from "@/lib/db";

export async function loadOwnedPlan(id: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    redirect("/sign-in");
  }
  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!plan) throw new Error("Change plan not found");
  return { session, plan };
}
