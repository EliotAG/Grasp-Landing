/**
 * Single source of truth for the planning-wizard step set.
 *
 * The progress rail, the per-step page dispatcher, the "Step N of 4 — X"
 * subtitle on the change-list page, and the server-action route guards all
 * derive from this list. Adding or reordering steps is a one-file change.
 */
import type { ChangePlanWizardStep } from "@prisma/client";

export type StepSlug = ChangePlanWizardStep;

export interface StepDef {
  slug: StepSlug;
  /** Sequence number, 1-indexed for UI. */
  index: number;
  /** Short label shown in the rail and on the list page subtitle. */
  label: string;
  /** Paragraph shown above the step heading, anchoring why it exists. */
  blurb: string;
  /** Page heading. */
  title: string;
}

export const WIZARD_STEPS: readonly StepDef[] = [
  {
    slug: "change",
    index: 1,
    label: "What's changing?",
    title: "What's changing?",
    blurb:
      "Drop in any docs you already have, name the rollout, explain what will be different, and choose the adoption window.",
  },
  {
    slug: "audience",
    index: 2,
    label: "Who needs to change?",
    title: "Who needs to change?",
    blurb:
      "Define the affected stakeholder groups and the concrete behaviors each group needs to adopt.",
  },
  {
    slug: "support",
    index: 3,
    label: "How will Grasp support them?",
    title: "How will Grasp support them?",
    blurb:
      "Set the leadership response promise, schedule the check-ins, and choose how Grasp kicks off with each person.",
  },
  {
    slug: "approve",
    index: 4,
    label: "Approve the rollout",
    title: "Approve the rollout",
    blurb:
      "Draft the announcement, score it against the rollout rubrics, and mark the plan ready to launch.",
  },
] as const;

export const TOTAL_STEPS = WIZARD_STEPS.length;

const BY_SLUG = new Map(WIZARD_STEPS.map((s) => [s.slug, s]));

export function getStep(slug: StepSlug): StepDef {
  const step = BY_SLUG.get(slug);
  if (!step) throw new Error(`Unknown wizard step: ${slug}`);
  return step;
}

export function isWizardStep(value: string): value is StepSlug {
  return BY_SLUG.has(value as StepSlug);
}

const LEGACY_STEP_MAP = {
  frame: "change",
  timeline: "change",
  mechanism: "change",
  stakeholders: "audience",
  behaviors: "audience",
  materials: "support",
  cadence: "support",
  announcement: "approve",
  review: "approve",
} as const satisfies Record<string, StepSlug>;

export function mapLegacyWizardStep(value: string): StepSlug | null {
  return LEGACY_STEP_MAP[value as keyof typeof LEGACY_STEP_MAP] ?? null;
}

export function nextStep(current: StepSlug): StepSlug | null {
  const step = getStep(current);
  return WIZARD_STEPS[step.index] /* index is 1-based, so this is +1 */?.slug ?? null;
}

export function previousStep(current: StepSlug): StepSlug | null {
  const step = getStep(current);
  return WIZARD_STEPS[step.index - 2]?.slug ?? null;
}
