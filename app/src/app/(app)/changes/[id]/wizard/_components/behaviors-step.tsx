"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { aiDraftBehaviorSpec, saveBehaviorSpec } from "../actions";
import { useAutosave } from "../_state/use-autosave";
import { StepNav } from "./step-nav";
import type { WizardPlan } from "./types";

export function BehaviorsStep({
  plan,
  showNav = true,
}: {
  plan: WizardPlan;
  showNav?: boolean;
}) {
  if (plan.stakeholderGroups.length === 0) {
    return (
      <div className="space-y-6">
        <div className="card p-7 text-[14px] leading-[1.7] text-[color:var(--color-muted)]">
          No stakeholder groups yet. Behavior specs are scoped per group, so
          go back to{" "}
          <Link
            href={`/changes/${plan.id}/wizard/audience`}
            className="underline"
          >
            Who needs to change?
          </Link>{" "}
          and add at least one group first.
        </div>
        {showNav ? (
          <StepNav changePlanId={plan.id} step="audience" continueDisabled />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ul className="space-y-3">
        {plan.stakeholderGroups.map((g) => (
          <li key={g.id} className="card p-6">
            <BehaviorRow
              changePlanId={plan.id}
              groupId={g.id}
              groupName={g.name}
              groupDescription={g.description}
              memberCount={g.members.length}
              initialSpec={g.behaviorSpec ?? ""}
            />
          </li>
        ))}
      </ul>

      {showNav ? <StepNav changePlanId={plan.id} step="audience" /> : null}
    </div>
  );
}

function BehaviorRow({
  changePlanId,
  groupId,
  groupName,
  groupDescription,
  memberCount,
  initialSpec,
}: {
  changePlanId: string;
  groupId: string;
  groupName: string;
  groupDescription: string | null;
  memberCount: number;
  initialSpec: string;
}) {
  const [spec, setSpec] = useState(initialSpec);
  const [aiPending, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);

  const { queue, flushNow } = useAutosave(
    (payload: { behaviorSpec: string }) =>
      saveBehaviorSpec(changePlanId, { groupId, ...payload }),
  );

  function runAi() {
    setAiError(null);
    startAi(async () => {
      const result = await aiDraftBehaviorSpec(changePlanId, groupId);
      if (!result.ok) {
        setAiError(result.error);
        return;
      }
      setSpec(result.rendered);
      queue({ behaviorSpec: result.rendered });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold">{groupName}</h3>
          {groupDescription ? (
            <p className="mt-1 text-[13px] text-[color:var(--color-muted)]">
              {groupDescription}
            </p>
          ) : null}
        </div>
        <span className="text-[11px] text-[color:var(--color-muted-2)]">
          {memberCount} {memberCount === 1 ? "member" : "members"}
        </span>
      </div>

      <textarea
        rows={4}
        value={spec}
        onChange={(e) => {
          setSpec(e.target.value);
          queue({ behaviorSpec: e.target.value });
        }}
        onBlur={() => flushNow({ behaviorSpec: spec })}
        placeholder="Atkins format: who does what, when, where, how often, with whom. Concrete and observable, not aspirational."
        className="input"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[color:var(--color-muted)]">
          Example: &ldquo;Sales reps log every customer interaction in the new
          CRM within 24 hours of the conversation.&rdquo;
        </p>
        <button
          type="button"
          onClick={runAi}
          disabled={aiPending}
          className="btn btn-ghost text-[12px]"
        >
          {aiPending ? "Drafting…" : spec ? "Re-draft" : "Draft with AI"}
        </button>
      </div>
      {aiError ? (
        <p className="text-[12px] text-red-700">{aiError}</p>
      ) : null}
    </div>
  );
}
