import { prisma } from "@/lib/db";

async function main() {
  const rows = await prisma.scheduledCheckIn.findMany({
    include: {
      enrollment: {
        select: {
          employee: { select: { name: true, email: true } },
          changePlan: { select: { name: true } },
        },
      },
    },
    orderBy: { scheduledFor: "asc" },
  });
  for (const r of rows) {
    console.log(
      `${r.id} | ${r.enrollment.employee.name} | ${r.kind} | scheduled_for=${r.scheduledFor.toISOString()} | status=${r.status} | dispatched=${r.dispatchedAt?.toISOString() ?? "null"} | error=${r.error ?? "null"}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
