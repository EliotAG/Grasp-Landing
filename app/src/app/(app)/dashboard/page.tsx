import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  if (!session.user.organizationId) redirect("/onboarding");
  const organizationId = session.user.organizationId;

  const [employeeCount, activeCount, draftCount] = await Promise.all([
    prisma.employee.count({ where: { organizationId } }),
    prisma.changePlan.count({
      where: { organizationId, status: "active" },
    }),
    prisma.changePlan.count({
      where: { organizationId, status: "draft" },
    }),
  ]);

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Welcome back
          </p>
          <h1 className="serif mt-1 text-[42px] leading-[1.05]">
            {session.user.name?.split(" ")[0] ?? "There"},{" "}
            <span className="italic font-normal">here&rsquo;s where you stand.</span>
          </h1>
        </div>
        <Link href="/changes/new" className="btn btn-primary">
          New change plan
        </Link>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="People in org chart"
          value={employeeCount}
          empty={employeeCount === 0}
          cta={
            employeeCount === 0
              ? { href: "/org-chart/upload", label: "Upload CSV" }
              : { href: "/org-chart", label: "View" }
          }
        />
        <Stat
          label="Active changes"
          value={activeCount}
          cta={{ href: "/changes", label: "View" }}
        />
        <Stat
          label="Drafts"
          value={draftCount}
          cta={{ href: "/changes/new", label: "New plan" }}
        />
      </section>

      <section className="card p-8">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          Suggested next step
        </p>
        <h2 className="serif mt-2 text-[26px] leading-[1.2]">
          {employeeCount === 0
            ? "Upload your org chart so Grasp knows who to talk to."
            : "Draft your first change plan."}
        </h2>
        <p className="mt-3 max-w-[640px] text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
          {employeeCount === 0
            ? "Grasp uses the org chart as ground truth for stakeholder groups, manager relationships, and how to reach each person on Teams or Zoom."
            : "Define what's changing, who's affected per stakeholder group, the key outcome to protect, and your response cadence commitment."}
        </p>
        <Link
          href={employeeCount === 0 ? "/org-chart/upload" : "/changes/new"}
          className="btn btn-primary mt-6"
        >
          {employeeCount === 0 ? "Upload org chart" : "Start a change plan"}
        </Link>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  empty,
  cta,
}: {
  label: string;
  value: number;
  empty?: boolean;
  cta: { href: string; label: string };
}) {
  return (
    <Link
      href={cta.href}
      className="card group flex items-end justify-between p-6 no-underline transition-transform hover:-translate-y-0.5"
    >
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          {label}
        </p>
        <p
          className="serif mt-2 text-[44px] leading-none"
          style={{ color: empty ? "#9a9a9a" : "#111" }}
        >
          {value}
        </p>
      </div>
      <span className="text-[13px] font-medium text-[color:var(--color-grasp)] group-hover:underline">
        {cta.label} →
      </span>
    </Link>
  );
}
