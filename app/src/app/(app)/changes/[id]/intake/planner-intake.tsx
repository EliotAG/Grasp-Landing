/**
 * PlannerIntake — two-phase intake shell.
 *
 *   Phase 1 (upload): leader drops in any context they have. The component
 *   renders the existing TrainingDocument list with live parsing status.
 *
 *   Phase 2 (voice): we open an OpenAI Realtime session and let the agent
 *   walk the leader through the remaining details, persisting fields via
 *   server-routed tool calls. When the agent (or the leader) ends the
 *   session, we route to /changes/[id]/review for the editable confirm.
 *
 * Phase is local state — no URL change — so refresh during voice will reset
 * the leader to the upload step (which is fine; they can re-enter voice
 * with one click).
 */
"use client";

import { useState } from "react";

import type { WizardPlan } from "../wizard/_components/types";
import { UploadStep } from "./_components/upload-step";
import { VoiceStep } from "./_components/voice-step";

type Phase = "upload" | "voice";

export function PlannerIntake({ plan }: { plan: WizardPlan }) {
  const [phase, setPhase] = useState<Phase>("upload");
  const reviewHref = `/changes/${plan.id}/review`;

  return (
    <div className="space-y-4">
      <PlanHeader name={plan.name} phase={phase} />
      {phase === "upload" ? (
        <UploadStep
          planId={plan.id}
          trainingDocuments={plan.trainingDocuments}
          onContinue={() => setPhase("voice")}
        />
      ) : (
        <VoiceStep
          planId={plan.id}
          reviewHref={reviewHref}
          onBack={() => setPhase("upload")}
        />
      )}
    </div>
  );
}

function PlanHeader({ name, phase }: { name: string; phase: Phase }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--color-line)] pb-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          Planning intake
        </p>
        <p className="serif mt-0.5 truncate text-[18px] leading-[1.2]">
          {name?.trim() || "Untitled change plan"}
        </p>
      </div>
      <PhaseStepper phase={phase} />
    </div>
  );
}

function PhaseStepper({ phase }: { phase: Phase }) {
  const steps: Array<{ key: Phase | "review"; label: string }> = [
    { key: "upload", label: "1 · Context" },
    { key: "voice", label: "2 · Voice" },
    { key: "review", label: "3 · Review" },
  ];
  return (
    <ol className="flex items-center gap-1 text-[11px] font-medium text-[color:var(--color-muted)]">
      {steps.map((step, index) => {
        const isActive = step.key === phase;
        return (
          <li key={step.key} className="flex items-center gap-1">
            <span
              className={`rounded-full px-2.5 py-1 ${
                isActive
                  ? "bg-[color:var(--color-grasp)] text-white"
                  : "bg-black/[0.05] text-[color:var(--color-ink-2)]"
              }`}
            >
              {step.label}
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden className="text-[color:var(--color-muted)]">
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
