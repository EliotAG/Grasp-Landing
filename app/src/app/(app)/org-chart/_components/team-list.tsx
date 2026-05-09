/**
 * "By team" view of the org chart. Server component — pure rendering
 * over the same Employee[] the page already loads. Originally lived
 * inline in page.tsx; extracted so the tree view can take over as the
 * default while this stays available behind ?view=teams.
 */

import Link from "next/link";
import type { Employee } from "@prisma/client";

import { displayMembershipRole } from "@/lib/organization-invitations";
import { initials, teamColor } from "../_lib/build-tree";

export type EmployeeWorkspaceAccess =
  | { status: "member"; role: "owner" | "admin" | "member" }
  | { status: "invited"; role: "admin" | "member" }
  | { status: "none" };

export function TeamList({
  employees,
  accessByEmail,
}: {
  employees: Employee[];
  accessByEmail: Record<string, EmployeeWorkspaceAccess>;
}) {
  // Stable team ordering driven by the same rank table the tree uses.
  // We re-sort the input here rather than asking the page to do it
  // because the page hands us the Prisma-ordered list (by team, name).
  const byTeam = new Map<string, Employee[]>();
  for (const row of employees) {
    const key = row.team || "Unassigned";
    const list = byTeam.get(key) ?? [];
    list.push(row);
    byTeam.set(key, list);
  }

  const ordered = [...byTeam.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="space-y-6">
      {ordered.map(([team, list]) => {
        const palette = teamColor(team);
        return (
          <section key={team} className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[color:var(--color-line)] px-6 py-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: palette.fg }}
                />
                <h2 className="text-[15px] font-semibold">{team}</h2>
              </div>
              <span className="text-[12px] text-[color:var(--color-muted)]">
                {list.length}
              </span>
            </div>
            <ul className="divide-y divide-[color:var(--color-line)]">
              {list.map((emp) => (
                <li key={emp.id}>
                  <Link
                    href={`/people/${emp.id}`}
                    className="group flex items-center gap-4 px-6 py-3.5 no-underline transition-colors hover:bg-black/[0.025]"
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tracking-wide"
                      style={{ background: palette.bg, color: palette.fg }}
                    >
                      {initials(emp.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-ink">
                        {emp.name}
                      </p>
                      <p className="truncate text-[12px] text-[color:var(--color-muted)]">
                        {emp.title ? `${emp.title} · ` : ""}
                        {emp.email}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className="text-[14px] text-[color:var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      →
                    </span>
                    <AccessPill
                      access={accessByEmail[emp.email.toLowerCase()] ?? { status: "none" }}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AccessPill({ access }: { access: EmployeeWorkspaceAccess }) {
  if (access.status === "member") {
    return (
      <span className="pill shrink-0">
        <span className="pill-dot" />
        {displayMembershipRole(access.role)}
      </span>
    );
  }
  if (access.status === "invited") {
    return (
      <span className="pill shrink-0 opacity-75">
        <span className="pill-dot" />
        Invited {displayMembershipRole(access.role)}
      </span>
    );
  }
  return (
    <span className="pill shrink-0 opacity-50">
      <span className="pill-dot bg-[color:var(--color-muted)]" />
      Not invited
    </span>
  );
}
