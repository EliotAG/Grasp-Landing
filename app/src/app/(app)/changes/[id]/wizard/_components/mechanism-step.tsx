"use client";

import { useState, useTransition } from "react";
import { aiProposeCoreMechanism, saveCoreMechanism } from "../actions";
import { useAutosave } from "../_state/use-autosave";
import { StepNav } from "./step-nav";
import type { WizardPlan } from "./types";

export function MechanismStep({
  plan,
  showNav = true,
  embedded = false,
}: {
  plan: WizardPlan;
  showNav?: boolean;
  embedded?: boolean;
}) {
  const [text, setText] = useState(plan.coreMechanism ?? "");
  const [aiPending, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);

  const { queue, flushNow } = useAutosave(
    (payload: { coreMechanism: string }) =>
      saveCoreMechanism(plan.id, payload),
  );

  function runAi() {
    setAiError(null);
    startAi(async () => {
      const result = await aiProposeCoreMechanism(plan.id);
      if (!result.ok) {
        setAiError(result.error);
        return;
      }
      setText(result.mechanism);
      queue({ coreMechanism: result.mechanism });
    });
  }

  return (
    <div className="space-y-6">
      <div className={embedded ? "space-y-4" : "card space-y-4 p-7"}>
        <div>
          <label htmlFor="guiding-principle" className="label">
            Key outcome to protect
          </label>
          <p className="mb-2 text-[12px] text-[color:var(--color-muted)]">
            What is the one thing Grasp should make sure does not get lost as
            people adapt the rollout?
          </p>
        </div>
        <textarea
          id="guiding-principle"
          rows={8}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            queue({ coreMechanism: e.target.value });
          }}
          onBlur={() => flushNow({ coreMechanism: text })}
          placeholder="e.g. Routine status updates should move to self-serve, while reps still own relationship-sensitive issues."
          className="input"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-[color:var(--color-muted)]">
            Example: &ldquo;Customer-facing context lives in one place where
            any teammate can find it&rdquo; — not &ldquo;everyone uses
            Salesforce.&rdquo;
          </p>
          <button
            type="button"
            onClick={runAi}
            disabled={aiPending}
            className="btn btn-ghost text-[12px]"
          >
            {aiPending ? "Thinking…" : text ? "Re-draft" : "Draft with AI"}
          </button>
        </div>
        {aiError ? (
          <p className="text-[12px] text-red-700">{aiError}</p>
        ) : null}
      </div>

      {showNav ? <StepNav changePlanId={plan.id} step="change" /> : null}
    </div>
  );
}
