import { prisma } from "@/lib/db";

async function main() {
  const amendments = await prisma.changeAmendment.findMany({
    include: {
      authoredBy: { select: { name: true } },
      deliveries: {
        include: {
          enrollment: {
            select: { employee: { select: { name: true, email: true } } },
          },
        },
      },
      sourceConcerns: {
        include: { concern: { select: { id: true, summary: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  for (const a of amendments) {
    console.log(`\n=== Amendment ${a.id}`);
    console.log(`  ${a.summary}`);
    console.log(
      `  by ${a.authoredBy?.name ?? "?"} · ${a.audience} · ${a.createdAt.toISOString()}`,
    );
    if (a.sourceConcerns.length > 0) {
      console.log(
        `  source concerns: ${a.sourceConcerns.map((sc) => sc.concern.summary).join("; ")}`,
      );
    }
    for (const d of a.deliveries) {
      console.log(
        `  delivery ${d.id} · ${d.enrollment.employee.name} · status=${d.status} · dispatched=${d.dispatchedAt?.toISOString() ?? "null"} · err=${d.error ?? "null"}`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
