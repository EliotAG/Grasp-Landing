import { AnnouncementStep } from "./announcement-step";
import { ReviewStep } from "./review-step";
import type { WizardPlan } from "./types";

export function ApproveStep({ plan }: { plan: WizardPlan }) {
  return (
    <div className="space-y-10">
      <WizardSection
        eyebrow="Announcement"
        title="Write the employee-facing message"
        description="Draft the rollout announcement and score it before the final read-through."
      >
        <AnnouncementStep plan={plan} showNav={false} />
      </WizardSection>

      <WizardSection
        eyebrow="Approval"
        title="Review the full plan"
        description="Check the plan end-to-end, then mark it ready for activation."
      >
        <ReviewStep plan={plan} />
      </WizardSection>
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
