"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { markWizardComplete } from "../actions";
import type { WizardPlan } from "./types";

function Section({
  title,
  editStep,
  changePlanId,
  children,
}: {
  title: string;
  editStep: string;
  changePlanId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-6">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
          {title}
        </h3>
        <Link
          href={`/changes/${changePlanId}/wizard/${editStep}`}
          className="text-[12px] text-[color:var(--color-grasp)] hover:underline"
        >
          Edit
        </Link>
      </header>
      <div className="text-[14px] leading-[1.7]">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="italic text-[color:var(--color-muted)]">{children}</p>
  );
}

export function ReviewStep({ plan }: { plan: WizardPlan }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const issues: string[] = [];
  if (!plan.name?.trim()) issues.push("What's changing: plan needs a name.");
  if (plan.stakeholderGroups.length === 0)
    issues.push("Who needs to change: add at least one group.");
  if (plan.stakeholderGroups.some((g) => !g.behaviorSpec?.trim())) {
    issues.push("Who needs to change: at least one group is missing what they need to do.");
  }
  if (!plan.coreMechanism?.trim())
    issues.push("What's changing: key outcome to protect is not yet specified.");
  if (!plan.announcement?.trim())
    issues.push("Approve the rollout: no announcement draft yet.");

  return (
    <div className="space-y-6">
      <Section title="Change brief" editStep="change" changePlanId={plan.id}>
        <p className="font-semibold">{plan.name || <Empty>No name</Empty>}</p>
        {plan.summary ? (
          <p className="mt-2 text-[color:var(--color-ink-2)]">{plan.summary}</p>
        ) : (
          <Empty>No summary</Empty>
        )}
      </Section>

      <Section
        title={`Stakeholder groups (${plan.stakeholderGroups.length})`}
        editStep="audience"
        changePlanId={plan.id}
      >
        {plan.stakeholderGroups.length === 0 ? (
          <Empty>None added</Empty>
        ) : (
          <ul className="space-y-3">
            {plan.stakeholderGroups.map((g) => (
              <li key={g.id}>
                <p className="font-semibold">
                  {g.name}{" "}
                  <span className="text-[12px] font-normal text-[color:var(--color-muted)]">
                    · {g.members.length}{" "}
                    {g.members.length === 1 ? "member" : "members"}
                  </span>
                </p>
                {g.description ? (
                  <p className="text-[13px] text-[color:var(--color-muted)]">
                    {g.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Things each group needs to do"
        editStep="audience"
        changePlanId={plan.id}
      >
        {plan.stakeholderGroups.length === 0 ? (
          <Empty>No groups defined</Empty>
        ) : (
          <ul className="space-y-3">
            {plan.stakeholderGroups.map((g) => (
              <li key={g.id}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
                  {g.name}
                </p>
                {g.behaviorSpec ? (
                  <p className="mt-1">{g.behaviorSpec}</p>
                ) : (
                  <Empty>Nothing added yet</Empty>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Timeline" editStep="change" changePlanId={plan.id}>
        <p>
          Kickoff:{" "}
          {plan.kickoffDate ? (
            plan.kickoffDate.toLocaleDateString()
          ) : (
            <Empty>—</Empty>
          )}
          {" · "}Target:{" "}
          {plan.targetDate ? (
            plan.targetDate.toLocaleDateString()
          ) : (
            <Empty>—</Empty>
          )}
        </p>
      </Section>

      <Section
        title="Key outcome to protect"
        editStep="change"
        changePlanId={plan.id}
      >
        {plan.coreMechanism ? (
          <p className="whitespace-pre-wrap">{plan.coreMechanism}</p>
        ) : (
          <Empty>Not specified</Empty>
        )}
      </Section>

      <Section
        title="Response cadence"
        editStep="support"
        changePlanId={plan.id}
      >
        <p>
          {plan.responseCadenceHours
            ? `${plan.responseCadenceHours} hours`
            : "Default cadence"}
          {" · "}
          {plan.announcementSendOnBehalf
            ? "agent sends on your behalf"
            : "you send the announcement"}
        </p>
      </Section>

      <Section
        title={`Training materials (${plan.trainingDocuments.length})`}
        editStep="support"
        changePlanId={plan.id}
      >
        {plan.trainingDocuments.length === 0 ? (
          <Empty>None uploaded</Empty>
        ) : (
          <ul className="space-y-1">
            {plan.trainingDocuments.map((d) => (
              <li key={d.id}>
                {d.filename}{" "}
                <span className="text-[12px] text-[color:var(--color-muted)]">
                  ({d.processingStatus})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Announcement"
        editStep="approve"
        changePlanId={plan.id}
      >
        {plan.announcement ? (
          <p className="whitespace-pre-wrap font-serif">{plan.announcement}</p>
        ) : (
          <Empty>No draft</Empty>
        )}
      </Section>

      {issues.length > 0 ? (
        <div className="rounded-card border border-amber-300 bg-amber-50 p-5">
          <p className="text-[13px] font-semibold text-amber-900">
            A few open items
          </p>
          <ul className="mt-2 list-disc pl-5 text-[13px] text-amber-900">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-amber-900/80">
            You can mark complete with these unresolved if you want. Name and
            at least one stakeholder group are the only hard requirements.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[color:var(--color-line)] pt-5">
        <div className="flex items-center gap-3">
          {error ? (
            <span className="text-[12px] text-red-700">{error}</span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                try {
                  const result = await markWizardComplete(plan.id);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  window.location.assign(result.href);
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Could not mark complete",
                  );
                }
              });
            }}
          >
            {pending ? "Finalizing…" : "Mark plan ready"}
          </button>
        </div>
      </div>
    </div>
  );
}
