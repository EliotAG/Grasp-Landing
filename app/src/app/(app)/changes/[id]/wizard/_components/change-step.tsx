"use client";

import { useCallback, useState } from "react";

import { FrameStep } from "./frame-step";
import { MaterialsStep } from "./materials-step";
import { StepNav } from "./step-nav";
import { TimelineStep } from "./timeline-step";
import type { WizardPlan } from "./types";

export function ChangeStep({ plan }: { plan: WizardPlan }) {
  const [frameValid, setFrameValid] = useState(
    (plan.name ?? "").trim().length >= 2,
  );
  const onFrameValidityChange = useCallback((valid: boolean) => {
    setFrameValid(valid);
  }, []);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Context
          </p>
          <h2 className="serif mt-1 text-[26px] leading-[1.15]">
            Drop in any docs, then frame the change
          </h2>
          <p className="mt-2 max-w-[660px] text-[14px] leading-[1.65] text-[color:var(--color-muted)]">
            Upload SOPs, briefs, or notes you already have so Grasp has the
            context up front. Then name the rollout, write a plain-language
            summary, and pick the adoption window.
          </p>
        </div>

        <div className="card space-y-8 p-7">
          <MaterialsStep plan={plan} showNav={false} />

          <div className="border-t border-[color:var(--color-line)] pt-7">
            <FrameStep
              plan={plan}
              showNav={false}
              embedded
              onValidityChange={onFrameValidityChange}
            />
          </div>

          <div className="border-t border-[color:var(--color-line)] pt-7">
            <TimelineStep plan={plan} showNav={false} embedded />
          </div>
        </div>
      </section>

      <StepNav
        changePlanId={plan.id}
        step="change"
        continueDisabled={!frameValid}
      />
    </div>
  );
}
