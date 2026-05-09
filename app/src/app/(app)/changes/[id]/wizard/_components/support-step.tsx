import { CadenceStep } from "./cadence-step";
import { MaterialsStep } from "./materials-step";
import { StepNav } from "./step-nav";
import type { WizardPlan } from "./types";

export function SupportStep({ plan }: { plan: WizardPlan }) {
  return (
    <div className="space-y-10">
      <WizardSection
        eyebrow="Knowledge"
        title="Add training materials"
        description="Upload any docs the agent should use when answering questions for this change."
      >
        <MaterialsStep plan={plan} showNav={false} />
      </WizardSection>

      <WizardSection
        eyebrow="Commitment"
        title="Set the leadership response promise"
        description="Decide how quickly you will respond when Grasp surfaces a concern."
      >
        <CadenceStep plan={plan} showNav={false} />
      </WizardSection>

      <StepNav changePlanId={plan.id} step="support" />
    </div>
  );
}

function WizardSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          {eyebrow}
        </p>
        <h2 className="serif mt-1 text-[26px] leading-[1.15]">{title}</h2>
        <p className="mt-2 max-w-[620px] text-[14px] leading-[1.65] text-[color:var(--color-muted)]">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}
