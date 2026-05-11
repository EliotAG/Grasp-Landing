/**
 * Phase 3 of the rollout intake — the editable review.
 *
 * The voice agent dropped the leader here when it called the `done` tool (or
 * the leader hit "End & review" themselves). This page renders the full plan
 * in editable form so they can adjust whatever the conversation didn't quite
 * land, then mark it ready.
 *
 * We reuse the wizard step components for editability + autosave parity, so
 * the same fields edited here behave identically to the legacy wizard.
 */

import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

import { ReviewForm } from "./review-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.organizationId) return { title: "Review plan" };
  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { name: true },
  });
  return { title: `${plan?.name ?? "Review plan"} · Review` };
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId },
    include: {
      stakeholderGroups: {
        orderBy: { createdAt: "asc" },
        include: {
          members: {
            include: { employee: { select: { id: true, name: true } } },
          },
        },
      },
      trainingDocuments: { orderBy: { createdAt: "asc" } },
      checkInTemplates: { orderBy: { offsetDays: "asc" } },
    },
  });

  if (!plan) notFound();
  if (plan.status !== "draft") redirect(`/changes/${id}`);

  const employees = await prisma.employee.findMany({
    where: { organizationId },
    orderBy: [{ team: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, team: true, title: true },
  });

  return <ReviewForm plan={plan} employees={employees} />;
}
