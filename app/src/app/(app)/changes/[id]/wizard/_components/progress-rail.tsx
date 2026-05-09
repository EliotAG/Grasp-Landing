"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TOTAL_STEPS,
  WIZARD_STEPS,
  getStep,
  isWizardStep,
  mapLegacyWizardStep,
  type StepSlug,
} from "@/lib/wizard/steps";

export function ProgressRail({
  changePlanId,
  current,
  furthestVisited,
}: {
  changePlanId: string;
  current: StepSlug;
  furthestVisited: StepSlug;
}) {
  const pathname = usePathname();
  const routeStep = pathname.split("/").filter(Boolean).at(-1) ?? "";
  const visibleCurrent = isWizardStep(routeStep)
    ? routeStep
    : mapLegacyWizardStep(routeStep) ?? current;
  const currentIdx = getStep(visibleCurrent).index;
  const furthestIdx = getStep(furthestVisited).index;

  return (
    <nav aria-label="Wizard progress" className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
        Step {currentIdx} of {TOTAL_STEPS}
      </p>
      <ol className="space-y-0.5">
        {WIZARD_STEPS.map((step) => {
          const isCurrent = step.slug === visibleCurrent;
          const isVisited = step.index <= furthestIdx;
          const className = isCurrent
            ? "border-l-2 border-[color:var(--color-grasp)] pl-3 py-1.5 text-[14px] font-semibold text-ink"
            : isVisited
              ? "border-l-2 border-[color:var(--color-line-strong)] pl-3 py-1.5 text-[14px] text-ink-2 hover:bg-black/[0.03] rounded-r-md transition-colors"
              : "border-l-2 border-transparent pl-3 py-1.5 text-[14px] text-[color:var(--color-muted)]";
          if (isVisited && !isCurrent) {
            return (
              <li key={step.slug}>
                <Link
                  href={`/changes/${changePlanId}/wizard/${step.slug}`}
                  className={`${className} block no-underline`}
                >
                  <span className="text-[11px] text-[color:var(--color-muted-2)] mr-1.5">
                    {step.index}
                  </span>
                  {step.label}
                </Link>
              </li>
            );
          }
          return (
            <li key={step.slug} className={`${className} block`}>
              <span className="text-[11px] text-[color:var(--color-muted-2)] mr-1.5">
                {step.index}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
