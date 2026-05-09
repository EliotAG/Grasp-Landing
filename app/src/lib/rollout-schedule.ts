import { type Prisma, type ScheduledCheckInKind } from "@prisma/client";

export const DEFAULT_CHECK_IN_TEMPLATES: Array<{
  kind: ScheduledCheckInKind;
  offsetDays: number;
  enabled: boolean;
}> = [
  { kind: "day_3", offsetDays: 3, enabled: true },
  { kind: "week_1", offsetDays: 7, enabled: true },
  { kind: "week_3", offsetDays: 21, enabled: true },
];

export const CHECK_IN_TEMPLATE_LABELS: Record<ScheduledCheckInKind, string> = {
  day_3: "Initial follow-up",
  week_1: "Mid-rollout follow-up",
  week_3: "Closeout follow-up",
};

export const CHECK_IN_TEMPLATE_DESCRIPTIONS: Record<ScheduledCheckInKind, string> = {
  day_3: "Early check to catch confusion, blockers, and initial reactions.",
  week_1: "Mid-rollout read on whether the change is showing up in real work.",
  week_3: "Final check for durable adoption, unresolved concerns, and support needs.",
};

export function defaultCheckInTemplateRows(
  changePlanId: string,
): Prisma.RolloutCheckInTemplateCreateManyInput[] {
  return DEFAULT_CHECK_IN_TEMPLATES.map((template) => ({
    changePlanId,
    kind: template.kind,
    offsetDays: template.offsetDays,
    enabled: template.enabled,
  }));
}

export async function ensureDefaultCheckInTemplates(
  tx: Prisma.TransactionClient,
  changePlanId: string,
): Promise<void> {
  await tx.rolloutCheckInTemplate.createMany({
    data: defaultCheckInTemplateRows(changePlanId),
    skipDuplicates: true,
  });
}
