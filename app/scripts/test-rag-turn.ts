/**
 * Drive a single user turn through the agent for the most-recent
 * active enrollment, with an SOP-fact question, and report whether
 * the agent reached for `lookup_training_doc`.
 *
 * Usage: pnpm tsx scripts/test-rag-turn.ts ["question text"]
 *
 * Smoke-tests the entire RAG path:
 *   user message → context (training corpus summary) → prompt
 *   (lookup-tool block) → model decides to call lookup_training_doc
 *   → retrieval returns chunks → tool result → final reply.
 */

import { AgentMessageChannel } from "@prisma/client";

import { prisma } from "@/lib/db";
import { loadAgentContextByEmail } from "@/lib/agent/context";
import { runAgentTurn } from "@/lib/agent/conversation";

const DEFAULT_QUESTION =
  "Quick one — what's the deadline for logging a customer visit after I leave the meeting?";

async function main() {
  const question = process.argv.slice(2).join(" ").trim() || DEFAULT_QUESTION;

  const plan = await prisma.changePlan.findFirst({
    where: { status: "active" },
    orderBy: { activatedAt: "desc" },
    select: { id: true, name: true },
  });
  if (!plan) {
    console.error("No active plan found.");
    process.exit(1);
  }
  const enrollment = await prisma.changeEnrollment.findFirst({
    where: { changePlanId: plan.id },
    include: { employee: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!enrollment) {
    console.error("No enrollment found on the active plan.");
    process.exit(1);
  }
  console.log(
    `Plan: ${plan.name}\nEmployee: ${enrollment.employee.name} <${enrollment.employee.email}>\nQuestion: ${question}\n`,
  );

  const ctx = await loadAgentContextByEmail(enrollment.employee.email);
  if (!ctx) {
    console.error("Could not load agent context for that employee.");
    process.exit(1);
  }
  console.log(
    `Training corpus: ${ctx.trainingCorpus.indexedDocCount} docs / ${ctx.trainingCorpus.indexedChunkCount} chunks indexed`,
  );

  const before = await prisma.agentMessage.count({
    where: { enrollmentId: ctx.enrollmentId },
  });

  const result = await runAgentTurn({
    context: ctx,
    userText: question,
    channel: AgentMessageChannel.simulator,
  });

  const newRows = await prisma.agentMessage.findMany({
    where: { enrollmentId: ctx.enrollmentId },
    orderBy: { createdAt: "asc" },
    skip: before,
  });

  console.log(`\n--- New messages this turn (${newRows.length}) ---`);
  for (const r of newRows) {
    const tag = r.role.toUpperCase();
    if (r.toolCalls) {
      console.log(`[${tag}] tool_calls:`, JSON.stringify(r.toolCalls, null, 2));
    }
    if (r.toolResults) {
      console.log(`[${tag}] tool_results:`);
      console.log(r.content);
    }
    if (r.role === "assistant" || r.role === "user") {
      console.log(`[${tag}] ${r.content || "(empty)"}`);
    }
  }

  console.log(
    `\n--- Reply (${result.toolCallsMade} tool calls) ---\n${result.reply}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
