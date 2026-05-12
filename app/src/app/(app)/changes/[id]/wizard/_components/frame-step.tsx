"use client";

import { useEffect, useState } from "react";
import { useAutosave } from "../_state/use-autosave";
import { saveFrame } from "../actions";
import { StepNav } from "./step-nav";
import type { WizardPlan } from "./types";

export function FrameStep({
  plan,
  showNav = true,
  embedded = false,
  onValidityChange,
}: {
  plan: WizardPlan;
  showNav?: boolean;
  embedded?: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [name, setName] = useState(plan.name ?? "");
  const [summary, setSummary] = useState(plan.summary ?? "");
  const { queue, flushNow } = useAutosave(
    (payload: { name: string; summary: string }) =>
      saveFrame(plan.id, payload),
  );

  const valid = name.trim().length >= 2;

  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  return (
    <div className="space-y-6">
      <div className={embedded ? "space-y-5" : "card space-y-5 p-7"}>
        <div>
          <label htmlFor="name" className="label">
            Name of the change
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              queue({ name: e.target.value, summary });
            }}
            onBlur={() => flushNow({ name, summary })}
            placeholder="e.g. Salesforce CRM rollout"
            className="input"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="summary" className="label">
            Description of the change
          </label>
          <textarea
            id="summary"
            rows={5}
            value={summary}
            onChange={(e) => {
              setSummary(e.target.value);
              queue({ name, summary: e.target.value });
            }}
            onBlur={() => flushNow({ name, summary })}
            placeholder="In a few sentences, what's actually changing for the team? Who initiated it, what's the trigger, and what should be different a month from now?"
            className="input"
          />
          <p className="mt-2 text-[12px] text-[color:var(--color-muted)]">
            The wizard uses this to propose stakeholder groups, behavior
            changes, and the announcement. The richer this is, the better the
            assistance gets.
          </p>
        </div>
      </div>

      {showNav ? (
        <StepNav
          changePlanId={plan.id}
          step="change"
          continueDisabled={!valid}
        />
      ) : null}
    </div>
  );
}
