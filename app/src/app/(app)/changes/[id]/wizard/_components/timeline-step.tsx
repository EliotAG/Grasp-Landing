"use client";

import { useState } from "react";
import { saveTimeline } from "../actions";
import { useAutosave } from "../_state/use-autosave";
import { StepNav } from "./step-nav";
import type { WizardPlan } from "./types";

function toInputDate(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function defaultKickoff(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultTarget(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

export function TimelineStep({
  plan,
  showNav = true,
  embedded = false,
}: {
  plan: WizardPlan;
  showNav?: boolean;
  embedded?: boolean;
}) {
  const [kickoff, setKickoff] = useState(toInputDate(plan.kickoffDate));
  const [target, setTarget] = useState(toInputDate(plan.targetDate));

  const { queue, flushNow } = useAutosave(
    (payload: { kickoffDate: string; targetDate: string }) =>
      saveTimeline(plan.id, payload),
  );

  function applyDefaults() {
    const k = defaultKickoff();
    const t = defaultTarget();
    setKickoff(k);
    setTarget(t);
    flushNow({ kickoffDate: k, targetDate: t });
  }

  return (
    <div className="space-y-6">
      <div className={embedded ? "space-y-5" : "card space-y-5 p-7"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="kickoffDate" className="label">
              Kickoff date
            </label>
            <input
              id="kickoffDate"
              type="date"
              value={kickoff}
              onChange={(e) => {
                setKickoff(e.target.value);
                queue({ kickoffDate: e.target.value, targetDate: target });
              }}
              onBlur={() =>
                flushNow({ kickoffDate: kickoff, targetDate: target })
              }
              className="input"
            />
          </div>
          <div>
            <label htmlFor="targetDate" className="label">
              Target adoption date
            </label>
            <input
              id="targetDate"
              type="date"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                queue({ kickoffDate: kickoff, targetDate: e.target.value });
              }}
              onBlur={() =>
                flushNow({ kickoffDate: kickoff, targetDate: target })
              }
              className="input"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={applyDefaults}
          className="text-[12px] text-[color:var(--color-grasp)] hover:underline self-start"
        >
          Use defaults (today → 30 days)
        </button>
      </div>

      {showNav ? <StepNav changePlanId={plan.id} step="change" /> : null}
    </div>
  );
}
