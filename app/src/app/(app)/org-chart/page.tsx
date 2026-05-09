import Link from "next/link";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

import { OrgTreeWithControls } from "./_components/org-tree";
import {
  TeamList,
  type EmployeeWorkspaceAccess,
} from "./_components/team-list";
import { ViewToggle, type OrgChartView } from "./_components/view-toggle";
import { buildTree } from "./_lib/build-tree";

export const metadata = { title: "Org chart" };

export default async function OrgChart({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const { view: viewParam } = await searchParams;
  const view: OrgChartView = viewParam === "teams" ? "teams" : "tree";

  // Single employee read; both views consume the same Employee[].
  const [rows, members, pendingInvites] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId },
      orderBy: [{ team: "asc" }, { name: "asc" }],
    }),
    prisma.membership.findMany({
      where: { organizationId },
      select: { role: true, user: { select: { email: true } } },
    }),
    prisma.organizationInvitation.findMany({
      where: { organizationId, acceptedAt: null },
      select: { email: true, role: true },
    }),
  ]);

  if (rows.length === 0) {
    return (
      <div className="card mx-auto max-w-[640px] p-10 text-center">
        <span className="pill self-start mb-5 mx-auto">
          <span className="pill-dot" />
          Step 1
        </span>
        <h1 className="serif text-[32px] leading-[1.15]">
          Upload your <span className="italic font-normal">org chart</span>.
        </h1>
        <p className="mt-3 text-[15px] leading-[1.65] text-[color:var(--color-muted)]">
          Manual CSV upload in v1 (per spec). Required columns:{" "}
          <code className="font-mono text-[13px]">name</code>,{" "}
          <code className="font-mono text-[13px]">email</code>. Optional:{" "}
          <code className="font-mono text-[13px]">title</code>,{" "}
          <code className="font-mono text-[13px]">team</code>,{" "}
          <code className="font-mono text-[13px]">manager_email</code>.
        </p>
        <Link href="/org-chart/upload" className="btn btn-primary mt-6">
          Upload CSV
        </Link>
      </div>
    );
  }

  const tree = buildTree(rows);
  const accessByEmail: Record<string, EmployeeWorkspaceAccess> = {};
  for (const member of members) {
    accessByEmail[member.user.email.toLowerCase()] = {
      status: "member",
      role: member.role,
    };
  }
  for (const invite of pendingInvites) {
    const email = invite.email.toLowerCase();
    if (!accessByEmail[email]) {
      accessByEmail[email] = {
        status: "invited",
        role: invite.role === "owner" ? "admin" : invite.role,
      };
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
          <h1 className="serif mt-1 text-[40px] leading-[1.05]">Org chart</h1>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle view={view} />
          <Link href="/org-chart/upload" className="btn btn-secondary">
            Re-upload CSV
          </Link>
        </div>
      </header>

      {view === "tree" ? (
        <OrgTreeWithControls
          roots={tree.roots}
          total={rows.length}
          teamCount={tree.teamCount}
          maxDepth={tree.maxDepth}
        />
      ) : (
        <TeamList employees={rows} accessByEmail={accessByEmail} />
      )}
    </div>
  );
}
