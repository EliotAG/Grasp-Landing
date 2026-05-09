"use client";

import { useTransition } from "react";
import type { ChangePlanWizardStep } from "@prisma/client";
import { previousStep, getStep } from "@/lib/wizard/steps";
import { advanceStep, jumpToStep } from "../actions";

export function StepNav({
  changePlanId,
  step,
  continueDisabled,
  continueLabel,
}: {
  changePlanId: string;
  step: ChangePlanWizardStep;
  continueDisabled?: boolean;
  continueLabel?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const back = previousStep(step);
  const isLast = getStep(step).slug === "approve";

  return (
    <div className="flex items-center justify-between gap-3 border-t border-[color:var(--color-line)] pt-5 mt-8">
      {back ? (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              await jumpToStep(changePlanId, back);
            });
          }}
        >
          ← Back
        </button>
      ) : (
        <span />
      )}
      {!isLast ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={isPending || continueDisabled}
          onClick={() => {
            startTransition(async () => {
              await advanceStep(changePlanId, step);
            });
          }}
        >
          {isPending ? "Saving…" : continueLabel ?? "Continue →"}
        </button>
      ) : null}
    </div>
  );
}
