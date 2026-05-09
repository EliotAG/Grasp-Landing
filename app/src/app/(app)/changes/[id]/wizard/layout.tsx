import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isWizardStep, mapLegacyWizardStep } from "@/lib/wizard/steps";
import { ProgressRail } from "./_components/progress-rail";
import {
  SaveProvider,
  SavedIndicator,
} from "./_state/save-indicator";

export default async function WizardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; step?: string }>;
}) {
  const { id, step } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const plan = await prisma.changePlan.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      name: true,
      currentStep: true,
      lastSavedAt: true,
      status: true,
    },
  });
  if (!plan) notFound();

  const current =
    step && isWizardStep(step)
      ? step
      : step
        ? mapLegacyWizardStep(step) ?? plan.currentStep
        : plan.currentStep;

  return (
    <SaveProvider initialSavedAt={plan.lastSavedAt}>
      <div className="mx-auto w-full max-w-[1100px]">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/changes"
            className="text-[13px] text-[color:var(--color-muted)] hover:text-ink"
          >
            ← Save & exit
          </Link>
          <div className="flex items-center gap-3">
            <SavedIndicator />
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
                Planning wizard
              </p>
              <h2 className="serif mt-1 text-[20px] leading-[1.15]">
                {plan.name?.trim() || (
                  <span className="italic text-[color:var(--color-muted)]">
                    Untitled draft
                  </span>
                )}
              </h2>
            </div>
            <ProgressRail
              changePlanId={plan.id}
              current={current}
              furthestVisited={plan.currentStep}
            />
          </aside>
          <main>{children}</main>
        </div>
      </div>
    </SaveProvider>
  );
}
