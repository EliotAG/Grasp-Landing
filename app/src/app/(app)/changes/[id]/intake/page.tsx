import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { plannerReadiness } from "@/lib/planner/services";
import { PlannerIntake } from "./planner-intake";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.organizationId) return { title: "Planning intake" };
  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { name: true },
  });
  return { title: `${plan?.name ?? "Planning intake"} · Intake` };
}

export default async function PlannerIntakePage({
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

  return (
    <PlannerIntake
      plan={plan}
      employees={employees}
      readinessIssues={plannerReadiness(plan)}
    />
  );
}
