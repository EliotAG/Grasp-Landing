/**
 * Intake tools — the function-call surface the OpenAI Realtime agent uses
 * during a voice intake.
 *
 * Three responsibilities live here so the API route, the session config, and
 * any future test code share one source of truth:
 *
 *   1. Zod schemas for each tool's arguments (validation on the server).
 *   2. JSON Schema parameter definitions for the OpenAI tool registration
 *      (the model sees these in the session config).
 *   3. A single `dispatchIntakeTool(planId, name, args)` entrypoint that
 *      routes to the existing planner service for the actual mutation.
 *
 * The dispatcher always returns a JSON-serializable payload. Callers send
 * the `output` string back into the Realtime data channel as a
 * `function_call_output` item.
 *
 * Mutations are merge-style: handlers read existing fields the agent didn't
 * touch and pass them through unchanged so a partial set_brief or set_timing
 * never accidentally clears the other half.
 */

import { z } from "zod";

import { loadOwnedPlan } from "@/lib/changes/load";
import { prisma } from "@/lib/db";
import { retrieveChunks } from "@/lib/agent/rag/retrieve";

import {
  savePlannerAnnouncement,
  savePlannerCoreMechanism,
  savePlannerFrame,
  savePlannerSupport,
  savePlannerTimeline,
  upsertPlannerStakeholderGroup,
  type GroupSaveResult,
  type SaveResult,
} from "./services";

// ---------------------------------------------------------------------------
// Argument schemas
// ---------------------------------------------------------------------------

export const ReadPlanStateInput = z.object({}).strict();

export const SetBriefInput = z
  .object({
    name: z.string().trim().min(2).max(140).optional(),
    summary: z.string().trim().min(10).max(2000).optional(),
    coreMechanism: z.string().trim().min(10).max(2000).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.name?.length || v.summary?.length || v.coreMechanism?.length),
    { message: "Provide at least one of name, summary, or coreMechanism" },
  );

export const UpsertGroupInput = z.object({
  name: z.string().trim().min(2).max(140),
  description: z.string().trim().min(8).max(1000).optional(),
  behaviorSpec: z.string().trim().min(10).max(2000).optional(),
  memberEmails: z.array(z.string().trim().email()).max(80).optional(),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const SetTimingInput = z
  .object({
    kickoffDate: z.string().regex(ISO_DATE, "Use YYYY-MM-DD").nullable().optional(),
    targetDate: z.string().regex(ISO_DATE, "Use YYYY-MM-DD").nullable().optional(),
  })
  .refine(
    (v) => "kickoffDate" in v || "targetDate" in v,
    { message: "Provide kickoffDate, targetDate, or both" },
  );

export const SetSupportInput = z
  .object({
    responseCadenceHours: z.number().int().min(1).max(720).optional(),
    sendOnBehalf: z.boolean().optional(),
  })
  .refine(
    (v) => "responseCadenceHours" in v || "sendOnBehalf" in v,
    { message: "Provide responseCadenceHours, sendOnBehalf, or both" },
  );

export const SetAnnouncementInput = z.object({
  announcement: z.string().trim().min(20).max(8000),
});

export const SearchEmployeesInput = z.object({
  query: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(20).optional(),
});

export const SearchDocsInput = z.object({
  query: z.string().trim().min(2).max(300),
  limit: z.number().int().min(1).max(6).optional(),
});

export const DoneInput = z.object({}).strict();

// ---------------------------------------------------------------------------
// JSON-Schema definitions exposed to the OpenAI Realtime session.
//
// Hand-written rather than zod-to-json-schema'd so descriptions are
// model-friendly (one or two sentences each) and we avoid the runtime
// quirks of zod-to-json-schema appearing in the session payload.
// ---------------------------------------------------------------------------

export interface IntakeToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function intakeToolDefinitions(): IntakeToolDefinition[] {
  return [
    {
      type: "function",
      name: "read_plan_state",
      description:
        "Return the current change plan state — name, summary, core mechanism, dates, cadence, announcement, stakeholder groups with member counts, and a list of uploaded docs. Call this whenever you need to ground a question or confirm what's already on the plan.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "set_brief",
      description:
        "Set or refine the rollout brief — any subset of name, summary, and the core outcome to protect. Pass only the fields you want to update; others are preserved.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Short rollout name, 2–140 characters. E.g., 'Move to weekly product reviews'.",
          },
          summary: {
            type: "string",
            description:
              "Plain-language description of what is changing and why. 1–4 sentences.",
          },
          coreMechanism: {
            type: "string",
            description:
              "The key outcome to protect — what cannot break for this rollout to succeed.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "upsert_group",
      description:
        "Create or update a stakeholder group by name (case-insensitive). Fields you omit are preserved on existing groups. Member emails must come from search_employees results — do not invent.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Group name, 2–140 characters." },
          description: {
            type: "string",
            description: "Why this group exists in this rollout.",
          },
          behaviorSpec: {
            type: "string",
            description:
              "What this group needs to do differently. Make it observable: who, what, when, how often.",
          },
          memberEmails: {
            type: "array",
            description:
              "Employee emails to include. Use search_employees first; do not pass emails you have not seen returned by that tool. Omit to keep existing membership unchanged.",
            items: { type: "string", format: "email" },
            maxItems: 80,
          },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "set_timing",
      description:
        "Set the rollout kickoff and/or target dates. Dates must be ISO YYYY-MM-DD. Pass null to clear a date; omit a field to leave it unchanged.",
      parameters: {
        type: "object",
        properties: {
          kickoffDate: {
            type: ["string", "null"],
            description: "Kickoff date in YYYY-MM-DD or null to clear.",
          },
          targetDate: {
            type: ["string", "null"],
            description: "Target completion date in YYYY-MM-DD or null to clear.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "set_support",
      description:
        "Set follow-up cadence and who sends the announcement. responseCadenceHours is the maximum hours between Grasp follow-ups (1–720). sendOnBehalf=true means Grasp posts the announcement on the leader's behalf.",
      parameters: {
        type: "object",
        properties: {
          responseCadenceHours: { type: "integer", minimum: 1, maximum: 720 },
          sendOnBehalf: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "set_announcement",
      description:
        "Set the announcement text the leader (or Grasp) will send to stakeholders. Must be at least 20 characters.",
      parameters: {
        type: "object",
        required: ["announcement"],
        properties: {
          announcement: { type: "string", minLength: 20, maxLength: 8000 },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "search_employees",
      description:
        "Search the organization roster for employees matching a name, email, team, or title fragment. Use this before suggesting members for a stakeholder group.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Substring matched against name, email, team, title.",
          },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "search_docs",
      description:
        "Search the uploaded context (SOPs, briefs, notes) for excerpts most relevant to a question. Use this whenever the leader implies the answer is already in the docs and you want to confirm a detail.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 6 },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "done",
      description:
        "Signal that the intake conversation is complete. Call this once every required field is set and the leader has confirmed they want to move on. The browser will end the session and route them to the review screen.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export async function dispatchIntakeTool(
  planId: string,
  toolName: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  // loadOwnedPlan throws if the caller doesn't own this plan. The route
  // already authenticates, but we re-check ownership here so any callsite
  // (tests, future server actions) gets the same guarantee.
  const { plan } = await loadOwnedPlan(planId);

  switch (toolName) {
    case "read_plan_state": {
      ReadPlanStateInput.parse(rawArgs ?? {});
      return readPlanState(planId);
    }
    case "set_brief": {
      const parsed = SetBriefInput.safeParse(rawArgs);
      if (!parsed.success) return parseFail(parsed.error);
      return runBrief(planId, parsed.data);
    }
    case "upsert_group": {
      const parsed = UpsertGroupInput.safeParse(rawArgs);
      if (!parsed.success) return parseFail(parsed.error);
      return runUpsertGroup(plan.organizationId, planId, parsed.data);
    }
    case "set_timing": {
      const parsed = SetTimingInput.safeParse(rawArgs);
      if (!parsed.success) return parseFail(parsed.error);
      return runTiming(planId, parsed.data);
    }
    case "set_support": {
      const parsed = SetSupportInput.safeParse(rawArgs);
      if (!parsed.success) return parseFail(parsed.error);
      return runSupport(planId, parsed.data);
    }
    case "set_announcement": {
      const parsed = SetAnnouncementInput.safeParse(rawArgs);
      if (!parsed.success) return parseFail(parsed.error);
      return wrapSave(
        savePlannerAnnouncement(planId, {
          announcement: parsed.data.announcement,
        }),
      );
    }
    case "search_employees": {
      const parsed = SearchEmployeesInput.safeParse(rawArgs);
      if (!parsed.success) return parseFail(parsed.error);
      return searchEmployees(plan.organizationId, parsed.data);
    }
    case "search_docs": {
      const parsed = SearchDocsInput.safeParse(rawArgs);
      if (!parsed.success) return parseFail(parsed.error);
      return searchDocs(planId, parsed.data);
    }
    case "done": {
      DoneInput.parse(rawArgs ?? {});
      return { ok: true, data: { acknowledged: true } };
    }
    default:
      return { ok: false, error: `Unknown tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function readPlanState(planId: string): Promise<ToolResult> {
  const plan = await prisma.changePlan.findUnique({
    where: { id: planId },
    select: {
      name: true,
      summary: true,
      coreMechanism: true,
      kickoffDate: true,
      targetDate: true,
      responseCadenceHours: true,
      announcementSendOnBehalf: true,
      announcement: true,
      stakeholderGroups: {
        orderBy: { createdAt: "asc" },
        select: {
          name: true,
          description: true,
          behaviorSpec: true,
          members: {
            select: {
              employee: { select: { name: true, email: true } },
            },
          },
        },
      },
      trainingDocuments: {
        orderBy: { createdAt: "asc" },
        select: {
          filename: true,
          processingStatus: true,
          indexStatus: true,
        },
      },
    },
  });
  if (!plan) return { ok: false, error: "Plan not found" };

  return {
    ok: true,
    data: {
      name: plan.name,
      summary: plan.summary,
      coreMechanism: plan.coreMechanism,
      kickoffDate: plan.kickoffDate?.toISOString().slice(0, 10) ?? null,
      targetDate: plan.targetDate?.toISOString().slice(0, 10) ?? null,
      responseCadenceHours: plan.responseCadenceHours,
      sendOnBehalf: plan.announcementSendOnBehalf,
      announcement: plan.announcement,
      groups: plan.stakeholderGroups.map((group) => ({
        name: group.name,
        description: group.description,
        behaviorSpec: group.behaviorSpec,
        memberCount: group.members.length,
        memberEmails: group.members.map((m) => m.employee.email),
      })),
      docs: plan.trainingDocuments.map((doc) => ({
        filename: doc.filename,
        processingStatus: doc.processingStatus,
        indexStatus: doc.indexStatus,
      })),
    },
  };
}

async function runBrief(
  planId: string,
  input: z.infer<typeof SetBriefInput>,
): Promise<ToolResult> {
  if (input.name !== undefined || input.summary !== undefined) {
    const existing = await prisma.changePlan.findUnique({
      where: { id: planId },
      select: { name: true, summary: true },
    });
    const frame = await savePlannerFrame(planId, {
      name: input.name ?? existing?.name ?? "Untitled draft",
      summary: input.summary ?? existing?.summary ?? undefined,
    });
    if (!frame.ok) return { ok: false, error: frame.error };
  }
  if (input.coreMechanism !== undefined) {
    const core = await savePlannerCoreMechanism(planId, {
      coreMechanism: input.coreMechanism,
    });
    if (!core.ok) return { ok: false, error: core.error };
  }
  return { ok: true, data: { saved: true } };
}

async function runTiming(
  planId: string,
  input: z.infer<typeof SetTimingInput>,
): Promise<ToolResult> {
  // The timeline service overwrites both dates atomically. Pull the existing
  // values so a partial set_timing call doesn't accidentally clear the other
  // date.
  const existing = await prisma.changePlan.findUnique({
    where: { id: planId },
    select: { kickoffDate: true, targetDate: true },
  });

  function resolve(
    next: string | null | undefined,
    current: Date | null | undefined,
  ): string {
    if (next === undefined) {
      return current ? current.toISOString().slice(0, 10) : "";
    }
    return next ?? "";
  }

  const result = await savePlannerTimeline(planId, {
    kickoffDate: resolve(input.kickoffDate, existing?.kickoffDate),
    targetDate: resolve(input.targetDate, existing?.targetDate),
  });
  return wrapResult(result);
}

async function runSupport(
  planId: string,
  input: z.infer<typeof SetSupportInput>,
): Promise<ToolResult> {
  const existing = await prisma.changePlan.findUnique({
    where: { id: planId },
    select: { responseCadenceHours: true, announcementSendOnBehalf: true },
  });

  const responseCadenceHours =
    input.responseCadenceHours !== undefined
      ? input.responseCadenceHours
      : existing?.responseCadenceHours ?? "";

  const sendOnBehalf =
    input.sendOnBehalf !== undefined
      ? input.sendOnBehalf
      : existing?.announcementSendOnBehalf ?? false;

  const result = await savePlannerSupport(planId, {
    responseCadenceHours,
    announcementSendOnBehalf: sendOnBehalf,
  });
  return wrapResult(result);
}

async function runUpsertGroup(
  organizationId: string,
  planId: string,
  input: z.infer<typeof UpsertGroupInput>,
): Promise<ToolResult> {
  // Treat the group name as a stable handle: case-insensitive lookup so a
  // second call with the same name updates rather than duplicates.
  const existing = await prisma.stakeholderGroup.findFirst({
    where: {
      changePlanId: planId,
      name: { equals: input.name, mode: "insensitive" },
    },
    select: {
      id: true,
      description: true,
      behaviorSpec: true,
      members: { select: { employeeId: true } },
    },
  });

  // Resolve member emails -> employee IDs, scoped to this org. If the agent
  // omitted memberEmails entirely we preserve the existing membership; if
  // they passed [] we replace with no members.
  let memberEmployeeIds: string[];
  let missingEmails: string[] = [];
  if (input.memberEmails !== undefined) {
    if (input.memberEmails.length === 0) {
      memberEmployeeIds = [];
    } else {
      const wanted = input.memberEmails.map((email) => email.trim().toLowerCase());
      const employees = await prisma.employee.findMany({
        where: {
          organizationId,
          email: { in: wanted, mode: "insensitive" },
        },
        select: { id: true, email: true },
      });
      const matchedEmails = new Set(
        employees.map((employee) => employee.email.toLowerCase()),
      );
      missingEmails = wanted.filter((email) => !matchedEmails.has(email));
      memberEmployeeIds = employees.map((employee) => employee.id);
    }
  } else {
    memberEmployeeIds = existing?.members.map((m) => m.employeeId) ?? [];
  }

  const result: GroupSaveResult = await upsertPlannerStakeholderGroup(planId, {
    id: existing?.id,
    name: input.name,
    description: input.description ?? existing?.description ?? undefined,
    behaviorSpec: input.behaviorSpec ?? existing?.behaviorSpec ?? undefined,
    memberEmployeeIds,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    data: {
      groupId: result.groupId,
      created: !existing,
      memberCount: memberEmployeeIds.length,
      missingEmails,
    },
  };
}

async function searchEmployees(
  organizationId: string,
  input: z.infer<typeof SearchEmployeesInput>,
): Promise<ToolResult> {
  const limit = input.limit ?? 10;
  const q = input.query.trim();
  const employees = await prisma.employee.findMany({
    where: {
      organizationId,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { team: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ team: "asc" }, { name: "asc" }],
    take: limit,
    select: { name: true, email: true, team: true, title: true },
  });
  return { ok: true, data: { employees } };
}

async function searchDocs(
  planId: string,
  input: z.infer<typeof SearchDocsInput>,
): Promise<ToolResult> {
  const limit = input.limit ?? 4;
  const chunks = await retrieveChunks(planId, input.query, { topK: limit });
  return {
    ok: true,
    data: {
      chunks: chunks.map((chunk) => ({
        filename: chunk.filename,
        page: chunk.pageHint,
        text: chunk.content.slice(0, 1200),
        score: Number(chunk.score.toFixed(3)),
        mode: chunk.mode,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapSave(promise: Promise<SaveResult>): Promise<ToolResult> {
  return promise.then(wrapResult);
}

function wrapResult(result: SaveResult): ToolResult {
  return result.ok
    ? { ok: true, data: { savedAt: result.savedAt } }
    : { ok: false, error: result.error };
}

function parseFail(error: z.ZodError): ToolResult {
  return { ok: false, error: error.errors[0]?.message ?? "Invalid arguments" };
}
