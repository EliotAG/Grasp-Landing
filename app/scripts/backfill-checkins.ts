/**
 * One-shot backfill: schedule check-ins for any active plan that
 * doesn't already have its cadence rows. Idempotent — safe to run
 * multiple times (skipDuplicates on the unique constraint).
 *
 * Usage:
 *   npx tsx scripts/backfill-checkins.ts
 */

import { prisma } from "@/lib/db";
import { scheduleCheckInsForPlan } from "@/lib/agent/check-ins";

async function main() {
  const plans = await prisma.changePlan.findMany({
    where: { status: "active", activatedAt: { not: null } },
    select: { id: true, name: true },
  });
  console.log(`Found ${plans.length} active plan(s).`);
  for (const plan of plans) {
    const result = await scheduleCheckInsForPlan(plan.id);
    console.log(
      `[${plan.name}] enrollments=${result.enrollments} scheduled=${result.scheduled}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
