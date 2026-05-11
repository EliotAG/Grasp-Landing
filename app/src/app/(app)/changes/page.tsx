import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TOTAL_STEPS, getStep } from "@/lib/wizard/steps";

export const metadata = { title: "Change plans" };

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-black/[0.06] text-[color:var(--color-muted)]",
  ready: "bg-amber-100/70 text-amber-800",
  active: "bg-[color:var(--color-grasp-soft)] text-[color:var(--color-grasp)]",
  completed: "bg-blue-100/60 text-blue-700",
  archived: "bg-black/[0.04] text-[color:var(--color-muted)]",
};

export default async function ChangesPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const rows = await prisma.changePlan.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  const drafts = rows.filter((r) => r.status === "draft");
  const others = rows.filter((r) => r.status !== "draft");

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            {rows.length} {rows.length === 1 ? "plan" : "plans"}
            {drafts.length > 0 ? (
              <span className="ml-2 normal-case tracking-normal text-[color:var(--color-muted-2)]">
                · {drafts.length}{" "}
                {drafts.length === 1 ? "draft in progress" : "drafts in progress"}
              </span>
            ) : null}
          </p>
          <h1 className="serif mt-1 text-[40px] leading-[1.05]">
            Change plans
          </h1>
        </div>
        <Link href="/changes/new" className="btn btn-primary">
          New change plan
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="card p-10 text-center">
          <h2 className="serif text-[26px] leading-[1.2]">
            Nothing here yet.
          </h2>
          <p className="mx-auto mt-3 max-w-[460px] text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
            A change plan specifies what&rsquo;s changing, who&rsquo;s
            affected per stakeholder group, the key outcome to protect, and
            your response cadence commitment.
          </p>
          <Link href="/changes/new" className="btn btn-primary mt-6">
            Draft your first plan
          </Link>
        </div>
      ) : (
        <div className="space-y-10">
          {drafts.length > 0 ? (
            <section>
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)] mb-3">
                Pick up where you left off
              </h2>
              <ul className="space-y-3">
                {drafts.map((p) => {
                  const step = getStep(p.currentStep);
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/changes/${p.id}/intake`}
                        className="card flex items-center justify-between gap-6 p-6 no-underline transition-transform hover:-translate-y-0.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${STATUS_STYLES.draft}`}
                            >
                              draft
                            </span>
                            <span className="text-[12px] text-[color:var(--color-muted)]">
                              Intake draft · classic step {step.index} of{" "}
                              {TOTAL_STEPS} · {step.label}
                            </span>
                            {p.lastSavedAt ? (
                              <span className="text-[12px] text-[color:var(--color-muted-2)]">
                                · last saved{" "}
                                {p.lastSavedAt.toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            ) : null}
                          </div>
                          <h3 className="serif mt-2 text-[22px] leading-[1.2]">
                            {p.name || (
                              <span className="italic text-[color:var(--color-muted)]">
                                Untitled draft
                              </span>
                            )}
                          </h3>
                          {p.summary ? (
                            <p className="mt-1 line-clamp-2 max-w-[640px] text-[14px] text-[color:var(--color-muted)]">
                              {p.summary}
                            </p>
                          ) : null}
                        </div>
                        <span className="text-[13px] text-[color:var(--color-grasp)]">
                          Resume →
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {others.length > 0 ? (
            <section>
              {drafts.length > 0 ? (
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)] mb-3">
                  Plans
                </h2>
              ) : null}
              <ul className="space-y-3">
                {others.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/changes/${p.id}`}
                      className="card flex items-center justify-between gap-6 p-6 no-underline transition-transform hover:-translate-y-0.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                              STATUS_STYLES[p.status] ?? STATUS_STYLES.draft
                            }`}
                          >
                            {p.status}
                          </span>
                          {p.kickoffDate ? (
                            <span className="text-[12px] text-[color:var(--color-muted)]">
                              Kickoff {p.kickoffDate.toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                        <h3 className="serif mt-2 text-[22px] leading-[1.2]">
                          {p.name}
                        </h3>
                        {p.summary ? (
                          <p className="mt-1 line-clamp-2 max-w-[640px] text-[14px] text-[color:var(--color-muted)]">
                            {p.summary}
                          </p>
                        ) : null}
                      </div>
                      <span className="text-[13px] text-[color:var(--color-grasp)]">
                        Open →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
