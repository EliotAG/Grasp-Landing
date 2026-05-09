/**
 * Smoke-test helper: publish an amendment to the most recent active
 * plan as the plan's leader, optionally crediting any in-flight
 * concerns the agent has surfaced.
 *
 * Usage: pnpm tsx scripts/publish-test-amendment.ts
 *
 * Picks the most recent active plan, finds its concerns, and creates
 * an amendment with audience=everyone that links the first two
 * concerns (when present) so we exercise the credit path.
 */

import { createAndDispatchAmendment } from "@/lib/agent/amendments";
import { prisma } from "@/lib/db";

async function main() {
  const plan = await prisma.changePlan.findFirst({
    where: { status: "active" },
    orderBy: { activatedAt: "desc" },
    select: { id: true, name: true, createdByUserId: true },
  });
  if (!plan) {
    console.error("No active plan found. Activate one first.");
    process.exit(1);
  }

  const concerns = await prisma.concern.findMany({
    where: { enrollment: { changePlanId: plan.id } },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, summary: true },
  });

  const summary =
    "Lengthening the rollout window by two weeks";
  const body = `Hey team — we heard the consistent feedback that the original three-week ramp doesn't give the field enough time to actually try the new process before we measure it. We're pushing the cutover by two weeks. Same target behavior, more breathing room. Nothing else changes.`;

  console.log(
    `Publishing amendment to plan "${plan.name}" (${plan.id}) crediting ${concerns.length} concern(s)…`,
  );
  const result = await createAndDispatchAmendment({
    changePlanId: plan.id,
    authoredByUserId: plan.createdByUserId,
    summary,
    body,
    audience: "everyone",
    sourceConcernIds: concerns.map((c) => c.id),
  });

  console.log(`Amendment id: ${result.amendmentId}`);
  console.log(`Total deliveries: ${result.totalDeliveries}`);
  console.log(`Inline results:`);
  for (const r of result.inlineResults) {
    console.log(
      `  ${r.deliveryId}: ok=${r.result.ok}${r.result.skippedReason ? ` skipped=${r.result.skippedReason}` : ""}${r.result.error ? ` error=${r.result.error}` : ""} channels=${JSON.stringify(r.result.channels ?? null)}`,
    );
  }
  if (result.deferred > 0) {
    console.log(`Deferred to cron: ${result.deferred}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
