/**
 * ReviewForm — editable confirm-and-mark-ready surface.
 *
 * Reuses the wizard step components (FrameStep, StakeholdersStep, etc.) so
 * the editable surface and autosave behavior here match the long-form
 * wizard. We wrap everything in the same `SaveProvider` the wizard layout
 * uses — that's what gives the autosave hooks their "Saved 2:47 PM" status
 * indicator without prop drilling.
 *
 * Cadence/sender are inlined here as a small form rather than reusing the
 * full CadenceStep, which carries an interactive timeline + voice-kickoff +
 * check-in scheduler that fits the wizard surface but would dominate this
 * page. Power users still have the wizard route if they want to tune those.
 */
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  markIntakeReadyAction,
  saveIntakeSupportAction,
} from "../intake/actions";
import { AnnouncementStep } from "../wizard/_components/announcement-step";
import { FrameStep } from "../wizard/_components/frame-step";
import { MechanismStep } from "../wizard/_components/mechanism-step";
import { StakeholdersStep } from "../wizard/_components/stakeholders-step";
import { TimelineStep } from "../wizard/_components/timeline-step";
import {
  SaveProvider,
  SavedIndicator,
} from "../wizard/_state/save-indicator";
import type { EmployeePick, WizardPlan } from "../wizard/_components/types";

export function ReviewForm({
  plan,
  employees,
}: {
  plan: WizardPlan;
  employees: EmployeePick[];
}) {
  return (
    <SaveProvider initialSavedAt={plan.lastSavedAt ?? null}>
      <div className="mx-auto max-w-[920px] space-y-8">
        <Header plan={plan} />

        <Section
          eyebrow="Brief"
          title="What's changing"
          description="The short name and plain-language summary stakeholders will see."
        >
          <FrameStep plan={plan} embedded showNav={false} />
        </Section>

        <Section
          eyebrow="Audience"
          title="Stakeholder groups"
          description="For each group: a name, the people in it, and an observable behavior."
        >
          <StakeholdersStep
            plan={plan}
            employees={employees}
            showNav={false}
          />
        </Section>

        <Section
          eyebrow="Outcome"
          title="Key outcome to protect"
          description="The thing Grasp should make sure does not get lost as people adapt."
        >
          <MechanismStep plan={plan} embedded showNav={false} />
        </Section>

        <Section
          eyebrow="Timing"
          title="Kickoff and target dates"
          description="When the rollout starts and when adoption should be complete."
        >
          <TimelineStep plan={plan} embedded showNav={false} />
        </Section>

        <Section
          eyebrow="Support"
          title="Follow-up cadence"
          description="How quickly you commit to responding when Grasp surfaces a concern, and who sends the announcement."
        >
          <SupportFields planId={plan.id} initial={plan} />
        </Section>

        <Section
          eyebrow="Approve"
          title="Announcement"
          description="The actual message stakeholders will see. Drafted from the plan; you own the words."
        >
          <AnnouncementStep plan={plan} showNav={false} />
        </Section>

        <ReviewActions planId={plan.id} />
      </div>
    </SaveProvider>
  );
}

function Header({ plan }: { plan: WizardPlan }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-line)] pb-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          Step 3 — Review &amp; mark ready
        </p>
        <h1 className="serif mt-1 truncate text-[28px] leading-[1.1]">
          {plan.name?.trim() || "Untitled change plan"}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <SavedIndicator />
        <Link
          href={`/changes/${plan.id}/intake`}
          className="text-[12px] text-[color:var(--color-grasp)] hover:underline"
        >
          ← Back to voice
        </Link>
      </div>
    </header>
  );
}

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          {eyebrow}
        </p>
        <h2 className="serif mt-1 text-[22px] leading-[1.15]">{title}</h2>
        <p className="mt-1 max-w-[640px] text-[13px] leading-[1.65] text-[color:var(--color-muted)]">
          {description}
        </p>
      </div>
      <div className="card p-6">{children}</div>
    </section>
  );
}

function SupportFields({
  planId,
  initial,
}: {
  planId: string;
  initial: WizardPlan;
}) {
  const [hours, setHours] = useState<string>(
    initial.responseCadenceHours?.toString() ?? "",
  );
  const [onBehalf, setOnBehalf] = useState(initial.announcementSendOnBehalf);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  function persist(next: { hours: string; onBehalf: boolean }) {
    setError(null);
    startTransition(async () => {
      const result = await saveIntakeSupportAction(planId, {
        responseCadenceHours: next.hours ? Number(next.hours) : "",
        announcementSendOnBehalf: next.onBehalf,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedTick((tick) => tick + 1);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="cadence-hours" className="label">
          Response cadence (hours)
        </label>
        <input
          id="cadence-hours"
          type="number"
          min={1}
          max={720}
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          onBlur={() => persist({ hours, onBehalf })}
          className="input max-w-[160px]"
          placeholder="48"
        />
        <p className="mt-2 text-[12px] text-[color:var(--color-muted)]">
          Maximum hours between Grasp follow-ups when a stakeholder needs
          attention.
        </p>
      </div>

      <label className="flex items-start gap-3 border-t border-[color:var(--color-line)] pt-4">
        <input
          type="checkbox"
          checked={onBehalf}
          onChange={(event) => {
            setOnBehalf(event.target.checked);
            persist({ hours, onBehalf: event.target.checked });
          }}
          className="mt-1"
        />
        <span>
          <span className="text-[14px] font-medium">
            Let Grasp send the announcement on my behalf
          </span>
          <span className="block text-[12px] text-[color:var(--color-muted)] mt-0.5">
            Off: Grasp introduces itself and references your announcement, but
            you send it from your own account. On: Grasp posts the
            announcement directly.
          </span>
        </span>
      </label>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-[color:var(--color-muted)]">
          Need check-in scheduling or voice kickoff? Use the{" "}
          <Link
            href={`/changes/${planId}/wizard/support`}
            className="text-[color:var(--color-grasp)] hover:underline"
          >
            wizard&rsquo;s support step
          </Link>
          .
        </p>
        {pending ? (
          <span className="text-[11px] text-[color:var(--color-muted)]">
            Saving…
          </span>
        ) : savedTick > 0 ? (
          <span className="text-[11px] text-[color:var(--color-grasp)]">
            Saved
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="text-[12px] text-red-700">{error}</p>
      ) : null}
    </div>
  );
}

function ReviewActions({ planId }: { planId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[color:var(--color-line)] pt-6">
      {error ? (
        <span className="text-[12px] text-red-700">{error}</span>
      ) : null}
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await markIntakeReadyAction(planId);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              window.location.assign(result.href);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Could not mark ready",
              );
            }
          });
        }}
      >
        {pending ? "Finalizing…" : "Mark plan ready"}
      </button>
    </div>
  );
}
