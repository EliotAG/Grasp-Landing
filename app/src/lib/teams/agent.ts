/**
 * AgentApplication wiring for the Teams bot.
 *
 * Three responsibilities:
 *
 *   1. Capture the ConversationReference for every Teams user we hear
 *      from, so we can later send proactive 1:1 messages without
 *      requiring the user to message us first. This is what unlocks the
 *      spec's day-zero kickoff DM and ongoing check-ins.
 *
 *   2. Send a one-time self-introduction the first time the bot lands
 *      in a 1:1 thread. We gate on `TeamsConversationReference.welcomeSentAt`
 *      so the two install events (`installationUpdate.add` and the
 *      legacy `conversationUpdate.membersAdded`) don't both fire it.
 *
 *   3. Route inbound user messages to the right active enrollment and
 *      hand off to `runAgentTurn`. Multiple-rollout disambiguation is
 *      handled by the LLM router; we only re-classify when there are
 *      2+ active enrollments.
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
  loadActiveEnrollmentSummariesByEmail,
  loadActiveEnrollmentSummariesByEmployeeId,
  loadAgentContextByEmployeeId,
  type ActiveEnrollmentSummary,
} from "@/lib/agent/context";
import { runAgentTurn } from "@/lib/agent/conversation";
import {
  routeUserMessageToEnrollment,
  type RouteDecision,
} from "@/lib/agent/router";
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
    // Greet only when *the bot itself* was the member added (i.e.
    // install). Avoids spamming when other people join a chat.
    const botId = context.activity.recipient?.id;
    const addedSelf = context.activity.membersAdded?.some(
      (m) => m.id === botId,
    );
    if (addedSelf) {
      await sendIntroIfNew(context);
    }
  });

  app.onActivity(ActivityTypes.InstallationUpdate, async (context) => {
    if (context.activity.action === "add") {
      await captureReference(context);
      await sendIntroIfNew(context);
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
    // Re-fetch the reference now that captureReference has upserted it,
    // so we have the routedEnrollment* fields plus the freshest
    // employeeId/userEmail link.
    const linkedRef = identity.aadObjectId
      ? await prisma.teamsConversationReference.findUnique({
          where: { aadObjectId: identity.aadObjectId },
          select: {
            id: true,
            employeeId: true,
            userEmail: true,
            routedEnrollmentId: true,
            routedEnrollmentAt: true,
          },
        })
      : null;

    const enrollments = linkedRef?.employeeId
      ? await loadActiveEnrollmentSummariesByEmployeeId(linkedRef.employeeId)
      : identity.email || linkedRef?.userEmail
        ? await loadActiveEnrollmentSummariesByEmail(
            (identity.email ?? linkedRef!.userEmail)!,
          )
        : [];

    if (enrollments.length === 0) {
      await context.sendActivity(
        MessageFactory.text(
          "Thanks — there isn't an active change rollout that includes you right now, so I'm just standing by. I'll be in touch when leadership kicks off the next one.",
        ),
      );
      return;
    }

    let decision: RouteDecision;
    try {
      decision = await routeUserMessageToEnrollment({
        userText: text,
        enrollments,
        recentlyRoutedEnrollmentId: linkedRef?.routedEnrollmentId ?? null,
        recentlyRoutedAt: linkedRef?.routedEnrollmentAt ?? null,
      });
    } catch (err) {
      console.error("[teams] router failed; falling back to most recent", err);
      // Fail-open to the most recently activated enrollment so the user
      // still gets a reply rather than a hard error. The router only
      // fires when there are 2+ enrollments and an LLM is available, so
      // a failure here is exceptional (network blip, model overload).
      decision = {
        kind: "confident",
        enrollmentId: enrollments[0].enrollmentId,
        confidence: "medium",
        reasoning: "Router failed; defaulted to most recent active rollout.",
      };
    }

    if (decision.kind === "ambiguous") {
      await context.sendActivity(
        MessageFactory.text(buildDisambiguationPrompt(decision.candidates)),
      );
      // Don't persist anything: the user's text isn't yet attached to
      // an enrollment, and we don't want to set the sticky pointer
      // until they clarify.
      return;
    }

    const enrollmentId = decision.enrollmentId;

    // Persist the routing decision so the next turn in this thread
    // can use it as a strong prior. We update on every confident
    // routing, including single-enrollment users, so the field
    // reflects current truth even when their plan membership churns.
    if (linkedRef?.id) {
      await prisma.teamsConversationReference.update({
        where: { id: linkedRef.id },
        data: {
          routedEnrollmentId: enrollmentId,
          routedEnrollmentAt: new Date(),
        },
      });
    }

    // We resolved the employee earlier (via captureReference) — pin
    // the agent context to the routed enrollment so we don't fall
    // back to "most recently activated" when the router picked the
    // older rollout.
    const employeeId = linkedRef?.employeeId;
    const ctx = employeeId
      ? await loadAgentContextByEmployeeId(employeeId, { enrollmentId })
      : null;
    if (!ctx) {
      await context.sendActivity(
        MessageFactory.text(
          "Thanks — I lost track of which rollout this is for. Could you say which change you mean?",
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

/**
 * Send the bot's self-introduction the first time we land in a 1:1
 * thread, and stamp `welcomeSentAt` so the second install event
 * doesn't double-send.
 *
 * Both `installationUpdate.add` and `conversationUpdate.membersAdded`
 * race to fire on a fresh install (Teams clients vary). We use a
 * conditional update on `welcomeSentAt: null` — the first writer wins
 * and the second is a no-op. The send only happens when the update
 * actually flipped a row from null → now, so the user sees exactly
 * one intro message.
 *
 * If the row hasn't been captured yet (unusual — `captureReference`
 * runs first in both handlers), we still send the intro so the user
 * isn't greeted by silence; a later `captureReference` on the same
 * thread will create the row with `welcomeSentAt` already populated
 * via the upsert path below.
 */
async function sendIntroIfNew(context: TurnContext): Promise<void> {
  const aadObjectId = context.activity.from?.aadObjectId;
  let shouldSend = true;
  if (aadObjectId) {
    // updateMany returns `{ count }` — we use a where clause that
    // requires `welcomeSentAt: null` AND the matching aad object id.
    // If `count` is 0 the row either doesn't exist yet or another
    // event already greeted; either way we treat it as already-sent
    // when we have a row, and as fresh when we don't.
    const existing = await prisma.teamsConversationReference.findUnique({
      where: { aadObjectId },
      select: { welcomeSentAt: true },
    });
    if (existing) {
      if (existing.welcomeSentAt) {
        shouldSend = false;
      } else {
        const updated = await prisma.teamsConversationReference.updateMany({
          where: { aadObjectId, welcomeSentAt: null },
          data: { welcomeSentAt: new Date() },
        });
        shouldSend = updated.count > 0;
      }
    }
  }
  if (!shouldSend) return;
  await context.sendActivity(MessageFactory.text(buildIntroMessage()));
}

function buildIntroMessage(): string {
  // Plain prose, no markdown — Teams DM conventions per the agent
  // tone guide. Two short paragraphs: who I am + why I'm here, and
  // what to expect next.
  return [
    "Hi — I'm Grasp. I'm an AI agent your leadership team uses to help land internal changes well. When there's a rollout that affects you, I'll DM you to share what's happening, hear how it's actually landing for you, and pass real concerns up to leadership so they can respond.",
    "Anything you tell me is summarized into aggregate signal for leadership; specific concerns I surface get sent up with attribution because that's the whole point of surfacing them. I'll tell you which mode we're in. If there's no active rollout for you right now I'll just stand by — you'll hear from me when leadership kicks the next one off.",
  ].join("\n\n");
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

/**
 * Build the user-facing message we send when the router can't decide
 * which active rollout an inbound message is about.
 *
 * We deliberately avoid numbered options ("1. CRM rollout") because
 * the user's reply needs to round-trip through the same router on
 * the next turn, and the router only sees plan names — not whatever
 * numbering we'd assign. Naming the plans inline gives the user
 * something concrete to echo back, and lets the router match on
 * "the CRM one" or "Q3 review".
 */
function buildDisambiguationPrompt(
  candidates: ActiveEnrollmentSummary[],
): string {
  const labels = candidates.map((c) => describeCandidate(c));
  if (labels.length === 2) {
    return `Quick check before I jump in — which rollout are you asking about: ${labels[0]} or ${labels[1]}? A few words is plenty.`;
  }
  const last = labels[labels.length - 1];
  const head = labels.slice(0, -1).join(", ");
  return `You're in a few rollouts right now and I want to make sure I'm helping with the right one. Which one is this about: ${head}, or ${last}? A few words is plenty.`;
}

function describeCandidate(c: ActiveEnrollmentSummary): string {
  // Bold the plan name so it stands out in the Teams render; append a
  // short tail of distinguishing context when present, capped to keep
  // the prompt scannable on mobile.
  const name = `**${c.planName}**`;
  const tail = c.coreMechanism ?? c.planSummary ?? c.stakeholderGroupName;
  if (!tail) return name;
  const trimmed = tail.length > 80 ? `${tail.slice(0, 79).trimEnd()}…` : tail;
  return `${name} (${trimmed})`;
}
