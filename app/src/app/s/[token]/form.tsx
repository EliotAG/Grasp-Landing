"use client";

/**
 * Single-page baseline survey form.
 *
 * Three sections, ten questions max, no per-page back/forward — keeps
 * it under two minutes and prevents losing answers to a refresh.
 *
 * Validation strategy: we collect everything into a typed state shape
 * that mirrors `BaselineSurveySchema`, validate the "all required
 * answered" shape on submit, scroll to the first missing field if not.
 * The server action re-validates with Zod regardless.
 */

import { useMemo, useRef, useState, useTransition } from "react";

import {
  CAUSALITY_VIGNETTES,
  OREG_LIKERT,
  OREG_RTC_ITEMS,
  WORKING_PREFERENCES_PROMPTS,
  type CausalityAnswers,
  type OregLikertValue,
  type OregRtcAnswers,
  type WorkingPreferencesAnswers,
} from "@/lib/surveys/baseline";

import { submitBaselineSurvey } from "./actions";

type FormState = {
  workingPreferences: Partial<WorkingPreferencesAnswers>;
  oregRtc: Partial<OregRtcAnswers>;
  causalityOrientation: Partial<CausalityAnswers>;
};

export type BaselineSurveyFormInitialState = FormState;

const EMPTY: FormState = {
  workingPreferences: { context: "" },
  oregRtc: {},
  causalityOrientation: {},
};

const TOTAL_SECTIONS = 3;

export function BaselineSurveyForm({
  token,
  initialState,
}: {
  token: string;
  initialState?: BaselineSurveyFormInitialState;
}) {
  const [state, setState] = useState<FormState>(initialState ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const completion = useMemo(() => computeProgress(state), [state]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const missingId = findFirstMissingFieldId(state);
    if (missingId) {
      const node = formRef.current?.querySelector<HTMLElement>(
        `[data-field-id="${missingId}"]`,
      );
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      setError("A few answers are missing. Please scroll up and finish them.");
      return;
    }

    startTransition(async () => {
      const result = await submitBaselineSurvey(token, state);
      if (result?.ok === false) {
        setError(result.error ?? "Something went wrong submitting.");
      }
      // On success the action redirects, so we won't get here.
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-12">
      {/* ------------------- Section 1: Working preferences ------------------- */}
      <Section
        index={1}
        title="How you like to work"
        helper="Three quick preferences so I'm not interrupting at the wrong time, plus an optional note if there's something else I should know."
      >
        <div className="space-y-7">
          {WORKING_PREFERENCES_PROMPTS.map((p) => {
            const id = `wp_${p.id}`;
            const value = state.workingPreferences[
              p.id as keyof WorkingPreferencesAnswers
            ] as string | undefined;

            return (
              <div key={p.id} data-field-id={id}>
                <p className="text-[14px] font-medium leading-[1.5] text-ink">
                  {p.label}
                  {p.required ? null : (
                    <span className="ml-2 text-[12px] font-normal text-[color:var(--color-muted-2)]">
                      Optional
                    </span>
                  )}
                </p>
                {p.kind === "radio" ? (
                  <div className="mt-3 grid gap-2">
                    {p.options.map((opt) => (
                      <RadioRow
                        key={opt.value}
                        name={id}
                        value={opt.value}
                        checked={value === opt.value}
                        onChange={() =>
                          setState((s) => ({
                            ...s,
                            workingPreferences: {
                              ...s.workingPreferences,
                              [p.id]: opt.value,
                            },
                          }))
                        }
                      >
                        {opt.label}
                      </RadioRow>
                    ))}
                  </div>
                ) : (
                  <textarea
                    className="input mt-2 min-h-[78px] resize-y"
                    placeholder={p.placeholder ?? ""}
                    value={value ?? ""}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        workingPreferences: {
                          ...s.workingPreferences,
                          [p.id]: e.target.value,
                        },
                      }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ------------------- Section 2: Oreg RTC ------------------- */}
      <Section
        index={2}
        title="How you tend to experience change"
        helper="Three short statements. Pick what's closest to true for you — there are no right answers."
      >
        <ul className="divide-y divide-[color:var(--color-line)]">
          {OREG_RTC_ITEMS.map((item) => {
            const id = `oreg_${item.id}`;
            const value = state.oregRtc[item.id];
            return (
              <li
                key={item.id}
                data-field-id={id}
                className="py-4 first:pt-0 last:pb-0"
              >
                <p className="text-[14px] leading-[1.55] text-ink">
                  {item.text}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {OREG_LIKERT.map((lk) => (
                    <LikertChip
                      key={lk.value}
                      name={id}
                      checked={value === lk.value}
                      label={lk.label}
                      onChange={() =>
                        setState((s) => ({
                          ...s,
                          oregRtc: {
                            ...s.oregRtc,
                            [item.id]: lk.value as OregLikertValue,
                          },
                        }))
                      }
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* ------------------- Section 3: Causality orientations ------------------- */}
      <Section
        index={3}
        title="How you orient to a new ask"
        helper="Three short scenarios. Pick the option that's most like you, even if none is exact."
      >
        <div className="space-y-8">
          {CAUSALITY_VIGNETTES.map((v) => {
            const id = `cau_${v.id}`;
            const value = state.causalityOrientation[v.id];
            return (
              <div key={v.id} data-field-id={id}>
                <p className="text-[14px] leading-[1.55] text-ink">
                  {v.scenario}
                </p>
                <div className="mt-3 grid gap-2">
                  {v.options.map((opt) => (
                    <RadioRow
                      key={opt.id}
                      name={id}
                      value={opt.id}
                      checked={value === opt.id}
                      onChange={() =>
                        setState((s) => ({
                          ...s,
                          causalityOrientation: {
                            ...s.causalityOrientation,
                            [v.id]: opt.id as "a" | "b" | "c",
                          },
                        }))
                      }
                    >
                      {opt.label}
                    </RadioRow>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ------------------- Submit ------------------- */}
      <div className="card sticky bottom-4 flex items-center justify-between gap-4 p-4 backdrop-blur-md">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted)]">
            {completion.answered} of {completion.total} answered
          </p>
          {error ? (
            <p className="mt-1 truncate text-[13px] text-red-700">{error}</p>
          ) : (
            <p className="mt-1 truncate text-[13px] text-[color:var(--color-muted-2)]">
              Your answers stay between you and the agent.
            </p>
          )}
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}

// ----- bits ----------------------------------------------------------------

function Section({
  index,
  title,
  helper,
  children,
}: {
  index: number;
  title: string;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-7">
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-muted)]">
          Part {index} of {TOTAL_SECTIONS}
        </p>
        <h2 className="serif mt-1 text-[24px] leading-[1.15]">{title}</h2>
        <p className="mt-1.5 text-[13px] text-[color:var(--color-muted)]">
          {helper}
        </p>
      </div>
      {children}
    </section>
  );
}

function RadioRow({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-[14px] transition-colors ${
        checked
          ? "border-[color:var(--color-grasp)] bg-[color:var(--color-grasp-soft)]"
          : "border-[color:var(--color-line-strong)] bg-white/55 hover:bg-white/85"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden
        className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          checked
            ? "border-[color:var(--color-grasp)] bg-[color:var(--color-grasp)]"
            : "border-[color:var(--color-line-strong)] bg-white"
        }`}
      >
        {checked ? (
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
        ) : null}
      </span>
      <span className="leading-[1.45] text-ink">{children}</span>
    </label>
  );
}

function LikertChip({
  name,
  checked,
  label,
  onChange,
}: {
  name: string;
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
        checked
          ? "border-[color:var(--color-grasp)] bg-[color:var(--color-grasp)] text-white"
          : "border-[color:var(--color-line-strong)] bg-white/60 text-ink-2 hover:bg-white"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {label}
    </label>
  );
}

// ----- progress + missing-field detection ----------------------------------

function computeProgress(s: FormState) {
  let answered = 0;
  let total = 0;

  for (const p of WORKING_PREFERENCES_PROMPTS) {
    if (!p.required) continue;
    total += 1;
    const v = s.workingPreferences[p.id as keyof WorkingPreferencesAnswers];
    if (typeof v === "string" && v.trim().length > 0) answered += 1;
  }
  for (const item of OREG_RTC_ITEMS) {
    total += 1;
    if (s.oregRtc[item.id] != null) answered += 1;
  }
  for (const v of CAUSALITY_VIGNETTES) {
    total += 1;
    if (s.causalityOrientation[v.id]) answered += 1;
  }
  return { answered, total };
}

function findFirstMissingFieldId(s: FormState): string | null {
  for (const p of WORKING_PREFERENCES_PROMPTS) {
    if (!p.required) continue;
    const v = s.workingPreferences[p.id as keyof WorkingPreferencesAnswers];
    if (typeof v !== "string" || v.trim().length === 0) return `wp_${p.id}`;
  }
  for (const item of OREG_RTC_ITEMS) {
    if (s.oregRtc[item.id] == null) return `oreg_${item.id}`;
  }
  for (const v of CAUSALITY_VIGNETTES) {
    if (!s.causalityOrientation[v.id]) return `cau_${v.id}`;
  }
  return null;
}
