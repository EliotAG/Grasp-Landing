/**
 * AgentApplication wiring for the Teams bot.
 *
 * Two responsibilities in this iteration:
 *
 *   1. Capture the ConversationReference for every Teams user we hear
 *      from, so we can later send proactive 1:1 messages without
 *      requiring the user to message us first. This is what unlocks the
 *      spec's day-zero kickoff DM and ongoing check-ins.
 *
 *   2. Echo any incoming text back to the user. Useful as a
 *      smoke-test once you've installed the bot in Teams and want to
 *      confirm the round-trip works before wiring up real check-in
 *      logic.
 *
 * Conversation references are captured on three triggers:
 *   - `installationUpdate.add`  — bot was just installed in 1:1 chat
 *   - `conversationUpdate.membersAdded` — same shape on legacy clients
 *   - `message`                 — backstop for already-installed users
 */

import {
  AgentApplication,
  MemoryStorage,
  MessageFactory,
  type TurnContext,
  type TurnState,
} from "@microsoft/agents-hosting";
import { ActivityTypes } from "@microsoft/agents-activity";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  loadAgentContextByEmail,
  loadAgentContextByEmployeeId,
} from "@/lib/agent/context";
import { runAgentTurn } from "@/lib/agent/conversation";
import { getTeamsPlaceholderAdapter } from "./adapter";

const globalForAgent = globalThis as unknown as {
  teamsAgent: AgentApplication<TurnState> | undefined;
};

export function getTeamsAgent(): AgentApplication<TurnState> {
  if (globalForAgent.teamsAgent) return globalForAgent.teamsAgent;

  // MemoryStorage is fine here — we don't lean on AgentApplication's
  // turn-state for cross-request data; conversation references live
  // in Postgres via captureReference below.
  //
  // Pass a placeholder adapter so AgentApplication doesn't construct
  // its own from environment-derived credentials. The real per-org
  // adapter is wired up at the route layer via `adapter.process(...)`.
  const app = new AgentApplication<TurnState>({
    storage: new MemoryStorage(),
    adapter: getTeamsPlaceholderAdapter(),
  });

  app.onConversationUpdate("membersAdded", async (context) => {
    await captureReference(context);
    // Send a one-time hello when *the bot itself* was the member added
    // (i.e. install). Avoids spamming when other people join a chat.
    const botId = context.activity.recipient?.id;
    const addedSelf = context.activity.membersAdded?.some(
      (m) => m.id === botId,
    );
    if (addedSelf) {
      await context.sendActivity(
        MessageFactory.text(
          "Hi — I'm Grasp. I'm connected. Send me anything and I'll echo it back so you know the round-trip works.",
        ),
      );
    }
  });

  app.onActivity(ActivityTypes.InstallationUpdate, async (context) => {
    if (context.activity.action === "add") {
      await captureReference(context);
      await context.sendActivity(
        MessageFactory.text(
          "Hi — I'm Grasp. I'm connected. Send me anything and I'll echo it back so you know the round-trip works.",
        ),
      );
    }
  });

  app.onActivity(ActivityTypes.Message, async (context) => {
    await captureReference(context);
    const text = context.activity.text?.trim() ?? "";
    if (!text) {
      await context.sendActivity(
        MessageFactory.text("Got an empty message — try sending some text."),
      );
      return;
    }

    const identity = extractTeamsIdentity(context.activity);
    const linkedRef = identity.aadObjectId
      ? await prisma.teamsConversationReference.findUnique({
          where: { aadObjectId: identity.aadObjectId },
          select: { employeeId: true, userEmail: true },
        })
      : null;
    const ctx = linkedRef?.employeeId
      ? await loadAgentContextByEmployeeId(linkedRef.employeeId)
      : identity.email || linkedRef?.userEmail
        ? await loadAgentContextByEmail((identity.email ?? linkedRef!.userEmail)!)
        : null;
    if (!ctx) {
      await context.sendActivity(
        MessageFactory.text(
          "Thanks — there isn't an active change rollout that includes you right now, so I'm just standing by. I'll be in touch when leadership kicks off the next one.",
        ),
      );
      return;
    }

    try {
      const turn = await runAgentTurn({
        context: ctx,
        userText: text,
        channel: "teams",
      });
      await context.sendActivity(MessageFactory.text(turn.reply));
    } catch (err) {
      console.error("[teams] agent turn failed", err);
      await context.sendActivity(
        MessageFactory.text(
          "I hit an error on my side processing that — try again in a moment, and if it keeps happening flag it to the leadership team.",
        ),
      );
    }
  });

  if (process.env.NODE_ENV !== "production") {
    globalForAgent.teamsAgent = app;
  }
  return app;
}

/**
 * Persist the user→bot ConversationReference so we can resume the
 * conversation later from a server action / cron / wizard handoff.
 *
 * Keyed on AAD object id (stable across renames). Stored as JSON
 * verbatim because CloudAdapter.continueConversation accepts the
 * full ConversationReference shape.
 */
async function captureReference(context: TurnContext): Promise<void> {
  const activity = context.activity;
  const ref = activity.getConversationReference();
  const identity = extractTeamsIdentity(activity);
  const aadObjectId = identity.aadObjectId;
  const conversationId = ref.conversation?.id;
  const serviceUrl = ref.serviceUrl;
  const tenantId =
    activity.conversation?.tenantId ??
    (activity.channelData as { tenant?: { id?: string } } | undefined)?.tenant
      ?.id ??
    "unknown";

  if (!aadObjectId || !conversationId || !serviceUrl) {
    // Group/channel installs and edge cases land here. We only support
    // 1:1 user conversations in this iteration.
    return;
  }

  const employeeFilters: Prisma.EmployeeWhereInput[] = [
    { microsoftAadObjectId: aadObjectId },
  ];
  if (identity.email) {
    employeeFilters.push({
      email: { equals: identity.email, mode: "insensitive" },
    });
  }

  const matchedEmployee = await prisma.employee.findFirst({
    where: { OR: employeeFilters },
    select: {
      id: true,
      organizationId: true,
      microsoftAadObjectId: true,
    },
  });

  if (matchedEmployee && !matchedEmployee.microsoftAadObjectId) {
    await prisma.employee.update({
      where: { id: matchedEmployee.id },
      data: {
        microsoftAadObjectId: aadObjectId,
        microsoftUserPrincipalName: identity.email,
        teamsBootstrapCheckedAt: new Date(),
        teamsBootstrapError: null,
      },
    });
  }

  await prisma.teamsConversationReference.upsert({
    where: { aadObjectId },
    create: {
      aadObjectId,
      organizationId: matchedEmployee?.organizationId ?? null,
      employeeId: matchedEmployee?.id ?? null,
      userEmail: identity.email,
      userName: identity.name,
      tenantId,
      serviceUrl,
      conversationId,
      // Cast: ConversationReference is JSON-serializable but Prisma's
      // Json type is `JsonValue`; round-trip is what we care about.
      reference: ref as unknown as object,
      lastActivityAt: new Date(),
    },
    update: {
      organizationId: matchedEmployee?.organizationId ?? undefined,
      employeeId: matchedEmployee?.id ?? undefined,
      userEmail: identity.email ?? undefined,
      userName: identity.name ?? undefined,
      tenantId,
      serviceUrl,
      conversationId,
      reference: ref as unknown as object,
      lastActivityAt: new Date(),
    },
  });
}

function extractTeamsIdentity(activity: TurnContext["activity"]): {
  aadObjectId: string | undefined;
  email: string | null;
  name: string | null;
} {
  const fromProps = readRecord(activity.from?.properties);
  const channelData = readRecord(activity.channelData);
  const channelUser = readRecord(channelData?.user);

  const email =
    firstString(
      fromProps?.email,
      fromProps?.userPrincipalName,
      fromProps?.upn,
      channelUser?.email,
      channelUser?.userPrincipalName,
      channelUser?.upn,
    )?.toLowerCase() ?? null;

  return {
    aadObjectId:
      activity.from?.aadObjectId ??
      firstString(
        fromProps?.aadObjectId,
        fromProps?.objectId,
        channelUser?.aadObjectId,
        channelUser?.objectId,
      ),
    email,
    name:
      firstString(activity.from?.name, fromProps?.name, channelUser?.name) ??
      email,
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  )?.trim();
}
