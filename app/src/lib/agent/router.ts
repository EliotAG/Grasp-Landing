/**
 * Routes an inbound user message to the right active change enrollment
 * when one employee is in multiple rollouts at the same time.
 *
 * Single-rollout case: short-circuits to that enrollment without a
 * classifier call. Multi-rollout case: asks Claude (forced tool use)
 * which enrollment the message most likely refers to, with a confidence
 * grade so the caller can decide whether to ask the user to disambiguate.
 *
 * The classifier never persists the user's message — only the caller
 * does, after a routing decision is final. That means a `low`-confidence
 * outcome is safe to abort on: the user's text is not yet attached to
 * any enrollment's transcript.
 */

import { z } from "zod";

import { callStructured } from "@/lib/ai/structured";
import { isAiEnabled } from "@/lib/ai/anthropic";
import type { ActiveEnrollmentSummary } from "./context";

export type RouteDecision =
  /// Only one active enrollment for this user — no classification needed.
  | { kind: "single"; enrollmentId: string }
  /// Classifier picked an enrollment with high or medium confidence.
  /// Caller should run the agent under this enrollment and persist
  /// the chosen id back to the thread sticky pointer.
  | {
      kind: "confident";
      enrollmentId: string;
      confidence: "high" | "medium";
      reasoning: string;
    }
  /// Classifier could not pick a single enrollment with enough
  /// confidence. Caller should ask the user to clarify and skip
  /// agent processing for this turn.
  | {
      kind: "ambiguous";
      candidates: ActiveEnrollmentSummary[];
      reasoning: string;
    };

const RouterOutputSchema = z.object({
  enrollment_id: z
    .string()
    .describe(
      "Id of the enrollment the user is most likely talking about. Must exactly match one of the provided enrollment ids.",
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "How confident the routing is. Use 'high' when the message contains specific terms or names that clearly belong to one rollout. Use 'medium' when one rollout is the best guess but the message is generic; lean on the recently-routed prior in that case. Use 'low' only when the message could plausibly fit two or more rollouts and the recency prior does not break the tie.",
    ),
  runner_up_enrollment_id: z
    .string()
    .nullable()
    .describe(
      "Second-best candidate id when confidence is 'low'. Null when confidence is high/medium. Required to be one of the provided enrollment ids when present.",
    ),
  reasoning: z
    .string()
    .describe(
      "One short sentence explaining the routing decision in plain English. Used for logging and the disambiguation prompt; the user may see a paraphrase of this.",
    ),
});

export interface RouteInput {
  /// The user's inbound message text, verbatim.
  userText: string;
  /// All currently active enrollments for this user. Caller is
  /// responsible for filtering out closed/archived plans.
  enrollments: ActiveEnrollmentSummary[];
  /// The enrollment id last routed in this thread, if any. Acts as
  /// a "stickiness prior" the classifier can use to break ties.
  recentlyRoutedEnrollmentId: string | null;
  /// When the recent routing happened, used by the classifier to
  /// weight the prior. Older = weaker signal.
  recentlyRoutedAt: Date | null;
}

/**
 * Decide which active enrollment a user's inbound Teams/sim message
 * is about. Throws when called with zero enrollments — that case is
 * a routing precondition failure, not a classifier outcome.
 */
export async function routeUserMessageToEnrollment(
  input: RouteInput,
): Promise<RouteDecision> {
  const {
    userText,
    enrollments,
    recentlyRoutedEnrollmentId,
    recentlyRoutedAt,
  } = input;

  if (enrollments.length === 0) {
    throw new Error("routeUserMessageToEnrollment called with no enrollments");
  }
  if (enrollments.length === 1) {
    return { kind: "single", enrollmentId: enrollments[0].enrollmentId };
  }

  // Without an LLM available, fall back to the recency prior or the
  // first enrollment. This keeps local dev / no-key environments
  // working — the trade-off is no smart routing, which is acceptable
  // because we wouldn't have AI replies in that mode anyway.
  if (!isAiEnabled()) {
    const prior =
      enrollments.find((e) => e.enrollmentId === recentlyRoutedEnrollmentId) ??
      enrollments[0];
    return {
      kind: "confident",
      enrollmentId: prior.enrollmentId,
      confidence: "medium",
      reasoning:
        "AI routing not configured; defaulted to the most recent active enrollment.",
    };
  }

  const enrollmentBlocks = enrollments
    .map((e, idx) => formatEnrollmentForRouter(e, idx + 1))
    .join("\n---\n");

  const recencyHint = formatRecencyHint(
    recentlyRoutedEnrollmentId,
    recentlyRoutedAt,
    enrollments,
  );

  const result = await callStructured(RouterOutputSchema, {
    system: ROUTER_SYSTEM_PROMPT,
    user: `# Active enrollments for this user
${enrollmentBlocks}

# Recently-routed prior
${recencyHint}

# User just said
"""
${userText}
"""`,
    toolName: "route_user_message",
    toolDescription:
      "Routes the user's inbound message to the most likely change enrollment.",
    temperature: 0,
    maxTokens: 512,
  });

  const chosen = enrollments.find((e) => e.enrollmentId === result.enrollment_id);
  if (!chosen) {
    // Model hallucinated an id. Treat as ambiguous so we ask the user.
    return {
      kind: "ambiguous",
      candidates: enrollments,
      reasoning:
        "Router returned an enrollment id that isn't in the active list — falling back to user disambiguation.",
    };
  }

  if (result.confidence === "low") {
    const runnerUp = enrollments.find(
      (e) =>
        e.enrollmentId === result.runner_up_enrollment_id &&
        e.enrollmentId !== chosen.enrollmentId,
    );
    const candidates = runnerUp ? [chosen, runnerUp] : enrollments;
    return {
      kind: "ambiguous",
      candidates,
      reasoning: result.reasoning,
    };
  }

  return {
    kind: "confident",
    enrollmentId: chosen.enrollmentId,
    confidence: result.confidence,
    reasoning: result.reasoning,
  };
}

const ROUTER_SYSTEM_PROMPT = `You are routing an inbound text message in Grasp, an employee-coaching system that runs multiple change rollouts in parallel.

Each enrollment pairs one user with one change rollout (a "plan"). The same user may be in multiple active plans at once. Your only job is to decide WHICH enrollment a single inbound message refers to, and how confident you are.

Rules:
- "high" confidence: the message references a topic, behavior, or term that clearly belongs to one rollout's summary, core mechanism, or stakeholder group. Or: the message is a direct continuation of the topic in that rollout's last_message_preview.
- "medium" confidence: one rollout is the best guess but the message itself is generic ("yeah ok", "I'll think about it", "what's next?"). In that case, prefer the recently-routed enrollment if one is provided and was set within the last day. Set runner_up_enrollment_id to null.
- "low" confidence: the message could genuinely fit two or more rollouts and you can't break the tie from content alone. Set runner_up_enrollment_id to the second-best id.
- Never invent an enrollment id. The id you return must exactly match one of the ids listed in the "Active enrollments" block.
- Reasoning must be one short sentence in plain English, written so a human can audit the routing decision.`;

function formatEnrollmentForRouter(
  e: ActiveEnrollmentSummary,
  position: number,
): string {
  const lines: string[] = [
    `[#${position}] enrollment_id: ${e.enrollmentId}`,
    `  plan_name: ${e.planName}`,
  ];
  if (e.planSummary) lines.push(`  plan_summary: ${e.planSummary}`);
  if (e.coreMechanism) lines.push(`  core_mechanism: ${e.coreMechanism}`);
  if (e.stakeholderGroupName) {
    lines.push(`  user_is_in_group: ${e.stakeholderGroupName}`);
  }
  if (e.kickoffDate) {
    lines.push(`  kickoff_date: ${e.kickoffDate.toISOString().slice(0, 10)}`);
  }
  if (e.targetDate) {
    lines.push(`  target_date: ${e.targetDate.toISOString().slice(0, 10)}`);
  }
  if (e.lastMessageAt) {
    lines.push(`  last_message_at: ${e.lastMessageAt.toISOString()}`);
  }
  lines.push(
    `  last_message_preview: ${e.lastMessagePreview ?? "(no prior conversation)"}`,
  );
  return lines.join("\n");
}

function formatRecencyHint(
  recentlyRoutedEnrollmentId: string | null,
  recentlyRoutedAt: Date | null,
  enrollments: ActiveEnrollmentSummary[],
): string {
  if (!recentlyRoutedEnrollmentId || !recentlyRoutedAt) {
    return "(none — this thread has no prior routing decision on file)";
  }
  const match = enrollments.find(
    (e) => e.enrollmentId === recentlyRoutedEnrollmentId,
  );
  if (!match) {
    return `(prior was ${recentlyRoutedEnrollmentId} but that enrollment is no longer active)`;
  }
  const ageMs = Date.now() - recentlyRoutedAt.getTime();
  const ageHours = Math.round(ageMs / (60 * 60 * 1000));
  return `enrollment_id: ${match.enrollmentId}\n  plan_name: ${match.planName}\n  set_about: ${ageHours}h ago`;
}
