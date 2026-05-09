/**
 * Baseline survey instrument (compressed).
 *
 * 10-item maximum: 3 working preferences + 3 Oreg RTC items + 3
 * Deci & Ryan causality vignettes + 1 optional free-text. The prior-
 * change-experience section was removed because no part of the agent
 * read those fields. Compression keeps the same downstream signals
 * the prompt branches on:
 *   - `causalityOrientation.subscale.{autonomy|control|impersonal}` →
 *     dominant orientation chooses the framing register.
 *   - `oregRtc.score` (mean across items, 1–6) → drives the RTC
 *     bucket the prompt explains to the model.
 *   - `workingPreferences.channelPreference` and `preferredTimeOfDay`
 *     are surfaced verbatim into the prompt; the field names align
 *     with what `context.ts` already reads.
 *
 * Single source of truth for both the rendered form and the server-
 * side scoring/validation: a typo or reorder in one place can't drift
 * from the other; the page maps over these constants and the submit
 * action validates against the schemas derived from them.
 */

import { z } from "zod";

// -----------------------------------------------------------------------
// Section 1: Working preferences (3 required + 1 optional)
// -----------------------------------------------------------------------

export const WORKING_PREFERENCES_PROMPTS = [
  {
    id: "channelPreference",
    label: "When I have a choice, I'd rather hear about a change via",
    kind: "radio",
    required: true,
    options: [
      { value: "text", label: "Text message in Teams" },
      { value: "voice", label: "A short voice call" },
      { value: "email", label: "Email" },
      { value: "no_preference", label: "No strong preference" },
    ],
  },
  {
    id: "preferredTimeOfDay",
    label: "The best time of day for me to think about a change check-in is",
    kind: "radio",
    required: true,
    options: [
      { value: "morning", label: "Morning (before 11)" },
      { value: "midday", label: "Midday (11–2)" },
      { value: "afternoon", label: "Afternoon (2–5)" },
      { value: "evening", label: "Late afternoon / evening" },
    ],
  },
  {
    id: "workload",
    label: "Right now, my workload feels",
    kind: "radio",
    required: true,
    options: [
      { value: "light", label: "Manageable, room to take on more" },
      { value: "steady", label: "Steady, at capacity but not buried" },
      { value: "heavy", label: "Heavy, most days I'm scrambling" },
    ],
  },
  {
    id: "context",
    label:
      "Anything else about how you like to work that would help me check in well with you?",
    kind: "free",
    required: false,
    placeholder: "Optional",
  },
] as const;

export type WorkingPreferencesAnswers = {
  channelPreference: "text" | "voice" | "email" | "no_preference";
  preferredTimeOfDay: "morning" | "midday" | "afternoon" | "evening";
  workload: "light" | "steady" | "heavy";
  context: string;
};

export const WorkingPreferencesSchema: z.ZodType<WorkingPreferencesAnswers> =
  z.object({
    channelPreference: z.enum(["text", "voice", "email", "no_preference"]),
    preferredTimeOfDay: z.enum(["morning", "midday", "afternoon", "evening"]),
    workload: z.enum(["light", "steady", "heavy"]),
    context: z.string().trim().max(1000),
  });

// -----------------------------------------------------------------------
// Section 2: Oreg Resistance to Change (compressed short form)
//
// Three items, one per high-signal subscale (routine seeking,
// emotional reaction, short-term focus). The cognitive-rigidity
// subscale was dropped because it correlates least with rollout
// outcomes per the empirical review and adds the most cognitive load
// in self-report. `score` remains the simple mean for sorting; with
// three items it still spreads the 1–6 scale enough to bucket into
// HIGH / TYPICAL / LOW for the prompt.
// -----------------------------------------------------------------------

export const OREG_RTC_ITEMS = [
  { id: "rs2", text: "I'd rather be bored than surprised." },
  {
    id: "er1",
    text: "When I am informed of a change of plans, I tense up a bit.",
  },
  {
    id: "stf3",
    text: "When things don't go according to plan, it stresses me out.",
  },
] as const;

export const OREG_LIKERT = [
  { value: 1, label: "Strongly disagree" },
  { value: 2, label: "Disagree" },
  { value: 3, label: "Slightly disagree" },
  { value: 4, label: "Slightly agree" },
  { value: 5, label: "Agree" },
  { value: 6, label: "Strongly agree" },
] as const;

export type OregLikertValue = 1 | 2 | 3 | 4 | 5 | 6;

export type OregRtcAnswers = Record<
  (typeof OREG_RTC_ITEMS)[number]["id"],
  OregLikertValue
>;

const OREG_LIKERT_VALUE_SCHEMA = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const OregRtcSchema = z.object(
  Object.fromEntries(
    OREG_RTC_ITEMS.map((item) => [item.id, OREG_LIKERT_VALUE_SCHEMA]),
  ) as Record<
    (typeof OREG_RTC_ITEMS)[number]["id"],
    typeof OREG_LIKERT_VALUE_SCHEMA
  >,
) as unknown as z.ZodType<OregRtcAnswers>;

export interface OregRtcStored {
  items: number[];
  score: number;
}

export function scoreOregRtc(answers: OregRtcAnswers): OregRtcStored {
  const items = OREG_RTC_ITEMS.map((it) => answers[it.id] as number);
  const score = items.reduce((a, b) => a + b, 0) / items.length;
  return { items, score };
}

// -----------------------------------------------------------------------
// Section 3: Deci & Ryan General Causality Orientations (compressed)
//
// Three vignettes chosen for clean autonomy/control/impersonal
// separation and direct relevance to a Grasp interaction:
//   - v1: opening reaction to a new process (the most general anchor),
//   - v3: how someone metabolizes a small failure during change,
//   - v6: how they want a Grasp check-in itself to feel.
// Score = count per subscale. Dominant subscale informs the agent's
// framing register (rationale-and-choice / structure-and-expectation /
// support-and-low-pressure).
// -----------------------------------------------------------------------

export const CAUSALITY_VIGNETTES = [
  {
    id: "v1",
    scenario:
      "Your team is asked to adopt a new process. The first thing you find yourself wondering is:",
    options: [
      {
        id: "a",
        label: "Why this, and how does it actually help?",
        subscale: "autonomy",
      },
      {
        id: "b",
        label: "What exactly am I supposed to do, and by when?",
        subscale: "control",
      },
      {
        id: "c",
        label: "Am I going to be able to keep up with this?",
        subscale: "impersonal",
      },
    ],
  },
  {
    id: "v3",
    scenario:
      "You missed a step in the new process and it caused a small problem. Your first reaction is:",
    options: [
      {
        id: "a",
        label: "Note what tripped you up so you can adjust next time.",
        subscale: "autonomy",
      },
      {
        id: "b",
        label: "Make sure you follow the steps exactly going forward.",
        subscale: "control",
      },
      {
        id: "c",
        label:
          "Feel like maybe you're not cut out for this kind of change.",
        subscale: "impersonal",
      },
    ],
  },
  {
    id: "v6",
    scenario:
      "If a check-in from Grasp asks how a change is going, you'd want it to:",
    options: [
      {
        id: "a",
        label:
          "Ask an open question and give you space to answer in your own words.",
        subscale: "autonomy",
      },
      {
        id: "b",
        label:
          "Be specific and direct: what did you do, did it work, yes or no.",
        subscale: "control",
      },
      {
        id: "c",
        label: "Be light-touch and not press if you don't have much to say.",
        subscale: "impersonal",
      },
    ],
  },
] as const;

export type CausalitySubscale = "autonomy" | "control" | "impersonal";
export type CausalityAnswers = Record<
  (typeof CAUSALITY_VIGNETTES)[number]["id"],
  "a" | "b" | "c"
>;

const CAUSALITY_OPTION_SCHEMA = z.enum(["a", "b", "c"]);

export const CausalitySchema = z.object(
  Object.fromEntries(
    CAUSALITY_VIGNETTES.map((v) => [v.id, CAUSALITY_OPTION_SCHEMA]),
  ) as Record<
    (typeof CAUSALITY_VIGNETTES)[number]["id"],
    typeof CAUSALITY_OPTION_SCHEMA
  >,
) as unknown as z.ZodType<CausalityAnswers>;

export interface CausalityStored {
  items: string[];
  subscale: { autonomy: number; control: number; impersonal: number };
  dominant: CausalitySubscale;
}

export function scoreCausality(answers: CausalityAnswers): CausalityStored {
  const subscale = { autonomy: 0, control: 0, impersonal: 0 };
  const items: string[] = [];
  for (const v of CAUSALITY_VIGNETTES) {
    const choice = answers[v.id];
    const opt = v.options.find((o) => o.id === choice);
    if (!opt) continue;
    subscale[opt.subscale as CausalitySubscale] += 1;
    items.push(`${v.id}:${choice}`);
  }
  const dominant = (
    Object.entries(subscale) as Array<[CausalitySubscale, number]>
  ).reduce((acc, cur) => (cur[1] > acc[1] ? cur : acc))[0];
  return { items, subscale, dominant };
}

// -----------------------------------------------------------------------
// Combined input schema for the submit action.
// -----------------------------------------------------------------------

export const BaselineSurveySchema = z.object({
  workingPreferences: WorkingPreferencesSchema,
  oregRtc: OregRtcSchema,
  causalityOrientation: CausalitySchema,
});

export type BaselineSurveyInput = z.infer<typeof BaselineSurveySchema>;
