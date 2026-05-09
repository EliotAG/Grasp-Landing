import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function WizardIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId },
    select: { currentStep: true, status: true },
  });
  if (!plan) notFound();

  // Completed plans live on the read-only detail page.
  if (plan.status !== "draft") redirect(`/changes/${id}`);
  redirect(`/changes/${id}/wizard/${plan.currentStep}`);
}
