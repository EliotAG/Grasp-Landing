/**
 * Per-employee, per-change conversation loop.
 *
 * One call to `runAgentTurn`:
 *   1. Persist the user's message.
 *   2. Hydrate full message history from the DB and rebuild the
 *      Anthropic `messages` array (including any tool_use /
 *      tool_result blocks from prior turns — required by the API).
 *   3. Call Claude with our tool definitions.
 *   4. If the model used tools, execute them, persist the results,
 *      and re-call Claude with the tool_result blocks until it
 *      returns a final text response.
 *   5. Persist the final assistant text and return it.
 *
 * The function is single-shot — it doesn't stream. The simulator and
 * Teams handler both call it after they've received a full user turn.
 *
 * Concurrency note: Anthropic's tool loop is inherently sequential
 * (each tool_use must be answered with a tool_result block before the
 * next assistant turn). We do NOT lock at the enrollment level here
 * because (a) Teams DM and the sim webhook are individually serial
 * for a single user, and (b) cross-channel double-sends are extremely
 * unlikely at MLP volume. If we see interleaving in the wild we'll
 * add a per-enrollment advisory lock.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { AgentMessageChannel, AgentMessageRole, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { DEFAULT_MODEL, getAnthropic, isAiEnabled } from "@/lib/ai/anthropic";
import type { AgentContext } from "./context";
import { AGENT_TOOLS, executeTool } from "./tools";
import { buildSystemPrompt } from "./prompt";

const MAX_TURNS_PER_CALL = 6;

export interface AgentTurnInput {
  context: AgentContext;
  userText: string;
  channel: AgentMessageChannel;
}

export interface AgentTurnResult {
  reply: string;
  toolCallsMade: number;
}

export async function runAgentTurn(
  input: AgentTurnInput,
): Promise<AgentTurnResult> {
  const { context, userText, channel } = input;

  // Persist the user's message first so the transcript is durable
  // even if the LLM call later fails.
  await prisma.agentMessage.create({
    data: {
      enrollmentId: context.enrollmentId,
      role: AgentMessageRole.user,
      content: userText,
      channel,
    },
  });

  // Soft-fail when the API key isn't set. Useful for local dev with
  // no Anthropic credentials — the simulator still echoes something
  // sensible so the wiring can be verified end-to-end.
  if (!isAiEnabled()) {
    const reply =
      "(AI is not configured on this Grasp instance. Set ANTHROPIC_API_KEY to enable the full kickoff conversation.)";
    await prisma.agentMessage.create({
      data: {
        enrollmentId: context.enrollmentId,
        role: AgentMessageRole.assistant,
        content: reply,
        channel: AgentMessageChannel.system,
      },
    });
    return { reply, toolCallsMade: 0 };
  }

  const client = getAnthropic();
  const systemPrompt = buildSystemPrompt(context);

  let toolCallsMade = 0;
  let finalText = "";

  // Inner loop: keep going as long as the model wants to call tools.
  // Each pass appends one assistant turn (and possibly one user turn
  // containing tool_results) and re-queries the model.
  for (let turn = 0; turn < MAX_TURNS_PER_CALL; turn++) {
    const messages = await rebuildMessages(context.enrollmentId);

    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      temperature: 0.6,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    });

    // Capture the assistant turn verbatim — both tool_use blocks (if
    // any) and the text. We persist text in `content` (for the
    // dashboard transcript) and tool_use blocks in `toolCalls` (for
    // re-hydration on the next turn).
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const assistantText = textBlocks.map((b) => b.text).join("\n").trim();

    await prisma.agentMessage.create({
      data: {
        enrollmentId: context.enrollmentId,
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
      // Done — model produced a final text turn.
      finalText = assistantText;
      break;
    }

    // Execute every tool the model called this turn and write a
    // single AgentMessage row containing all tool_result blocks.
    // (Anthropic requires the next user turn to carry tool_result
    // blocks paired to each tool_use id, in the same order.)
    const toolResults: Array<{ tool_use_id: string; content: string }> = [];
    for (const block of toolUseBlocks) {
      try {
        const result = await executeTool(context, block.name, block.input);
        toolResults.push({
          tool_use_id: block.id,
          content: result.text,
        });
        toolCallsMade += 1;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Tool execution failed";
        toolResults.push({
          tool_use_id: block.id,
          content: `Tool error: ${message}. Acknowledge to the user and continue without retrying this tool.`,
        });
      }
    }

    await prisma.agentMessage.create({
      data: {
        enrollmentId: context.enrollmentId,
        role: AgentMessageRole.tool,
        content: toolResults
          .map((r) => `${r.tool_use_id}: ${r.content}`)
          .join("\n"),
        channel: AgentMessageChannel.system,
        toolResults: toolResults as unknown as Prisma.InputJsonValue,
      },
    });
  }

  if (!finalText) {
    // Hit the loop cap without a clean termination. Fall back to a
    // safe acknowledgement so the user isn't left hanging.
    finalText =
      "Got it. Let me come back to you on this. (Hit my internal turn limit, so I'll surface this as a follow-up.)";
    await prisma.agentMessage.create({
      data: {
        enrollmentId: context.enrollmentId,
        role: AgentMessageRole.assistant,
        content: finalText,
        channel: AgentMessageChannel.system,
      },
    });
  }

  return { reply: finalText, toolCallsMade };
}

/**
 * Rebuild the Anthropic `messages` array from the persisted history.
 * Order matters: user/assistant alternation is enforced by the API,
 * with tool_use blocks paired to tool_result blocks.
 *
 * We map our own roles back to Anthropic's:
 *   - user role     → { role: "user", content: text }
 *   - assistant     → { role: "assistant", content: [text, ...tool_use] }
 *   - tool          → { role: "user",       content: [tool_result, ...] }
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
      // Per-turn system notes (proactive seed, leadership response
      // injection) ride on a user message because Anthropic only
      // supports ONE top-level system prompt. Tagged so the model
      // can tell apart "human said this" from "Grasp internal note".
      messages.push({
        role: "user",
        content: `[system note] ${row.content}`,
      });
      continue;
    }
    if (row.role === AgentMessageRole.assistant) {
      const blocks: Anthropic.ContentBlockParam[] = [];
      // Anthropic forbids empty text blocks. Skip text when the
      // assistant turn was tool-call-only.
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
