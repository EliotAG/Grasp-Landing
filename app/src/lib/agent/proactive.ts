/**
 * Proactive agent turn — used when leadership has replied to a
 * surfaced concern and we need to push the response to the employee
 * out-of-band (no incoming message to react to).
 *
 * Mechanically very similar to `runAgentTurn`, but seeded by a
 * synthetic SYSTEM message that orients the model toward delivery
 * instead of the usual user-initiated turn. The system message is
 * persisted so the next user-initiated turn sees the same context.
 *
 * Delivery channels: tries Slack first, falls back to Teams, and mirrors
 * to the simulator (dev path). Marks the concerns `deliveredAt` only
 * when at least one channel actually accepted the message.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { AgentMessageChannel, AgentMessageRole, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { DEFAULT_MODEL, getAnthropic, isAiEnabled } from "@/lib/ai/anthropic";
import { getOrganizationPrimaryTextChannel } from "@/lib/channels";
import { sendSimMessage } from "@/lib/integrations/simulator";
import {
  SlackSendError,
  sendSlackMessageByEmployee,
} from "@/lib/slack/proactive";
import {
  describeSlackConfigProblem,
  getOrganizationSlackConfig,
} from "@/lib/slack/integration";
import {
  describeTeamsConfigProblem,
  getOrganizationTeamsConfig,
} from "@/lib/teams/integration";
import { loadAgentContextByEmail } from "./context";
import type { AgentContext } from "./context";
import { buildSystemPrompt } from "./prompt";
import { AGENT_TOOLS, executeTool } from "./tools";

const MAX_TURNS_PER_CALL = 4;

export interface ProactiveDeliveryResult {
  ok: boolean;
  /// Concern ids we marked deliveredAt on this run.
  deliveredConcernIds: string[];
  /// Per-channel send outcomes for observability + UI.
  channels: {
    slack: "sent" | "skipped_no_bot" | "failed" | "skipped";
    teams: "sent" | "skipped_no_bot" | "failed" | "skipped";
    simulator: "sent" | "skipped" | "failed";
  };
  reply: string;
  error?: string;
}

/**
 * Synthesize and deliver a proactive reply for one enrollment.
 *
 * The orchestrator (server action) calls this immediately after a
 * leader hits "respond" so the employee gets the leadership reply
 * without waiting for them to message us first.
 */
export async function deliverPendingResponses(
  enrollmentId: string,
): Promise<ProactiveDeliveryResult> {
  const enrollment = await prisma.changeEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { employee: { select: { email: true, name: true } } },
  });
  if (!enrollment) {
    return emptyFailure("Enrollment not found");
  }
  const ctx = await loadAgentContextByEmail(enrollment.employee.email);
  if (!ctx) {
    return emptyFailure(
      "Could not load agent context for this enrollment (likely the change plan is no longer active).",
    );
  }
  if (ctx.pendingLeadershipResponses.length === 0) {
    return {
      ok: true,
      deliveredConcernIds: [],
      channels: { slack: "skipped", teams: "skipped", simulator: "skipped" },
      reply: "(No pending leadership responses — nothing to deliver.)",
    };
  }
  if (!isAiEnabled()) {
    // Without an LLM we can still ferry the leader's reply over —
    // just verbatim, so leadership feedback never gets stuck on a
    // missing API key in dev. Wrap with a brief intro line.
    const reply = formatVerbatimFallback(ctx);
    return persistAndSend(ctx, reply, ctx.pendingLeadershipResponses);
  }

  const reply = await runProactiveTurn(ctx, buildProactiveSeed(ctx));
  return persistAndSend(ctx, reply, ctx.pendingLeadershipResponses);
}

/**
 * Persist a system seed and run the LLM loop until the assistant
 * stops calling tools. Returns the final synthesized reply text.
 *
 * Exported so other proactive-turn callers (scheduled check-ins,
 * future drift-detection nudges) reuse the same machinery without
 * having to duplicate the message-rebuild + tool-loop dance.
 */
export async function runProactiveTurn(
  ctx: AgentContext,
  seedSystemNote: string,
): Promise<string> {
  await prisma.agentMessage.create({
    data: {
      enrollmentId: ctx.enrollmentId,
      role: AgentMessageRole.system,
      content: seedSystemNote,
      channel: AgentMessageChannel.system,
    },
  });
  return runProactiveLoop(ctx);
}

function emptyFailure(reason: string): ProactiveDeliveryResult {
  return {
    ok: false,
    deliveredConcernIds: [],
    channels: { slack: "skipped", teams: "skipped", simulator: "skipped" },
    reply: "",
    error: reason,
  };
}

/**
 * Verbatim-fallback message when AI is disabled. Plain, transparent
 * about being a fallback so the dev knows their key is missing
 * rather than thinking the agent has gone weirdly stiff.
 */
function formatVerbatimFallback(ctx: AgentContext): string {
  const parts: string[] = [
    `Hi ${ctx.employee.name.split(" ")[0]} — leadership got back on something you raised.`,
    "",
  ];
  for (const r of ctx.pendingLeadershipResponses) {
    parts.push(
      `On "${r.concernSummary}":`,
      r.responseBody,
      "",
    );
  }
  parts.push(
    "(This is a verbatim relay — the AI layer is disabled on this Grasp instance, so you're getting the leader's words directly. Reply if anything's unclear.)",
  );
  return parts.join("\n");
}

/**
 * The synthetic system note that seeds the proactive turn.
 * Distinguished from the system PROMPT (which describes the agent
 * generally) — this is one specific instruction for one specific turn.
 */
function buildProactiveSeed(ctx: AgentContext): string {
  return `[PROACTIVE TURN — leadership has just replied to ${ctx.pendingLeadershipResponses.length} concern${ctx.pendingLeadershipResponses.length === 1 ? "" : "s"}. Generate ONE message to ${ctx.employee.name.split(" ")[0]} that delivers the response per the rules in the system prompt's "Pending leadership responses" section. This is your only job for this turn — don't elicit baseline / intentions, just close the loop on the concern${ctx.pendingLeadershipResponses.length === 1 ? "" : "s"}. Do NOT call mark_concern_resolved on this turn — that comes later when the employee reacts.]`;
}

async function runProactiveLoop(ctx: AgentContext): Promise<string> {
  const client = getAnthropic();
  const systemPrompt = buildSystemPrompt(ctx);

  for (let turn = 0; turn < MAX_TURNS_PER_CALL; turn++) {
    const messages = await rebuildMessages(ctx.enrollmentId);
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      temperature: 0.6,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const assistantText = textBlocks.map((b) => b.text).join("\n").trim();

    await prisma.agentMessage.create({
      data: {
        enrollmentId: ctx.enrollmentId,
        role: AgentMessageRole.assistant,
        content: assistantText,
        channel: AgentMessageChannel.system,
        toolCalls:
          toolUseBlocks.length > 0
            ? (toolUseBlocks.map((b) => ({
                id: b.id,
                name: b.name,
                input: b.input,
              })) as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });

    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      return assistantText;
    }

    // Tool use on a proactive turn is unexpected (we told the model
    // not to) but we handle it gracefully. The seed instructions
    // discouraged mark_concern_resolved here, but if the model
    // surfaces a NEW concern from re-reading the prior conversation
    // we let that through.
    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    for (const block of toolUseBlocks) {
      try {
        const result = await executeTool(ctx, block.name, block.input);
        toolResults.push({ tool_use_id: block.id, content: result.text });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool error";
        toolResults.push({
          tool_use_id: block.id,
          content: `Tool error: ${message}. Continue without retrying.`,
        });
      }
    }
    await prisma.agentMessage.create({
      data: {
        enrollmentId: ctx.enrollmentId,
        role: AgentMessageRole.tool,
        content: toolResults.map((r) => `${r.tool_use_id}: ${r.content}`).join("\n"),
        channel: AgentMessageChannel.system,
        toolResults: toolResults as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return "(I tried to deliver the leadership response but ran out of internal turns — leadership please ping the team directly while I retry.)";
}

export interface ChannelSendResult {
  channels: ProactiveDeliveryResult["channels"];
  anyDelivered: boolean;
  /// Last error message from a failed channel; null when nothing
  /// failed (i.e. all channels were either sent or skipped). Useful
  /// for surfacing a single human-readable error in the UI.
  error: string | null;
}

/**
 * Send a reply over the org-selected production text channel and the
 * internal simulator mirror.
 *
 * The important product rule: Slack vs Teams is an organization choice,
 * not an implicit fallback chain. If the org selected Slack, Teams is
 * skipped; if Slack is misconfigured, the send fails loudly so Settings
 * tells the truth about where employee messages are going.
 */
export async function sendReplyOnAllChannels(
  ctx: AgentContext,
  reply: string,
): Promise<ChannelSendResult> {
  const primaryChannel = await getOrganizationPrimaryTextChannel(
    ctx.employee.organizationId,
  );
  let slack: ProactiveDeliveryResult["channels"]["slack"] = "skipped";
  let slackErr: string | null = null;
  if (primaryChannel === "slack") {
    const slackConfig = await getOrganizationSlackConfig(
      ctx.employee.organizationId,
    );
    const slackProblem = describeSlackConfigProblem(slackConfig);
    slack = slackProblem ? "skipped" : "skipped_no_bot";
    if (slackProblem) slackErr = slackProblem;
    try {
      if (!slackProblem) {
        await sendSlackMessageByEmployee(ctx.employee, reply);
        slack = "sent";
      }
    } catch (err) {
      slack = "failed";
      slackErr =
        err instanceof SlackSendError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Slack send failed";
      console.error("[proactive] slack send failed:", slackErr);
    }
  }

  let ref: { id: string } | null = null;
  let teams: ProactiveDeliveryResult["channels"]["teams"] = "skipped";
  let teamsErr: string | null = null;
  if (primaryChannel === "teams") {
    const teamsConfig = await getOrganizationTeamsConfig(
      ctx.employee.organizationId,
    );
    const teamsProblem = describeTeamsConfigProblem(teamsConfig);
    teams = teamsProblem ? "skipped" : "skipped_no_bot";
    if (teamsProblem) teamsErr = teamsProblem;

    if (!teamsProblem) {
      const {
        ensureTeamsAppInstalledForEmployee,
        resolveTeamsReferenceForEmployee,
      } = await import("@/lib/teams/bootstrap");
      ref = await resolveTeamsReferenceForEmployee(ctx.employee);
      if (!ref) {
        await ensureTeamsAppInstalledForEmployee(ctx.employee);
        ref = await resolveTeamsReferenceForEmployee(ctx.employee);
      }
    }

    if (!teamsProblem && ref?.id) {
      try {
        const { sendTeamsMessageByReferenceId } = await import(
          "@/lib/teams/proactive"
        );
        await sendTeamsMessageByReferenceId(ref.id, reply);
        teams = "sent";
      } catch (err) {
        teams = "failed";
        teamsErr =
          err instanceof Error && err.name === "TeamsSendError"
            ? err.message
            : err instanceof Error
              ? err.message
              : "Teams send failed";
        console.error("[proactive] teams send failed:", teamsErr);
      }
    }
  }

  const sim = await sendSimMessage({
    email: ctx.employee.email,
    name: ctx.employee.name,
    text: reply,
    kind: "message",
  });
  let simulator: ProactiveDeliveryResult["channels"]["simulator"];
  if (sim.skipped) simulator = "skipped";
  else if (sim.ok) simulator = "sent";
  else simulator = "failed";

  const anyDelivered =
    slack === "sent" || teams === "sent" || simulator === "sent";
  return {
    channels: { slack, teams, simulator },
    anyDelivered,
    error:
      anyDelivered ? null : (slackErr ?? teamsErr ?? "No channel accepted the message."),
  };
}

/**
 * Send the synthesized reply via Teams + simulator and mark the
 * concerns delivered if at least one channel succeeded.
 */
async function persistAndSend(
  ctx: AgentContext,
  reply: string,
  pending: AgentContext["pendingLeadershipResponses"],
): Promise<ProactiveDeliveryResult> {
  const send = await sendReplyOnAllChannels(ctx, reply);

  // Mark the concerns delivered iff a channel actually took the
  // message. We deliberately do NOT mark on a pure failure — the
  // delivery worker (manual resend for now) will retry.
  let deliveredConcernIds: string[] = [];
  if (send.anyDelivered) {
    deliveredConcernIds = pending.map((p) => p.concernId);
    await prisma.concern.updateMany({
      where: { id: { in: deliveredConcernIds } },
      data: { deliveredAt: new Date(), deliveryError: null },
    });
  } else if (send.error) {
    await prisma.concern.updateMany({
      where: { id: { in: pending.map((p) => p.concernId) } },
      data: { deliveryError: send.error },
    });
  }

  return {
    ok: send.anyDelivered,
    deliveredConcernIds,
    channels: send.channels,
    reply,
    error: send.anyDelivered ? undefined : (send.error ?? undefined),
  };
}

/**
 * Same shape as conversation.ts::rebuildMessages, lifted here so the
 * proactive loop doesn't import the user-turn entry point. Keeping
 * this duplicated (small, explicit) is preferable to extracting a
 * shared helper that pulls the two loops into a circular import.
 */
async function rebuildMessages(
  enrollmentId: string,
): Promise<Anthropic.MessageParam[]> {
  const rows = await prisma.agentMessage.findMany({
    where: { enrollmentId },
    orderBy: { createdAt: "asc" },
  });
  const messages: Anthropic.MessageParam[] = [];
  for (const row of rows) {
    if (row.role === AgentMessageRole.user) {
      messages.push({ role: "user", content: row.content });
      continue;
    }
    if (row.role === AgentMessageRole.system) {
      // System rows we wrote (proactive seeds, leadership injection)
      // are folded into the conversation as user-role context blocks.
      // Anthropic only supports ONE top-level system prompt; per-turn
      // injections have to ride on a user message.
      messages.push({
        role: "user",
        content: `[system note] ${row.content}`,
      });
      continue;
    }
    if (row.role === AgentMessageRole.assistant) {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (row.content.trim().length > 0) {
        blocks.push({ type: "text", text: row.content });
      }
      const toolCalls = (row.toolCalls as
        | Array<{ id: string; name: string; input: Record<string, unknown> }>
        | null) ?? [];
      for (const tc of toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      if (blocks.length > 0) {
        messages.push({ role: "assistant", content: blocks });
      }
      continue;
    }
    if (row.role === AgentMessageRole.tool) {
      const toolResults = (row.toolResults as
        | Array<{ tool_use_id: string; content: string }>
        | null) ?? [];
      const blocks: Anthropic.ContentBlockParam[] = toolResults.map((r) => ({
        type: "tool_result",
        tool_use_id: r.tool_use_id,
        content: r.content,
      }));
      if (blocks.length > 0) {
        messages.push({ role: "user", content: blocks });
      }
      continue;
    }
  }
  return messages;
}
