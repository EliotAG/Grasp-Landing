import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getStep,
  isWizardStep,
  mapLegacyWizardStep,
} from "@/lib/wizard/steps";
import { ApproveStep } from "../_components/approve-step";
import { AudienceStep } from "../_components/audience-step";
import { ChangeStep } from "../_components/change-step";
import { SupportStep } from "../_components/support-step";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; step: string }>;
}) {
  const { step } = await params;
  const canonical = isWizardStep(step) ? step : mapLegacyWizardStep(step);
  if (!canonical) return { title: "Wizard" };
  return { title: `${getStep(canonical).label} · Wizard` };
}

export default async function WizardStepPage({
  params,
}: {
  params: Promise<{ id: string; step: string }>;
}) {
  const { id, step } = await params;
  if (!isWizardStep(step)) {
    const canonical = mapLegacyWizardStep(step);
    if (canonical) redirect(`/changes/${id}/wizard/${canonical}`);
    notFound();
  }

  const session = await auth();
  const organizationId = session!.user.organizationId!;

  // Each step page loads only what it needs. The shape is wide enough that
  // a single fetch keeps the dispatcher simple; small payload either way.
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

  const def = getStep(step);

  const header = (
    <div className="mb-8">
      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
        Step {def.index} · {def.label}
      </p>
      <h1 className="serif mt-1 text-[40px] leading-[1.05]">{def.title}</h1>
      <p className="mt-3 max-w-[640px] text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
        {def.blurb}
      </p>
    </div>
  );

  let body: React.ReactNode;
  switch (step) {
    case "change":
      body = <ChangeStep plan={plan} />;
      break;
    case "audience": {
      const employees = await prisma.employee.findMany({
        where: { organizationId },
        orderBy: [{ team: "asc" }, { name: "asc" }],
        select: { id: true, name: true, email: true, team: true, title: true },
      });
      body = <AudienceStep plan={plan} employees={employees} />;
      break;
    }
    case "support":
      body = <SupportStep plan={plan} />;
      break;
    case "approve":
      body = <ApproveStep plan={plan} />;
      break;
  }

  return (
    <div>
      {header}
      {body}
    </div>
  );
}
