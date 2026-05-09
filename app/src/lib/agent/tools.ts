/**
 * Agent tools the kickoff conversation can call.
 *
 * Each tool is one structured artifact the spec calls for:
 *   - record_three_dim_baseline → Piderit cognitive/emotional/behavioral
 *     baseline (Step 2 of per-change workflow).
 *   - record_implementation_intention → Gollwitzer trigger/action
 *     commitment (the "highest-leverage behavioral intervention" per
 *     the spec).
 *   - surface_concern → Piderit-classified objection routed to
 *     leadership.
 *
 * Convention:
 *   - `definition` is the Anthropic tool descriptor (name + JSON
 *     schema) handed to the model.
 *   - `execute` runs the side-effect against the database and
 *     returns a short user-facing string the agent reads back as
 *     the tool result. The string is designed to be quotable in the
 *     transcript ("Recorded.") so the dashboard view stays legible.
 */

import type Anthropic from "@anthropic-ai/sdk";

import { prisma } from "@/lib/db";
import type { AgentContext } from "./context";
import { retrieveChunks } from "./rag/retrieve";

export type ToolName =
  | "record_three_dim_baseline"
  | "record_three_dim_response"
  | "record_implementation_intention"
  | "surface_concern"
  | "mark_concern_resolved"
  | "lookup_training_doc";

export interface ToolExecutionResult {
  /// Short text we send back to the model as the tool_result content
  /// AND record on the AgentMessage row for transcript readability.
  text: string;
  /// Structured side-effects we performed (id of the row we created
  /// etc). Logged as the tool_results JSON column for observability.
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Tool definitions handed to Anthropic.
// ---------------------------------------------------------------------

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "record_three_dim_baseline",
    description:
      "Capture the employee's baseline three-dimensional response to this change (Piderit framework). Call this exactly once per change, after you've heard enough from the employee to characterize each dimension. If you only have one or two dimensions clearly, ask one more question before calling. Each field is a 1–2 sentence summary in the employee's own framing — do NOT moralize, just describe.",
    input_schema: {
      type: "object",
      properties: {
        cognitive: {
          type: "string",
          description:
            "What the employee thinks about the change on the merits — agree, skeptical, sees a specific tradeoff, etc. 1–2 sentences.",
        },
        emotional: {
          type: "string",
          description:
            "How the employee feels about the change — neutral, anxious, excited, fatigued from prior changes, etc. 1–2 sentences.",
        },
        behavioral: {
          type: "string",
          description:
            "What the employee is actually doing or planning to do — already started, waiting for X, blocked on Y, will start after the kickoff date, etc. 1–2 sentences.",
        },
      },
      required: ["cognitive", "emotional", "behavioral"],
      additionalProperties: false,
    },
  },
  {
    name: "record_three_dim_response",
    description:
      "Capture an updated three-dimensional response (Piderit) at a check-in or ad-hoc moment, AFTER the kickoff baseline is already on file. Use this when the conversation has surfaced enough signal on all three dimensions for the current state, especially when the system prompt has flagged an active check-in (day_3 / week_1 / week_3). Do NOT call this during the kickoff conversation — use record_three_dim_baseline for the first capture. Each field is a 1–2 sentence summary in the employee's own framing.",
    input_schema: {
      type: "object",
      properties: {
        cognitive: {
          type: "string",
          description:
            "What the employee currently thinks about the change on the merits. 1–2 sentences. If unchanged from baseline, say 'unchanged: <baseline summary>' so the dashboard can show that explicitly.",
        },
        emotional: {
          type: "string",
          description:
            "How the employee currently feels about the change. 1–2 sentences. Note any drift from baseline (warmer, more anxious, fatigued, energized).",
        },
        behavioral: {
          type: "string",
          description:
            "What the employee is currently doing or planning to do. 1–2 sentences. Note progress against the implementation intention if relevant.",
        },
      },
      required: ["cognitive", "emotional", "behavioral"],
      additionalProperties: false,
    },
  },
  {
    name: "record_implementation_intention",
    description:
      "Record an implementation intention in the form 'when X happens, I will do Y' (Gollwitzer). Call this once you and the employee have settled on a concrete trigger and action they're committing to. The trigger should be a real cue in their workflow (a specific meeting, the start of their day, finishing a task), not vague ('whenever I remember'). The action should be the specific behavior from the change spec.",
    input_schema: {
      type: "object",
      properties: {
        trigger: {
          type: "string",
          description:
            "The 'when X happens' cue, in the employee's own words. Should reference a concrete moment in their workflow.",
        },
        action: {
          type: "string",
          description:
            "The 'I will do Y' action, in the employee's own words. Should be the specific behavior the rollout is asking for.",
        },
      },
      required: ["trigger", "action"],
      additionalProperties: false,
    },
  },
  {
    name: "mark_concern_resolved",
    description:
      "Mark a previously-surfaced concern as resolved. Call this only AFTER you've delivered leadership's response and the employee has clearly signaled the response addresses the concern (verbal yes, says it answers their question, says they're good, etc). Do NOT mark resolved if they push back, ask a follow-up that re-opens the issue, or are non-committal. When unsure, leave the concern in `responded` status and let the next turn decide.",
    input_schema: {
      type: "object",
      properties: {
        concern_id: {
          type: "string",
          description:
            "The id of the concern being resolved. Must match a concern_id you saw in the 'Pending leadership responses' system block earlier in this conversation.",
        },
        resolution_note: {
          type: "string",
          description:
            "Brief one-line note for leadership about how the employee received the response (e.g. 'satisfied — moving on', 'partially addressed; she still wants the default-category feature').",
        },
      },
      required: ["concern_id", "resolution_note"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_training_doc",
    description:
      "Search the leadership-uploaded training materials for this change for passages relevant to a question. Use this WHEN the employee asks about a process detail, policy, SLA, deadline, eligibility rule, or any specific fact that would plausibly be in an SOP or onboarding doc — and you don't already have the answer in the system prompt. Do NOT use this for opinions, feelings, or general 'how do you feel about this' chatter. Returns up to a handful of short passages with their source filename and (when available) a page hint. If nothing relevant comes back, say so plainly to the employee — do not invent an answer.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A focused natural-language query. Mirror the employee's actual question rather than abstracting it. Avoid one-word queries — give the search at least a noun phrase.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "surface_concern",
    description:
      "Surface a concern from this employee to leadership. Call this when the employee raises something that (a) leadership should hear, (b) you can't resolve in the conversation alone, or (c) requires a leadership decision. Do NOT call this for every grumble — reserve it for things worth a leader's attention. Classify the dominant Piderit dimension and identify likely underlying drivers beyond surface content.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "One sentence describing the concern in neutral language a leader can scan. NOT a quote — your characterization.",
        },
        dimension: {
          type: "string",
          enum: ["cognitive", "emotional", "behavioral"],
          description:
            "Dominant Piderit dimension. Cognitive = disagrees on the merits. Emotional = how they feel about it (timing, fatigue, exclusion). Behavioral = a real-world blocker preventing them doing the thing.",
        },
        drivers: {
          type: "array",
          items: { type: "string" },
          description:
            "Likely underlying drivers beyond surface content. Examples: 'tiredness from prior rollout', 'felt excluded from the decision', 'genuine substantive disagreement', 'tooling not in place yet'. Keep to 1–4 items.",
        },
        suggested_response: {
          type: "string",
          description:
            "Optional. A starting point for how leadership might respond. Skip if you're unsure.",
        },
        raw_quote: {
          type: "string",
          description:
            "Verbatim snippet from the employee that captures what they actually said. Helps leadership ground the summary in the employee's voice.",
        },
      },
      required: ["summary", "dimension", "drivers", "raw_quote"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------
// Execution.
// ---------------------------------------------------------------------

interface ThreeDimInput {
  cognitive: string;
  emotional: string;
  behavioral: string;
}
interface IntentionInput {
  trigger: string;
  action: string;
}
interface ConcernInput {
  summary: string;
  dimension: "cognitive" | "emotional" | "behavioral";
  drivers: string[];
  suggested_response?: string;
  raw_quote: string;
}
interface ResolveInput {
  concern_id: string;
  resolution_note: string;
}
interface LookupInput {
  query: string;
}

/**
 * Dispatch a single tool call from a model turn, write the side
 * effect, and return the user-visible confirmation + structured
 * payload. Throws on unknown tool names so the model can't sneak in
 * something we don't have a handler for.
 */
export async function executeTool(
  ctx: AgentContext,
  name: string,
  input: unknown,
): Promise<ToolExecutionResult> {
  switch (name) {
    case "record_three_dim_baseline":
      return recordThreeDimBaseline(ctx, input as ThreeDimInput);
    case "record_three_dim_response":
      return recordThreeDimResponse(ctx, input as ThreeDimInput);
    case "record_implementation_intention":
      return recordImplementationIntention(ctx, input as IntentionInput);
    case "surface_concern":
      return surfaceConcern(ctx, input as ConcernInput);
    case "mark_concern_resolved":
      return markConcernResolved(ctx, input as ResolveInput);
    case "lookup_training_doc":
      return lookupTrainingDoc(ctx, input as LookupInput);
    default:
      throw new Error(`Unknown agent tool: ${name}`);
  }
}

async function lookupTrainingDoc(
  ctx: AgentContext,
  input: LookupInput,
): Promise<ToolExecutionResult> {
  const query = (input.query ?? "").trim();
  if (query.length < 2) {
    return {
      text: "Query was empty. Don't retry without a real question — just answer the employee from what you already know or say you don't know.",
      payload: { kind: "training_doc_lookup_invalid", query },
    };
  }
  const results = await retrieveChunks(ctx.plan.id, query, { topK: 4 });
  if (results.length === 0) {
    return {
      text: `No relevant passages found in the uploaded training materials for: "${query}". Tell the employee plainly that you don't have a documented answer for this — do NOT make one up. Offer to surface_concern if it's worth a leader's eyes.`,
      payload: { kind: "training_doc_lookup_empty", query },
    };
  }
  // Compact, model-friendly rendering. We include filename + page
  // hint with each passage so the agent can cite source faithfully
  // when it answers the employee.
  const lines: string[] = [
    `Found ${results.length} passage${results.length === 1 ? "" : "s"} for "${query}" (${results[0].mode === "semantic" ? "semantic" : "keyword"} match):`,
    "",
  ];
  for (const r of results) {
    const cite = `${r.filename}${r.pageHint ? `, p.${r.pageHint}` : ""}`;
    lines.push(
      `[${cite}] ${truncate(r.content, 600)}`,
      "",
    );
  }
  lines.push(
    "Use these to answer the employee's question. Cite the source filename casually in-line ('per the onboarding SOP'). If the passages contradict each other or don't actually answer the question asked, say so honestly — quote the bit that's relevant and acknowledge the gap. Do NOT invent details that aren't in the passages.",
  );
  return {
    text: lines.join("\n"),
    payload: {
      kind: "training_doc_lookup",
      query,
      mode: results[0].mode,
      results: results.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        filename: r.filename,
        pageHint: r.pageHint,
        score: Number(r.score.toFixed(4)),
      })),
    },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

async function recordThreeDimBaseline(
  ctx: AgentContext,
  input: ThreeDimInput,
): Promise<ToolExecutionResult> {
  // Two writes in a transaction: the denormalized baseline columns
  // on the enrollment (hot path for dashboard) AND the canonical
  // baseline snapshot row (so the cadence later compares against
  // the same data the dashboard renders). Idempotent: if we already
  // have a baseline, treat the call as a refinement and overwrite
  // the enrollment columns; the snapshot table just gains another
  // row, which is fine — we always read the EARLIEST baseline-kind
  // row as "the baseline" anyway.
  const snapshot = await prisma.$transaction(async (tx) => {
    await tx.changeEnrollment.update({
      where: { id: ctx.enrollmentId },
      data: {
        baselineCognitive: input.cognitive,
        baselineEmotional: input.emotional,
        baselineBehavioral: input.behavioral,
        baselineCapturedAt: new Date(),
      },
    });
    return tx.threeDimSnapshot.create({
      data: {
        enrollmentId: ctx.enrollmentId,
        kind: "baseline",
        cognitive: input.cognitive,
        emotional: input.emotional,
        behavioral: input.behavioral,
      },
      select: { id: true },
    });
  });
  return {
    text: "Baseline captured. Move on — don't read it back to the employee.",
    payload: {
      kind: "three_dim_baseline",
      enrollmentId: ctx.enrollmentId,
      snapshotId: snapshot.id,
    },
  };
}

/**
 * Recurring (post-baseline) three-dim capture. Writes a snapshot
 * with kind inferred from `ctx.activeCheckIn` (set by the
 * scheduled-check-in dispatcher) — falls back to `ad_hoc` for
 * mid-cadence ad-lib captures.
 *
 * If the agent calls this before the baseline exists, we redirect
 * to the baseline path and return guidance — that's the most likely
 * model error and we'd rather repair it than reject.
 */
async function recordThreeDimResponse(
  ctx: AgentContext,
  input: ThreeDimInput,
): Promise<ToolExecutionResult> {
  if (!ctx.baselineSnapshot) {
    return recordThreeDimBaseline(ctx, input);
  }
  const kind = ctx.activeCheckIn ? ctx.activeCheckIn.kind : "ad_hoc";
  const snapshot = await prisma.threeDimSnapshot.create({
    data: {
      enrollmentId: ctx.enrollmentId,
      kind,
      cognitive: input.cognitive,
      emotional: input.emotional,
      behavioral: input.behavioral,
      checkInId: ctx.activeCheckIn?.id ?? null,
    },
    select: { id: true, kind: true },
  });
  return {
    text: `Three-dim snapshot captured (${snapshot.kind}). Don't read it back; just continue the conversation.`,
    payload: {
      kind: "three_dim_snapshot",
      snapshotId: snapshot.id,
      snapshotKind: snapshot.kind,
    },
  };
}

async function recordImplementationIntention(
  ctx: AgentContext,
  input: IntentionInput,
): Promise<ToolExecutionResult> {
  const created = await prisma.implementationIntention.create({
    data: {
      enrollmentId: ctx.enrollmentId,
      trigger: input.trigger,
      action: input.action,
      stakeholderGroupId: ctx.stakeholderGroup?.id ?? null,
    },
    select: { id: true },
  });
  return {
    text: "Implementation intention recorded. Acknowledge briefly to the employee that you've got it.",
    payload: { kind: "implementation_intention", id: created.id },
  };
}

// Loose UUID guard: just enough to stop a hallucinated handle like
// "concern_1" from blowing up Prisma's UUID column on updateMany.
// Full canonical-form validation isn't needed — the where clause
// will simply not match anything for non-real ids.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function markConcernResolved(
  ctx: AgentContext,
  input: ResolveInput,
): Promise<ToolExecutionResult> {
  if (!UUID_RE.test(input.concern_id)) {
    return {
      text: `concern_id "${input.concern_id}" isn't a valid id — you may have made it up. The real ids are listed in the system prompt under "Recently delivered concerns". Don't retry this tool; just continue the conversation naturally.`,
      payload: { kind: "concern_resolve_invalid_id", concernId: input.concern_id },
    };
  }
  // Guard: only resolve concerns belonging to THIS enrollment. Stops
  // a hallucinated concern_id from a different employee's thread
  // accidentally closing someone else's open item.
  const updated = await prisma.concern.updateMany({
    where: {
      id: input.concern_id,
      enrollmentId: ctx.enrollmentId,
      // Only resolve things that have already been responded to and
      // delivered — anything else is probably a hallucination.
      respondedAt: { not: null },
    },
    data: { status: "resolved" },
  });
  if (updated.count === 0) {
    return {
      text: `Couldn't find concern ${input.concern_id} in this employee's open list. Don't try again — just continue the conversation naturally.`,
      payload: { kind: "concern_resolve_failed", concernId: input.concern_id },
    };
  }
  return {
    text: `Concern marked resolved. (Note for leadership: "${input.resolution_note}".) Thank the employee briefly.`,
    payload: {
      kind: "concern_resolved",
      concernId: input.concern_id,
      note: input.resolution_note,
    },
  };
}

async function surfaceConcern(
  ctx: AgentContext,
  input: ConcernInput,
): Promise<ToolExecutionResult> {
  const created = await prisma.concern.create({
    data: {
      enrollmentId: ctx.enrollmentId,
      summary: input.summary,
      dimension: input.dimension,
      drivers: input.drivers,
      suggestedResponse: input.suggested_response ?? null,
      rawQuote: input.raw_quote,
    },
    select: { id: true },
  });
  // The user-facing acknowledgement is intentionally not a "we've
  // routed this to leadership" promise — that's the response loop's
  // job, which is the next slice. We just confirm we heard it.
  return {
    text: "Concern logged for leadership review. Acknowledge to the employee that you heard them and that leadership will see it within their committed response window — do NOT promise a specific outcome.",
    payload: { kind: "concern", id: created.id },
  };
}
