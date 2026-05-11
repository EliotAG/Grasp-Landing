/**
 * Slim, read-only plan snapshot pinned to the right of the chat. Shows the
 * shape of the draft (name, summary status, group counts, dates) plus the
 * current readiness state. Editing is intentionally one click away — the
 * "Edit plan fields" button opens a focused drawer instead of revealing more
 * controls inside the rail. Collapsed mode shrinks to a thin vertical tab so
 * the chat owns the screen.
 */
"use client";

import Link from "next/link";

import type { PlannerReadinessIssue } from "@/lib/planner/services";
import type { WizardPlan } from "../../wizard/_components/types";

export function PlanRail({
  plan,
  readinessIssues,
  open,
  onToggle,
  onEditPlan,
  onMarkReady,
  markBlocked,
}: {
  plan: WizardPlan;
  readinessIssues: PlannerReadinessIssue[];
  open: boolean;
  onToggle: () => void;
  onEditPlan: () => void;
  onMarkReady: () => void;
  markBlocked: boolean;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="card intake-rail flex w-12 shrink-0 flex-col items-center gap-3 px-2 py-4"
        aria-label="Show plan snapshot"
      >
        <span className="rotate-180 [writing-mode:vertical-rl] text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted)]">
          Plan
        </span>
        <span
          className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            markBlocked
              ? "bg-amber-100 text-amber-800"
              : "bg-[color:var(--color-grasp)] text-white"
          }`}
        >
          {markBlocked ? "!" : "✓"}
        </span>
      </button>
    );
  }

  const groupsWithBehavior = plan.stakeholderGroups.filter((group) =>
    group.behaviorSpec?.trim(),
  ).length;

  return (
    <aside className="card intake-rail flex w-[320px] shrink-0 flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
            Plan snapshot
          </p>
          <h2 className="serif mt-1 truncate text-[20px] leading-[1.15]">
            {plan.name?.trim() || "Untitled draft"}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Hide plan snapshot"
          onClick={onToggle}
          className="text-[12px] text-[color:var(--color-muted)] hover:text-ink"
        >
          Hide
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Tile
          label="Summary"
          value={plan.summary?.trim() ? "Drafted" : "Empty"}
        />
        <Tile label="Groups" value={String(plan.stakeholderGroups.length)} />
        <Tile
          label="Behaviors"
          value={`${groupsWithBehavior}/${plan.stakeholderGroups.length || 0}`}
        />
        <Tile
          label="Announcement"
          value={plan.announcement?.trim() ? "Drafted" : "Empty"}
        />
        <Tile
          label="Kickoff"
          value={
            plan.kickoffDate ? plan.kickoffDate.toLocaleDateString() : "—"
          }
        />
        <Tile
          label="Target"
          value={plan.targetDate ? plan.targetDate.toLocaleDateString() : "—"}
        />
      </dl>

      <button
        type="button"
        onClick={onEditPlan}
        className="btn btn-secondary w-full text-[12px]"
      >
        Edit plan fields
      </button>

      <div className="rounded-[14px] border border-[color:var(--color-line)] bg-white/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
            Readiness
          </p>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${
              markBlocked
                ? "bg-amber-100 text-amber-800"
                : "bg-[color:var(--color-grasp)] text-white"
            }`}
          >
            {markBlocked ? "Open items" : "Ready"}
          </span>
        </div>
        {readinessIssues.length > 0 ? (
          <ul className="mt-2 space-y-1.5 text-[12px] leading-[1.45]">
            {readinessIssues.map((issue) => (
              <li
                key={issue.key}
                className="flex gap-2 text-[color:var(--color-muted)]"
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    issue.required ? "bg-red-500" : "bg-amber-500"
                  }`}
                />
                <span>{issue.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12px] text-[color:var(--color-muted)]">
            All hard requirements met.
          </p>
        )}
        <button
          type="button"
          onClick={onMarkReady}
          disabled={markBlocked}
          className="btn btn-primary mt-3 w-full text-[12px]"
        >
          Mark plan ready
        </button>
      </div>

      <div className="mt-auto border-t border-[color:var(--color-line)] pt-3 text-[11px] text-[color:var(--color-muted)]">
        <Link
          href={`/changes/${plan.id}/wizard`}
          className="hover:text-ink"
        >
          Open classic editor →
        </Link>
      </div>
    </aside>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-[color:var(--color-line)] bg-white/45 p-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-muted)]">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[13px] text-[color:var(--color-ink-2)]">
        {value}
      </p>
    </div>
  );
}
