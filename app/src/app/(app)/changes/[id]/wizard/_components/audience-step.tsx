"use client";

import { useCallback, useState } from "react";

import { StakeholdersStep } from "./stakeholders-step";
import { StepNav } from "./step-nav";
import type { EmployeePick, WizardPlan } from "./types";

export function AudienceStep({
  plan,
  employees,
}: {
  plan: WizardPlan;
  employees: EmployeePick[];
}) {
  const [stakeholdersValid, setStakeholdersValid] = useState(
    plan.stakeholderGroups.length > 0 &&
      plan.stakeholderGroups.every(
        (g) => g.name.trim().length >= 2 && g.members.length > 0,
      ),
  );
  const onStakeholderValidityChange = useCallback((valid: boolean) => {
    setStakeholdersValid(valid);
  }, []);

  return (
    <div className="space-y-8">
      <WizardSection
        eyebrow="Audience"
        title="Group the people affected"
        description="For each group, add the people, why they are affected, and what they need to do differently."
      >
        <StakeholdersStep
          plan={plan}
          employees={employees}
          showNav={false}
          onValidityChange={onStakeholderValidityChange}
        />
      </WizardSection>

      <StepNav
        changePlanId={plan.id}
        step="audience"
        continueDisabled={!stakeholdersValid}
      />
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
